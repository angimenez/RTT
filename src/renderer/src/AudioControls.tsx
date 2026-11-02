import { useEffect, useState } from 'react'

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** "Generar audio": lee el resumen con la voz de un audio elegido por el usuario. */
export function AudioControls({ session }: { session: string }) {
  const [voice, setVoice] = useState<string | null>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'working' | 'error'; text: string }>({ kind: 'idle', text: '' })
  const [url, setUrl] = useState<string | null>(null)

  const load = async () => {
    const bytes = await window.rtt.readAudio(session)
    setUrl((old) => { if (old) URL.revokeObjectURL(old); return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' })) : null })
  }

  useEffect(() => { // al cambiar de sesión: audio ya generado, si existe
    setState({ kind: 'idle', text: '' })
    void load()
    return () => setUrl((old) => { if (old) URL.revokeObjectURL(old); return null })
  }, [session])

  useEffect(() => window.rtt.onEvent((e) => {
    if (e.type !== 'audio' || e.session !== session) return
    if (e.state === 'done') { setState({ kind: 'idle', text: '' }); void load() }
    else setState({ kind: e.state, text: e.text })
  }), [session])

  const generate = async () => {
    const path = voice ?? await window.rtt.pickVoice()
    if (!path) return
    setVoice(path)
    setState({ kind: 'working', text: 'Iniciando…' })
    await window.rtt.generateAudio(session, path)
  }

  const working = state.kind === 'working'
  return (
    <div className="audio">
      <button onClick={generate} disabled={working}>{url ? 'Regenerar audio' : 'Generar audio'}</button>
      <button onClick={async () => { const p = await window.rtt.pickVoice(); if (p) setVoice(p) }} disabled={working}>
        {voice ? `Voz: ${baseName(voice)}` : 'Elegir voz…'}
      </button>
      {working && <span className="hint">⏳ {state.text}</span>}
      {state.kind === 'error' && <span className="error">{state.text}</span>}
      {url && <audio controls src={url} />}
    </div>
  )
}
