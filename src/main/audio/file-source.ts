import { spawn, type ChildProcess } from 'node:child_process'
import type { AudioSource } from './audio-source'

const CHUNK_BYTES = 1600 * 4 // 100 ms a 16 kHz, f32le
const SPEED = 4 // se alimenta a 4x del tiempo real: la transcripción tarda lo que tarda, pero sin esperar al reloj
const HIGH_WATER = 8 * 1024 * 1024 // pausa ffmpeg si hay tanto audio sin entregar

/** Lee un archivo de audio (o vídeo) cualquiera con ffmpeg y lo entrega como si fuera una captura. */
export class FileSource implements AudioSource {
  private proc?: ChildProcess
  private timer?: NodeJS.Timeout

  constructor(private path: string) {}

  async start(onChunk: (pcm: Buffer) => void, onError: (e: Error) => void, onEnd?: () => void) {
    const proc = spawn('ffmpeg', ['-v', 'error', '-i', this.path, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    let pending = Buffer.alloc(0)
    let decoded = false // ffmpeg ya terminó
    let stderr = ''

    proc.stdout!.on('data', (data: Buffer) => {
      pending = Buffer.concat([pending, data])
      if (pending.length > HIGH_WATER) proc.stdout!.pause()
    })
    proc.stderr!.on('data', (d: Buffer) => { stderr += d })
    proc.on('error', (e) => onError(new Error(`No se pudo ejecutar ffmpeg (¿está instalado?): ${e.message}`)))
    proc.on('close', (code, signal) => {
      if (this.proc !== proc) return // detenido a mano
      if (code !== 0 && signal !== 'SIGTERM') { this.clear(); onError(new Error(`ffmpeg no pudo leer el archivo (${code}): ${stderr.trim()}`)); return }
      decoded = true
    })

    this.timer = setInterval(() => {
      if (pending.length >= CHUNK_BYTES) {
        onChunk(pending.subarray(0, CHUNK_BYTES))
        pending = pending.subarray(CHUNK_BYTES)
        if (pending.length < HIGH_WATER / 2) proc.stdout!.resume()
      } else if (decoded) {
        this.clear()
        if (pending.length > 0) onChunk(Buffer.concat([pending, Buffer.alloc(CHUNK_BYTES - pending.length)])) // resto, con silencio
        onEnd?.()
      }
    }, 100 / SPEED)
  }

  private clear() { if (this.timer) clearInterval(this.timer); this.timer = undefined }

  async stop() {
    const proc = this.proc
    this.proc = undefined
    this.clear()
    proc?.kill('SIGTERM')
  }
}
