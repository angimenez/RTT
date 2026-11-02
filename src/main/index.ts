import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import type { RttEvent, Settings, SourceChoice } from '../shared/types'
import { ModelService } from './models'
import { TelegramNotifier } from './notifier-telegram'
import { SessionManager } from './session-manager'
import { listSessions, readSession } from './session-store'
import { loadSettings, saveSettings } from './settings-store'
import { generateSummaryAudio } from './tts'

// Linux: sin helper SUID el sandbox de Chromium falla (igual que en el tutorial de QVAC).
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

let win: BrowserWindow | null = null
const send = (e: RttEvent) => win?.webContents.send('rtt:event', e)

let settings: Settings
const models = new ModelService((whisper, llm) => send({ type: 'models', whisper, llm }))
const manager = new SessionManager(models, async () => settings)
manager.on('event', send)

function registerIpc() {
  ipcMain.handle('start', (_e, source?: SourceChoice) => manager.start(source))
  ipcMain.handle('pickAudioFile', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Elige el audio a transcribir',
      properties: ['openFile'],
      filters: [{ name: 'Audio o vídeo', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'webm', 'aac', 'wma', 'mp4', 'mkv'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
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
  ipcMain.handle('pickVoice', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Elige el audio con la voz a imitar (mínimo ~5 s, una sola persona)',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'webm'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  let audioBusy = false
  ipcMain.handle('generateAudio', async (_e, session: string, voicePath: string) => {
    const emit = (state: 'working' | 'done' | 'error', text: string) => send({ type: 'audio', state, text, session })
    if (audioBusy) return
    if (!manager.isIdle) return emit('error', 'Hay una sesión en curso; espera a que termine.')
    audioBusy = true
    try {
      const dir = join(settings.sessionsDir, session)
      const summary = await readFile(join(dir, 'summary.md'), 'utf8')
      emit('working', 'Liberando Whisper y el LLM para dejar memoria…')
      await models.withModelsUnloaded(settings, () =>
        generateSummaryAudio(summary, voicePath, settings, join(dir, 'summary.wav'), (t) => emit('working', t)))
      emit('done', 'Audio listo')
    } catch (err) {
      emit('error', err instanceof Error ? err.message : String(err))
    } finally { audioBusy = false }
  })
  ipcMain.handle('readAudio', async (_e, session: string) => {
    const buf = await readFile(join(settings.sessionsDir, session, 'summary.wav')).catch(() => null)
    return buf ? new Uint8Array(buf) : null
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
