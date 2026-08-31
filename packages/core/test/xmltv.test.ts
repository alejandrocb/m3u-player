import assert from 'node:assert/strict';
import test from 'node:test';

import { canalesDeXmltv, fechaXmltv, programasDeXmltv, sinEntidades } from '../src/xmltv.ts';

/**
 * Copiado de `xmltv.php` de la lista real, con los nombres de canal que trae
 * el panel. Se ha recortado a tres programas y dos canales; lo demás es más
 * de lo mismo.
 */
const XML = `<?xml version="1.0" encoding="utf-8" ?>
<tv generator-info-name="Xtream Codes">
  <channel id="La1.es"><display-name>La 1</display-name></channel>
  <channel id="Antena3.es"><display-name>Antena 3</display-name></channel>
  <programme start="20260829180000 +0000" stop="20260829193000 +0000" channel="La1.es">
    <title lang="es">Espa&#241;a Directo</title>
    <desc lang="es">Reportajes de actualidad &amp; entrevistas</desc>
  </programme>
  <programme start="20260829193000 +0000" stop="20260829210000 +0000" channel="La1.es">
    <title lang="es">Telediario 2</title>
  </programme>
  <programme start="20260829200000 +0200" stop="20260829220000 +0200" channel="Antena3.es">
    <title lang="es">El Hormiguero</title>
    <desc lang="es">Programa de entretenimiento</desc>
  </programme>
</tv>`;

test('saca los programas con su canal, su título y sus horas', () => {
  const programas = programasDeXmltv(XML);
  assert.equal(programas.length, 3);

  const primero = programas.find((uno) => uno.titulo === 'España Directo')!;
  assert.equal(primero.canal, 'La1.es');
  assert.equal(primero.desde.toISOString(), '2026-08-29T18:00:00.000Z');
  assert.equal(primero.hasta.toISOString(), '2026-08-29T19:30:00.000Z');
});

test('deshace las entidades del XML, también en la sinopsis', () => {
  const programas = programasDeXmltv(XML);
  const conSinopsis = programas.find((uno) => uno.canal === 'La1.es')!;
  assert.equal(conSinopsis.titulo, 'España Directo');
  assert.equal(conSinopsis.descripcion, 'Reportajes de actualidad & entrevistas');
});

test('un programa sin sinopsis no se descarta: se queda sin ella', () => {
  const programas = programasDeXmltv(XML);
  const telediario = programas.find((uno) => uno.titulo === 'Telediario 2')!;
  assert.equal(telediario.descripcion, null);
});

test('el huso de la hora se respeta: +0200 no es lo mismo que UTC', () => {
  const hormiguero = programasDeXmltv(XML).find((uno) => uno.canal === 'Antena3.es')!;
  assert.equal(hormiguero.desde.toISOString(), '2026-08-29T18:00:00.000Z');
});

test('sin huso se toma UTC, como hace el resto del panel', () => {
  assert.equal(fechaXmltv('20260829180000')!.toISOString(), '2026-08-29T18:00:00.000Z');
});

test('una fecha que no lo es se descarta en vez de inventar una', () => {
  assert.equal(fechaXmltv('mañana por la tarde'), null);
  assert.equal(fechaXmltv(''), null);
});

test('los programas con horas imposibles se caen', () => {
  const roto = `<tv>
    <programme start="20260829200000 +0000" stop="20260829190000 +0000" channel="La1.es"><title>Al revés</title></programme>
    <programme stop="20260829210000 +0000" channel="La1.es"><title>Sin principio</title></programme>
    <programme start="20260829200000 +0000" stop="20260829210000 +0000"><title>Sin canal</title></programme>
  </tv>`;
  assert.deepEqual(programasDeXmltv(roto), []);
});

test('los canales declarados salen sin repetir', () => {
  assert.deepEqual(canalesDeXmltv(XML), ['La1.es', 'Antena3.es']);
});

test('el &amp; se deshace el último, o &amp;lt; acabaría siendo un <', () => {
  assert.equal(sinEntidades('&amp;lt;'), '&lt;');
  assert.equal(sinEntidades('Cine &amp; Series'), 'Cine & Series');
});

test('salen ordenados por canal y hora, aunque lleguen mezclados', () => {
  const mezclado = `<tv>
    <programme start="20260829210000 +0000" stop="20260829220000 +0000" channel="B"><title>Tarde</title></programme>
    <programme start="20260829180000 +0000" stop="20260829190000 +0000" channel="B"><title>Pronto</title></programme>
    <programme start="20260829200000 +0000" stop="20260829210000 +0000" channel="A"><title>Uno</title></programme>
  </tv>`;
  assert.deepEqual(
    programasDeXmltv(mezclado).map((uno) => `${uno.canal}:${uno.titulo}`),
    ['A:Uno', 'B:Pronto', 'B:Tarde'],
  );
});
