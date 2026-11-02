import { transcribeStream } from '@qvac/sdk'
import type { Segment } from '../shared/types'

/**
 * Sesión de transcripción en streaming (Whisper + VAD Silero).
 * El SDK emite un texto por cada tramo de voz que el VAD da por completo; los
 * tiempos se calculan aquí con el reloj de audio recibido (100 ms por chunk).
 */
export class Transcriber {
  private session?: Awaited<ReturnType<typeof transcribeStream>>
  private bytes = 0
  private nextId = 1
  private done?: Promise<void>
  private failed = false

  async start(modelId: string, onSegment: (s: Segment) => void, onError: (e: Error) => void) {
    const session = await transcribeStream({ modelId })
    this.session = session
    let lastEnd = 0
    this.done = (async () => {
      try {
        for await (const text of session) {
          const clean = text.trim()
          if (!clean) continue
          const endMs = this.audioMs()
          onSegment({ id: this.nextId++, startMs: lastEnd, endMs, text: clean })
          lastEnd = endMs
        }
      } catch (e) {
        this.failed = true
        session.destroy() // libera la sesión para poder abrir otra
        onError(e instanceof Error ? e : new Error(String(e)))
      }
    })()
  }

  private audioMs() { return Math.round((this.bytes / 4 / 16000) * 1000) }

  write(pcm: Buffer) {
    if (this.failed) return
    this.bytes += pcm.length
    this.session?.write(pcm)
  }

  /** Cierra el audio y espera a que salgan los segmentos pendientes. */
  async stop() {
    if (!this.failed) this.session?.end()
    await this.done
    this.session = undefined
  }
}
