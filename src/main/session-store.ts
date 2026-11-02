import { join } from 'node:path'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Alert, Segment, SessionDetail, SessionInfo } from '../shared/types'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`

export const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Carpeta de una sesión: transcript.txt (en vivo), alerts.json y summary.md. */
export class SessionStore {
  constructor(readonly root: string, readonly name = stamp()) {}

  get dir() { return join(this.root, this.name) }

  async init() { await mkdir(this.dir, { recursive: true }); await writeFile(join(this.dir, 'transcript.txt'), '') }

  appendSegment(s: Segment) { return appendFile(join(this.dir, 'transcript.txt'), `[${formatTime(s.startMs)}] ${s.text}\n`) }

  saveAlerts(alerts: Alert[]) { return writeFile(join(this.dir, 'alerts.json'), JSON.stringify(alerts, null, 2)) }

  saveSummary(md: string) { return writeFile(join(this.dir, 'summary.md'), md) }
}

const read = (p: string, fallback = '') => readFile(p, 'utf8').catch(() => fallback)

export async function listSessions(root: string): Promise<SessionInfo[]> {
  const names = (await readdir(root).catch(() => [] as string[])).sort().reverse()
  return Promise.all(names.map(async (name) => {
    const alerts = JSON.parse(await read(join(root, name, 'alerts.json'), '[]')) as Alert[]
    return { name, hasSummary: !!(await read(join(root, name, 'summary.md'))), alertCount: alerts.length }
  }))
}

export async function readSession(root: string, name: string): Promise<SessionDetail> {
  const dir = join(root, name)
  return {
    name,
    transcript: await read(join(dir, 'transcript.txt')),
    summary: await read(join(dir, 'summary.md')),
    alerts: JSON.parse(await read(join(dir, 'alerts.json'), '[]'))
  }
}
