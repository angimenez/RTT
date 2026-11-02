// Tipos compartidos entre main, preload y renderer.

export type Segment = { id: number; startMs: number; endMs: number; text: string }

export type AlertKind = 'task' | 'date' | 'decision' | 'other'

export type Alert = {
  id: string
  createdAt: string // ISO
  kind: AlertKind
  title: string
  detail: string
  dueDate?: string // ISO si el LLM detecta una fecha
}

export type Settings = {
  language: 'es' | 'en' | 'auto'
  sessionsDir: string
  audioTarget: string // nodo/monitor de PipeWire; '' = monitor del sink por defecto
  analysisEverySegments: number // cada cuántos segmentos nuevos corre el LLM
  analysisWindowSegments: number // cuántos segmentos recientes ve el LLM
  telegram: { enabled: boolean; botToken: string; chatId: string }
}

export type ModelState = { stage: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'; percent?: number; error?: string }

export type SessionInfo = { name: string; hasSummary: boolean; alertCount: number }

export type SessionDetail = { name: string; transcript: string; summary: string; alerts: Alert[] }

// Eventos main -> renderer
export type RttEvent =
  | { type: 'models'; whisper: ModelState; llm: ModelState }
  | { type: 'status'; status: 'idle' | 'starting' | 'recording' | 'stopping'; session?: string }
  | { type: 'segment'; segment: Segment }
  | { type: 'alert'; alert: Alert }
  | { type: 'level'; rms: number }
  | { type: 'error'; message: string }
  | { type: 'summary'; summary: string }
  | { type: 'progress'; text: string }

// API expuesta por el preload en window.rtt
export interface RttApi {
  start(): Promise<void>
  stop(): Promise<void>
  prepareModels(): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  listSessions(): Promise<SessionInfo[]>
  readSession(name: string): Promise<SessionDetail>
  openSessionFolder(name?: string): Promise<void>
  testTelegram(): Promise<string>
  onEvent(cb: (e: RttEvent) => void): () => void
}
