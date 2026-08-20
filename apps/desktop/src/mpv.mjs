/**
 * Control de mpv como proceso hijo empotrado en una ventana nativa.
 *
 * Por qué mpv y no <video>: el VOD del proveedor viene en .mkv (Matroska), que
 * Chromium no reproduce ni llevando H.264 dentro, y el audio suele ser AC3/E-AC3,
 * que tampoco decodifica por licencia.
 *
 * La comunicación va por el socket JSON IPC de mpv, que en Windows es una
 * tubería con nombre. Cada comando lleva un request_id para poder casar la
 * respuesta, porque mpv mezcla respuestas y eventos en el mismo flujo.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

/** Rutas donde suele quedar mpv en Windows tras instalarlo. */
const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\MPV Player\\mpv.exe',
  'C:\\Program Files\\mpv\\mpv.exe',
  'C:\\Program Files (x86)\\mpv\\mpv.exe',
];

/** Localiza el ejecutable. Devuelve null si no hay mpv en el sistema. */
export function findMpv() {
  if (process.env.MPV_PATH && existsSync(process.env.MPV_PATH)) return process.env.MPV_PATH;
  for (const candidate of WINDOWS_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  // Última opción: confiar en el PATH.
  return process.platform === 'win32' ? 'mpv.exe' : 'mpv';
}

export class MpvPlayer {
  #process = null;
  #socket = null;
  #pipe;
  #binary;
  #nextRequestId = 1;
  #pending = new Map();
  #buffer = '';
  #listeners = new Set();

  #software;

  constructor({ binary = findMpv(), pipeName = 'mpv-m3u-player', software = false } = {}) {
    this.#binary = binary;
    this.#software = software;
    this.#pipe = process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : `/tmp/${pipeName}.sock`;
  }

  /**
   * Arranca mpv empotrado en la ventana nativa indicada.
   *
   * @param {bigint|number} windowHandle HWND de la ventana anfitriona.
   */
  async start(windowHandle) {
    const args = [
      // Empotrar: mpv crea una ventana hija dentro de esta y la sigue al
      // redimensionar. Sin esto abriría una ventana suelta.
      `--wid=${windowHandle}`,
      `--input-ipc-server=${this.#pipe}`,
      // Sin configuración del usuario: que la app se comporte igual en
      // cualquier máquina, pase lo que pase en el mpv.conf de cada uno.
      '--no-config',
      '--no-terminal',
      // Quedarse vivo sin fichero: la ventana existe antes de elegir qué ver.
      '--idle=yes',
      '--force-window=yes',
      // Al acabar un episodio no cerrar: la app decide si pasa al siguiente.
      '--keep-open=yes',
      // Algunos servidores solo responden a agentes de reproductor conocidos.
      '--user-agent=VLC/3.0.20 LibVLC/3.0.20',
      // Decodificación por hardware donde sea seguro. Sin esto, un HEVC a 4K
      // se come la CPU entera. "auto-safe" excluye los códecs problemáticos.
      ...(this.#software
        ? [
            // Modo software. La salida D3D11 puede acabar en un plano de
            // superposición de hardware, que se dibuja saltándose el orden Z
            // de ventanas y tapa la interfaz. OpenGL compone como una ventana
            // normal, a costa de más CPU. Es también el modo que hace falta en
            // sesiones remotas (RDP), donde D3D11 va irregular.
            '--hwdec=no',
            '--gpu-api=opengl',
          ]
        : ['--hwdec=auto-safe']),
      // Búfer generoso: el VOD viene por HTTP de servidores lentos.
      '--cache=yes',
      '--demuxer-max-bytes=64MiB',
    ];

    this.#process = spawn(this.#binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.#process.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[mpv] ${text}`);
    });

    const exited = new Promise((_, reject) => {
      this.#process.once('error', (error) => reject(new Error(`no se pudo lanzar mpv: ${error.message}`)));
      this.#process.once('exit', (code) => reject(new Error(`mpv terminó antes de tiempo (código ${code})`)));
    });

    await Promise.race([this.#connect(), exited]);
  }

  /** La tubería no existe hasta que mpv termina de arrancar: reintentar. */
  async #connect(attempts = 50) {
    for (let i = 0; i < attempts; i++) {
      try {
        this.#socket = await new Promise((resolve, reject) => {
          const socket = net.connect(this.#pipe);
          socket.once('connect', () => resolve(socket));
          socket.once('error', reject);
        });
        this.#socket.on('data', (chunk) => this.#onData(chunk));
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error('mpv arrancó pero no abrió el socket de control');
  }

  #onData(chunk) {
    this.#buffer += chunk.toString('utf8');
    // mpv manda un objeto JSON por línea.
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (message.request_id !== undefined && this.#pending.has(message.request_id)) {
        const { resolve, reject } = this.#pending.get(message.request_id);
        this.#pending.delete(message.request_id);
        if (message.error && message.error !== 'success') reject(new Error(message.error));
        else resolve(message.data);
        continue;
      }

      if (message.event) {
        for (const listener of this.#listeners) listener(message);
      }
    }
  }

  /** Se notifica cada evento de mpv (playback-restart, end-file, ...). */
  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  command(...args) {
    if (!this.#socket) throw new Error('mpv no está arrancado');
    const requestId = this.#nextRequestId++;
    const payload = JSON.stringify({ command: args, request_id: requestId }) + '\n';

    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#socket.write(payload, (error) => {
        if (error) {
          this.#pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  get(property) {
    return this.command('get_property', property);
  }

  set(property, value) {
    return this.command('set_property', property, value);
  }

  load(url) {
    return this.command('loadfile', url, 'replace');
  }

  /**
   * Cierra mpv y, con él, la conexión al servidor.
   *
   * Con max_connections=1 esto es crítico: si el proceso queda vivo, el panel
   * sigue contando la conexión ocupada y no se puede ver nada más.
   */
  async stop() {
    if (!this.#process) return;
    const process_ = this.#process;
    this.#process = null;

    try {
      await this.command('quit');
    } catch {
      // Si el socket ya no responde, se mata sin más.
    }

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        process_.kill('SIGKILL');
        resolve();
      }, 2000);
      process_.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.#socket?.destroy();
    this.#socket = null;
  }
}
