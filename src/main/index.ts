import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { RttEvent, Settings } from '../shared/types'
import { ModelService } from './models'
import { TelegramNotifier } from './notifier-telegram'
import { SessionManager } from './session-manager'
import { listSessions, readSession } from './session-store'
import { loadSettings, saveSettings } from './settings-store'

// Linux: sin helper SUID el sandbox de Chromium falla (igual que en el tutorial de QVAC).
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

let win: BrowserWindow | null = null
const send = (e: RttEvent) => win?.webContents.send('rtt:event', e)

let settings: Settings
const models = new ModelService((whisper, llm) => send({ type: 'models', whisper, llm }))
const manager = new SessionManager(models, async () => settings)
manager.on('event', send)

function registerIpc() {
  ipcMain.handle('start', () => manager.start())
  ipcMain.handle('stop', () => manager.stop())
  ipcMain.handle('prepareModels', () => models.ensureLoaded(settings).catch((e) => send({ type: 'error', message: String(e?.message ?? e) })))
  ipcMain.handle('getSettings', () => settings)
  ipcMain.handle('saveSettings', async (_e, s: Settings) => { settings = s; await saveSettings(s) })
  ipcMain.handle('listSessions', () => listSessions(settings.sessionsDir))
  ipcMain.handle('readSession', (_e, name: string) => readSession(settings.sessionsDir, name))
  ipcMain.handle('openSessionFolder', async (_e, name?: string) => {
    const dir = name ? join(settings.sessionsDir, name) : settings.sessionsDir
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
  ipcMain.handle('testTelegram', async () => {
    try { await TelegramNotifier.test(settings.telegram); return 'ok' } catch (e) { return e instanceof Error ? e.message : String(e) }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 780, show: false, title: 'RTT',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  win.on('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  settings = await loadSettings()
  registerIpc()
  createWindow()
})

app.on('before-quit', () => { void manager.stop().then(() => models.unloadAll()) })
app.on('window-all-closed', () => app.quit())
