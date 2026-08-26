import assert from 'node:assert/strict';
import test from 'node:test';

import { Presentador } from '../src/presentador.ts';
import type { FilaInicio } from '../src/presentador.ts';
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

/**
 * Entra en una sección desde el inicio.
 *
 * El inicio ya no tiene fila de secciones —la sustituyó el selector de
 * arriba—, así que se navega por donde lo hace la vista: `irASeccion`.
 */
async function entrarEn(presentador: Presentador, tipo: 'peliculas' | 'series' | 'directo' | 'buscador') {
  return presentador.irASeccion({ tipo });
}

/** Biblioteca de mentira: la misma forma que la real, con datos a mano. */
function bibliotecaFalsa(peliculas = 3): Biblioteca {
  // Recientes, valoradas y con cartel: es lo que exige la portada, y sin eso
  // media pantalla de inicio no existiría en los tests.
  const esteAnio = new Date().getFullYear();
  const todas: PeliculaFicha[] = Array.from({ length: peliculas }, (_, i) => ({
    id: `p${i}`,
    titulo: `Película ${i}`,
    anio: esteAnio,
    // Notas decrecientes: la primera es la mejor valorada.
    valoracion: 9 - i,
    logo: `http://host/p${i}.jpg`,
    genero: 'Comedia',
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
      return [{ id: 'dw', titulo: 'Doctor Who', anio: 2005, valoracion: 8, logo: null, genero: 'Ciencia ficción' }];
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
    async detalleDePelicula(id: string) {
      // Todas menos `p0` traen imagen apaisada: sin ella no salen en la
      // portada, que es justo lo que hay que poder probar.
      if (id === 'p0') return null;
      return {
        sinopsis: 'Una película de prueba con su sinopsis.',
        reparto: 'Actriz Primera, Actor Segundo, Actriz Tercera',
        fondo: `http://host/fondo-${id}.jpg`,
        genero: 'Comedia, Animación',
      };
    },
    async guardarGeneros() {},
    async detalleDeSerie(id: string) {
      // Doctor Who sí tiene imagen apaisada: es la que preside "Series".
      return id === 'dw'
        ? { sinopsis: 'Un viajero del tiempo.', reparto: null, fondo: 'http://host/dw-fondo.jpg', genero: 'Aventura' }
        : null;
    },
    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      return ids.includes('dw')
        ? [{ id: 'dw', titulo: 'Doctor Who', anio: 2005, valoracion: 8, logo: null, genero: 'Ciencia ficción' }]
        : [];
    },
    async episodiosPorId(ids: string[]) {
      return ids.map((id) => ({
        id: Number(id),
        serieId: 'dw',
        serieTitulo: 'Doctor Who',
        serieLogo: null,
        temporada: 1,
        numero: Number(id),
        titulo: `Episodio ${id}`,
      }));
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
    async buscar(texto: string): Promise<Resultado[]> {
      if (!texto) return [];
      // Mezcladas a propósito y en orden de relevancia: es lo que devuelve la
      // búsqueda de verdad, y el orden hay que conservarlo.
      return [
        { tipo: 'serie', id: 'dw', titulo: 'Doctor Who' },
        { tipo: 'pelicula', id: 'p1', titulo: 'Película 1' },
        { tipo: 'canal', id: 'c1', titulo: '24 Horas' },
      ];
    },
    async variantes(): Promise<Variante[]> {
      return [{ url: 'http://host/1.mkv', calidad: 'FHD' }];
    },
  };
}

test('el inicio son filas: la portada primero', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  const estado = await presentador.cargar();

  assert.equal(estado.titulo, 'Biblioteca');
  // La rejilla se queda vacía: en el inicio las fichas viven en las filas.
  assert.deepEqual(estado.elementos, []);
  // Y ya no hay fila de secciones: la sustituyó el selector de arriba, que
  // hacía lo mismo y estaba repetido.
  assert.equal(
    estado.inicio?.filas.every((fila) => fila.tipo === 'destacado' || fila.tipo === 'carrusel'),
    true,
  );
  assert.equal(estado.inicio?.fila, 0);
  assert.equal(estado.inicio?.columna, 0);
});

test('el inicio trae carruseles de películas y de series', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  const estado = await presentador.cargar();

  assert.deepEqual(
    estado.inicio?.filas.filter((fila) => fila.tipo === 'carrusel').map((fila) => fila.titulo),
    ['Películas recién llegadas', 'Series recién llegadas', 'Mejor valoradas'],
  );
  assert.equal(estado.inicio?.modo, 'todo');
});

