import assert from 'node:assert/strict';
import test from 'node:test';

import { Presentador } from '../src/presentador.ts';
import type { ClaseMedio } from '../src/perfiles.ts';
import type {
  Biblioteca,
  CanalFicha,
  EpisodioFicha,
  GrupoFicha,
  Pagina,
  PeliculaFicha,
  Resultado,
  SerieFicha,
  TemporadaFicha,
  Variante,
} from '../src/puerto.ts';

/**
 * El tipo de la pantalla actual, como texto.
 *
 * `assert.equal` de `node:assert/strict` es una aserción de tipo: comprobar dos
 * veces seguidas `presentador.pantalla.tipo` estrecha el getter hasta `never` y
 * el typecheck se cae, aunque los tests pasen. Una llamada a función no deja
 * referencia que estrechar.
 */
const pantallaDe = (presentador: Presentador): string => presentador.pantalla.tipo;

/** Biblioteca de mentira: la misma forma que la real, con datos a mano. */
function bibliotecaFalsa(peliculas = 3): Biblioteca {
  const todas: PeliculaFicha[] = Array.from({ length: peliculas }, (_, i) => ({
    id: `p${i}`,
    titulo: `Película ${i}`,
    anio: 2000 + i,
    // Notas decrecientes: la primera es la mejor valorada.
    valoracion: 9 - i,
    logo: null,
  }));

  return {
    async totales() {
      return { canales: 486, peliculas: todas.length, series: 2, episodios: 40 };
    },
    async grupos(): Promise<GrupoFicha[]> {
      return [
        { nombre: 'NOTICIAS', canales: 3 },
        { nombre: 'DEPORTES', canales: 5 },
      ];
    },
    async canalesDeGrupo(grupo: string): Promise<CanalFicha[]> {
      return [{ id: 'c1', nombre: '24 Horas', grupo, logo: null }];
    },
    async canales(): Promise<CanalFicha[]> {
      return [
        { id: 'c1', nombre: '24 Horas', grupo: 'NOTICIAS', logo: null },
        { id: 'c2', nombre: 'Teledeporte', grupo: 'DEPORTES', logo: null },
      ];
    },
    async peliculas(pagina: Pagina): Promise<PeliculaFicha[]> {
      return todas.slice(pagina.desde, pagina.desde + pagina.limite);
    },
    async series(): Promise<SerieFicha[]> {
      return [{ id: 'dw', titulo: 'Doctor Who', anio: 2005, valoracion: 8, logo: null }];
    },
    async temporadas(): Promise<TemporadaFicha[]> {
      return [
        { numero: 1, episodios: 13 },
        { numero: 2, episodios: 13 },
      ];
    },
    async episodios(_serieId: string, temporada: number): Promise<EpisodioFicha[]> {
      return [
        {
          id: 1,
          temporada,
          numero: 1,
          titulo: null,
          imagen: 'http://host/1.jpg',
          resumen: 'Rose conoce al Doctor.',
          valoracion: 7,
          anio: 2005,
          segundos: 2700,
        },
      ];
    },
    async peliculasPorId(ids: string[]): Promise<PeliculaFicha[]> {
      return ids.map((id) => todas.find((pelicula) => pelicula.id === id)).filter((p) => p !== undefined);
    },
    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      return ids.includes('dw') ? [{ id: 'dw', titulo: 'Doctor Who', anio: 2005, valoracion: 8, logo: null }] : [];
    },
    async canalesPorId(ids: string[]): Promise<CanalFicha[]> {
      return ids.map((id) => ({ id, nombre: '24 Horas', grupo: 'NOTICIAS', logo: null }));
    },
    async categorias(): Promise<GrupoFicha[]> {
      return [
        { nombre: 'Estrenos', canales: 2 },
        { nombre: 'Clásicos', canales: 1 },
      ];
    },
    async buscar(): Promise<Resultado[]> {
      return [];
    },
    async variantes(): Promise<Variante[]> {
      return [{ url: 'http://host/1.mkv', calidad: 'FHD' }];
    },
  };
}

