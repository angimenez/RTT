# RTT — Real-Time Transcriber

Aplicación de escritorio (Electron) que **captura el audio del sistema**, lo **transcribe en tiempo real** y **detecta alertas** (tareas, fechas, decisiones, compromisos) con modelos locales de [QVAC SDK](https://docs.qvac.tether.io). Todo se procesa en tu equipo; lo único que puede salir a internet es el envío opcional de alertas a Telegram.

Cada sesión genera una carpeta con la transcripción completa, un resumen y un JSON con las alertas.

## Requisitos

- **Linux con PipeWire** (la captura de audio solo está implementada para Linux). Necesita el comando `pw-record`.
- **Node.js 22.17 o superior** y npm 10.9 o superior.
- GPU con Vulkan recomendada; sin ella los modelos corren en CPU, más lento.
- Espacio en disco para los modelos (se descargan solos la primera vez): Whisper small (~264 MB), VAD (~1 MB) y Qwen3.5-2B (~1,3 GB).

## Instalar y arrancar

```bash
npm install
node node_modules/electron/install.js   # solo si npm no descargó el binario de Electron
npm run dev
```

La primera vez, la app descarga los modelos a `~/.qvac/models/`. Arriba, en el panel central, verás el estado de cada modelo; cuando desaparece ese aviso, está todo listo.

## Cómo usarla

1. Pon a sonar lo que quieras transcribir (una llamada, un video, una reunión). Se captura **lo que sale por tus parlantes**, no el micrófono.
2. Pulsa **● Iniciar**. La barra azul junto al botón se mueve con el nivel del audio; si no se mueve, no está captando nada.
3. El texto aparece en el panel central cuando el detector de voz nota una pausa.
4. Cada pocos segmentos, el modelo revisa lo último que se dijo y publica **alertas** en el panel derecho. El botón *Copiar* de cada alerta copia su texto.
5. Pulsa **■ Detener**. La app termina el análisis en curso, genera el resumen y guarda todo. En llamadas largas el resumen se hace por bloques y puede tardar varios minutos; un aviso arriba indica el paso.

### Panel izquierdo

- **Historial:** lista de sesiones anteriores. Al abrir una se ven su transcripción, resumen y alertas; *Volver al directo* regresa a la vista en vivo. *Abrir carpeta* abre el directorio de sesiones.
- **Ajustes:** ver la tabla siguiente.

| Ajuste | Qué hace |
|---|---|
| Idioma | Idioma de la transcripción (Español, English o Auto). Se aplica al cargar Whisper, es decir, **al reiniciar la app**. |
| Carpeta de sesiones | Dónde se guardan las sesiones. Por defecto `~/Documentos/RTT-sessions`. |
| Destino PipeWire | Nodo del que capturar. Vacío = la salida de audio por defecto. |
| Analizar cada N segmentos | Con qué frecuencia el modelo busca alertas. |
| Ventana de análisis | Cuántos segmentos recientes ve el modelo en cada pasada. |
| Telegram | Activar el envío de alertas, token del bot y Chat ID. *Enviar prueba* manda un mensaje de test. |

Los ajustes se guardan con **Guardar**, en `~/.config/rtt/settings.json` (el archivo se crea la primera vez que guardas). El token de Telegram se cifra con `safeStorage` de Electron.

### Telegram (opcional)

1. Crea un bot con [@BotFather](https://t.me/BotFather) y copia su token.
2. Escríbele un mensaje al bot y averigua tu Chat ID.
3. En *Ajustes → Telegram* activa el envío, pega token y Chat ID, pulsa *Enviar prueba* y luego *Guardar*.

## Qué se guarda de cada sesión

```
~/Documentos/RTT-sessions/<AAAA-MM-DD_HH-mm-ss>/
├─ transcript.txt   # [hh:mm:ss] texto — se escribe en vivo, no se pierde si la app se cierra
├─ alerts.json      # lista de alertas: tipo, título, detalle y fecha si se mencionó
└─ summary.md       # resumen final, generado al detener
```

## Cómo funciona (resumen)

```
audio del sistema → pw-record → Whisper + VAD (transcripción) → segmentos
                                                                  │
                         panel + transcript.txt  ◄────────────────┤
                                                                  ▼
                              Qwen3.5-2B (alertas por tool calling) → panel + alerts.json (+ Telegram)

Al detener: resumen por bloques con el mismo modelo → summary.md
```

El detalle de módulos y decisiones está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Qué hay en el repositorio

| Ruta | Qué es |
|---|---|
| `src/main/` | Proceso principal de Electron. Toda la lógica y el uso de QVAC. |
| `src/main/index.ts` | Crea la ventana y registra los canales IPC. |
| `src/main/session-manager.ts` | Orquesta una sesión completa (audio → texto → alertas → disco). |
| `src/main/audio/` | Captura de audio: la interfaz `AudioSource` y la implementación de Linux (`linux-pipewire.ts`). |
| `src/main/models.ts` | Carga y descarga de los modelos. **Aquí se cambian los modelos.** |
| `src/main/transcriber.ts` | Transcripción en streaming con Whisper. |
| `src/main/analyzer.ts` | Detección de alertas y resumen por bloques. Contiene los prompts. |
| `src/main/notifier-telegram.ts` | Envío de alertas a Telegram. |
| `src/main/session-store.ts` | Lectura y escritura de las carpetas de sesión. |
| `src/main/settings-store.ts` | Lectura y escritura de los ajustes. |
| `src/preload/` | Puente seguro entre la interfaz y el proceso principal (`window.rtt`). |
| `src/renderer/` | Interfaz en React: paneles de historial/ajustes, transcripción y alertas. |
| `src/shared/types.ts` | Tipos compartidos entre procesos; es el contrato de la API interna. |
| `docs/ARCHITECTURE.md` | Arquitectura y decisiones de diseño. |
| `electron.vite.config.ts` | Configuración de compilación. |
| `forge.config.cjs` | Configuración de empaquetado con Electron Forge y el plugin de QVAC. |
| `qvac.config.json` | Plugins de QVAC que se incluyen al empaquetar (Whisper y LLM). |
| `package.json` | Dependencias y scripts. |
| `tsconfig.json` | Configuración de TypeScript. |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca la app en modo desarrollo (con `--no-sandbox`, necesario en Linux). |
| `npm run build` | Compila a `dist/`. |
| `npm run typecheck` | Revisa los tipos sin compilar. |
| `npm run package` / `npm run make` | Empaqueta la app con Electron Forge. Configurado pero sin probar. |

## Cambiar los modelos

Edita las constantes al inicio de `src/main/models.ts` (`WHISPER_MODEL` y `LLM_MODEL`) con cualquier constante exportada por `@qvac/sdk`. Los modelos nuevos se descargan en el siguiente arranque.

## Limitaciones conocidas

- Solo hay captura de audio del sistema en **Linux (PipeWire)**. Para otras plataformas hay que implementar `AudioSource` (ver `src/main/audio/`).
- El modelo de 2B puede inventar o malinterpretar detalles en alertas y resúmenes, y marcar como alerta algo que no lo es. Conviene revisar lo importante contra la transcripción.
- El resumen se genera por completo al detener, así que en llamadas de horas Detener tarda unos minutos.
- El empaquetado no está probado.

## Solución de problemas

- **No aparece texto:** revisa que la barra de nivel se mueva. Si no, comprueba que `pw-record` existe y que el audio sale por la salida por defecto, o indica el nodo en *Destino PipeWire*.
- **Error `Electron uninstall` al arrancar:** ejecuta `node node_modules/electron/install.js`.
- **Los modelos tardan en descargarse:** es normal la primera vez; depende de tu conexión.
- **Un error en rojo en la ventana:** indica el módulo que falló (`Transcripción`, `Análisis`, `Telegram`); la sesión sigue cuando es posible.