test('la pestaña de películas deja fuera las series, y al revés', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const soloPeliculas = await presentador.elegirModo('peliculas');
  assert.deepEqual(
    soloPeliculas.inicio?.filas.filter((fila) => fila.tipo === 'carrusel').map((fila) => fila.titulo),
    ['Novedades', 'Mejor valoradas'],
  );

  const soloSeries = await presentador.elegirModo('series');
  assert.deepEqual(
    soloSeries.inicio?.filas.filter((fila) => fila.tipo === 'carrusel').map((fila) => fila.titulo),
    ['Novedades', 'Mejor valoradas'],
  );
  assert.equal(soloSeries.inicio?.modo, 'series');
});

test('cambiar de pestaña devuelve el foco arriba', async () => {
  // Lo que hay debajo es otro contenido: dejar el foco en la cuarta fila de
  // unos carruseles que ya no existen es peor que empezar de nuevo.
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');
  await presentador.mover('derecha');

  const cambiado = await presentador.elegirModo('peliculas');
  assert.equal(cambiado.inicio?.fila, 0);
  assert.equal(cambiado.inicio?.columna, 0);
});

test('elegir la pestaña que ya está no recarga nada', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.mover('abajo');

  const igual = await presentador.elegirModo('todo');
  assert.equal(igual.inicio?.fila, 1, 'el foco se queda donde estaba');
});

test('entrar en una sección la abre con su barra de categorías', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const estado = await entrarEn(presentador, 'directo');
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
  await entrarEn(presentador, 'directo'); // ya con los canales en pantalla

  const { reproducir } = await presentador.aceptar();
  assert.deepEqual(reproducir, { clase: 'canal', id: 'c1', titulo: '24 Horas' });
  // Reproducir no cambia de pantalla: al cerrar el vídeo seguimos donde estábamos.
  assert.equal(pantallaDe(presentador), 'directo');
});

test('una serie enseña sus temporadas al lado y los episodios en el centro', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'series');

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
  await entrarEn(presentador, 'series');
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
  const estado = await entrarEn(presentador, 'series');
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
  const estado = await entrarEn(presentador, 'peliculas');

  assert.equal(estado.columnas, 2, 'las carátulas van en rejilla');
  assert.equal(estado.elementos.length, 4, 'solo la primera página');
  assert.equal(estado.hayMas, true);

  // Bajar acerca el foco al final de lo cargado y dispara la página siguiente.
  const ampliado = await presentador.mover('abajo');
  assert.equal(ampliado.elementos.length, 7);
  assert.equal(ampliado.hayMas, false, 'la última página vino incompleta');
});

test('tocar una ficha lleva el foco a ella', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const cuantasFilas = presentador.estado().inicio?.filas.length ?? 0;

  assert.equal(presentador.enfocarEnInicio(1, 2).inicio?.columna, 2);
  // Fuera de rango se recorta en vez de dejar el foco en el limbo.
  assert.equal(presentador.enfocarEnInicio(1, 99).inicio?.columna, 2);
  assert.equal(presentador.enfocarEnInicio(1, -5).inicio?.columna, 0);
  assert.equal(presentador.enfocarEnInicio(99, 0).inicio?.fila, cuantasFilas - 1);
});

test('atrás retrocede y, en el inicio, pide salir', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'directo');

  const vuelta = await presentador.atras();
  assert.equal(vuelta.resultado, 'retrocedido');
  assert.equal(vuelta.estado.titulo, 'Biblioteca');

  const salida = await presentador.atras();
  assert.equal(salida.resultado, 'salir');
});

test('al volver, el foco del inicio sigue donde estaba', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  // Se baja un par de filas antes de entrar, para que haya algo que recordar.
  await presentador.mover('abajo');
  await presentador.mover('derecha');

  await entrarEn(presentador, 'peliculas');
  await presentador.atras();

  const estado = presentador.estado();
  assert.equal(estado.inicio?.fila, 1, 'vuelve a la fila desde la que se entró');
  assert.equal(estado.inicio?.columna, 1, 'y a la misma ficha');
});

