import { useEffect, useState } from 'react'
import type { SessionDetail, SessionInfo, Settings } from '../../shared/types'

type Props = { refresh: number; onOpen(s: SessionDetail): void }

export function Sidebar({ refresh, onOpen }: Props) {
  const [tab, setTab] = useState<'history' | 'settings'>('history')
  return (
    <nav className="sidebar">
      <div className="tabs">
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Historial</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Ajustes</button>
      </div>
      {tab === 'history' ? <History refresh={refresh} onOpen={onOpen} /> : <SettingsForm />}
    </nav>
  )
}

function History({ refresh, onOpen }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  useEffect(() => { void window.rtt.listSessions().then(setSessions) }, [refresh])
  return (
    <div className="list">
      <button onClick={() => void window.rtt.openSessionFolder()}>Abrir carpeta</button>
      {sessions.length === 0 && <p className="hint">Sin sesiones todavía.</p>}
      {sessions.map((s) => (
        <button key={s.name} className="item" onClick={async () => onOpen(await window.rtt.readSession(s.name))}>
          {s.name}<small>{s.alertCount} alertas{s.hasSummary ? ' · resumen' : ''}</small>
        </button>
      ))}
    </div>
  )
}

function SettingsForm() {
  const [s, setS] = useState<Settings | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { void window.rtt.getSettings().then(setS) }, [])
  if (!s) return null

  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch })
  const setTg = (patch: Partial<Settings['telegram']>) => setS({ ...s, telegram: { ...s.telegram, ...patch } })
  const save = async () => { await window.rtt.saveSettings(s); setMsg('Guardado (idioma: se aplica al recargar modelos al reiniciar)') }

  return (
    <form className="settings" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <label>Idioma
        <select value={s.language} onChange={(e) => set({ language: e.target.value as Settings['language'] })}>
          <option value="es">Español</option><option value="en">English</option><option value="auto">Auto</option>
        </select>
      </label>
      <label>Carpeta de sesiones<input value={s.sessionsDir} onChange={(e) => set({ sessionsDir: e.target.value })} /></label>
      <label>Destino PipeWire (vacío = salida por defecto)<input value={s.audioTarget} onChange={(e) => set({ audioTarget: e.target.value })} /></label>
      <label>Analizar cada N segmentos<input type="number" min={1} value={s.analysisEverySegments} onChange={(e) => set({ analysisEverySegments: +e.target.value })} /></label>
      <label>Ventana de análisis (segmentos)<input type="number" min={1} value={s.analysisWindowSegments} onChange={(e) => set({ analysisWindowSegments: +e.target.value })} /></label>
      <fieldset>
        <legend>Telegram</legend>
        <label className="row"><input type="checkbox" checked={s.telegram.enabled} onChange={(e) => setTg({ enabled: e.target.checked })} /> Enviar alertas</label>
        <label>Token del bot<input type="password" value={s.telegram.botToken} onChange={(e) => setTg({ botToken: e.target.value })} /></label>
        <label>Chat ID<input value={s.telegram.chatId} onChange={(e) => setTg({ chatId: e.target.value })} /></label>
        <button type="button" onClick={async () => { await window.rtt.saveSettings(s); setMsg((r => r === 'ok' ? 'Mensaje de prueba enviado' : r)(await window.rtt.testTelegram())) }}>Enviar prueba</button>
      </fieldset>
      <button type="submit">Guardar</button>
      {msg && <small>{msg}</small>}
    </form>
  )
}