test('el inicio enseña las secciones con sus totales', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  const estado = await presentador.cargar();

  assert.equal(estado.titulo, 'Biblioteca');
  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.titulo),
    ['TV en directo', 'Películas', 'Series', 'Buscar'],
  );
  assert.equal(estado.elementos[0]!.detalle, '486 canales');
  // El inicio es una lista, no una rejilla.
  assert.equal(estado.columnas, 1);
});

test('aceptar sobre una sección entra en ella', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const { estado, reproducir } = await presentador.aceptar();
  assert.equal(reproducir, null);
  assert.equal(pantallaDe(presentador), 'directo');
  // Los grupos están en la barra de la izquierda, no ocupando la rejilla: al
  // entrar se ven ya los canales, todos mientras no se elija categoría.
  assert.equal(estado.titulo, 'TV en directo');
  assert.equal(estado.formato, 'canales');
  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.titulo),
    ['24 Horas', 'Teledeporte'],
  );
  assert.deepEqual(
    estado.lateral?.opciones.map((opcion) => opcion.nombre),
    ['Todos los canales', 'NOTICIAS', 'DEPORTES'],
  );
});

test('un canal se reproduce en vez de abrir otra pantalla', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.aceptar(); // TV en directo, ya con los canales en pantalla

  const { reproducir } = await presentador.aceptar();
  assert.deepEqual(reproducir, { clase: 'canal', id: 'c1', titulo: '24 Horas' });
  // Reproducir no cambia de pantalla: al cerrar el vídeo seguimos donde estábamos.
  assert.equal(pantallaDe(presentador), 'directo');
});

test('una serie enseña sus temporadas al lado y los episodios en el centro', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('abajo'); // Series
  await presentador.aceptar();

  assert.equal(pantallaDe(presentador), 'series');

  const serie = await presentador.aceptar();
  assert.equal(pantallaDe(presentador), 'serie');
  // Las temporadas van en la barra, como las categorías.
  assert.deepEqual(
    serie.estado.lateral?.opciones.map((opcion) => opcion.nombre),
    ['Temporada 1', 'Temporada 2'],
  );
  // Y los episodios de la primera ya están puestos: no hay que entrar en ella.
  assert.equal(serie.estado.titulo, 'Doctor Who · Temporada 1');
  assert.equal(serie.estado.formato, 'episodios');
  // Sin título propio, el episodio se nombra por su número.
  assert.equal(serie.estado.elementos[0]!.titulo, '1. Episodio 1');
});

test('el episodio lleva su ficha: fotograma, sinopsis, nota y duración', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('abajo');
  await presentador.aceptar(); // Series
  const { estado } = await presentador.aceptar(); // Doctor Who

  const episodio = estado.elementos[0]!;
  assert.equal(episodio.logo, 'http://host/1.jpg');
  assert.equal(episodio.resumen, 'Rose conoce al Doctor.');
  assert.equal(episodio.valoracion, 7);
  assert.equal(episodio.anio, 2005);
  assert.equal(episodio.detalle, '45 min');
});

test('cambiar de temporada no apila pantalla: atrás sale de la serie', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('abajo');
  await presentador.aceptar(); // Series
  await presentador.aceptar(); // Doctor Who

  const segunda = await presentador.elegirCategoria('2');
  assert.equal(segunda.titulo, 'Doctor Who · Temporada 2');
  assert.equal(pantallaDe(presentador), 'serie');

  const vuelta = await presentador.atras();
  assert.equal(vuelta.estado.titulo, 'Series', 'no hay que deshacer temporada a temporada');
});

test('las películas se piden por páginas y se amplían al acercarse al final', async () => {
  const presentador = new Presentador(bibliotecaFalsa(7), { tamanoPagina: 4, columnasRejilla: 2 });
  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  const estado = await presentador.aceptar();

  assert.equal(estado.estado.columnas, 2, 'las carátulas van en rejilla');
  assert.equal(estado.estado.elementos.length, 4, 'solo la primera página');
  assert.equal(estado.estado.hayMas, true);

  // Bajar acerca el foco al final de lo cargado y dispara la página siguiente.
  const ampliado = await presentador.mover('abajo');
  assert.equal(ampliado.elementos.length, 7);
  assert.equal(ampliado.hayMas, false, 'la última página vino incompleta');
});

