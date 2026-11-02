import { loadModel, unloadModel, textToSpeech, TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0 } from '@qvac/sdk'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '../shared/types'

const run = promisify(execFile)
const SAMPLE_RATE = 24000 // solo por defecto: el motor informa la tasa real
const REFERENCE_SECONDS = 10

/** Quita el markdown del resumen para que el TTS no lea símbolos. */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, '$1.')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\.\.+\s*$/gm, '.')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * Chatterbox pide un wav mono; ffmpeg convierte cualquier formato (mp3, ogg, m4a…).
 * Se recorta a REFERENCE_SECONDS: la referencia se vuelve tokens de prompt (~25/s) y su análisis
 * consume RAM en proporción a la duración; con ~160 s el proceso llegó a 10 GB.
 */
async function toReferenceWav(src: string, dir: string): Promise<string> {
  const out = join(dir, 'voice.wav')
  try {
    await run('ffmpeg', ['-y', '-i', src, '-t', String(REFERENCE_SECONDS), '-ac', '1', '-ar', String(SAMPLE_RATE), out])
  } catch (e) {
    throw new Error(`No se pudo leer el audio de voz con ffmpeg (¿está instalado?): ${e instanceof Error ? e.message : e}`)
  }
  return out
}

/** Trozos de ≤ max caracteres cortando en frases (el motor limita la duración de cada síntesis). */
export function splitSentences(text: string, max = 180): string[] {
  const out: string[] = []
  let cur = ''
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const sentence of text.match(/[^.!?\n]+[.!?]*|\n/g) ?? []) {
    if (sentence === '\n') { push(); continue }
    for (let part = sentence; part.length > 0;) {
      let piece = part
      if (part.length > max) { // frase larga: cortar en la última coma/espacio antes del límite
        const cut = Math.max(part.lastIndexOf(',', max), part.lastIndexOf(' ', max))
        piece = part.slice(0, cut > 0 ? cut + 1 : max)
      }
      if (cur && cur.length + piece.length > max) push()
      cur += piece
      part = part.slice(piece.length)
    }
  }
  push()
  return out
}

function wav(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/**
 * Lee `summary` con la voz de `voicePath` (clonación con Chatterbox multilingüe) y guarda el wav.
 * Carga el modelo solo mientras dura la síntesis para no ocupar memoria junto a Whisper y el LLM.
 */
export async function generateSummaryAudio(
  summary: string, voicePath: string, settings: Settings, outFile: string, progress: (t: string) => void
): Promise<void> {
  const text = markdownToSpeech(summary)
  if (!text) throw new Error('El resumen está vacío.')
  const tmp = await mkdtemp(join(tmpdir(), 'rtt-voice-'))
  let modelId: string | undefined
  try {
    progress('Preparando la voz de referencia…')
    const reference = await toReferenceWav(voicePath, tmp)
    progress('Cargando modelo de voz (la primera vez se descarga, ~2 GB)…')
    modelId = await loadModel({
      modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0,
      modelConfig: {
        ttsEngine: 'chatterbox',
        language: settings.language === 'auto' ? 'es' : settings.language,
        s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0,
        referenceAudioSrc: reference,
        useGPU: true, // opt-in: sin esto el motor corre en CPU (Vulkan en Linux sin NVIDIA)
        cfmSteps: 1,
        threads: 8
      },
      onProgress: (p) => progress(`Descargando modelo de voz… ${Math.round(p.percentage)}%`)
    })
    progress('Generando audio… (puede tardar varios minutos)')
    const chunks = splitSentences(text)
    const parts: Int16Array[] = []
    let rate = SAMPLE_RATE
    for (const [i, chunk] of chunks.entries()) {
      progress(`Generando audio… ${i + 1}/${chunks.length}`)
      const result = textToSpeech({ modelId, text: chunk, inputType: 'text', stream: false })
      parts.push(Int16Array.from(await result.buffer))
      rate = (await result.sampleRate) ?? rate
      parts.push(new Int16Array(Math.round(rate * 0.15))) // pausa breve entre frases
    }
    const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
    let off = 0
    for (const p of parts) { pcm.set(p, off); off += p.length }
    await writeFile(outFile, wav(pcm, rate))
  } finally {
    if (modelId) await unloadModel({ modelId }).catch(() => {})
    await rm(tmp, { recursive: true, force: true })
  }
}
