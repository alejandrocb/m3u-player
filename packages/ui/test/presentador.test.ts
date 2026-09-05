import assert from 'node:assert/strict';
import test from 'node:test';

import { Presentador } from '../src/presentador.ts';
import type { EstadoPantalla, FilaInicio } from '../src/presentador.ts';
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
 * Se pone una pestaña del inicio, que es lo único que hay.
 *
 * Las rejillas de películas, series y directo —con su barra de categorías—
 * se fueron: eran el mismo contenido con otra cara, y se llegaba a ellas
 * pulsando dos veces la pestaña, que era justo lo que confundía.
 */
async function enPestana(presentador: Presentador, modo: 'peliculas' | 'series' | 'directo' | 'lista') {
  return presentador.elegirModo(modo);
}

/** Biblioteca de mentira: la misma forma que la real, con datos a mano. */
function bibliotecaFalsa(peliculas = 3, temas: GrupoFicha[] = []): Biblioteca {
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
      // Filtrar por tema deja una sola, para poder distinguir en el test una
      // fila de tema de una de categoría.
      const fichas = pagina.tema ? todas.slice(0, 1) : todas;
      return fichas.slice(pagina.desde, pagina.desde + pagina.limite);
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
        trailer: 'dQw4w9WgXcQ',
      };
    },
    async guardarGeneros() {},
    async gruposDe(_clase: ClaseMedio, id: string) {
      // En el catálogo falso, cada película está en la categoría que dice su
      // nombre; lo demás no pertenece a ninguna.
      return id.startsWith('p') ? ['Estrenos'] : [];
    },
    async detalleDeSerie(id: string) {
      // Doctor Who sí tiene imagen apaisada: es la que preside "Series".
      return id === 'dw'
        ? {
            sinopsis: 'Un viajero del tiempo.',
            reparto: null,
            fondo: 'http://host/dw-fondo.jpg',
            genero: 'Aventura',
            trailer: null,
          }
        : null;
    },
    async seriesPorId(ids: string[]): Promise<SerieFicha[]> {
      return ids.includes('dw')
        ? [{ id: 'dw', titulo: 'Doctor Who', anio: 2005, valoracion: 8, logo: null, genero: 'Ciencia ficción' }]
        : [];
    },
    async episodioSiguiente(clave: string) {
      // La serie de prueba tiene tres capítulos en una temporada.
      const numero = Number(clave.split('e').pop());
      if (!Number.isFinite(numero) || numero >= 3) return null;
      return {
        clave: `dw:s1e${numero + 1}`,
        serieId: 'dw',
        serieTitulo: 'Doctor Who',
        serieLogo: null,
        temporada: 1,
        numero: numero + 1,
        titulo: `Episodio ${numero + 1}`,
      };
    },
    async episodiosPorClave(claves: string[]) {
      // La clave es `serie:sTeN`, la misma en todos los aparatos.
      return claves.map((clave) => {
        const numero = Number(clave.split('e').pop());
        return {
          clave,
          serieId: 'dw',
          serieTitulo: 'Doctor Who',
          serieLogo: null,
          temporada: 1,
          numero,
          titulo: `Episodio ${numero}`,
        };
      });
    },
    async canalesPorId(ids: string[]): Promise<CanalFicha[]> {
      return ids.map((id) => ({ id, nombre: '24 Horas', grupo: 'NOTICIAS', logo: null }));
    },
    async temas(): Promise<GrupoFicha[]> {
      // Vacíos salvo que el test los ponga: es el estado del primer día, con
      // el servidor aún sin averiguar ningún género.
      return temas;
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
    {
      clase: 'pelicula',
      itemId: 'p1',
      titulo: 'Película 1',
      segundos: 1800,
      duracion: 5400,
      visto: '2026-08-26T21:00:00.000Z',
    },
    {
      clase: 'episodio',
      itemId: 'dw:s1e7',
      titulo: 'Doctor Who',
      segundos: 600,
      duracion: 2400,
      visto: '2026-08-25T21:00:00.000Z',
    },
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
    // Detrás van las categorías del proveedor, una fila por cada una.
    estado.inicio?.filas
      .filter((fila) => fila.tipo === 'carrusel')
      .map((fila) => fila.titulo)
      .slice(0, 3),
    ['Películas recién llegadas', 'Series recién llegadas', 'Recomendadas'],
  );
  assert.equal(estado.inicio?.modo, 'todo');
});