test('el desplazamiento pide más sin mover el foco', async () => {
  const presentador = new Presentador(bibliotecaFalsa(7), { tamanoPagina: 4, columnasRejilla: 2 });
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');

  const antes = presentador.estado();
  assert.equal(antes.elementos.length, 4);

  const ampliado = await presentador.cargarMas();
  assert.equal(ampliado.elementos.length, 7);
  assert.equal(ampliado.foco, antes.foco, 'el dedo desplaza, no elige');
});

test('no se piden dos páginas a la vez ni se pide de más', async () => {
  const presentador = new Presentador(bibliotecaFalsa(7), { tamanoPagina: 4, columnasRejilla: 2 });
  await presentador.cargar();
  await entrarEn(presentador, 'peliculas');

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
  const estado = await entrarEn(presentador, 'peliculas');

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
  await entrarEn(presentador, 'peliculas'); // Películas

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
  await entrarEn(presentador, 'peliculas'); // Películas

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
  await entrarEn(presentador, 'peliculas'); // Películas
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
  const estado = await entrarEn(presentador, 'peliculas');

  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.avance),
    [0.5, 0.93, null],
    'lo no empezado se queda sin barrita',
  );

  // Una sola consulta con todas las fichas de la pantalla, no una por ficha.
  assert.equal(pedidos[pedidos.length - 1]!.length, 3);
});

test('si el historial falla, la rejilla se pinta igual', async () => {
  const presentador = new Presentador(bibliotecaFalsa(2), {
    async avances() {
      throw new Error('base ocupada');
    },
  });

  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');
  assert.equal(estado.elementos.length, 2, 'las películas siguen saliendo');
  assert.equal(estado.elementos[0]!.avance, null);
});

test('la ficha lleva el año y la nota sueltos, para pintarlos sobre la carátula', async () => {
  const presentador = new Presentador(bibliotecaFalsa(2));
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');

  const esteAnio = new Date().getFullYear();
  assert.equal(estado.elementos[0]!.anio, esteAnio);
  assert.equal(estado.elementos[0]!.valoracion, 9);
  assert.equal(estado.elementos[1]!.anio, esteAnio);
  assert.equal(estado.elementos[1]!.valoracion, 8);

  // Ya no se escriben debajo del título: esa línea era la que impedía agrandar
  // la carátula.
  assert.equal(estado.elementos[0]!.detalle, null);
});

test('se puede ordenar por valoración', async () => {
  const presentador = new Presentador(bibliotecaFalsa(3));
  await presentador.cargar();
  await entrarEn(presentador, 'peliculas');

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
  const estado = await entrarEn(presentador, 'peliculas');

  assert.equal(
    estado.lateral?.opciones.some((opcion) => opcion.favoritos),
    false,
  );
});

test('las tres secciones traen el grupo de favoritos', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');

  // Va el segundo, justo detrás de "todas" y antes de lo del proveedor.
  assert.equal(estado.lateral?.opciones[1]?.nombre, 'Favoritos');
  assert.equal(estado.lateral?.opciones[1]?.favoritos, true);
});

test('la pulsación larga marca y desmarca', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');

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
  const estado = await entrarEn(presentador, 'peliculas');

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
  await entrarEn(presentador, 'peliculas');

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
  await entrarEn(presentador, 'peliculas');
  await presentador.elegirCategoria(null, { favoritos: true });

  const estado = await presentador.alternarFavorito(0);
  assert.equal(estado.elementos.length, 0, 'si no, queda una ficha sin corazón en Favoritos');
});

test('una serie se marca por su ficha, no por lo que reproduce', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await entrarEn(presentador, 'series');

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
  await entrarEn(presentador, 'peliculas');

  // Siete películas en pantalla, una sola consulta.
  assert.equal(favoritos.llamadas, 1);
});

test('recorrer los grupos con el mando ya enseña lo que tienen dentro', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await entrarEn(presentador, 'peliculas');

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
  await entrarEn(presentador, 'peliculas');
  await presentador.mover('izquierda');

  // Arriba del todo ya: la pantalla se queda como está.
  const estado = await presentador.mover('arriba');
  assert.equal(estado.lateral?.foco, 0);
  assert.equal(estado.titulo, 'Películas');
});

