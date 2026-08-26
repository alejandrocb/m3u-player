/**
 * El preparador de portadas, contra un panel de mentira.
 *
 * Lo que hay que dejar clavado es la regla: **sin imagen apaisada no hay
 * sugerencia**. Es la que evita que el inicio salga presidido por un cartel
 * vertical estirado, que es de donde viene todo esto.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { esApaisada, medir } from '../src/imagen.ts';
import { prepararPortadas } from '../src/portadas.ts';

/** Una cabecera PNG con las medidas que se le pidan. */
function png(ancho: number, alto: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const vista = new DataView(bytes.buffer);
  vista.setUint32(16, ancho);
  vista.setUint32(20, alto);
  return bytes;
}

test('una cabecera PNG se mide sin descargar la imagen', () => {
  assert.deepEqual(medir(png(1920, 1080)), { ancho: 1920, alto: 1080 });
});

test('lo vertical no pasa por apaisado', () => {
  assert.equal(esApaisada({ ancho: 1920, alto: 1080 }), true);
  assert.equal(esApaisada({ ancho: 600, alto: 900 }), false);
  assert.equal(esApaisada(null), false);
});

test('una cabecera JPEG se mide saltándose los segmentos de la cámara', () => {
  const bytes = new Uint8Array([
    0xff, 0xd8, // arranque
    0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4, // un APP0 cualquiera, que hay que saltar
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x40, 0x04, 0x00, // SOF0: alto 576, ancho 1024
  ]);
  assert.deepEqual(medir(bytes), { ancho: 1024, alto: 576 });
});

const ANIO = new Date().getFullYear();

/** Un panel de mentira con dos películas y una serie. */
function panelFalso(): typeof globalThis.fetch {
  const respuesta = (datos: unknown): Response =>
    new Response(JSON.stringify(datos), { status: 200, headers: { 'Content-Type': 'application/json' } });

  return (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));

    if (url.pathname === '/fondo.png') return new Response(png(1920, 1080), { status: 206 });
    if (url.pathname === '/cartel.png') return new Response(png(600, 900), { status: 206 });

    const accion = url.searchParams.get('action');
    if (accion === 'get_vod_streams') {
      return respuesta([
        { stream_id: 1, name: `La buena (${ANIO}) 1080p`, rating: '8.4', year: String(ANIO), stream_icon: 'x' },
        // La misma película en otra calidad: aquí es donde está la sinopsis.
        { stream_id: 4, name: `La buena (${ANIO}) 720p`, rating: '8.4', year: String(ANIO), stream_icon: 'x' },
        { stream_id: 2, name: `La del cartel (${ANIO})`, rating: '9.1', year: String(ANIO), stream_icon: 'x' },
        { stream_id: 3, name: 'Una vieja (1998)', rating: '9.9', year: '1998', stream_icon: 'x' },
        // Un diez de los que reparte el proveedor y una copia de pase de
        // prensa: las dos con fondo bueno, para que lo que las descarte sea
        // el criterio y no la falta de imagen.
        { stream_id: 5, name: `La del diez (${ANIO})`, rating: '10', year: String(ANIO), stream_icon: 'x' },
        { stream_id: 6, name: `La muestra (${ANIO}) SCREENING`, rating: '8.8', year: String(ANIO), stream_icon: 'x' },
      ]);
    }
    if (accion === 'get_series') {
      return respuesta([
        { series_id: 7, name: 'La serie', rating: '8', releaseDate: `${ANIO}-01-01`, cover: 'x' },
      ]);
    }
    if (accion === 'get_vod_info') {
      const id = url.searchParams.get('vod_id');
      // La 2 está mejor valorada, pero lo que da por fondo es el cartel.
      if (id === '2') return respuesta({ info: { backdrop_path: ['http://panel/cartel.png'], plot: 'Con cartel.' } });
      // La primera calidad trae imagen pero no sinopsis; la segunda, al revés.
      if (id === '1') return respuesta({ info: { backdrop_path: ['http://panel/fondo.png'], genre: 'Drama' } });
      if (id === '4') return respuesta({ info: { plot: 'Con fondo.', cast: 'Fulana', genre: 'Drama' } });
      return respuesta({ info: { backdrop_path: ['http://panel/fondo.png'], plot: 'Otra.', genre: 'Drama' } });
    }
    if (accion === 'get_series_info') {
      return respuesta({ info: { backdrop_path: ['http://panel/fondo.png'], plot: 'Una serie.' } });
    }
    return respuesta({});
  }) as typeof globalThis.fetch;
}

test('solo se sugiere lo que trae imagen apaisada', async () => {
  const { portadas } = await prepararPortadas('http://panel/get.php?username=u&password=p', {
    fetch: panelFalso(),
  });

  assert.deepEqual(
    portadas.map((portada) => portada.titulo),
    ['La buena', 'La serie'],
    'la del cartel vertical se queda fuera y la vieja no llega a candidata',
  );
});

test('ni los dieces ni las copias de pase de prensa se sugieren', async () => {
  // El proveedor reparte dieces a mansalva, así que un 10 no significa que
  // sea buena; y una "SCREENING" es una grabación previa al estreno.
  const { portadas } = await prepararPortadas('http://panel/get.php?username=u&password=p', {
    fetch: panelFalso(),
  });

  assert.ok(
    !portadas.some((portada) => portada.titulo.includes('diez') || /screening/i.test(portada.titulo)),
    'las dos se quedan fuera aunque tengan imagen apaisada',
  );
});

test('el identificador es el mismo que calcula el aparato', async () => {
  const { portadas, generos } = await prepararPortadas('http://panel/get.php?username=u&password=p', {
    fetch: panelFalso(),
  });

  const pelicula = portadas.find((portada) => portada.clase === 'pelicula');
  assert.equal(pelicula?.id, `la-buena-${ANIO}`);
  assert.equal(pelicula?.sinopsis, 'Con fondo.');
  assert.equal(pelicula?.genero, 'Drama');
  assert.equal(portadas.find((portada) => portada.clase === 'serie')?.id, `la-serie-${ANIO}`);

  /*
    Y de las que van a salir en los carruseles se averigua el género, que el
    catálogo de películas no trae. Aquí entran también el diez y la copia de
    pase de prensa: no presiden el inicio, pero salen en "recién llegadas"
    como cualquier otra y allí también quieren su género.
  */
  assert.deepEqual(
    generos.map((genero) => genero.id).sort(),
    [`la-buena-${ANIO}`, `la-del-diez-${ANIO}`, `la-muestra-screening-${ANIO}`, 'una-vieja-1998'],
  );
});

test('la sinopsis se busca en las otras calidades del mismo título', async () => {
  // El proveedor manda una entrada por calidad y no todas traen lo mismo: una
  // tiene la imagen y otra la sinopsis, y la portada las quiere las dos.
  const { portadas } = await prepararPortadas('http://panel/get.php?username=u&password=p', {
    fetch: panelFalso(),
  });

  const pelicula = portadas.find((portada) => portada.clase === 'pelicula');
  assert.equal(pelicula?.imagen, 'http://panel/fondo.png');
  assert.equal(pelicula?.sinopsis, 'Con fondo.');
  assert.equal(pelicula?.reparto, 'Fulana');
});

test('sin credenciales en la URL no hay nada que preparar', async () => {
  await assert.rejects(() => prepararPortadas('http://panel/lista.m3u'), /usuario y contraseña/);
});