test('con géneros suficientes, las filas van por tema y no por categoría', async () => {
  /*
    El servidor va averiguando el género de las películas, una petición por
    título. Hasta que hay para unas cuantas filas, el inicio se monta con las
    categorías del proveedor; a partir de ahí, con los temas, que es de lo que
    va la película y no dónde la ha colocado el proveedor en su lista.
  */
  const temas = [
    { nombre: 'Drama', canales: 400 },
    { nombre: 'Comedia', canales: 300 },
    { nombre: 'Terror', canales: 200 },
    { nombre: 'Documental', canales: 100 },
    // Este no llega para llenar una fila: no se enseña.
    { nombre: 'Cortometraje', canales: 3 },
  ];

  const conTemas = await new Presentador(bibliotecaFalsa(3, temas)).cargar();
  const titulos = (conTemas.inicio?.filas ?? [])
    .filter((fila) => fila.tipo === 'carrusel')
    .map((fila) => fila.titulo);

  assert.ok(titulos.includes('Drama'), 'las filas de género se llaman por su tema');
  assert.ok(!titulos.includes('Cortometraje'), 'un tema con tres películas no da para una fila');
  assert.ok(!titulos.includes('Estrenos'), 'con temas no se usan las categorías del proveedor');

  // Y con tres temas —uno menos de los que hacen falta— se sigue con las
  // categorías, que están todas desde el primer arranque.
  const conPocos = await new Presentador(bibliotecaFalsa(3, temas.slice(0, 3))).cargar();
  const pocos = (conPocos.inicio?.filas ?? [])
    .filter((fila) => fila.tipo === 'carrusel')
    .map((fila) => fila.titulo);

  assert.ok(pocos.includes('Estrenos'), 'sin temas suficientes mandan las categorías');
  assert.ok(!pocos.includes('Drama'));
});

test('la pestaña de películas deja fuera las series, y al revés', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const titulos = (estado: EstadoPantalla): string[] =>
    (estado.inicio?.filas ?? [])
      .map((fila: FilaInicio) => (fila.tipo === 'carrusel' ? fila.titulo : null))
      .filter((titulo): titulo is string => titulo !== null)
      .slice(0, 2);

  const soloPeliculas = await presentador.elegirModo('peliculas');
  assert.deepEqual(titulos(soloPeliculas), ['Novedades', 'Recomendadas']);

  const soloSeries = await presentador.elegirModo('series');
  assert.deepEqual(titulos(soloSeries), ['Novedades', 'Recomendadas']);
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

test('un canal se reproduce en vez de abrir otra pantalla', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await enPestana(presentador, 'directo');

  const { reproducir } = await presentador.aceptar();
  assert.deepEqual(reproducir, { clase: 'canal', id: 'c1', titulo: '24 Horas' });
  // Reproducir no cambia de pantalla: al cerrar el vídeo seguimos donde estábamos.
  assert.equal(pantallaDe(presentador), 'inicio');
});

test('una serie enseña sus temporadas al lado y los episodios en el centro', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await enPestana(presentador, 'series');

  // La primera ficha de la primera fila es una serie: aceptar entra en ella.
  const serie = await presentador.aceptar();
  assert.equal(pantallaDe(presentador), 'serie');
  // Las temporadas van en la barra, que es la única que queda.
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
  await enPestana(presentador, 'series');
  const { estado } = await presentador.aceptar(); // Doctor Who

  const episodio = estado.elementos[0]!;
  assert.equal(episodio.logo, 'http://host/1.jpg');
  assert.equal(episodio.resumen, 'Rose conoce al Doctor.');
  assert.equal(episodio.valoracion, 7);
  assert.equal(episodio.detalle, '45 min');
});

test('cambiar de temporada no apila pantalla: atrás sale de la serie', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await enPestana(presentador, 'series');
  await presentador.aceptar(); // Doctor Who

  const segunda = await presentador.elegirCategoria('2');
  assert.equal(segunda.titulo, 'Doctor Who · Temporada 2');

  // Atrás sale de la serie de una vez, sin ir deshaciendo temporadas.
  const vuelta = await presentador.atras();
  assert.equal(vuelta.resultado, 'retrocedido');
  assert.equal(vuelta.estado.titulo, 'Biblioteca');
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
  await enPestana(presentador, 'series');
  await presentador.aceptar(); // se entra en una serie

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

  await presentador.aceptar(); // lo que haya bajo el foco
  await presentador.atras();

  const estado = presentador.estado();
  assert.equal(estado.inicio?.fila, 1, 'vuelve a la fila desde la que se entró');
  assert.equal(estado.inicio?.columna, 1, 'y a la misma ficha');
});

