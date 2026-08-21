import assert from 'node:assert/strict';
import test from 'node:test';

import { anioDeFecha, epoch, segundosDeEpisodio, tituloDeEpisodio } from '../src/episodios.ts';

test('el título sale de lo que va detrás del código del episodio', () => {
  assert.equal(
    tituloDeEpisodio('True Detective - S01E01 - La larga y clara oscuridad', 'True Detective'),
    'La larga y clara oscuridad',
  );
  assert.equal(tituloDeEpisodio('Euphoria 1080p - S01E01 - Piloto', 'Euphoria'), 'Piloto');
});

test('cuando detrás del código no hay nada, no hay título', () => {
  // El caso más común del panel: el nombre de la serie y el código, y ya.
  assert.equal(tituloDeEpisodio('Outer Banks 1080P S01E01', 'Outer Banks'), null);
  assert.equal(tituloDeEpisodio('Muertos S.L. 1080p S04E06', 'Muertos S.L.'), null);
});

test('sin código, el nombre de la serie repetido tampoco es un título', () => {
  assert.equal(tituloDeEpisodio('Outer Banks 1080P', 'Outer Banks'), null);
  assert.equal(tituloDeEpisodio('El caso Hartung', 'El caso Hartung'), null);
  // Pero un título de verdad se respeta aunque no traiga código.
  assert.equal(tituloDeEpisodio('La boda de Rachel', 'Friends'), 'La boda de Rachel');
});

test('otros formatos de código que usan los paneles', () => {
  assert.equal(tituloDeEpisodio('Perdidos 2x04 - El fin', 'Perdidos'), 'El fin');
  assert.equal(tituloDeEpisodio('Doctor Who S 2 E 1 Rosa', 'Doctor Who'), 'Rosa');
});

test('un título vacío o que es solo un número no cuenta', () => {
  assert.equal(tituloDeEpisodio('', 'Friends'), null);
  assert.equal(tituloDeEpisodio(null, 'Friends'), null);
  assert.equal(tituloDeEpisodio('Friends S01E01 - 12', 'Friends'), null);
});

test('el año sale de la fecha del panel, y solo si tiene sentido', () => {
  assert.equal(anioDeFecha('2025-12-28'), 2025);
  assert.equal(anioDeFecha(''), null);
  assert.equal(anioDeFecha(undefined), null);
  assert.equal(anioDeFecha('0000-00-00'), null);
});

test('la duración se saca del reloj cuando los segundos vienen a cero', () => {
  assert.equal(segundosDeEpisodio(3420, '00:57:00'), 3420);
  // Medido: `duration_secs` llega a 0 en bastantes episodios y `duration` no.
  assert.equal(segundosDeEpisodio(0, '00:57:00'), 3420);
  assert.equal(segundosDeEpisodio(0, '48:30'), 2910);
  assert.equal(segundosDeEpisodio(0, ''), null);
  assert.equal(segundosDeEpisodio(undefined, undefined), null);
});

test('el epoch descarta el cero y la basura', () => {
  assert.equal(epoch('1590590016'), 1590590016);
  assert.equal(epoch(0), null);
  assert.equal(epoch(''), null);
  assert.equal(epoch(undefined), null);
});