test('tocar una ficha lleva el foco a ella', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  assert.equal(presentador.enfocar(2).foco, 2);
  // Fuera de rango se recorta en vez de dejar el foco en el limbo.
  assert.equal(presentador.enfocar(99).foco, 3);
  assert.equal(presentador.enfocar(-5).foco, 0);

  presentador.enfocar(2);
  const { estado } = await presentador.aceptar();
  assert.equal(estado.titulo, 'Series', 'acepta sobre lo que se tocó');
});

test('atrás retrocede y, en el inicio, pide salir', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.aceptar(); // TV en directo

  const vuelta = await presentador.atras();
  assert.equal(vuelta.resultado, 'retrocedido');
  assert.equal(vuelta.estado.titulo, 'Biblioteca');

  const salida = await presentador.atras();
  assert.equal(salida.resultado, 'salir');
});

test('al volver, el foco sigue donde estaba', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('abajo'); // Series, índice 2
  await presentador.aceptar();
  await presentador.atras();

  const estado = presentador.estado();
  assert.equal(estado.foco, 2);
  assert.equal(estado.elementos[estado.foco]!.titulo, 'Series');
});

test('el desplazamiento pide más sin mover el foco', async () => {
  const presentador = new Presentador(bibliotecaFalsa(7), { tamanoPagina: 4, columnasRejilla: 2 });
  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  await presentador.aceptar();

  const antes = presentador.estado();
  assert.equal(antes.elementos.length, 4);

  const ampliado = await presentador.cargarMas();
  assert.equal(ampliado.elementos.length, 7);
  assert.equal(ampliado.foco, antes.foco, 'el dedo desplaza, no elige');
});

test('no se piden dos páginas a la vez ni se pide de más', async () => {
  const presentador = new Presentador(bibliotecaFalsa(7), { tamanoPagina: 4, columnasRejilla: 2 });
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();

  // Dos avisos seguidos de la lista, como cuando se arrastra rápido.
  const [uno, dos] = await Promise.all([presentador.cargarMas(), presentador.cargarMas()]);
  assert.equal(uno.elementos.length, 7);
  assert.equal(dos.elementos.length <= 7, true, 'la segunda llamada no duplica la página');

  // Ya no queda nada por traer.
  const ultimo = await presentador.cargarMas();
  assert.equal(ultimo.elementos.length, 7);
  assert.equal(ultimo.hayMas, false);
});

test('películas y series traen su barra de categorías', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  const { estado } = await presentador.aceptar();

  assert.ok(estado.lateral);
  assert.deepEqual(
    estado.lateral.opciones.map((opcion) => opcion.nombre),
    ['Todas las películas', 'Estrenos', 'Clásicos'],
    'la primera opción siempre es ver todas',
  );
  assert.equal(estado.lateral.activa, null);
  assert.equal(estado.lateral.dentro, false, 'el foco empieza en la rejilla');
});

test('la izquierda entra en la barra y la derecha vuelve a la rejilla', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar(); // Películas

  const dentro = await presentador.mover('izquierda');
  assert.equal(dentro.lateral?.dentro, true);

  // Dentro de la barra, arriba y abajo recorren categorías.
  const bajado = await presentador.mover('abajo');
  assert.equal(bajado.lateral?.foco, 1);

  const fuera = await presentador.mover('derecha');
  assert.equal(fuera.lateral?.dentro, false);
});

test('elegir categoría filtra sin apilar pantalla', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar(); // Películas

  const estado = await presentador.elegirCategoria('Estrenos');
  assert.equal(estado.titulo, 'Estrenos');
  assert.equal(estado.lateral?.activa, 'Estrenos');

  // "Atrás" sale de Películas, no va deshaciendo las categorías miradas.
  const vuelta = await presentador.atras();
  assert.equal(vuelta.resultado, 'retrocedido');
  assert.equal(vuelta.estado.titulo, 'Biblioteca');
});