test('la izquierda entra en la barra de temporadas y la derecha vuelve', async () => {
  // La única barra lateral que queda es la de una serie.
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await enPestana(presentador, 'series');
  await presentador.mover('abajo');
  await presentador.aceptar(); // Doctor Who

  const dentro = await presentador.mover('izquierda');
  assert.equal(dentro.lateral?.dentro, true);

  const bajado = await presentador.mover('abajo');
  assert.equal(bajado.lateral?.foco, 1);

  const fuera = await presentador.mover('derecha');
  assert.equal(fuera.lateral?.dentro, false);
});

test('el buscador hereda la pestaña donde se abrió', async () => {
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  await enPestana(presentador, 'peliculas');

  const buscador = await presentador.abrirBuscador();
  assert.equal(buscador.titulo, 'Buscar en Películas');
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
  const estado = await enPestana(presentador, 'peliculas');

  const novedades = estado.inicio!.filas.find(
    (fila) => fila.tipo === 'carrusel' && fila.titulo === 'Novedades',
  )!;
  assert.deepEqual(
    novedades.elementos.map((elemento) => elemento.avance),
    [0.5, 0.93, null],
    'lo no empezado se queda sin barrita',
  );

  // Una sola consulta por fila, con todas sus fichas: no una por ficha.
  assert.equal(pedidos[pedidos.length - 1]!.length, 3);
});

test('la ficha lleva el año y la nota sueltos, para pintarlos sobre la carátula', async () => {
  const presentador = new Presentador(bibliotecaFalsa(2));
  await presentador.cargar();
  const estado = await enPestana(presentador, 'peliculas');

  const fila = estado.inicio!.filas.find((una) => una.tipo === 'carrusel')!;
  const esteAnio = new Date().getFullYear();
  assert.equal(fila.elementos[0]!.anio, esteAnio);
  assert.equal(fila.elementos[0]!.valoracion, 9);

  // Ya no se escriben debajo del título: esa línea era la que impedía agrandar
  // la carátula.
  assert.equal(fila.elementos[0]!.detalle, null);
});

test('la pulsación larga marca y desmarca', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  const estado = await presentador.cargar();

  // Se marca sobre la ficha del inicio, que es donde se ven ahora: fila y
  // columna en vez de un índice de rejilla.
  const fila = estado.inicio!.filas.findIndex((una) => una.tipo === 'carrusel');
  const ficha = () => presentador.estado().inicio!.filas[fila]!.elementos[0]!;

  assert.equal(ficha().favorito, false);
  await presentador.alternarFavoritoEnInicio(fila, 0);
  assert.equal(ficha().favorito, true, 'el corazón se queda puesto');

  await presentador.alternarFavoritoEnInicio(fila, 0);
  assert.equal(ficha().favorito, false);
});

test('el corazón sale ya puesto en lo que estaba guardado', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: favoritosFalsos([{ clase: 'pelicula', id: 'p1' }]),
  });
  const estado = await presentador.cargar();

  const novedades = filaDe(estado, 'Películas recién llegadas')!;
  const marcada = novedades.elementos.filter((elemento) => elemento.favorito);
  assert.deepEqual(
    marcada.map((elemento) => elemento.titulo),
    ['Película 1'],
    'solo la que estaba guardada sale con el corazón puesto',
  );
});

test('una serie se marca por su ficha, no por lo que reproduce', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  const estado = await enPestana(presentador, 'series');

  const fila = estado.inicio!.filas.findIndex((una) => una.tipo === 'carrusel');
  const marcada = await presentador.alternarFavoritoEnInicio(fila, 0);
  assert.equal(marcada.inicio!.filas[fila]!.elementos[0]!.favorito, true);

  // Y dentro de la serie, los episodios sueltos no se marcan: lo que uno
  // guarda es la serie entera.
  await presentador.aceptar();
  const enEpisodio = await presentador.alternarFavorito(0);
  assert.equal(enEpisodio.elementos[0]!.favorito, false);
});

test('los favoritos se piden por clase, no por ficha', async () => {
  const favoritos = favoritosFalsos();
  const presentador = new Presentador(bibliotecaFalsa(7), { favoritos });
  const estado = await presentador.cargar();

  // Una consulta por fila —con sus siete fichas dentro—, no una por ficha.
  const filas = estado.inicio!.filas.filter((una) => una.tipo === 'carrusel').length;
  assert.ok(favoritos.llamadas <= filas, `${favoritos.llamadas} consultas para ${filas} filas`);
});

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

