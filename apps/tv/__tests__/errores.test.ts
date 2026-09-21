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

/**
 * Lo que soltó la tele al abrir *Baby Driver*, recortado.
 *
 * DTS 5.1 en español: el decodificador de H.264 arrancó bien y el que no
 * existe es el de audio. `format_supported=NO_UNSUPPORTED_TYPE` quiere decir
 * que el aparato no tiene con qué, no que el fichero esté roto.
 */
const AUDIO_DTS = {
  error: {
    errorCode: '24001',
    errorException:
      'androidx.media3.exoplayer.ExoPlaybackException: MediaCodecAudioRenderer error, index=1, ' +
      'format=Format(2, Movieshdgratis, video/x-matroska, audio/vnd.dts, null, -1, es, ' +
      '[-1, -1, -1.0, null], [6, 48000]), format_supported=NO_UNSUPPORTED_TYPE ... ' +
      'DecoderInitializationException: Decoder init failed: [-49999]',
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

test('el audio con licencia se nombra, y se dice que es de esta copia', () => {
  const mensaje = mensajeDeError(AUDIO_DTS);
  expect(mensaje).toContain('DTS');
  // Que el problema es de **esta copia** y de **este aparato**, no del título.
  expect(mensaje).toContain('Esta copia');
  expect(mensaje).toContain('este aparato');
  // Y no el genérico, que deja sin saber si falla el vídeo o el sonido.
  expect(mensaje).not.toBe('El aparato no puede decodificar este vídeo o su audio.');
});

test('el 403 del panel se explica como límite de conexiones', () => {
  expect(mensajeDeError(MAX_CONEXIONES)).toContain('límite de conexiones');
});

test('un fallo desconocido no deja la pantalla muda', () => {
  expect(mensajeDeError({})).toBe('No se pudo reproducir.');
  expect(mensajeDeError(null)).toBe('No se pudo reproducir.');
});
