import type { Alert } from '../../shared/types'

const ICON = { task: '✅', date: '📅', decision: '🧭', other: '🔔' }

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <aside className="alerts">
      <h2>Alertas <span>{alerts.length}</span></h2>
      {alerts.length === 0 && <p className="hint">Aquí aparecerán tareas, fechas y compromisos detectados.</p>}
      {alerts.map((a) => (
        <article key={a.id} className={`alert ${a.kind}`}>
          <h4>{ICON[a.kind]} {a.title}</h4>
          <p>{a.detail}</p>
          {a.dueDate && <small>📆 {a.dueDate}</small>}
          <button onClick={() => void navigator.clipboard.writeText(`${a.title}\n${a.detail}${a.dueDate ? `\n${a.dueDate}` : ''}`)}>Copiar</button>
        </article>
      ))}
    </aside>
  )
}