test('TV en directo es una fila por grupo de canales, con todos', async () => {
  // La misma forma que el resto del inicio. Y aquí no se recorta: un grupo de
  // canales es una lista corta y cerrada, esconder alguno sería esconder un
  // canal.
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();

  const estado = await presentador.elegirModo('directo');
  assert.equal(estado.inicio?.modo, 'directo');
  assert.deepEqual(
    estado.inicio?.filas.map((fila) => (fila.tipo === 'carrusel' ? fila.titulo : fila.tipo)),
    ['Deportes', 'Noticias'],
    'una por grupo, de más canales a menos',
  );
});

test('Mi Lista enseña lo marcado, por clases y con su filtro', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: {
      listar: async (clase) => (clase === 'pelicula' ? ['p1'] : clase === 'serie' ? ['dw'] : []),
      alternar: async () => true,
    },
  });
  await presentador.cargar();

  const estado = await presentador.elegirModo('lista');
  assert.equal(estado.inicio?.modo, 'lista');

  // La primera fila son los filtros; luego, una fila por clase con algo.
  assert.equal(estado.inicio?.filas[0]?.tipo, 'filtros');
  assert.deepEqual(
    estado.inicio?.filas.slice(1).map((fila) => (fila.tipo === 'carrusel' ? fila.titulo : fila.tipo)),
    ['Películas', 'Series'],
    'los canales no salen porque no hay ninguno marcado',
  );

  // Y el filtro deja solo lo suyo.
  const soloSeries = await presentador.elegirFiltro('serie');
  assert.deepEqual(
    soloSeries.inicio?.filas.slice(1).map((fila) => (fila.tipo === 'carrusel' ? fila.titulo : fila.tipo)),
    ['Series'],
  );
});

test('sin nada marcado, Mi Lista solo tiene sus filtros', async () => {
  // La vista enseña ahí el "aquí va lo que marques": no es un fallo, es que
  // todavía no hay nada.
  const presentador = new Presentador(bibliotecaFalsa(), {
    favoritos: { listar: async () => [], alternar: async () => true },
  });
  await presentador.cargar();

  const estado = await presentador.elegirModo('lista');
  assert.equal(estado.inicio?.filas.length, 1);
  assert.equal(estado.inicio?.filas[0]?.tipo, 'filtros');
});

test('de una serie solo sale por dónde vas, no cada capítulo', async () => {
  // Una serie se ve en orden: lo que hace falta es el último capítulo tocado,
  // no los cuatro anteriores llenando la fila con la misma carátula.
  const presentador = new Presentador(bibliotecaFalsa(), {
    seguirViendo: async () => [
      {
        clase: 'episodio',
        itemId: 'dw:s1e7',
        titulo: 'Doctor Who',
        segundos: 600,
        duracion: 2400,
        visto: '2026-08-25T21:00:00.000Z',
      },
      {
        clase: 'episodio',
        itemId: 'dw:s1e6',
        titulo: 'Doctor Who',
        segundos: 2000,
        duracion: 2400,
        visto: '2026-08-24T21:00:00.000Z',
      },
    ],
  });

  const fila = filaDe(await presentador.cargar(), 'Seguir viendo');
  assert.equal(fila?.elementos.length, 1);
  assert.equal(fila?.elementos[0]?.detalle, 'T1 E7 · Episodio 7', 'el último que se tocó');
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

test('las filas son solo del inicio: dentro de una serie no hay', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { seguirViendo: async () => aMedias() });
  await presentador.cargar();
  const enSeries = await enPestana(presentador, 'series');

  // Se enfoca la fila de series, que es la que lleva a una pantalla.
  presentador.enfocarEnInicio(indiceDe(enSeries, 'Novedades'), 0);
  const { estado } = await presentador.aceptar(); // Doctor Who
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
  // La clave del contenido, que es lo que significa lo mismo en otro aparato.
  assert.equal(episodio.reproducir?.id, 'dw:s1e7');
});

