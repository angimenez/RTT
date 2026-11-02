# Arquitectura de RTT

RTT captura el audio del sistema, lo transcribe en tiempo real con QVAC SDK, detecta alertas con un LLM local y guarda cada sesión en una carpeta.

## Procesos

```
Renderer (React)  ──window.rtt──►  Preload  ──IPC──►  Main (Node + QVAC SDK)
 paneles y estado                  contextBridge       toda la lógica
```

- **Main** (`src/main/`): único lugar con lógica y con acceso al SDK de QVAC.
- **Preload** (`src/preload/index.ts`): expone `window.rtt`, definido en `src/shared/types.ts` (`RttApi`).
- **Renderer** (`src/renderer/src/`): solo dibuja. Recibe eventos `RttEvent` y los reduce a un estado (`App.tsx`).
- **Shared** (`src/shared/`): tipos comunes. Es el contrato entre procesos.

## Módulos de main

| Archivo | Responsabilidad |
|---|---|
| `index.ts` | Ventana, registro de canales IPC, ciclo de vida. |
| `session-manager.ts` | Orquesta una sesión (audio → texto → alertas → disco). Único que conoce a todos los demás. |
| `audio/audio-source.ts` | Interfaz `AudioSource` y selector por plataforma. Entrega PCM f32le, 16 kHz, mono, en chunks de 100 ms. |
| `audio/linux-pipewire.ts` | Captura el monitor del sink con `pw-record --raw`. Sin `--raw` entrega una cabecera que rompe el SDK. |
| `models.ts` | Carga y descarga de Whisper y del LLM. Las constantes de modelos están al inicio del archivo. |
| `transcriber.ts` | `transcribeStream` (Whisper + VAD). Un texto por tramo de voz; los tiempos se calculan con el audio recibido. |
| `analyzer.ts` | Alertas (tool calling `create_alert`) y resumen final (por bloques si es largo). |
| `notifier-telegram.ts` | Envío a la API de bots con cola de ~1 mensaje/s. Un fallo no corta la sesión. |
| `session-store.ts` | Escribe y lee la carpeta de cada sesión. |
| `settings-store.ts` | `settings.json`; el token de Telegram se cifra con `safeStorage`. |

## Flujo de una sesión

1. **Iniciar:** asegura los modelos, crea la carpeta, abre la sesión de transcripción y arranca `pw-record`.
2. **Audio → texto:** cada chunk va a `session.write()`. Cada texto devuelto se vuelve un `Segment`, que se envía a la UI y se agrega a `transcript.txt`.
3. **Texto → alertas:** cada N segmentos (por defecto 4) el LLM analiza los últimos K (por defecto 12) junto con los títulos de alertas ya creadas. Los análisis se encadenan: nunca corren dos a la vez. Los resultados se validan a mano y se deduplican por título normalizado.
4. **Detener:** cierra el audio, espera los segmentos pendientes, hace un último análisis, genera `summary.md` y guarda `alerts.json`.

## Datos en disco

```
~/Documentos/RTT-sessions/<AAAA-MM-DD_HH-mm-ss>/
├─ transcript.txt   # [hh:mm:ss] texto, se escribe en vivo
├─ alerts.json      # array de Alert
└─ summary.md       # al detener la sesión
```

- Ajustes: `~/.config/rtt/settings.json`.
- Modelos: caché de QVAC en `~/.qvac/models/`, descargados en el primer uso.

## Decisiones y limitaciones conocidas

- **Salida estructurada:** el SDK no documenta modo JSON; se usa tool calling con JSON Schema y validación manual.
- **Modelos:** Whisper small Q8 (multilingüe) y Qwen3.5-2B Q4_K_M. Cambiarlos es una línea en `models.ts`.
- **Solo Linux (PipeWire):** el loopback de Electron solo existe en Windows y macOS no tiene captura nativa. Para añadir una plataforma, implementar `AudioSource` y registrarla en `createAudioSource`.
- **Idioma:** se aplica al cargar Whisper, es decir, al reiniciar la app.
- **Empaquetado:** `electron-forge` con `QvacForgePlugin` (desactiva `asar`). Configurado, sin probar con `npm run make`.
- **Dev en Linux:** se usa `--no-sandbox`, igual que en el tutorial de QVAC.
- **Binario de Electron:** si `npm install` no descarga `electron/dist`, ejecutar `node node_modules/electron/install.js`.
