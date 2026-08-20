/**
 * Prueba de concepto del reproductor.
 *
 * Objetivo único: comprobar que mpv se empotra en una ventana de Electron y
 * reproduce un .mkv del proveedor, informando de qué códecs trae dentro. Si
 * esto no funciona, la arquitectura de la app cambia por completo, así que se
 * valida antes de construir nada de interfaz encima.
 *
 *   npm run start:desktop                      (lee la URL de .probe-cache/test-url.txt)
 *   npm run start:desktop -- <url> --auto-exit 20
 *   .\app.cmd --sw                            (salida por software)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, app } from 'electron';

import { MpvPlayer, findMpv } from './mpv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function parseArgs(argv) {
  const options = { url: null, autoExit: 0, software: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--auto-exit') options.autoExit = Number(argv[++i] ?? 0);
    // Salida de vídeo por software: evita el plano de superposición de
    // hardware, que tapa la interfaz saltándose el orden Z.
    else if (arg === '--sw') options.software = true;
    else if (!arg.startsWith('-')) options.url = arg;
  }
  return options;
}

/** URL de prueba, fuera del código: lleva las credenciales del panel dentro. */
function testUrl() {
  try {
    return readFileSync(join(repoRoot, '.probe-cache', 'test-url.txt'), 'utf8').trim();
  } catch {
    return null;
  }
}

/** Oculta usuario y contraseña de las rutas /movie/USER/PASS/id.mkv. */
function redact(url) {
  return url.replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//, '/$1/***/***/');
}

const options = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const url = options.url ?? testUrl();

let player = null;

app.whenReady().then(async () => {
  // Ventana anfitriona: solo aloja a mpv. No lleva interfaz porque Chromium
  // pinta una superficie opaca sobre toda la ventana y taparía el vídeo.
  const window_ = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    title: 'Prueba mpv',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // La interfaz va en una ventana transparente por encima. Es la única forma
  // de tener HTML sobre el vídeo, y la que permitirá poner controles y fichas
  // encima de la reproducción.
  const overlay = new BrowserWindow({
    parent: window_,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await overlay.loadFile(join(here, 'index.html'));

  // Cuando mpv empieza a decodificar sube su ventana hija por encima de todo y
  // taparía la interfaz. La solución es marcar la superposición como
  // siempre-encima: una ventana de nivel superior gana a la ventana hija de
  // otra ventana.
  //
  // Pero "siempre encima" a secas la deja flotando sobre las demás
  // aplicaciones, así que se activa solo mientras la app tiene el foco.
  const raiseOverlay = () => {
    if (!overlay.isDestroyed()) overlay.setAlwaysOnTop(true, 'pop-up-menu');
  };
  const releaseOverlay = () => {
    if (!overlay.isDestroyed()) overlay.setAlwaysOnTop(false);
  };

  window_.on('focus', raiseOverlay);
  window_.on('blur', releaseOverlay);
  window_.on('minimize', releaseOverlay);
  window_.on('restore', raiseOverlay);
  if (window_.isFocused()) raiseOverlay();

  // La superposición sigue a la ventana anfitriona en tamaño y posición.
  const syncOverlay = () => overlay.setBounds(window_.getContentBounds());
  syncOverlay();
  window_.on('resize', syncOverlay);
  window_.on('move', syncOverlay);
  window_.on('closed', () => overlay.destroy());

  // El HWND de la ventana, que es lo que mpv necesita para empotrarse.
  const handleBuffer = window_.getNativeWindowHandle();
  const handle = process.platform === 'win32' ? handleBuffer.readBigUInt64LE() : handleBuffer.readBigUInt64LE();

  console.log(`\n== Prueba de reproducción ==`);
  console.log(`  mpv:      ${findMpv()}`);
  console.log(`  salida:   ${options.software ? 'software (OpenGL, sin hwdec)' : 'hardware (D3D11)'}`);
  console.log(`  ventana:  HWND ${handle}`);

  player = new MpvPlayer({ software: options.software });

  try {
    await player.start(handle);
    console.log('  empotrado: OK, mpv responde por el socket de control');
  } catch (error) {
    console.error(`  FALLO al arrancar mpv: ${error.message}`);
    app.quit();
    return;
  }

  if (!url) {
    console.log('\n  Sin URL de prueba. Escribe una en .probe-cache/test-url.txt o pásala como argumento.');
    return;
  }

  console.log(`  fichero:  ${redact(url)}`);

  // El informe se emite cuando mpv confirma que ha empezado a decodificar:
  // preguntar antes devolvería propiedades vacías.
  player.on(async (event) => {
    if (event.event === 'file-loaded') await report(player);
    if (event.event === 'end-file' && event.reason === 'error') {
      console.error(`\n  FALLO: mpv no pudo reproducir (${event.file_error ?? 'error desconocido'})`);
    }
  });

  await player.load(url);

  if (options.autoExit > 0) {
    setTimeout(() => {
      console.log(`\n  Cierre automático tras ${options.autoExit}s.`);
      app.quit();
    }, options.autoExit * 1000);
  }
});

async function report(player_) {
  // Un respiro para que mpv rellene las propiedades del flujo.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    const [format, duration, videoCodec, audioCodec, width, height, hwdec] = await Promise.all([
      player_.get('file-format').catch(() => '?'),
      player_.get('duration').catch(() => null),
      player_.get('video-codec').catch(() => '?'),
      player_.get('audio-codec').catch(() => '?'),
      player_.get('width').catch(() => null),
      player_.get('height').catch(() => null),
      player_.get('hwdec-current').catch(() => 'no'),
    ]);

    console.log('\n== Reproduciendo ==');
    console.log(`  contenedor:  ${format}`);
    console.log(`  vídeo:       ${videoCodec} ${width && height ? `(${width}x${height})` : ''}`);
    console.log(`  audio:       ${audioCodec}`);
    console.log(`  duración:    ${duration ? `${Math.round(duration / 60)} min` : 'desconocida'}`);
    console.log(`  decodifica:  ${hwdec === 'no' ? 'por CPU' : `por hardware (${hwdec})`}`);
  } catch (error) {
    console.error(`  no se pudieron leer las propiedades: ${error.message}`);
  }
}

// Liberar la conexión del panel pase lo que pase: con max_connections=1, un
// mpv zombi deja la cuenta bloqueada hasta que el servidor caduque la sesión.
app.on('before-quit', async (event) => {
  if (!player) return;
  event.preventDefault();
  const closing = player;
  player = null;
  await closing.stop();
  console.log('  mpv cerrado, conexión liberada.');
  app.quit();
});

app.on('window-all-closed', () => app.quit());