test('un episodio de dentro de la serie también se reproduce por su clave', async () => {
  // Es el otro sitio donde se anota el avance de un capítulo, y tiene que
  // guardar exactamente la misma clave que "seguir viendo": si no, el mismo
  // capítulo quedaría con dos entradas en el historial.
  const presentador = new Presentador(bibliotecaFalsa());
  await presentador.cargar();
  const enSeries = await enPestana(presentador, 'series');
  presentador.enfocarEnInicio(indiceDe(enSeries, 'Novedades'), 0);
  await presentador.aceptar(); // Doctor Who

  const { reproducir } = await presentador.aceptar();
  assert.equal(reproducir?.clase, 'episodio');
  assert.equal(reproducir?.id, 'dw:s1e1');
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

test('la ficha reúne la sinopsis y los botones de lo que se puede hacer', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();

  const estado = await presentador.abrirFicha('pelicula', 'p1', 'Película 1');

  assert.equal(estado.formato, 'ficha');
  assert.equal(estado.ficha?.sinopsis, 'Una película de prueba con su sinopsis.');
  assert.equal(estado.ficha?.reparto, 'Actriz Primera, Actor Segundo, Actriz Tercera');
  assert.deepEqual(
    estado.elementos.map((boton) => boton.titulo),
    ['Reproducir', 'Añadir a Mi Lista', 'Descargar', 'Ver tráiler'],
  );
});

test('una serie no se reproduce ni se descarga: se entra en sus episodios', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();

  const estado = await presentador.abrirFicha('serie', 'dw', 'Doctor Who');

  assert.deepEqual(
    estado.elementos.map((boton) => boton.titulo),
    ['Ver episodios', 'Añadir a Mi Lista'],
  );
});

test('el botón de Mi Lista dice lo que va a hacer, y cambia al pulsarlo', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await presentador.abrirFicha('pelicula', 'p1', 'Película 1');

  // El foco empieza en Reproducir; los botones son una fila, así que se pasa
  // al de la lista con la derecha.
  await presentador.mover('derecha');
  const despues = await presentador.aceptar();

  assert.equal(despues.estado.elementos[1]!.titulo, 'Quitar de Mi Lista');
  assert.equal(despues.estado.ficha?.favorito, true);
});

test('el tráiler se abre fuera: la vista recibe la dirección', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  const estado = await presentador.abrirFicha('pelicula', 'p1', 'Película 1');

  const indice = estado.elementos.findIndex((boton) => boton.id === 'trailer');
  for (let paso = 0; paso < indice; paso++) await presentador.mover('derecha');
  const hecho = await presentador.aceptar();

  assert.equal(hecho.abrir, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(hecho.reproducir, null);
});

test('descargar no reproduce: se lo pasa a quien lleve la cola', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  const estado = await presentador.abrirFicha('pelicula', 'p1', 'Película 1');

  const indice = estado.elementos.findIndex((boton) => boton.id === 'descargar');
  for (let paso = 0; paso < indice; paso++) await presentador.mover('derecha');
  const hecho = await presentador.aceptar();

  assert.equal(hecho.descargar?.id, 'p1');
  assert.equal(hecho.reproducir, null);
});

test('atrás sale de la ficha y devuelve al inicio', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), { favoritos: favoritosFalsos() });
  await presentador.cargar();
  await presentador.abrirFicha('pelicula', 'p1', 'Película 1');

  const { resultado, estado } = await presentador.atras();
  assert.equal(resultado, 'retrocedido');
  assert.equal(estado.ficha, null);
  assert.ok(estado.inicio, 'debería volver al inicio');
});

test('una película vista se cae de "seguir viendo" al pasar del 90 %', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    // 91 % de una película: para el catálogo, vista.
    seguirViendo: async () => [
      { clase: 'pelicula', itemId: 'p1', titulo: 'Película 1', segundos: 5460, duracion: 6000, visto: '2026-08-30' },
    ],
  });
  const estado = await presentador.cargar();

  assert.equal(
    estado.inicio?.filas.some((fila) => fila.tipo === 'carrusel' && fila.titulo === 'Seguir viendo'),
    false,
  );
});

test('pero al 85 % sigue ahí: una película aguanta más que un capítulo', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    seguirViendo: async () => [
      { clase: 'pelicula', itemId: 'p1', titulo: 'Película 1', segundos: 5100, duracion: 6000, visto: '2026-08-30' },
    ],
  });
  const estado = await presentador.cargar();

  const fila = estado.inicio?.filas.find((una) => una.tipo === 'carrusel' && una.titulo === 'Seguir viendo');
  assert.equal(fila?.elementos[0]?.titulo, 'Película 1');
});

