import { EventEmitter } from 'node:events'
import type { Alert, RttEvent, Segment, Settings, SourceChoice } from '../shared/types'
import { createAudioSource, rms, type AudioSource } from './audio/audio-source'
import { Analyzer } from './analyzer'
import type { ModelService } from './models'
import { TelegramNotifier } from './notifier-telegram'
import { SessionStore } from './session-store'
import { Transcriber } from './transcriber'

/** Orquesta una sesión: audio -> transcripción -> análisis -> alertas -> disco/Telegram. */
export class SessionManager extends EventEmitter {
  private status: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle'
  private audio?: AudioSource
  private transcriber?: Transcriber
  private analyzer?: Analyzer
  private notifier?: TelegramNotifier
  private store?: SessionStore
  private segments: Segment[] = []
  private alerts: Alert[] = []
  private sinceAnalysis = 0
  private analysis?: Promise<void>
  private analysisPending = false
  private lastLevel = 0
  private window = 12

  constructor(private models: ModelService, private getSettings: () => Promise<Settings>) { super() }

  private progress(text: string) { this.emitEvent({ type: 'progress', text }) }
  private emitEvent(e: RttEvent) { this.emit('event', e) }
  private fail(message: string) { this.emitEvent({ type: 'error', message }) }
  private setStatus(status: typeof this.status) {
    this.status = status
    this.emitEvent({ type: 'status', status, session: this.store?.name })
  }

  get isIdle() { return this.status === 'idle' }

  async start(source: SourceChoice = { kind: 'system' }) {
    if (this.status !== 'idle') return
    this.setStatus('starting')
    try {
      const settings = await this.getSettings()
      await this.models.ensureLoaded(settings)
      this.store = new SessionStore(settings.sessionsDir)
      await this.store.init()
      this.segments = []; this.alerts = []; this.sinceAnalysis = 0
      this.analysisPending = false
      this.window = settings.analysisWindowSegments
      this.analyzer = new Analyzer(this.models.llmId!)
      this.notifier = new TelegramNotifier(settings.telegram, (m) => this.fail(m))

      this.transcriber = new Transcriber()
      await this.transcriber.start(
        this.models.whisperId!,
        (s) => this.onSegment(s, settings),
        (e) => { this.fail(`Transcripción: ${e.message}`); void this.stop() }
      )

      this.audio = createAudioSource(source, settings.audioTarget)
      await this.audio.start(
        (pcm) => {
          this.transcriber?.write(pcm)
          const now = Date.now()
          if (now - this.lastLevel > 100) { this.lastLevel = now; this.emitEvent({ type: 'level', rms: rms(pcm) }) }
        },
        (e) => { this.fail(e.message); void this.stop() },
        () => { void this.stop() } // archivo terminado: cierra la sesión y genera el resumen
      )
      this.setStatus('recording')
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e))
      await this.audio?.stop().catch(() => {})
      this.audio = undefined
      this.setStatus('idle')
    }
  }

  private onSegment(s: Segment, settings: Settings) {
    this.segments.push(s)
    this.emitEvent({ type: 'segment', segment: s })
    void this.store?.appendSegment(s)
    if (++this.sinceAnalysis >= settings.analysisEverySegments) {
      this.sinceAnalysis = 0
      this.queueAnalysis()
    }
  }

  // Un análisis en curso y, como mucho, uno en espera: si el LLM va más lento que el audio,
  // las peticiones intermedias se fusionan en una sola (siempre ve los últimos segmentos).
  private queueAnalysis() {
    this.analysisPending = true
    this.analysis ??= this.drainAnalysis().finally(() => { this.analysis = undefined })
  }

  private async drainAnalysis() {
    while (this.analysisPending && this.analyzer) {
      this.analysisPending = false
      try {
        for (const alert of await this.analyzer.findAlerts(this.segments.slice(-this.window), this.alerts)) {
          this.alerts.push(alert)
          this.emitEvent({ type: 'alert', alert })
          this.notifier?.notify(alert)
        }
        await this.store?.saveAlerts(this.alerts)
      } catch (e) {
        this.fail(`Análisis: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  async stop() {
    if (this.status !== 'recording' && this.status !== 'starting') return
    this.setStatus('stopping')
    try {
      await this.audio?.stop()
      await this.transcriber?.stop() // vacía los segmentos pendientes
      // Se descarta el análisis en espera: solo se termina el que ya está en curso.
      this.analysisPending = false
      this.progress('Terminando el análisis en curso…')
      await this.analysis
      // Último pase solo si quedan segmentos sin analizar.
      if (this.sinceAnalysis > 0) { this.progress('Analizando los últimos segmentos…'); this.queueAnalysis(); await this.analysis }
      this.progress('Generando resumen…')
      const transcript = this.segments.map((s) => s.text).join('\n')
      const summary = await this.analyzer!.summarize(transcript, (t) => this.progress(t))
      await this.store?.saveSummary(summary)
      await this.store?.saveAlerts(this.alerts)
      this.emitEvent({ type: 'summary', summary })
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e))
    } finally {
      this.audio = undefined; this.transcriber = undefined; this.analyzer = undefined
      this.progress('')
      this.setStatus('idle')
    }
  }

  get sessionsDir() { return this.store?.root }
}
