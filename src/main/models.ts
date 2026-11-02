import { loadModel, unloadModel, QWEN3_5_2B_MULTIMODAL_Q4_K_M, WHISPER_SMALL_Q8_0, VAD_SILERO_5_1_2 } from '@qvac/sdk'
import type { ModelState, Settings } from '../shared/types'

// Constantes del registro de QVAC. Cambiarlas aquí cambia los modelos de toda la app.
const WHISPER_MODEL = WHISPER_SMALL_Q8_0 // multilingüe
const LLM_MODEL = QWEN3_5_2B_MULTIMODAL_Q4_K_M

type Listener = (whisper: ModelState, llm: ModelState) => void

/** Carga y descarga los dos modelos. Los IDs se reutilizan entre sesiones. */
export class ModelService {
  whisperId?: string
  llmId?: string
  private whisper: ModelState = { stage: 'idle' }
  private llm: ModelState = { stage: 'idle' }
  private loading?: Promise<void>
  private loadedLanguage?: string

  constructor(private emit: Listener) {}

  private set(which: 'whisper' | 'llm', s: ModelState) {
    this[which] = s
    this.emit(this.whisper, this.llm)
  }

  /** Idempotente: si ya están cargados con el mismo idioma, no hace nada. */
  ensureLoaded(settings: Settings): Promise<void> {
    this.loading ??= this.loadAll(settings).finally(() => { this.loading = undefined })
    return this.loading
  }

  private async loadAll(settings: Settings) {
    if (this.whisperId && this.loadedLanguage !== settings.language) {
      await unloadModel({ modelId: this.whisperId })
      this.whisperId = undefined
    }
    if (!this.whisperId) {
      this.loadedLanguage = settings.language
      this.whisperId = await this.load('whisper', () => loadModel({
        modelSrc: WHISPER_MODEL,
        modelType: 'whisper',
        onProgress: (p) => this.set('whisper', { stage: 'downloading', percent: Math.round(p.percentage) }),
        modelConfig: {
          vadModelSrc: VAD_SILERO_5_1_2,
          audio_format: 'f32le',
          strategy: 'greedy',
          n_threads: 4,
          ...(settings.language === 'auto' ? {} : { language: settings.language }),
          no_timestamps: true,
          suppress_blank: true,
          suppress_nst: true,
          temperature: 0.0,
          vad_params: { threshold: 0.6, min_speech_duration_ms: 250, min_silence_duration_ms: 500, max_speech_duration_s: 15.0, speech_pad_ms: 200 }
        }
      }))
    }
    if (!this.llmId) {
      this.llmId = await this.load('llm', () => loadModel({
        modelSrc: LLM_MODEL,
        modelType: 'llm',
        onProgress: (p) => this.set('llm', { stage: 'downloading', percent: Math.round(p.percentage) }),
        // reasoning_budget: 0 apaga el canal de razonamiento (<think>) de Qwen3.5
        modelConfig: { ctx_size: 8192, tools: true, reasoning_budget: 0 }
      }))
    }
  }

  private async load(which: 'whisper' | 'llm', fn: () => Promise<string>): Promise<string> {
    this.set(which, { stage: 'loading' })
    try {
      const id = await fn()
      this.set(which, { stage: 'ready' })
      return id
    } catch (e) {
      this.set(which, { stage: 'error', error: String(e instanceof Error ? e.message : e) })
      throw e
    }
  }

  async unloadAll() {
    for (const id of [this.whisperId, this.llmId]) if (id) await unloadModel({ modelId: id }).catch(() => {})
    this.whisperId = this.llmId = undefined
  }
}
