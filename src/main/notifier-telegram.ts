import type { Alert, Settings } from '../shared/types'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ICON = { task: '✅', date: '📅', decision: '🧭', other: '🔔' }

export const alertText = (a: Alert) =>
  `${ICON[a.kind]} <b>${esc(a.title)}</b>\n${esc(a.detail)}${a.dueDate ? `\n📆 ${esc(a.dueDate)}` : ''}`

async function send(cfg: Settings['telegram'], text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' })
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`)
}

/** Cola secuencial con ~1 mensaje/s (límite de Telegram por chat). Un fallo no corta la sesión. */
export class TelegramNotifier {
  private chain: Promise<void> = Promise.resolve()

  constructor(private cfg: Settings['telegram'], private onError: (m: string) => void) {}

  get active() { return this.cfg.enabled && !!this.cfg.botToken && !!this.cfg.chatId }

  notify(a: Alert) {
    if (!this.active) return
    this.chain = this.chain
      .then(() => send(this.cfg, alertText(a)))
      .catch((e) => this.onError(`Telegram: ${e.message}`))
      .then(() => new Promise<void>((r) => setTimeout(r, 1000)))
  }

  static test(cfg: Settings['telegram']) { return send(cfg, '✅ RTT conectado correctamente.') }
}
