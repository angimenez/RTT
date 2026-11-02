import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type { Settings } from '../shared/types'

const file = () => join(app.getPath('userData'), 'settings.json')

const defaults = (): Settings => ({
  language: 'es',
  sessionsDir: join(app.getPath('documents'), 'RTT-sessions'),
  audioTarget: '',
  analysisEverySegments: 4,
  analysisWindowSegments: 12,
  telegram: { enabled: false, botToken: '', chatId: '' }
})

// El token de Telegram se guarda cifrado (safeStorage) con prefijo "enc:".
const encrypt = (t: string) => (t && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(t).toString('base64') : t)
const decrypt = (t: string) => (t.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(t.slice(4), 'base64')) : t)

export async function loadSettings(): Promise<Settings> {
  const base = defaults()
  try {
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Partial<Settings>
    const merged = { ...base, ...saved, telegram: { ...base.telegram, ...saved.telegram } }
    merged.telegram.botToken = decrypt(merged.telegram.botToken)
    return merged
  } catch {
    return base
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const toSave = { ...s, telegram: { ...s.telegram, botToken: encrypt(s.telegram.botToken) } }
  await writeFile(file(), JSON.stringify(toSave, null, 2))
}