test('un capítulo terminado da paso al siguiente, no se queda puesto', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    // 96 % del primero: terminado, y lo que toca ver es el segundo.
    seguirViendo: async () => [
      { clase: 'episodio', itemId: 'dw:s1e1', titulo: 'Doctor Who', segundos: 2880, duracion: 3000, visto: '2026-08-30' },
    ],
  });
  const estado = await presentador.cargar();

  const fila = estado.inicio?.filas.find((una) => una.tipo === 'carrusel' && una.titulo === 'Seguir viendo');
  assert.equal(fila?.elementos[0]?.detalle, 'T1 E2 · Episodio 2');
  // Y empieza de cero: la barrita del que ya se vio no dice nada del que viene.
  assert.equal(fila?.elementos[0]?.avance, 0);
});

test('y cuando se acaba la serie, sale de la fila', async () => {
  const presentador = new Presentador(bibliotecaFalsa(), {
    // El tercero es el último de la serie de prueba.
    seguirViendo: async () => [
      { clase: 'episodio', itemId: 'dw:s1e3', titulo: 'Doctor Who', segundos: 2970, duracion: 3000, visto: '2026-08-30' },
    ],
  });
  const estado = await presentador.cargar();

  assert.equal(
    estado.inicio?.filas.some((fila) => fila.tipo === 'carrusel' && fila.titulo === 'Seguir viendo'),
    false,
  );
});

/** Un canal a medias, con la parrilla que se le quiera dar. */
function conDirecto(programas: Record<string, Array<{ desde: Date; hasta: Date; titulo: string }>>, visto: string) {
  return new Presentador(bibliotecaFalsa(), {
    seguirViendo: async () => [
      { clase: 'canal' as ClaseMedio, itemId: 'c1', titulo: '24 Horas', segundos: 600, duracion: 0, visto },
    ],
    parrilla: async () =>
      Object.fromEntries(
        Object.entries(programas).map(([canal, suyos]) => [
          canal,
          suyos.map((uno) => ({ ...uno, descripcion: null })),
        ]),
      ),
  });
}

const haceUnRato = new Date(Date.now() - 30 * 60_000);

test('un canal sigue en "seguir viendo" mientras dure el programa', async () => {
  const presentador = conDirecto(
    {
      // Empezó antes de que lo dejáramos y no ha terminado: es el mismo.
      c1: [{ desde: new Date(Date.now() - 60 * 60_000), hasta: new Date(Date.now() + 30 * 60_000), titulo: 'Telediario' }],
    },
    haceUnRato.toISOString(),
  );
  const estado = await presentador.cargar();

  const fila = estado.inicio?.filas.find((una) => una.tipo === 'carrusel' && una.titulo === 'Seguir viendo');
  assert.equal(fila?.elementos[0]?.titulo, '24 Horas');
  // Y dice qué echan, que es lo que uno reconoce.
  assert.equal(fila?.elementos[0]?.detalle, 'Telediario');
  // En directo no hay barrita: el flujo no empieza ni acaba.
  assert.equal(fila?.elementos[0]?.avance, null);
});

test('y se cae cuando el programa que veías ha terminado', async () => {
  const presentador = conDirecto(
    {
      // El que hay ahora empezó después de que lo dejáramos: el nuestro acabó.
      c1: [{ desde: new Date(Date.now() - 10 * 60_000), hasta: new Date(Date.now() + 50 * 60_000), titulo: 'Otro' }],
    },
    haceUnRato.toISOString(),
  );
  const estado = await presentador.cargar();

  assert.equal(
    estado.inicio?.filas.some((fila) => fila.tipo === 'carrusel' && fila.titulo === 'Seguir viendo'),
    false,
  );
});

test('sin programación aguanta dos horas, que es lo que dura un partido', async () => {
  // 272 de los 463 canales de la lista real no tienen EPG: son los de eventos.
  const reciente = await conDirecto({}, new Date(Date.now() - 60 * 60_000).toISOString()).cargar();
  assert.equal(
    reciente.inicio?.filas.some((fila) => fila.tipo === 'carrusel' && fila.titulo === 'Seguir viendo'),
    true,
  );

  const viejo = await conDirecto({}, new Date(Date.now() - 3 * 60 * 60_000).toISOString()).cargar();
  assert.equal(
    viejo.inicio?.filas.some((fila) => fila.tipo === 'carrusel' && fila.titulo === 'Seguir viendo'),
    false,
  );
});
