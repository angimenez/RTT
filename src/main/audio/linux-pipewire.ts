import { spawn, type ChildProcess } from 'node:child_process'
import type { AudioSource } from './audio-source'

const CHUNK_BYTES = 1600 * 4 // 100 ms a 16 kHz, f32le (formato que usan los ejemplos del SDK)

/**
 * Captura con pw-record (PipeWire). Modo 'system': el monitor del sink de salida
 * (`stream.capture.sink=true` hace que, sin --target, grabe lo que suena por el sink por defecto).
 * Modo 'mic': la fuente de entrada por defecto (micrófono).
 */
export class LinuxPipewireSource implements AudioSource {
  private proc?: ChildProcess

  constructor(private mode: 'system' | 'mic', private target: string) {}

  async start(onChunk: (pcm: Buffer) => void, onError: (e: Error) => void) {
    const args = ['--raw', '--rate', '16000', '--channels', '1', '--format', 'f32']
    if (this.mode === 'system') {
      args.push('-P', '{ stream.capture.sink=true }')
      if (this.target) args.push('--target', this.target)
    }
    args.push('-')

    const proc = spawn('pw-record', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    let pending = Buffer.alloc(0)

    proc.stdout!.on('data', (data: Buffer) => {
      pending = Buffer.concat([pending, data])
      while (pending.length >= CHUNK_BYTES) {
        onChunk(pending.subarray(0, CHUNK_BYTES))
        pending = pending.subarray(CHUNK_BYTES)
      }
    })
    let stderr = ''
    proc.stderr!.on('data', (d: Buffer) => { stderr += d })
    proc.on('error', (e) => onError(new Error(`No se pudo ejecutar pw-record: ${e.message}`)))
    proc.on('exit', (code, signal) => {
      if (this.proc === proc && code !== 0 && signal !== 'SIGTERM') onError(new Error(`pw-record terminó (${code}): ${stderr.trim()}`))
    })
  }

  async stop() {
    const proc = this.proc
    this.proc = undefined
    proc?.kill('SIGTERM')
  }
}
