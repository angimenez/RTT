import { LinuxPipewireSource } from './linux-pipewire'

/** Fuente de audio: entrega PCM f32le, 16 kHz, mono, en chunks de 100 ms. */
export interface AudioSource {
  start(onChunk: (pcm: Buffer) => void, onError: (e: Error) => void): Promise<void>
  stop(): Promise<void>
}

export function createAudioSource(target: string): AudioSource {
  if (process.platform === 'linux') return new LinuxPipewireSource(target)
  throw new Error(`Captura de audio del sistema no implementada en ${process.platform} (ver README.md, Limitaciones conocidas)`)
}

/** Nivel RMS (0..1) de un chunk f32le, para el indicador de la UI. */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 4)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) { const v = pcm.readFloatLE(i * 4); sum += v * v }
  return Math.sqrt(sum / n)
}