/** Un perfil con dos cosas a medias: una película y un episodio. */
function aMedias(): Array<{
  clase: 'pelicula' | 'episodio';
  itemId: string;
  titulo: string;
  segundos: number;
  duracion: number;
  visto: string;
}> {
  return [
    { clase: 'pelicula', itemId: 'p1', titulo: 'Película 1', segundos: 1800, duracion: 5400, visto: '2026-08-26T21:00:00.000Z' },
    { clase: 'episodio', itemId: '7', titulo: 'Doctor Who', segundos: 600, duracion: 2400, visto: '2026-08-25T21:00:00.000Z' },
  ];
}

/** Busca un carrusel del inicio por su título. */
function filaDe(estado: { inicio: { filas: FilaInicio[] } | null }, titulo: string) {
  const fila = estado.inicio?.filas.find((una) => una.tipo === 'carrusel' && una.titulo === titulo);
  return fila && fila.tipo === 'carrusel' ? fila : null;
}

/** En qué posición está esa fila, para poder llegar con el mando. */
function indiceDe(estado: { inicio: { filas: FilaInicio[] } | null }, titulo: string): number {
  return estado.inicio?.filas.findIndex((una) => una.tipo === 'carrusel' && una.titulo === titulo) ?? -1;
}

test('seguir viendo es una fila más del inicio, con su avance', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();

  const fila = filaDe(estado, 'Seguir viendo');
  assert.equal(fila?.elementos.length, 2);
  assert.equal(fila?.elementos[0]?.titulo, 'Película 1');
  assert.equal(fila?.elementos[0]?.avance, 1800 / 5400);
  // Del episodio se enseña la serie, que es lo que se reconoce, y el capítulo
  // concreto queda debajo.
  assert.equal(fila?.elementos[1]?.titulo, 'Doctor Who');
  assert.equal(fila?.elementos[1]?.detalle, 'T1 E7 · Episodio 7');
});

test('lo empezado va justo detrás de la portada', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();

  assert.equal(estado.inicio?.filas[0]?.tipo, 'destacado');
  assert.equal(indiceDe(estado, 'Seguir viendo'), 1, 'lo primero después de la portada');
});

test('seguir viendo se filtra por la pestaña', async () => {
  // En Películas no pinta nada un capítulo a medias, y en Series tampoco una
  // película.
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  await presentador.cargar();

  const enPeliculas = await presentador.elegirModo('peliculas');
  assert.deepEqual(
    filaDe(enPeliculas, 'Seguir viendo')?.elementos.map((elemento) => elemento.titulo),
    ['Película 1'],
  );

  const enSeries = await presentador.elegirModo('series');
  assert.deepEqual(
    filaDe(enSeries, 'Seguir viendo')?.elementos.map((elemento) => elemento.titulo),
    ['Doctor Who'],
  );
});

test('la portada sugiere varias y se pueden ir turnando', async () => {
  const presentador = new Presentador(bibliotecaFalsa(6));
  const estado = await presentador.cargar();

  const portada = estado.inicio?.filas[0];
  assert.equal(portada?.tipo, 'destacado');
  assert.ok(portada && portada.tipo === 'destacado' && portada.elementos.length > 1);
  assert.equal(estado.inicio?.destacado, 0);

  assert.equal(presentador.rotarDestacado(1).inicio?.destacado, 1);
  // Da la vuelta al llegar al final, que es lo que hace el reloj de la vista.
  assert.equal(presentador.rotarDestacado(portada.elementos.length).inicio?.destacado, 0);
});

