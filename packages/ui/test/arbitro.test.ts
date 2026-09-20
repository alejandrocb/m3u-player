/**
 * El árbitro de conexiones.
 *
 * Lo que hay que dejar clavado son las tres reglas medidas contra el panel
 * real: la reproducción gana siempre, lo recién soltado tarda medio minuto en
 * quedar libre, y un 403 no es un fallo sino una espera.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Arbitro, ENFRIAMIENTO_MS, esLimiteDeConexiones } from '../src/arbitro.ts';

/** Un reloj de mentira, que es lo que permite probar los treinta segundos. */
function reloj(desde = 1_000_000): { ahora: () => number; avanzar: (ms: number) => void } {
  let momento = desde;
  return { ahora: () => momento, avanzar: (ms) => (momento += ms) };
}

test('con una ranura, lo segundo espera', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);

  assert.equal(arbitro.pedir('peli', 'reproducir', t.ahora()).concedido, true);

  const segunda = arbitro.pedir('otra', 'reproducir', t.ahora());
  assert.equal(segunda.concedido, false);
  assert.equal(segunda.concedido === false && segunda.porque, 'ranuras');
});

test('con tres ranuras caben tres, y la cuarta no', () => {
  const t = reloj();
  const arbitro = new Arbitro(3);

  for (const id of ['una', 'dos', 'tres']) {
    assert.equal(arbitro.pedir(id, 'reproducir', t.ahora()).concedido, true);
  }
  assert.equal(arbitro.pedir('cuatro', 'reproducir', t.ahora()).concedido, false);
});

test('el número de ranuras sale del handshake, no de una constante', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);
  arbitro.ajustarRanuras(3);

  assert.equal(arbitro.ranuras, 3);
  assert.equal(arbitro.pedir('una', 'reproducir', t.ahora()).concedido, true);
  assert.equal(arbitro.pedir('dos', 'reproducir', t.ahora()).concedido, true);
});

test('reproducir echa a la descarga, y dice a quién', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);
  arbitro.pedir('bajando', 'descargar', t.ahora());

  const puesta = arbitro.pedir('peli', 'reproducir', t.ahora());
  assert.equal(puesta.concedido, true);
  assert.deepEqual(puesta.concedido === true && puesta.expulsados, ['bajando']);
  // Y la descarga ya no cuenta como abierta.
  assert.deepEqual(
    arbitro.enUso().map((uno) => uno.id),
    ['peli'],
  );
});

test('la descarga no echa a la reproducción: espera', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);
  arbitro.pedir('peli', 'reproducir', t.ahora());

  assert.equal(arbitro.pedir('bajando', 'descargar', t.ahora()).concedido, false);
});

test('la vista previa cede ante la reproducción y manda sobre la descarga', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);

  arbitro.pedir('bajando', 'descargar', t.ahora());
  const previa = arbitro.pedir('previa', 'previa', t.ahora());
  assert.deepEqual(previa.concedido === true && previa.expulsados, ['bajando']);

  const peli = arbitro.pedir('peli', 'reproducir', t.ahora());
  assert.deepEqual(peli.concedido === true && peli.expulsados, ['previa']);
});

test('entre dos descargas se echa a la más vieja, que ya ha adelantado más', () => {
  const t = reloj();
  const arbitro = new Arbitro(2);
  arbitro.pedir('vieja', 'descargar', t.ahora());
  t.avanzar(60_000);
  arbitro.pedir('nueva', 'descargar', t.ahora());

  const peli = arbitro.pedir('peli', 'reproducir', t.ahora());
  assert.deepEqual(peli.concedido === true && peli.expulsados, ['vieja']);
});

test('lo recién soltado no se puede reusar: el panel tarda medio minuto', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);
  arbitro.pedir('peli', 'reproducir', t.ahora());
  arbitro.soltar('peli', t.ahora());

  const seguida = arbitro.pedir('otra', 'reproducir', t.ahora());
  assert.equal(seguida.concedido, false);
  assert.equal(seguida.concedido === false && seguida.porque, 'enfriando');
  // Y dice cuánto falta, para no preguntar a ciegas.
  assert.equal(seguida.concedido === false && seguida.esperar, ENFRIAMIENTO_MS);

  t.avanzar(ENFRIAMIENTO_MS);
  assert.equal(arbitro.pedir('otra', 'reproducir', t.ahora()).concedido, true);
});

test('pedir dos veces lo mismo no gasta dos ranuras', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);

  assert.equal(arbitro.pedir('peli', 'reproducir', t.ahora()).concedido, true);
  // Es el caso de cambiar de canal sin cerrar el reproductor, y el de
  // reintentar tras un 403.
  assert.equal(arbitro.pedir('peli', 'reproducir', t.ahora()).concedido, true);
  assert.equal(arbitro.enUso().length, 1);
});

test('un 403 suelta lo nuestro sin enfriar: la ranura la tiene otro aparato', () => {
  const t = reloj();
  const arbitro = new Arbitro(1);
  arbitro.pedir('peli', 'reproducir', t.ahora());

  const espera = arbitro.rechazado('peli', t.ahora());
  assert.ok(espera > 0, 'debería decir cuánto esperar');
  assert.equal(arbitro.enUso().length, 0);
  // Nada de enfriamiento: aquí no llegó a abrirse ninguna conexión.
  assert.equal(arbitro.pedir('peli', 'reproducir', t.ahora()).concedido, true);
});

test('reconoce el 403 del panel venga de donde venga', () => {
  // Tal como lo suelta el reproductor de Android, con la traza de Java.
  assert.equal(
    esLimiteDeConexiones({ error: { errorString: 'Response code: 403', errorCode: '2004' } }),
    true,
  );
  // Y tal como lo contesta el panel a una petición nuestra.
  assert.equal(esLimiteDeConexiones('HTTP 403 en get_live_streams'), true);
  assert.equal(esLimiteDeConexiones('{"message":"Max Connections Reached"}'), true);
});

test('y no confunde otros fallos con el límite', () => {
  assert.equal(esLimiteDeConexiones({ error: { errorString: 'Response code: 404' } }), false);
  assert.equal(esLimiteDeConexiones('UnknownHostException'), false);
  assert.equal(esLimiteDeConexiones(null), false);
});
