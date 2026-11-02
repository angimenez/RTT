import { useEffect, useRef } from 'react'
import type { ModelState, SessionDetail } from '../../shared/types'
import type { LiveState } from './App'

const modelLabel = (name: string, m: ModelState) =>
  `${name}: ${m.stage === 'downloading' ? `descargando ${m.percent ?? 0}%` : m.stage === 'error' ? `error (${m.error})` : m.stage}`

const STATUS = { idle: 'Listo', starting: 'Iniciando…', recording: 'Grabando', stopping: 'Deteniendo…' }
const mmss = (ms: number) => new Date(ms).toISOString().slice(11, 19)

type Props = {
  live: LiveState
  viewing: SessionDetail | null
  onStart(): void
  onStop(): void
  onCloseView(): void
}

export function TranscriptPanel({ live, viewing, onStart, onStop, onCloseView }: Props) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [live.segments.length])

  const busy = live.status !== 'idle'
  const ready = live.whisper.stage === 'ready' && live.llm.stage === 'ready'
  const summary = viewing ? viewing.summary : live.summary

  return (
    <main className="center">
      <header className="bar">
        {viewing ? (
          <>
            <strong>Sesión {viewing.name}</strong>
            <button onClick={onCloseView}>Volver al directo</button>
          </>
        ) : (
          <>
            {busy ? <button className="stop" onClick={onStop} disabled={live.status !== 'recording'}>■ Detener</button>
                  : <button className="rec" onClick={onStart}>● Iniciar</button>}
            <span className="status">{live.status === 'recording' ? `Grabando · ${live.session}` : STATUS[live.status]}</span>
            <div className="meter"><div style={{ width: `${Math.min(100, live.level * 400)}%` }} /></div>
          </>
        )}
      </header>

      {!viewing && !ready && (
        <div className="models">{modelLabel('Whisper', live.whisper)} · {modelLabel('LLM', live.llm)}</div>
      )}
      {live.status === 'stopping' && <div className="models">⏳ {live.progress || 'Deteniendo…'}</div>}
      {live.errors.map((m, i) => <div className="error" key={i}>{m}</div>)}

      <section className="transcript">
        {viewing ? <pre>{viewing.transcript || '(vacía)'}</pre> : live.segments.map((s) => (
          <p key={s.id}><time>{mmss(s.startMs)}</time> {s.text}</p>
        ))}
        {!viewing && live.status === 'recording' && live.segments.length === 0 && <p className="hint">Esperando voz en el audio del sistema…</p>}
        <div ref={bottom} />
      </section>

      {summary && <section className="summary"><h3>Resumen</h3><pre>{summary}</pre></section>}
    </main>
  )
}