test('las portadas del servidor mandan sobre las de aquí', async () => {
  const presentador = new Presentador(bibliotecaFalsa(6));
  presentador.usarPortadas([
    {
      clase: 'pelicula',
      id: 'p2',
      titulo: 'La que manda el servidor',
      anio: 2026,
      valoracion: 9,
      imagen: 'http://host/preparada.jpg',
      sinopsis: 'Ya venía escrita.',
      reparto: null,
      genero: 'Drama',
    },
    {
      clase: 'pelicula',
      id: 'no-esta-en-la-base',
      titulo: 'De otra lista',
      anio: 2026,
      valoracion: 10,
      imagen: 'http://host/otra.jpg',
      sinopsis: null,
      reparto: null,
      genero: null,
    },
  ]);

  const portada = (await presentador.cargar()).inicio?.filas[0];
  assert.equal(portada?.tipo, 'destacado');
  // La que no existe en este aparato se descarta: sin ficha no hay ni
  // carátula que enseñar ni URL que reproducir.
  assert.deepEqual(
    portada?.elementos.map((elemento) => elemento.titulo),
    ['La que manda el servidor'],
  );
  assert.equal(portada?.elementos[0]?.resumen, 'Ya venía escrita.');
  assert.equal(portada?.elementos[0]?.logo, 'http://host/preparada.jpg');
});

test('sin imagen apaisada no se sugiere en la portada', async () => {
  // `p0` es la mejor valorada del catálogo falso, pero su ficha no trae
  // fondo: el cartel vertical estirado a lo ancho es lo que queremos evitar.
  const presentador = new Presentador(bibliotecaFalsa(6));
  const estado = await presentador.cargar();

  const portada = estado.inicio?.filas[0];
  assert.equal(portada?.tipo, 'destacado');
  assert.ok(
    portada?.elementos.every((elemento) => elemento.logo?.includes('fondo-')),
    'todas las sugerencias llevan la imagen apaisada',
  );
  assert.ok(
    !portada?.elementos.some((elemento) => elemento.id === 'destacado:pelicula:p0'),
    'la que no tiene fondo se queda fuera',
  );
});

test('en la portada, izquierda y derecha no mueven nada', async () => {
  // Las sugerencias se turnan solas; moverse entre ellas con el mando
  // confundiría los dos mecanismos.
  const presentador = new Presentador(bibliotecaFalsa(6));
  await presentador.cargar();

  const movido = await presentador.mover('derecha');
  assert.equal(movido.inicio?.columna, 0);
});

test('sin nada empezado no hay fila que enseñar', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => [] });
  assert.equal(filaDe(await presentador.cargar(), 'Seguir viendo'), null);
});

test('si el historial falla, el inicio se pinta igual', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    async seguirViendo() {
      throw new Error('base ocupada');
    },
  });

  const estado = await presentador.cargar();
  assert.equal(filaDe(estado, 'Seguir viendo'), null);
  assert.ok((estado.inicio?.filas.length ?? 0) > 0, 'el resto de filas siguen ahí');
});

test('las filas son solo del inicio: dentro de una sección no hay', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  await presentador.cargar();
  const estado = await entrarEn(presentador, 'peliculas');

  assert.equal(estado.inicio, null);
});

test('arriba y abajo cambian de fila; izquierda y derecha recorren la de dentro', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const inicial = await presentador.cargar();
  const continuar = indiceDe(inicial, 'Seguir viendo');

  for (let i = 0; i < continuar; i++) await presentador.mover('abajo');
  const derecha = await presentador.mover('derecha');
  assert.equal(derecha.inicio?.fila, continuar);
  assert.equal(derecha.inicio?.columna, 1);
});

test('en los bordes el foco no se sale', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();

  // Arriba del todo ya.
  assert.equal((await presentador.mover('arriba')).inicio?.fila, 0);
  assert.equal((await presentador.mover('izquierda')).inicio?.columna, 0);

  // Y abajo del todo.
  const ultima = (estado.inicio?.filas.length ?? 1) - 1;
  for (let i = 0; i < 20; i++) await presentador.mover('abajo');
  assert.equal(presentador.estado().inicio?.fila, ultima);
});

test('al cambiar de fila la columna se recorta a lo que quepa', async () => {
  // "Seguir viendo" tiene dos fichas y los carruseles tres: bajar desde la
  // tercera no puede dejar el foco apuntando a un hueco.
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();
  const novedades = indiceDe(estado, 'Películas recién llegadas');

  for (let i = 0; i < novedades; i++) await presentador.mover('abajo');
  for (let i = 0; i < 3; i++) await presentador.mover('derecha');
  assert.equal(presentador.estado().inicio?.columna, 2, 'la fila tiene tres');

  const arriba = await presentador.mover('arriba');
  assert.equal(arriba.inicio?.columna, 1, 'recortada al último hueco de "seguir viendo"');
});

