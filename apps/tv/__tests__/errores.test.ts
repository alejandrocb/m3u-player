/**
 * Los mensajes de fallo del reproductor.
 *
 * Las muestras están copiadas de lo que soltó ExoPlayer en la tablet, no
 * inventadas: es lo único que garantiza que las expresiones sigan casando
 * cuando cambie la versión de media3.
 */

import { mensajeDeError } from '../src/reproductor';

/** Lo que llegó al reproducir un episodio de "12 monos". Recortado. */
const HEVC_10_BITS = {
  error: {
    errorCode: '24003',
    errorString: 'ERROR_CODE_DECODING_FAILED',
    errorException:
      'androidx.media3.exoplayer.ExoPlaybackException: MediaCodecVideoRenderer error, index=0, ' +
      'format=Format(1, , video/x-matroska, video/hevc, hvc1.2.4.L120.90, -1, und, [1920, 1080, -1.0, null], ' +
      '[-1, -1]), format_supported=NO_EXCEEDS_CAPABILITIES ... Decoder failed: c2.mtk.hevc.decoder',
  },
};

const MAX_CONEXIONES = {
  error: { errorException: 'InvalidResponseCodeException: Response code: 403' },
};

test('el HEVC de 10 bits se nombra por lo que es', () => {
  const mensaje = mensajeDeError(HEVC_10_BITS);
  expect(mensaje).toContain('10 bits');
  // Y no el genérico, que no dice si es el fichero, la red o el aparato.
  expect(mensaje).not.toBe('El aparato no puede decodificar este vídeo o su audio.');
});

test('el 403 del panel se explica como límite de conexiones', () => {
  expect(mensajeDeError(MAX_CONEXIONES)).toContain('límite de conexiones');
});

test('un fallo desconocido no deja la pantalla muda', () => {
  expect(mensajeDeError({})).toBe('No se pudo reproducir.');
  expect(mensajeDeError(null)).toBe('No se pudo reproducir.');
});
