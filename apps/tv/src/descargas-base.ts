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

import type { AlmacenDescargas, Descarga, EstadoDescarga, Transferencia } from '@m3u/ui';

/** Dónde viven los ficheros bajados, dentro de lo privado de la aplicación. */
export const CARPETA = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/descargas`;

/** La ruta completa de una descarga, que es lo que se le pasa al reproductor. */
export function rutaDe(descarga: Descarga): string {
  return `${CARPETA}/${descarga.fichero}`;
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
        `INSERT INTO download (id, kind, item_id, title, series_id, url, file, state, bytes, total, created, tries, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      void carpetaLista.then((hayCarpeta) => {
        if (cancelada) return;
        if (!hayCarpeta) {
          alFallar('no se pudo crear la carpeta de descargas');
          return;
        }

        console.log(`[descarga] empieza ${descarga.fichero} desde ${desde}`);

        tarea = ReactNativeBlobUtil.config({
          path: ruta,
          /*
            `overwrite: false` **añade** al fichero que ya hubiera, que es lo
            que hace que reanudar sirva de algo. Con `true` empezaría de cero.
          */
          overwrite: desde === 0,
          // El panel es HTTP y a veces tarda en contestar la primera cabecera.
          timeout: 60_000,
        }).fetch('GET', descarga.url, desde > 0 ? { Range: `bytes=${desde}-` } : {});

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
          alAvanzar(desde + hechos, cuanto > 0 ? desde + cuanto : null);
        });

        tarea
          .then(async (respuesta) => {
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
        tarea?.cancel();
      };
    },
  };
}