test('aceptar en una fila reproduce lo que haya debajo del foco', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();
  const continuar = indiceDe(estado, 'Seguir viendo');

  for (let i = 0; i < continuar; i++) await presentador.mover('abajo');
  const pelicula = await presentador.aceptar();
  assert.deepEqual(pelicula.reproducir, { clase: 'pelicula', id: 'p1', titulo: 'Película 1' });

  await presentador.mover('derecha');
  const episodio = await presentador.aceptar();
  assert.equal(episodio.reproducir?.clase, 'episodio');
  assert.equal(episodio.reproducir?.id, '7');
});

test('una serie de un carrusel se abre, no se reproduce', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  const estado = await presentador.cargar();
  const series = indiceDe(estado, 'Series recién llegadas');

  for (let i = 0; i < series; i++) await presentador.mover('abajo');
  const { reproducir } = await presentador.aceptar();

  assert.equal(reproducir, null);
  assert.equal(pantallaDe(presentador), 'serie');
});

test('lo que ya no está en el catálogo no ensucia la fila', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    // El proveedor quitó esta película: el historial la recuerda y la
    // biblioteca no la encuentra.
    seguirViendo: async () => [
      {
        clase: 'pelicula' as const,
        itemId: 'ya-no-esta',
        titulo: 'Fantasma',
        segundos: 60,
        duracion: 5400,
        visto: '2026-08-26T21:00:00.000Z',
      },
    ],
  });

  assert.equal(filaDe(await presentador.cargar(), 'Seguir viendo'), null);
});

test('recargar conserva el foco', async () => {
  // Es lo que pasa cuando entra una sincronización mientras estás mirando.
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  const estado = await presentador.cargar();
  const continuar = indiceDe(estado, 'Seguir viendo');

  for (let i = 0; i < continuar; i++) await presentador.mover('abajo');
  await presentador.mover('derecha');

  const recargado = await presentador.cargar();
  assert.equal(recargado.inicio?.fila, continuar);
  assert.equal(recargado.inicio?.columna, 1);
});

test('el buscador enseña carátulas, no líneas de texto', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  const abierto = await presentador.abrirBuscador();

  // Sin texto no se busca nada, pero el formato ya es el de una rejilla.
  assert.equal(abierto.formato, 'carteles');
  assert.deepEqual(abierto.elementos, []);
});

test('los resultados llegan con su ficha del catálogo', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.abrirBuscador();
  const estado = await presentador.buscar('who');

  assert.equal(estado.elementos.length, 3);
  // La serie trae carátula, año y nota de su ficha, no solo el título.
  const serie = estado.elementos[0]!;
  assert.equal(serie.titulo, 'Doctor Who');
  assert.equal(serie.anio, 2005);
  assert.equal(serie.valoracion, 8);
  assert.equal(serie.detalle, 'Serie');
});

test('el orden de relevancia de la búsqueda se respeta', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.abrirBuscador();
  const estado = await presentador.buscar('lo que sea');

  assert.deepEqual(
    estado.elementos.map((elemento) => elemento.titulo),
    ['Doctor Who', 'Película 1', '24 Horas'],
  );
});

test('aceptar sobre una serie del buscador entra en ella, no en el listado', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.abrirBuscador();
  await presentador.buscar('who');

  const { estado, reproducir } = await presentador.aceptar();
  assert.equal(reproducir, null);
  assert.equal(pantallaDe(presentador), 'serie');
  // Y entra ya con sus temporadas en la barra y los episodios de la primera.
  assert.equal(estado.titulo, 'Doctor Who · Temporada 1');
  assert.deepEqual(
    estado.lateral?.opciones.map((opcion) => opcion.nombre),
    ['Temporada 1', 'Temporada 2'],
  );
});

test('una película del buscador se reproduce', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.abrirBuscador();
  await presentador.buscar('lo que sea');
  presentador.enfocar(1);

  const { reproducir } = await presentador.aceptar();
  assert.deepEqual(reproducir, { clase: 'pelicula', id: 'p1', titulo: 'Película 1' });
});

test('un canal del buscador lleva su grupo como detalle', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await presentador.abrirBuscador();
  const estado = await presentador.buscar('lo que sea');

  assert.equal(estado.elementos[2]!.detalle, 'NOTICIAS');
});
