import { contextBridge, ipcRenderer } from 'electron'
import type { RttApi, RttEvent } from '../shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: RttApi = {
  start: invoke('start') as RttApi['start'],
  pickAudioFile: invoke('pickAudioFile') as RttApi['pickAudioFile'],
  stop: invoke('stop') as RttApi['stop'],
  prepareModels: invoke('prepareModels') as RttApi['prepareModels'],
  getSettings: invoke('getSettings') as RttApi['getSettings'],
  saveSettings: invoke('saveSettings') as RttApi['saveSettings'],
  listSessions: invoke('listSessions') as RttApi['listSessions'],
  readSession: invoke('readSession') as RttApi['readSession'],
  openSessionFolder: invoke('openSessionFolder') as RttApi['openSessionFolder'],
  testTelegram: invoke('testTelegram') as RttApi['testTelegram'],
  pickVoice: invoke('pickVoice') as RttApi['pickVoice'],
  generateAudio: invoke('generateAudio') as RttApi['generateAudio'],
  readAudio: invoke('readAudio') as RttApi['readAudio'],
  onEvent(cb) {
    const handler = (_: unknown, e: RttEvent) => cb(e)
    ipcRenderer.on('rtt:event', handler)
    return () => ipcRenderer.removeListener('rtt:event', handler)
  }
}

contextBridge.exposeInMainWorld('rtt', api)