test('el buscador hereda la sección y la categoría donde se abrió', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar(); // Películas
  await presentador.elegirCategoria('Estrenos');

  const buscador = await presentador.abrirBuscador();
  assert.equal(buscador.titulo, 'Buscar en Estrenos');
  assert.equal(buscador.busqueda, '');
  assert.deepEqual(buscador.elementos, [], 'sin texto no se busca nada');
});

test('las fichas traen cuánto se ha visto de ellas', async () => {
  const pedidos: Array<Array<{ clase: string; id: string }>> = [];
  const presentador = new Presentador(bibliotecaFalsa(3), {
    async avances(medios) {
      pedidos.push(medios);
      // La primera película va por la mitad; la segunda, casi al final.
      return { 'pelicula:p0': 0.5, 'pelicula:p1': 0.93 };
    },
  });

  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  const { estado } = await presentador.aceptar();

  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.avance),
    [0.5, 0.93, null],
    'lo no empezado se queda sin barrita',
  );

  // Una sola consulta con todas las fichas de la pantalla, no una por ficha.
  assert.equal(pedidos[pedidos.length - 1]!.length, 3);
});

test('los grupos y las categorías no llevan barrita', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    async avances() {
      throw new Error('no debería preguntarse por cosas que no se reproducen');
    },
  });

  // El inicio son secciones: nada que se vea a medias.
  const inicio = await presentador.cargar();
  assert.deepEqual(
    inicio.elementos.map((elemento) => elemento.avance),
    [null, null, null, null],
  );
});

test('si el historial falla, la rejilla se pinta igual', async () => {
  const presentador = new Presentador(bibliotecaFalsa(2), {
    async avances() {
      throw new Error('base ocupada');
    },
  });

  await presentador.cargar();
  await presentador.mover('abajo');
  const { estado } = await presentador.aceptar();
  assert.equal(estado.elementos.length, 2, 'las películas siguen saliendo');
  assert.equal(estado.elementos[0]!.avance, null);
});

test('la ficha lleva el año y la nota sueltos, para pintarlos sobre la carátula', async () => {
  const presentador = new Presentador(bibliotecaFalsa(2));
  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  const { estado } = await presentador.aceptar();

  assert.equal(estado.elementos[0]!.anio, 2000);
  assert.equal(estado.elementos[0]!.valoracion, 9);
  assert.equal(estado.elementos[1]!.anio, 2001);
  assert.equal(estado.elementos[1]!.valoracion, 8);

  // Ya no se escriben debajo del título: esa línea era la que impedía agrandar
  // la carátula.
  assert.equal(estado.elementos[0]!.detalle, null);
});

test('se puede ordenar por valoración', async () => {
  const presentador = new Presentador(bibliotecaFalsa(3));
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();

  assert.equal(presentador.orden, 'titulo');
  const porNota = await presentador.ordenarPor('valoracion');
  assert.equal(presentador.orden, 'valoracion');
  // La biblioteca de mentira devuelve las mejor valoradas primero.
  assert.equal(porNota.elementos[0]!.titulo, 'Película 0');
});

/** Favoritos de mentira, en memoria, con la misma forma que los de verdad. */
function favoritosFalsos(iniciales: Array<{ clase: ClaseMedio; id: string }> = []) {
  const marcados = new Set(iniciales.map((favorito) => `${favorito.clase}:${favorito.id}`));
  return {
    llamadas: 0,
    async listar(clase: ClaseMedio): Promise<string[]> {
      this.llamadas++;
      return [...marcados]
        .filter((clave) => clave.startsWith(`${clase}:`))
        .map((clave) => clave.slice(clase.length + 1));
    },
    async alternar(clase: ClaseMedio, id: string): Promise<boolean> {
      const clave = `${clase}:${id}`;
      if (marcados.delete(clave)) return false;
      marcados.add(clave);
      return true;
    },
  };
}

