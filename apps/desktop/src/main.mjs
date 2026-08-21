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

import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import { MpvPlayer, findMpv } from './mpv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function parseArgs(argv) {
  const options = { url: null, autoExit: 0, software: false, ventana: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--auto-exit') options.autoExit = Number(argv[++i] ?? 0);
    // Salida de vídeo por software: evita el plano de superposición de
    // hardware, que tapa la interfaz saltándose el orden Z.
    else if (arg === '--sw') options.software = true;
    // El destino son tablets, televisores y móviles: la app va a pantalla
    // completa siempre. En desarrollo estorba, y para eso está `--ventana`.
    else if (arg === '--ventana') options.ventana = true;
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

// `M3U_URL` antes que el argumento: la línea de comandos de un proceso la puede
// leer cualquiera desde el Administrador de tareas, y estas URLs llevan el
// usuario y la contraseña del panel dentro.
const url = process.env.M3U_URL ?? options.url ?? testUrl();

let player = null;

app.whenReady().then(async () => {
  // Una sola ventana: aloja a mpv y a la interfaz a la vez.
  //
  // Dentro de la ventana, mpv crea una ventana hija (clase "mpv") y Chromium
  // otra (clase "Intermediate D3D Window"). Medido en Electron 43 + mpv 0.41,
  // **Chromium queda por encima**, así que la interfaz se dibuja sobre el
  // vídeo sin hacer nada especial. Lo único imprescindible es que la ventana
  // no pinte un fondo opaco, o taparía el vídeo con él: de ahí `transparent`
  // y el fondo con alfa cero.
  //
  // Antes esto se resolvía con dos ventanas —una anfitriona y una superpuesta
  // marcada como siempre-encima—, partiendo de que era mpv quien se subía.
  // Con estas versiones es al revés, y la segunda ventana solo servía para
  // tapar el vídeo de negro.
  //
  // El precio de `transparent` en Windows: Electron marca la ventana como no
  // redimensionable y le quita WS_THICKFRAME, así que **el usuario no puede
  // arrastrar los bordes**. Medido: `setResizable(true)` no lo revierte y
  // `setSize` se ignora, pero `setBounds`, `maximize` y la pantalla completa
  // sí funcionan. Cuando llegue la interfaz habrá que dar marco propio y
  // redimensionar con `setBounds`, o aceptar tamaño fijo más maximizar.
  // Sin menú: en un televisor o una tablet no hay a quién servirle un "File,
  // Edit, View", y en pantalla completa solo roba sitio.
  Menu.setApplicationMenu(null);

  const window_ = new BrowserWindow({
    width: 1280,
    height: 720,
    // Pantalla completa de partida, que es como se va a usar. Con la ventana
    // sin marco no queda botón de cerrar del sistema: lo pone la interfaz.
    fullscreen: !options.ventana,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Prueba mpv',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(here, 'preload.cjs'),
    },
  });

  // El <title> del HTML se impondría al de la ventana; el nombre lo decide la
  // app, no el documento.
  window_.on('page-title-updated', (event) => event.preventDefault());

  // Salir es cosa de la interfaz: el botón de cerrar y el "atrás" repetido.
  ipcMain.on('app:cerrar', () => app.quit());

  await window_.loadFile(join(here, 'index.html'));

  // El HWND de la ventana, que es lo que mpv necesita para empotrarse.
  const handleBuffer = window_.getNativeWindowHandle();
  const handle = handleBuffer.readBigUInt64LE();

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
