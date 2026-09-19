/**
 * Las pistas de un MKV, con un fichero de mentira montado a mano.
 *
 * Lo que hay que dejar clavado: que se leen los idiomas y las marcas, que una
 * pista **sin marca cuenta como marcada** —que es justo por lo que salen unos
 * subtítulos que nadie ha pedido— y que de cada una se sabe dónde empieza y
 * dónde acaba, que es lo que permitirá taparla al vuelo.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audioPorDefecto, huecosParaDejarSolo, nombreDeIdioma, pistasDeMatroska } from '../src/matroska.ts';

const texto = (cadena: string): number[] => [...cadena].map((letra) => letra.charCodeAt(0));

/** Un elemento EBML con su longitud en un byte (vale hasta 127). */
const corto = (id: number[], contenido: number[]): number[] => [...id, 0x80 | contenido.length, ...contenido];

/** Ídem con dos bytes de longitud, para lo que no cabe en uno. */
const largo = (id: number[], contenido: number[]): number[] => [
  ...id,
  0x40 | ((contenido.length >> 8) & 0x3f),
  contenido.length & 0xff,
  ...contenido,
];

const NUMERO = [0xd7];
const TIPO = [0x83];
const CODEC = [0x86];
const IDIOMA = [0x22, 0xb5, 0x9c];
const POR_DEFECTO = [0x88];
const NOMBRE = [0x53, 0x6e];

function pista(numero: number, tipo: number, codec: string, idioma: string, marcada: number | null): number[] {
  return corto([0xae], [
    ...corto(NUMERO, [numero]),
    ...corto(TIPO, [tipo]),
    ...corto(CODEC, texto(codec)),
    ...corto(IDIOMA, texto(idioma)),
    ...(marcada === null ? [] : corto(POR_DEFECTO, [marcada])),
  ]);
}

/** Cabecera de un MKV con vídeo, dos audios y unos subtítulos. */
function ficheroFalso(): Uint8Array {
  const pistas = [
    ...pista(1, 1, 'V_MPEG4/ISO/AVC', 'und', 1),
    ...pista(2, 2, 'A_AC3', 'spa', 1),
    ...pista(3, 2, 'A_AC3', 'eng', 0),
    // Sin marca: en Matroska eso significa "sí", y es lo que hace que la
    // tele los saque sin que nadie los pida.
    ...pista(4, 17, 'S_TEXT/UTF8', 'spa', null),
  ];
  const cabecera = corto([0x1a, 0x45, 0xdf, 0xa3], corto([0x42, 0x82], texto('matroska')));
  const segmento = largo([0x18, 0x53, 0x80, 0x67], [
    // Un hueco antes de las pistas, como en cualquier fichero de verdad.
    ...corto([0xec], [0, 0, 0, 0]),
    ...largo([0x16, 0x54, 0xae, 0x6b], pistas),
  ]);
  return Uint8Array.from([...cabecera, ...segmento]);
}

test('se leen las pistas con su clase, su códec y su idioma', () => {
  const pistas = pistasDeMatroska(ficheroFalso());

  assert.deepEqual(
    pistas.map((una) => `${una.numero} ${una.clase} ${una.codec} ${una.idioma} ${una.porDefecto ? 'marcada' : 'no'}`),
    [
      '1 video V_MPEG4/ISO/AVC und marcada',
      '2 audio A_AC3 spa marcada',
      '3 audio A_AC3 eng no',
      // Sin marca en el fichero, pero marcada: es lo que dice Matroska.
      '4 subtitulo S_TEXT/UTF8 spa marcada',
    ],
  );
});

test('de cada pista se sabe dónde empieza y dónde acaba', () => {
  const bytes = ficheroFalso();
  const pistas = pistasDeMatroska(bytes);

  for (const una of pistas) {
    // Donde dice que empieza tiene que estar su identificador, y lo que hay
    // entre medias es exactamente su ficha.
    assert.equal(bytes[una.desde], 0xae, `la pista ${una.numero} no empieza donde dice`);
    assert.ok(una.hasta > una.desde && una.hasta <= bytes.length);
  }
  // Y van seguidas, sin pisarse.
  for (let i = 1; i < pistas.length; i += 1) assert.equal(pistas[i]!.desde, pistas[i - 1]!.hasta);
});

test('el nombre que puso quien lo codificó también sale', () => {
  const pistas = pistasDeMatroska(
    Uint8Array.from(
      largo([0x18, 0x53, 0x80, 0x67], largo([0x16, 0x54, 0xae, 0x6b], corto([0xae], [
        ...corto(NUMERO, [2]),
        ...corto(TIPO, [2]),
        ...corto(CODEC, texto('A_EAC3')),
        ...corto(NOMBRE, texto('Comentario del director')),
      ]))),
    ),
  );

  assert.equal(pistas[0]!.nombre, 'Comentario del director');
});

test('una cabecera cortada a la mitad no inventa pistas', () => {
  const bytes = ficheroFalso();
  // La mitad justa: lo que se haya leído entero vale, lo demás no.
  const pistas = pistasDeMatroska(bytes.slice(0, Math.floor(bytes.length / 2)));

  assert.ok(pistas.length < 4);
  for (const una of pistas) assert.ok(una.hasta <= Math.floor(bytes.length / 2));
});

test('lo que no es un MKV no da pistas', () => {
  assert.deepEqual(pistasDeMatroska(Uint8Array.from([0, 1, 2, 3, 4, 5])), []);
});

test('los idiomas se dicen en cristiano', () => {
  assert.equal(nombreDeIdioma('spa'), 'Español');
  assert.equal(nombreDeIdioma('eng'), 'Inglés');
  assert.equal(nombreDeIdioma('und'), 'Sin idioma');
  assert.equal(nombreDeIdioma('tlh'), 'TLH');
});

test('para dejar un audio y ningún subtítulo se tapa todo lo demás', () => {
  const pistas = pistasDeMatroska(ficheroFalso());

  const huecos = huecosParaDejarSolo(pistas, { audio: 2, subtitulo: null });

  // El vídeo no se toca nunca; el audio elegido tampoco.
  const tapadas = pistas.filter((una) => huecos.some((hueco) => hueco.desde === una.desde));
  assert.deepEqual(
    tapadas.map((una) => `${una.numero} ${una.clase}`),
    ['3 audio', '4 subtitulo'],
  );
});

test('y para poner los subtítulos, se deja el que se elija', () => {
  const pistas = pistasDeMatroska(ficheroFalso());

  const huecos = huecosParaDejarSolo(pistas, { audio: 3, subtitulo: 4 });
  const tapadas = pistas.filter((una) => huecos.some((hueco) => hueco.desde === una.desde));

  assert.deepEqual(
    tapadas.map((una) => `${una.numero} ${una.clase}`),
    ['2 audio'],
  );
});

test('el audio por defecto es el que marca el fichero', () => {
  assert.equal(audioPorDefecto(pistasDeMatroska(ficheroFalso())), 2);
  assert.equal(audioPorDefecto([]), null);
});
