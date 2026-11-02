import { completion } from '@qvac/sdk'
import type { Alert, Segment } from '../shared/types'

// create_alert: el LLM "llama" a esta herramienta una vez por hallazgo (salida estructurada).
const KINDS = ['task', 'date', 'decision', 'other'] as const
const alertTool = {
  type: 'function' as const,
  name: 'create_alert',
  description: 'Registra una alerta: tarea por hacer, fecha o plazo importante, decisión o compromiso.',
  parameters: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string' as const, enum: [...KINDS], description: 'Tipo de alerta' },
      title: { type: 'string' as const, description: 'Título corto (máx. 80 caracteres)' },
      detail: { type: 'string' as const, description: 'Explicación breve con quién/qué/cuándo' },
      dueDate: { type: 'string' as const, description: 'Fecha o plazo en formato ISO (YYYY-MM-DD) si se menciona' }
    },
    required: ['kind', 'title', 'detail']
  }
}

type AlertArgs = { kind: Alert['kind']; title: string; detail: string; dueDate?: string }

/** El LLM es pequeño: se valida a mano lo que devuelve la herramienta. */
function parseArgs(a: unknown): AlertArgs | null {
  const o = a as Record<string, unknown> | null
  if (!o || typeof o.title !== 'string' || !o.title.trim() || typeof o.detail !== 'string') return null
  const kind = KINDS.includes(o.kind as never) ? (o.kind as Alert['kind']) : 'other'
  return { kind, title: o.title.trim().slice(0, 120), detail: o.detail.trim(), dueDate: typeof o.dueDate === 'string' && o.dueDate ? o.dueDate : undefined }
}

const SYSTEM = `Eres un asistente que escucha la transcripción de una conversación y detecta información de interés para el usuario: tareas por hacer, fechas o plazos importantes, decisiones y compromisos.
Por cada hallazgo llama a la herramienta create_alert. Si no hay nada relevante, no llames a ninguna herramienta y no escribas texto.
No repitas alertas ya creadas. Responde en el idioma de la conversación.`

const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()


// Presupuesto de contexto (ctx_size 8192 tokens ≈ 28k caracteres en español): entrada + salida + prompt.
const CHUNK_CHARS = 14000
const PARTIAL_TOKENS = 1500
const FINAL_TOKENS = 3000

const CHUNK_PROMPT = 'Resume este fragmento de una conversación, en español, con un máximo de 12 viñetas. Conserva decisiones, tareas, compromisos, fechas y nombres propios.'
const MERGE_PROMPT = 'Estos son resúmenes consecutivos de partes de una misma conversación. Únelos en un único resumen en español, sin repetir ideas, con un máximo de 15 viñetas. Conserva decisiones, tareas, compromisos, fechas y nombres propios.'
const FINAL_PROMPT = 'Redacta el resumen final de la conversación, en español, con estas secciones en Markdown: "## Resumen general", "## Temas tratados", "## Decisiones", "## Tareas y compromisos", "## Fechas y plazos". Omite las secciones sin contenido.'

/** Agrupa líneas en bloques de hasta `max` caracteres sin partir ninguna línea. */
function chunkLines(text: string, max: number, sep = '\n'): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of text.split(sep)) {
    if (cur && cur.length + line.length + sep.length > max) { out.push(cur); cur = '' }
    cur += (cur ? sep : '') + line
  }
  if (cur) out.push(cur)
  return out
}

/** Ejecuta `fn` sobre cada elemento en orden, informando el avance (i empieza en 1). */
async function mapAll<T>(items: string[], fn: (item: string, i: number, n: number) => Promise<T>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i + 1, items.length))
  return out
}

export class Analyzer {
  constructor(private modelId: string) {}

  /** Analiza los segmentos recientes y devuelve solo alertas nuevas (sin duplicar `known`). */
  async findAlerts(recent: Segment[], known: Alert[]): Promise<Alert[]> {
    const knownList = known.length ? `\nAlertas ya creadas (no repetir):\n${known.map((a) => `- ${a.title}`).join('\n')}` : ''
    const transcript = recent.map((s) => s.text).join('\n')
    const run = completion({
      modelId: this.modelId,
      history: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Transcripción reciente:\n${transcript}${knownList}` }
      ],
      stream: true,
      tools: [alertTool],
      generationParams: { temp: 0.2, predict: 800, reasoning_budget: 0 }
    })
    await run.text // consume el stream completo
    const seen = new Set(known.map((a) => norm(a.title)))
    const fresh: Alert[] = []
    for (const call of await run.toolCalls) {
      if (call.name !== 'create_alert') continue
      const args = parseArgs(call.arguments)
      if (!args || seen.has(norm(args.title))) continue
      seen.add(norm(args.title))
      fresh.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...args })
    }
    return fresh
  }

  /**
   * Resumen final, pensado para llamadas de horas: se corta por líneas en bloques que caben en
   * el contexto, se resume cada bloque y los parciales se unen por niveles hasta quedar uno solo.
   */
  async summarize(transcript: string, onProgress: (text: string) => void = () => {}): Promise<string> {
    if (!transcript.trim()) return 'Sin contenido transcrito.'
    let parts = chunkLines(transcript, CHUNK_CHARS)
    if (parts.length === 1) return this.ask(FINAL_PROMPT, parts[0], FINAL_TOKENS)

    parts = await mapAll(parts, (p, i, n) => { onProgress(`Resumiendo bloque ${i} de ${n}…`); return this.ask(CHUNK_PROMPT, p, PARTIAL_TOKENS) })
    for (let level = 2; parts.length > 1; level++) {
      const groups = chunkLines(parts.join('\n\n'), CHUNK_CHARS, '\n\n')
      const last = groups.length === 1
      parts = await mapAll(groups, (g, i, n) => {
        onProgress(last ? 'Redactando el resumen final…' : `Uniendo resúmenes (nivel ${level}, ${i} de ${n})…`)
        return this.ask(last ? FINAL_PROMPT : MERGE_PROMPT, g, last ? FINAL_TOKENS : PARTIAL_TOKENS)
      })
    }
    return parts[0]
  }

  private async ask(instruction: string, content: string, predict: number) {
    const run = completion({
      modelId: this.modelId,
      history: [
        { role: 'system', content: instruction },
        { role: 'user', content }
      ],
      stream: true,
      // predict es solo un tope anti-desborde: sin razonamiento el modelo termina solo.
      generationParams: { temp: 0.3, predict, reasoning_budget: 0 }
    })
    const final = await run.final
    const text = stripThink(final.contentText)
    return final.stopReason === 'length' ? `${text}\n\n_[Texto truncado por el límite de longitud]_` : text
  }
}
