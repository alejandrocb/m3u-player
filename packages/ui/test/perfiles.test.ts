import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AJUSTES_POR_DEFECTO,
  COLORES_PERFIL,
  ajustesDesde,
  colorLibre,
  estaTerminado,
  idDePerfil,
  proporcionVista,
  vaAnotado,
} from '../src/perfiles.ts';
import type { Avance, Perfil } from '../src/perfiles.ts';

function perfil(id: string, color: string): Perfil {
  return { id, nombre: id, color, avatar: '', creado: '2026-08-20T00:00:00.000Z' };
}

function avance(segundos: number, duracion: number): Avance {
  return {
    clase: 'pelicula',
    itemId: 'lola-pater-2017',
    titulo: 'Lola Pater',
    segundos,
    duracion,
    visto: '2026-08-20T00:00:00.000Z',
  };
}

test('la proporción vista sale de lo reproducido', () => {
  assert.equal(proporcionVista(avance(0, 100)), 0);
  assert.equal(proporcionVista(avance(50, 100)), 0.5);
  assert.equal(proporcionVista(avance(150, 100)), 1, 'nunca pasa de uno');
});

test('una duración desconocida no rompe el cálculo', () => {
  assert.equal(proporcionVista(avance(30, 0)), 0);
  assert.equal(proporcionVista(avance(30, Number.NaN)), 0);
});

test('el final son los últimos minutos, no el segundo exacto', () => {
  // Los títulos de crédito no deberían dejar la película en "seguir viendo".
  assert.equal(estaTerminado(avance(5400, 5548)), true);
  assert.equal(estaTerminado(avance(4000, 5548)), false);
});

test('los primeros segundos no se anotan', () => {
  // Abrir algo para ver qué es y salir no debe llenar el "seguir viendo".
  assert.equal(vaAnotado(avance(10, 5548)), false);
  assert.equal(vaAnotado(avance(45, 5548)), true);
});

test('lo terminado tampoco se anota', () => {
  assert.equal(vaAnotado(avance(5500, 5548)), false);
});

test('los perfiles con el mismo nombre no chocan', () => {
  const existentes = [perfil('ana', '#1'), perfil('ana-2', '#2')];
  assert.equal(idDePerfil('Ana', existentes), 'ana-3');
});

test('el identificador aguanta acentos y símbolos', () => {
  assert.equal(idDePerfil('Mamá y Papá', []), 'mama-y-papa');
  assert.equal(idDePerfil('   ', []), 'perfil');
});

test('cada perfil nuevo estrena color mientras queden', () => {
  assert.equal(colorLibre([]), COLORES_PERFIL[0]);
  assert.equal(colorLibre([perfil('a', COLORES_PERFIL[0])]), COLORES_PERFIL[1]);

  // Con todos gastados se vuelve a empezar en vez de quedarse sin color.
  const todos = COLORES_PERFIL.map((color, indice) => perfil(`p${indice}`, color));
  assert.equal(colorLibre(todos), COLORES_PERFIL[0]);
});

test('los ajustes guardados se interpretan y se sanean', () => {
  assert.deepEqual(ajustesDesde({ columnas: '6', orden: 'valoracion' }), {
    columnas: 6,
    orden: 'valoracion',
    continua: true,
  });

  // Lo que no está entre los valores admitidos vuelve al de siempre.
  assert.deepEqual(ajustesDesde({ columnas: '17' }), AJUSTES_POR_DEFECTO);
  assert.deepEqual(ajustesDesde({ columnas: 'muchas' }), AJUSTES_POR_DEFECTO);
  assert.deepEqual(ajustesDesde({ orden: 'por lo que sea' }), AJUSTES_POR_DEFECTO);
  assert.deepEqual(ajustesDesde({}), AJUSTES_POR_DEFECTO);
});

test('la reproducción continua se apaga solo con un "no" explícito', () => {
  // Es de cada persona: hay a quien le gusta que siga solo y hay a quien no.
  assert.equal(ajustesDesde({ continua: 'no' }).continua, false);
  assert.equal(ajustesDesde({ continua: 'si' }).continua, true);
  // Y por defecto encadena, que es lo que hacen todos.
  assert.equal(ajustesDesde({}).continua, true);
});

test('el orden por novedades es un ajuste más del perfil', () => {
  assert.deepEqual(ajustesDesde({ orden: 'reciente' }), { columnas: 4, orden: 'reciente', continua: true });
});
