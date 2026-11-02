import { useEffect, useReducer, useRef, useState } from 'react'
import type { Alert, ModelState, RttEvent, Segment, SessionDetail } from '../../shared/types'
import { AlertsPanel } from './AlertsPanel'
import { Sidebar } from './Sidebar'
import { TranscriptPanel } from './TranscriptPanel'

export type LiveState = {
  status: 'idle' | 'starting' | 'recording' | 'stopping'
  session?: string
  segments: Segment[]
  alerts: Alert[]
  summary: string
  progress: string
  level: number
  errors: string[]
  whisper: ModelState
  llm: ModelState
}

const initial: LiveState = {
  status: 'idle', segments: [], alerts: [], summary: '', progress: '', level: 0, errors: [],
  whisper: { stage: 'idle' }, llm: { stage: 'idle' }
}

function reduce(s: LiveState, e: RttEvent): LiveState {
  switch (e.type) {
    case 'models': return { ...s, whisper: e.whisper, llm: e.llm }
    case 'status': return e.status === 'starting' ? { ...s, status: e.status, session: e.session, segments: [], alerts: [], summary: '', progress: '' } : { ...s, status: e.status, session: e.session ?? s.session }
    case 'segment': return { ...s, segments: [...s.segments, e.segment] }
    case 'alert': return { ...s, alerts: [e.alert, ...s.alerts] }
    case 'level': return { ...s, level: e.rms }
    case 'summary': return { ...s, summary: e.summary }
    case 'progress': return { ...s, progress: e.text }
    case 'error': return { ...s, errors: [...s.errors.slice(-4), e.message] }
    case 'audio': return s // lo gestiona AudioControls
  }
}

export function App() {
  const [live, dispatch] = useReducer(reduce, initial)
  const [viewing, setViewing] = useState<SessionDetail | null>(null) // sesión pasada abierta
  const [refresh, setRefresh] = useState(0)
  const prevStatus = useRef(live.status)

  useEffect(() => window.rtt.onEvent(dispatch), [])
  useEffect(() => { void window.rtt.prepareModels() }, [])
  useEffect(() => { // al terminar una sesión, recargar el historial
    if (prevStatus.current === 'stopping' && live.status === 'idle') setRefresh((n) => n + 1)
    prevStatus.current = live.status
  }, [live.status])

  const showing = viewing
  return (
    <div className="layout">
      <Sidebar refresh={refresh} onOpen={setViewing} />
      <TranscriptPanel
        live={live}
        viewing={showing}
        onStart={() => { setViewing(null); void window.rtt.start() }}
        onStop={() => void window.rtt.stop()}
        onCloseView={() => setViewing(null)}
      />
      <AlertsPanel alerts={showing ? showing.alerts : live.alerts} />
    </div>
  )
}
