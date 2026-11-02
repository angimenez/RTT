import type { SourceChoice } from '../../shared/types'
import { FileSource } from './file-source'
import { LinuxPipewireSource } from './linux-pipewire'

/** Fuente de audio: entrega PCM f32le, 16 kHz, mono, en chunks de 100 ms. */
export interface AudioSource {
  /** `onEnd` solo lo usan las fuentes finitas (archivo): avisa de que no queda más audio. */
  start(onChunk: (pcm: Buffer) => void, onError: (e: Error) => void, onEnd?: () => void): Promise<void>
  stop(): Promise<void>
}

/** `target` (ajuste «Destino PipeWire») solo se aplica al audio del sistema. */
export function createAudioSource(source: SourceChoice, target: string): AudioSource {
  if (source.kind === 'file') return new FileSource(source.path)
  if (process.platform === 'linux') return new LinuxPipewireSource(source.kind === 'mic' ? 'mic' : 'system', target)
  throw new Error(`Captura de audio no implementada en ${process.platform} (ver README.md, Limitaciones conocidas)`)
}

/** Nivel RMS (0..1) de un chunk f32le, para el indicador de la UI. */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 4)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) { const v = pcm.readFloatLE(i * 4); sum += v * v }
  return Math.sqrt(sum / n)
}