test('sin puerto de favoritos no aparece su grupo', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  const { estado } = await presentador.aceptar();

  assert.equal(
    estado.lateral?.opciones.some((opcion) => opcion.favoritos),
    false,
  );
});

test('las tres secciones traen el grupo de favoritos', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await presentador.mover('abajo');
  const { estado } = await presentador.aceptar();

  // Va el segundo, justo detrás de "todas" y antes de lo del proveedor.
  assert.equal(estado.lateral?.opciones[1]?.nombre, 'Favoritos');
  assert.equal(estado.lateral?.opciones[1]?.favoritos, true);
});

test('la pulsación larga marca y desmarca', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await presentador.mover('abajo');
  const { estado } = await presentador.aceptar(); // Películas

  assert.equal(estado.elementos[0]!.favorito, false);
  const marcado = await presentador.alternarFavorito(0);
  assert.equal(marcado.elementos[0]!.favorito, true, 'el corazón se queda puesto');

  const desmarcado = await presentador.alternarFavorito(0);
  assert.equal(desmarcado.elementos[0]!.favorito, false);
});

test('el corazón sale ya puesto en lo que estaba guardado', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: favoritosFalsos([{ clase: 'pelicula', id: 'p1' }]),
  });
  await presentador.cargar();
  await presentador.mover('abajo');
  const { estado } = await presentador.aceptar();

  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.favorito),
    [false, true, false],
  );
});

test('el grupo de favoritos enseña lo marcado, y nada más', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: favoritosFalsos([{ clase: 'pelicula', id: 'p2' }]),
  });
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();

  const estado = await presentador.elegirCategoria(null, { favoritos: true });
  assert.equal(estado.titulo, 'Favoritos');
  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.titulo),
    ['Película 2'],
  );
  // Y no se pagina: son los que sean.
  assert.equal(estado.hayMas, false);
});

test('quitar de favoritos dentro del grupo saca la ficha de la lista', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: favoritosFalsos([{ clase: 'pelicula', id: 'p0' }]),
  });
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();
  await presentador.elegirCategoria(null, { favoritos: true });

  const estado = await presentador.alternarFavorito(0);
  assert.equal(estado.elementos.length, 0, 'si no, queda una ficha sin corazón en Favoritos');
});

test('una serie se marca por su ficha, no por lo que reproduce', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('abajo');
  await presentador.aceptar(); // Series

  const estado = await presentador.alternarFavorito(0);
  assert.equal(estado.elementos[0]!.favorito, true);

  // Y dentro de la serie, los episodios sueltos no se marcan: lo que uno
  // guarda es la serie entera.
  await presentador.aceptar();
  const enEpisodio = await presentador.alternarFavorito(0);
  assert.equal(enEpisodio.elementos[0]!.favorito, false);
});

test('los favoritos se piden por clase, no por ficha', async () => {
  const favoritos = favoritosFalsos();
  const presentador = new Presentador(bibliotecaFalsa(7), { favoritos, tamanoPagina: 7 });
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();

  // Siete películas en pantalla, una sola consulta.
  assert.equal(favoritos.llamadas, 1);
});

test('recorrer los grupos con el mando ya enseña lo que tienen dentro', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo'); // Películas
  await presentador.aceptar();

  // Entrar en la barra y bajar a la primera categoría del proveedor: sin
  // perfil no hay grupo de favoritos, así que va justo detrás de "todas".
  await presentador.mover('izquierda');
  const estado = await presentador.mover('abajo');

  assert.equal(estado.titulo, 'Estrenos', 'el contenido cambia sin aceptar');
  assert.equal(estado.lateral?.dentro, true, 'y el foco se queda en la barra');
  assert.equal(estado.lateral?.activa, 'Estrenos');
});

test('en el borde de la barra no se recarga nada', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.aceptar();
  await presentador.mover('izquierda');

  // Arriba del todo ya: la pantalla se queda como está.
  const estado = await presentador.mover('arriba');
  assert.equal(estado.lateral?.foco, 0);
  assert.equal(estado.titulo, 'Películas');
});
