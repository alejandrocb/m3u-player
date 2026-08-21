import assert from 'node:assert/strict';
import test from 'node:test';

import {
  avanceDePrograma,
  programaActual,
  programasDesde,
  programasSiguientes,
  streamIdDeUrl,
} from '../src/epg.ts';

/**
 * Copiado de lo que devolvió `get_short_epg` para 24 Horas, sin tocar. El
 * primero es el que el panel marcaba como `now_playing`.
 */
const CRUDO = [
  {
    title: 'RGlhcmlvIDI0',
    description: 'SW5mb3JtYWNpw7NuLEluZm9ybWF0aXZv',
    start: '2026-08-21 08:35:00',
    end: '2026-08-21 12:00:00',
    start_timestamp: '1787301300',
    stop_timestamp: '1787313600',
    now_playing: 1,
  },
  {
    title: 'Tm90aWNpYXMgMjRI',
    description: '',
    start: '2026-08-21 12:00:00',
    end: '2026-08-21 12:55:00',
    start_timestamp: '1787313600',
    stop_timestamp: '1787316900',
    now_playing: 0,
  },
];

test('el título y la descripción llegan en base64', () => {
  const programas = programasDesde(CRUDO);
  assert.equal(programas[0]!.titulo, 'Diario 24');
  // Y con los acentos en su sitio: base64 trae bytes UTF-8, no caracteres.
  assert.equal(programas[0]!.descripcion, 'Información,Informativo');
  assert.equal(programas[1]!.descripcion, null, 'una descripción vacía es null, no cadena vacía');
});

test('los tiempos del panel son UTC, no hora local', () => {
  const programas = programasDesde(CRUDO);
  // El panel escribe "08:35:00" en `start`, pero el sello dice que son las
  // 08:35 UTC: en España eso son las 10:35, y es cuando se estaba emitiendo.
  assert.equal(programas[0]!.desde.toISOString(), '2026-08-21T08:35:00.000Z');
  assert.equal(programas[0]!.hasta.toISOString(), '2026-08-21T12:00:00.000Z');
});

test('lo que no tiene horas utilizables se descarta', () => {
  assert.deepEqual(programasDesde(undefined), []);
  assert.deepEqual(programasDesde([]), []);
  assert.deepEqual(programasDesde([{ title: 'QQ==', start_timestamp: '0', stop_timestamp: '0' }]), []);
  // Un final anterior al principio es basura, no un programa de duración rara.
  assert.deepEqual(
    programasDesde([{ title: 'QQ==', start_timestamp: '200', stop_timestamp: '100' }]),
    [],
  );
});

test('sin título se pone uno, que la fila no puede salir vacía', () => {
  const programas = programasDesde([{ start_timestamp: '100', stop_timestamp: '200' }]);
  assert.equal(programas[0]!.titulo, 'Sin título');
});

test('los programas salen en orden aunque lleguen mezclados', () => {
  const programas = programasDesde([CRUDO[1]!, CRUDO[0]!]);
  assert.deepEqual(
    programas.map((programa) => programa.titulo),
    ['Diario 24', 'Noticias 24H'],
  );
});

test('el que se emite se decide por la hora del aparato', () => {
  const programas = programasDesde(CRUDO);
  // 10:35 en España es 08:35 UTC: justo el arranque del primero.
  const aLasDiezYMedia = new Date('2026-08-21T09:00:00.000Z');
  assert.equal(programaActual(programas, aLasDiezYMedia)?.titulo, 'Diario 24');

  // Y una hora más tarde ya es el segundo, aunque el panel siga diciendo que
  // el `now_playing` es el primero: ese campo lo calculó su reloj al responder.
  const masTarde = new Date('2026-08-21T12:30:00.000Z');
  assert.equal(programaActual(programas, masTarde)?.titulo, 'Noticias 24H');

  // Fuera de la ventana que dio el panel no hay nada que enseñar.
  assert.equal(programaActual(programas, new Date('2026-08-22T00:00:00.000Z')), null);
});

test('lo próximo es lo que aún no ha empezado', () => {
  const programas = programasDesde(CRUDO);
  const siguientes = programasSiguientes(programas, new Date('2026-08-21T09:00:00.000Z'));
  assert.deepEqual(
    siguientes.map((programa) => programa.titulo),
    ['Noticias 24H'],
  );
});

test('el avance del programa llena la barra del directo', () => {
  const programas = programasDesde(CRUDO);
  const programa = programas[0]!;
  assert.equal(avanceDePrograma(programa, new Date('2026-08-21T08:35:00.000Z')), 0);
  assert.equal(avanceDePrograma(programa, new Date('2026-08-21T12:00:00.000Z')), 1);
  // A la mitad justa de las 3 h 25 min que dura.
  assert.equal(
    Math.round(avanceDePrograma(programa, new Date('2026-08-21T10:17:30.000Z')) * 100),
    50,
  );
  // Y nunca se sale de la barra, aunque el reloj se vaya.
  assert.equal(avanceDePrograma(programa, new Date('2020-01-01T00:00:00.000Z')), 0);
  assert.equal(avanceDePrograma(programa, new Date('2030-01-01T00:00:00.000Z')), 1);
});

test('el identificador del panel se recupera de la URL del canal', () => {
  assert.equal(streamIdDeUrl('http://servidor:8080/live/usuario/clave/43124.ts'), '43124');
  // Algunos paneles sirven el directo sin extensión.
  assert.equal(streamIdDeUrl('http://servidor:8080/live/usuario/clave/43124'), '43124');
  assert.equal(streamIdDeUrl('http://servidor:8080/live/usuario/clave/43124.m3u8?x=1'), '43124');
  // Y lo que no es un canal del panel no da identificador.
  assert.equal(streamIdDeUrl('http://otro/stream/canal.m3u8'), null);
  assert.equal(streamIdDeUrl(''), null);
});

test('un panel que mande el texto en claro también vale', () => {
  // El decodificador es nuestro y no depende de `atob` ni de `TextDecoder`,
  // que Hermes no trae: lo que no sea base64 se deja tal cual en vez de
  // desaparecer.
  const programas = programasDesde([
    { title: 'Telediario 1', start_timestamp: '100', stop_timestamp: '200' },
  ]);
  assert.equal(programas[0]!.titulo, 'Telediario 1');
});

test('los emojis y los acentos sobreviven al base64', () => {
  // "Cine: El niño ⭐" en base64.
  const programas = programasDesde([
    { title: 'Q2luZTogRWwgbmnDsW8g4q2Q', start_timestamp: '100', stop_timestamp: '200' },
  ]);
  assert.equal(programas[0]!.titulo, 'Cine: El niño ⭐');
});
