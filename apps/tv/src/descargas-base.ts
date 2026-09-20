/**
 * La cola de descargas sobre SQLite y el transporte de Android.
 *
 * Dos piezas que la cola de `@m3u/ui` no quiere conocer: dónde se guarda la
 * lista y quién mueve los bytes.
 *
 * **El fichero va en la carpeta privada de la aplicación.** No en Descargas ni
 * en la galería: así no hace falta pedir permisos de almacenamiento, no se
 * mezcla con las fotos, y al desinstalar se va con la aplicación. La
 * contrapartida es que no se puede pasar por USB a un ordenador, que no es lo
 * que se busca aquí.
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import type { DB } from '@op-engineering/op-sqlite';

import { urlSinCredenciales } from '@m3u/ui';
import type { AlmacenDescargas, Descarga, EstadoDescarga, Transferencia } from '@m3u/ui';

/** Dónde viven los ficheros bajados, dentro de lo privado de la aplicación. */
export const CARPETA = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/descargas`;

/**
 * Cuánto se aguanta sin que entre un solo byte antes de dar por atascada la
 * descarga, soltar la ranura y volver a intentarlo.
 *
 * Generoso a propósito: el panel tarda en contestar la primera cabecera y una
 * tablet vieja con un wifi flojo se queda parada a ratos. Cortar antes sería
 * cortar descargas que iban bien.
 *
 * **Esta constante estuvo sin declarar**, y salió carísimo: `rearmar()` es lo
 * primero que se llama después de lanzar la petición, así que reventaba con un
 * `ReferenceError` **antes de registrar `progress` y `then`**. La descarga
 * arrancaba y escribía en el disco —eso lo hace la librería por su cuenta—
 * pero ya no había nadie escuchando: ni avance, ni final, ni fallo. Por fuera
 * se veía como "baja gigas, no termina nunca, no reanuda y llena el disco".
 * No lo cazó nadie porque **`npm run typecheck` no mira `apps/`**.
 */
const SIN_UN_BYTE_MS = 45_000;

/**
 * Cada cuánto se mira el tamaño del fichero para saber por dónde va.
 *
 * Dos segundos es de sobra para una barra que se mueve y no cuesta nada: es
 * un `stat`, no leer el fichero.
 */
const MIRAR_CADA_MS = 2_000;

/** La ruta completa de una descarga, que es lo que se le pasa al reproductor. */
export function rutaDe(descarga: Descarga): string {
  return `${CARPETA}/${descarga.fichero}`;
}

/** Borra el fichero de una descarga. Que no exista no es un fallo. */
export async function borrarFichero(descarga: Descarga): Promise<void> {
  await ReactNativeBlobUtil.fs.unlink(rutaDe(descarga)).catch(() => undefined);
}

/**
 * Cuánto ocupan las descargas y cuánto queda libre en el disco.
 *
 * Lo ocupado se mide sumando los ficheros de verdad y no lo que diga la base:
 * una descarga a medias ocupa lo que lleve bajado, y un fichero que alguien
 * borró por fuera no ocupa nada aunque su fila siga ahí.
 */
export async function espacio(): Promise<{ ocupado: number; libre: number }> {
  const ocupado = await ReactNativeBlobUtil.fs
    .lstat(CARPETA)
    .then((ficheros) => ficheros.reduce((suma, uno) => suma + (Number(uno.size) || 0), 0))
    .catch(() => 0);

  const libre = await ReactNativeBlobUtil.fs
    .df()
    .then((disco) => Number(disco.internal_free ?? disco.free ?? 0) || 0)
    .catch(() => 0);

  return { ocupado, libre };
}

/**
 * Borra los ficheros de la carpeta que ninguna descarga reclama.
 *
 * Un fichero a medias cuya fila no existe **no se puede borrar desde la
 * aplicación**: no sale en la lista, así que no hay botón que lo quite, y se
 * queda ocupando sitio para siempre. Los hubo a pares mientras `download` no
 * podía guardar nada —la descarga bajaba gigas y su fila nunca llegaba a la
 * base—, y son lo que dejó la tele al 91 %.
 *
 * Se pasa al abrir, con lo que diga la cola. Devuelve cuántos bytes ha
 * recuperado, para poder decirlo.
 */
export async function limpiarHuerfanos(conocidos: string[]): Promise<number> {
  const suyos = new Set(conocidos);
  const ficheros = await ReactNativeBlobUtil.fs.lstat(CARPETA).catch(() => []);

  let recuperado = 0;
  for (const uno of ficheros) {
    if (suyos.has(uno.filename)) continue;
    const tamano = Number(uno.size) || 0;
    const fuera = await ReactNativeBlobUtil.fs
      .unlink(`${CARPETA}/${uno.filename}`)
      .then(() => true)
      .catch(() => false);
    if (fuera) recuperado += tamano;
  }

  if (recuperado > 0) {
    console.log(`[descarga] limpiados ${Math.round(recuperado / 1_000_000)} MB sin dueño`);
  }
  return recuperado;
}

type Fila = Record<string, unknown>;

function comoDescarga(fila: Fila): Descarga {
  return {
    id: fila.id as string,
    clase: fila.kind as Descarga['clase'],
    itemId: fila.item_id as string,
    titulo: fila.title as string,
    serieId: (fila.series_id as string | null) ?? null,
    url: fila.url as string,
    fichero: fila.file as string,
    estado: fila.state as EstadoDescarga,
    bytes: Number(fila.bytes) || 0,
    total: fila.total === null || fila.total === undefined ? null : Number(fila.total),
    creada: fila.created as string,
    duracion: fila.seconds === null || fila.seconds === undefined ? null : Number(fila.seconds),
    intentos: Number(fila.tries) || 0,
    error: (fila.error as string | null) ?? null,
  };
}

export function descargasEnBase(db: DB): AlmacenDescargas {
  return {
    async leer(): Promise<Descarga[]> {
      const filas = (db.executeSync('SELECT * FROM download ORDER BY created').rows ?? []) as Fila[];
      return filas.map(comoDescarga);
    },

    async guardar(descarga: Descarga): Promise<void> {
      db.executeSync(
        `INSERT INTO download
              (id, kind, item_id, title, series_id, url, file, state, bytes, total, created, seconds, tries, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state, bytes = excluded.bytes, total = excluded.total,
           url = excluded.url, tries = excluded.tries, error = excluded.error`,
        [
          descarga.id,
          descarga.clase,
          descarga.itemId,
          descarga.titulo,
          descarga.serieId,
          descarga.url,
          descarga.fichero,
          descarga.estado,
          descarga.bytes,
          descarga.total,
          descarga.creada,
          descarga.duracion,
          descarga.intentos,
          descarga.error,
        ],
      );
    },

    async borrar(id: string): Promise<void> {
      db.executeSync('DELETE FROM download WHERE id = ?', [id]);
    },
  };
}

/**
 * El transporte de Android: pide el fichero al panel y lo escribe en el disco.
 *
 * Tres cosas que no son evidentes y que deciden cómo está escrito esto:
 *
 * - **Se reanuda con `Range`.** Si ya hay bytes en el disco se le pide al
 *   panel desde ahí, y el fichero se abre en modo añadir. Es lo que permite
 *   que una descarga se pueda expulsar sin coste cuando alguien pone una
 *   película.
 * - **Hay que comprobar que el panel respeta el rango.** Si contesta `200` en
 *   vez de `206`, está mandando el fichero entero desde el principio, y
 *   añadirlo a lo que ya había daría un fichero corrupto que además parece
 *   completo. En ese caso se empieza de cero.
 * - **Lo que cancela no falla.** Al expulsar una descarga, la petición se
 *   aborta y eso llega aquí como un error de red. Si se contara como fallo, lo
 *   que la cola quiere reanudar quedaría marcado como roto.
 */
export function transferenciaDeAndroid(): Transferencia {
  /*
    La carpeta, una vez. Se espera a que exista antes de la primera descarga:
    pedirla en paralelo con el fetch es una carrera que a veces se pierde.

    Y si no se puede crear hay que **decirlo**: sin carpeta, el fichero no se
    puede abrir y lo único que se ve por fuera es "Download interrupted", que
    parece un problema de red y no lo es.
  */
  const carpetaLista = ReactNativeBlobUtil.fs
    .isDir(CARPETA)
    .then(async (hay) => {
      if (!hay) await ReactNativeBlobUtil.fs.mkdir(CARPETA);
      return true;
    })
    .catch((fallo: unknown) => {
      console.warn('[descarga] no se pudo crear la carpeta', CARPETA, fallo);
      return false;
    });

  return {
    empezar({ descarga, desde, alAvanzar, alTerminar, alFallar }) {
      let cancelada = false;
      let tarea: ReturnType<ReturnType<typeof ReactNativeBlobUtil.config>['fetch']> | null = null;
      const ruta = `${CARPETA}/${descarga.fichero}`;

      /*
        El vigía del atasco: si no entra un byte en `SIN_UN_BYTE_MS`, se corta
        y se suelta la ranura. Se rearma con cada byte que llega, así que una
        descarga lenta no lo despierta nunca.
      */
      let vigia: ReturnType<typeof setTimeout> | null = null;
      const rearmar = (): void => {
        if (vigia) clearTimeout(vigia);
        vigia = setTimeout(() => {
          if (cancelada) return;
          cancelada = true;
          tarea?.cancel();
          console.warn(`[descarga] ${descarga.fichero}: el panel no mandó nada en ${SIN_UN_BYTE_MS / 1000} s`);
          alFallar(`el panel no mandó nada en ${SIN_UN_BYTE_MS / 1000} s`);
        }, SIN_UN_BYTE_MS);
      };
      /*
        **Cuánto lleva bajado se mide mirando el fichero, no esperando a que
        la librería avise.**

        `ReactNativeBlobUtil` tiene su propia llamada de progreso y aquí
        **no se dispara nunca**: medido en la tablet, con cientos de megas en
        el disco, la línea que escribe cada diez megas no salió ni una vez. El
        resultado era que el panel enseñaba "Bajando · 0 MB" mientras el disco
        se llenaba, que a la base se apuntaba `bytes = 0`, y que al reabrir la
        aplicación la descarga empezaba otra vez desde el principio. Una
        película de cinco gigas no terminaba nunca y el disco se llenaba en
        cada intento.

        El tamaño del fichero es el dato que de verdad importa —es lo que se
        le pide al panel con `Range` al reanudar—, así que se lee de ahí. Y de
        paso el vigía del atasco se rearma con lo que **de verdad** ha entrado
        en el disco y no con lo que diga una librería.
      */
      let reloj: ReturnType<typeof setInterval> | null = null;
      let ultimoVisto = desde;
      const mirarElFichero = (): void => {
        reloj = setInterval(() => {
          if (cancelada) return;
          void ReactNativeBlobUtil.fs
            .stat(ruta)
            .then((medida) => {
              if (cancelada) return;
              const bytes = Number(medida.size) || 0;
              if (bytes <= ultimoVisto) return;
              ultimoVisto = bytes;
              // Ha entrado algo de verdad: el vigía vuelve a empezar la cuenta.
              rearmar();
              // El total no se sabe desde aquí; lo que ya hubiera se conserva.
              alAvanzar(bytes, null);
            })
            .catch(() => {
              // Todavía no existe el fichero, o el sistema no deja mirarlo: no
              // es motivo para cortar nada, ya lo dirá el vigía.
            });
        }, MIRAR_CADA_MS);
      };

      const guardarVigia = (): void => {
        if (vigia) clearTimeout(vigia);
        vigia = null;
        if (reloj) clearInterval(reloj);
        reloj = null;
      };

      void carpetaLista.then((hayCarpeta) => {
        if (cancelada) return;
        if (!hayCarpeta) {
          alFallar('no se pudo crear la carpeta de descargas');
          return;
        }

        console.log(`[descarga] empieza ${descarga.fichero} desde ${desde} · ${urlSinCredenciales(descarga.url)}`);

        tarea = ReactNativeBlobUtil.config({
          path: ruta,
          /*
            `overwrite: false` **añade** al fichero que ya hubiera, que es lo
            que hace que reanudar sirva de algo. Con `true` empezaría de cero.
          */
          overwrite: desde === 0,
          // El panel es HTTP y a veces tarda en contestar la primera cabecera.
          timeout: 60_000,
        }).fetch('GET', descarga.url, {
          /*
            **El mismo User-Agent que usa el cliente del panel.** Hay paneles
            que rechazan —o peor, dejan colgada— una petición que no venga de
            algo que parezca un reproductor, y sin esto aquí iba el `okhttp`
            que pone la librería por su cuenta. El reproductor de vídeo sí
            manda uno, así que la misma película se servía por un camino y no
            por el otro.
          */
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          Accept: '*/*',
          ...(desde > 0 ? { Range: `bytes=${desde}-` } : {}),
        });

        rearmar();
        mirarElFichero();

        let ultimoAviso = 0;
        tarea.progress({ interval: 500 }, (recibidos, total) => {
          if (cancelada) return;
          const hechos = Number(recibidos) || 0;
          const cuanto = Number(total) || 0;
          // Una línea cada diez megas: suficiente para ver si avanza y para
          // saber por dónde iba cuando se corte.
          if (hechos - ultimoAviso >= 10_000_000) {
            ultimoAviso = hechos;
            console.log(`[descarga] ${descarga.fichero}: ${Math.round(hechos / 1_000_000)} MB de ${Math.round(cuanto / 1_000_000)}`);
          }
          // Ha entrado algo: el vigía vuelve a empezar la cuenta.
          if (hechos > 0) rearmar();
          alAvanzar(desde + hechos, cuanto > 0 ? desde + cuanto : null);
        });

        tarea
          .then(async (respuesta) => {
            guardarVigia();
            if (cancelada) return;

            const estado = respuesta.info().status;
            /*
              Reanudando, el panel tiene que contestar 206. Un 200 quiere decir
              que manda el fichero entero otra vez: lo que hay en el disco ya
              no vale y hay que empezar de cero, o quedaría con el principio
              repetido y **pareciendo completo**, que es lo peor.
            */
            if (desde > 0 && estado === 200) {
              await ReactNativeBlobUtil.fs.unlink(ruta).catch(() => undefined);
              alAvanzar(0, null);
              alFallar('el panel no respeta el rango; se empieza de cero');
              return;
            }
            if (estado >= 400) {
              alFallar(`el panel contestó ${estado}`);
              return;
            }
            console.log(`[descarga] termina ${descarga.fichero}, estado ${estado}`);

            // El tamaño de verdad sale del disco, no de lo que dijera nadie.
            const medida = await ReactNativeBlobUtil.fs.stat(ruta).catch(() => null);
            const bytes = medida ? Number(medida.size) || 0 : desde;
            alAvanzar(bytes, bytes);
            alTerminar();
          })
          .catch(async (fallo: unknown) => {
            guardarVigia();
            // Cancelar aborta la petición y eso llega aquí como error de red:
            // no es un fallo, es que alguien ha puesto una película.
            if (cancelada) return;

            // Cuánto quedó en el disco: es lo que distingue "no ha empezado"
            // de "se cortó a la mitad", y no se sabe de otra forma.
            const medida = await ReactNativeBlobUtil.fs.stat(ruta).catch(() => null);
            const bytes = medida ? Number(medida.size) || 0 : 0;
            if (bytes > desde) alAvanzar(bytes, null);
            console.warn(`[descarga] se cortó ${descarga.fichero} con ${bytes} bytes:`, fallo);

            alFallar(fallo instanceof Error ? fallo.message : String(fallo));
          });
      });

      return () => {
        cancelada = true;
        guardarVigia();
        tarea?.cancel();
      };
    },
  };
}
