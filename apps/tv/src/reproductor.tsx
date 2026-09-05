/**
 * Capa de reproducción sobre la biblioteca.
 *
 * En Android no hay mpv: el vídeo va por ExoPlayer, a través de
 * `react-native-video`. Lo que sí se comparte con el escritorio es de dónde
 * sale la URL —la mejor variante de calidad, según el puerto `Biblioteca`— y
 * el gesto para salir.
 *
 * Los controles se esconden solos a los pocos segundos y vuelven al tocar la
 * pantalla o mover el mando: sobre una película, un rótulo permanente estorba.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useTVEventHandler,
} from 'react-native';
import Video from 'react-native-video';
import type { VideoRef } from 'react-native-video';

import type {
  AlmacenPerfiles,
  Arbitro,
  Biblioteca,
  ClaseMedio,
  Perfil,
  Programacion,
  Reproducible,
  Uso,
} from '@m3u/ui';
import { FIN_EPISODIO, esLimiteDeConexiones, reloj, vaAnotado } from '@m3u/ui';
import { avanceDePrograma, programaActual } from '@m3u/core';
import type { Programa } from '@m3u/core';

import { hora } from './reloj';
import type { Caja } from './reloj';
import { FONDO, TINTA_SUAVE, VERDE } from './tema';

import {
  IconoAnterior,
  IconoAudio,
  IconoPausa,
  IconoPlay,
  IconoPrincipio,
  IconoSalto,
  IconoSiguiente,
  IconoSubtitulos,
} from './iconos';

/** Cuánto tarda en esconderse el rótulo si no se toca nada. */
const OCULTAR_MS = 4000;
/**
 * Cuánto salta cada pulsación con el foco en la barra de tiempo.
 *
 * Medio minuto de entrada —el salto fino, de diez segundos, se queda en el
 * círculo de reproducir— y, manteniendo pulsado, hasta cinco minutos, que
 * cruza un capítulo en cuatro pulsaciones. Los escalones son a ojo pero el
 * orden importa: el primero tiene que ser cómodo y el último, rápido.
 */
const SALTOS_LARGOS_S = [30, 60, 120, 300];

/** Cuánto puede tardar la siguiente pulsación y seguir contando como racha. */
const RACHA_MS = 500;

/**
 * A partir de cuántos segundos se anota lo visto.
 *
 * Abrir algo para ver qué es y salir no debería llenar el "seguir viendo". Es
 * el mismo mínimo que usa `vaAnotado` para decidir si merece la pena ofrecer
 * reanudar.
 */
const MINIMO_ANOTABLE_S = 30;

/** Salto de las flechas y de los botones de avance. */
const SALTO_S = 10;
/** Cada cuánto se apunta por dónde va. Escribir en cada fotograma sobra. */
const ANOTAR_CADA_MS = 10_000;

/**
 * Cuánto vídeo pide ExoPlayer antes de (re)arrancar.
 *
 * Se fija a mano para poder enseñar un porcentaje con sentido: no existe un
 * "porcentaje de descarga" del salto —el búfer se mide en segundos de vídeo,
 * no en bytes—, pero sí se puede decir cuánto falta de lo que hace falta para
 * reanudar. Cinco segundos es un término medio para un panel por HTTP: menos,
 * y se corta al primer bache; más, y cada salto se hace eterno.
 */
const BUFER_PARA_ARRANCAR_S = 5;

const BUFER = {
  minBufferMs: 15_000,
  maxBufferMs: 50_000,
  bufferForPlaybackMs: 2_500,
  bufferForPlaybackAfterRebufferMs: BUFER_PARA_ARRANCAR_S * 1000,
};

/**
 * Lo que se estaba viendo en la pantalla de la que se salió, para poder pasar
 * de una cosa a la siguiente sin volver atrás.
 *
 * Es la misma pieza para dos usos que parecían distintos: el episodio
 * siguiente dentro de una temporada y el zapeo entre canales de un grupo. En
 * los dos casos es "la lista donde estaba esto y en qué puesto".
 */
export interface Cola {
  medios: Reproducible[];
  indice: number;
}

interface Props {
  biblioteca: Biblioteca;
  medio: Reproducible;
  perfiles: AlmacenPerfiles;
  perfil: Perfil;
  cola?: Cola;
  /** Se llama al pasar al siguiente o al anterior de la cola. */
  onCambiar?: (medio: Reproducible) => void;
  /** Para poner el programa en curso donde iría la línea de tiempo. */
  programacion?: Programacion;
  /**
   * Dónde colocarse cuando no va a pantalla completa.
   *
   * Es el hueco que deja la columna de la parrilla, en coordenadas de
   * pantalla. **El componente es el mismo en los dos tamaños**: solo cambia su
   * estilo. Montarlo y desmontarlo al agrandar soltaría la conexión, y el
   * panel tarda medio minuto en volver a darla.
   */
  caja?: Caja | null;
  /**
   * Quién reparte las conexiones del panel.
   *
   * Sin él, el reproductor abre y ya está: es lo que hacía hasta ahora, y por
   * eso un 403 salía como fallo. Con él, se pide la ranura antes de abrir y se
   * espera cuando la casa está al tope.
   */
  arbitro?: Arbitro;
  /**
   * Encadenar con el siguiente al terminar.
   *
   * Es un ajuste del perfil, no del aparato: lo decide quien está viendo. Solo
   * aplica a lo que tiene cola —los capítulos de una serie—; una película no
   * encadena con nada.
   */
  continua?: boolean;
  /**
   * El mando está sobre la vista previa.
   *
   * El resalte lo dibuja el reproductor y no la columna: el vídeo va por
   * encima del hueco y taparía cualquier marco que pintase la columna debajo.
   */
  resaltado?: boolean;
  /** Pulsar sobre la vista previa la abre entera. */
  onAbrir?: () => void;
}

/**
 * Convierte el error de ExoPlayer en algo que se pueda leer en pantalla.
 *
 * Lo que llega es un objeto con la traza de Java entera: útil en el registro,
 * ilegible en un televisor. Interesa sobre todo el código HTTP, porque el 403
 * del panel es un caso esperado y no un fallo del reproductor: con el límite
 * de conexiones al tope, el servidor rechaza mientras haya otra en curso.
 */
export function mensajeDeError(fallo: unknown): string {
  const detalle = JSON.stringify(fallo ?? {});
  const codigo = /Response code: (\d{3})/.exec(detalle)?.[1];

  if (codigo === '403') {
    return 'El servidor rechazó la conexión (403). Puede ser el límite de conexiones: cierra otras reproducciones y espera unos segundos.';
  }
  if (codigo === '404') return 'El servidor no encuentra el fichero (404).';
  if (codigo) return `El servidor respondió ${codigo}.`;
  if (/UnknownHostException|ERROR_CODE_IO_NETWORK/.test(detalle)) {
    return 'No se pudo conectar con el servidor. Comprueba la red.';
  }
  if (/ERROR_CODE_DECODING|Decoder/.test(detalle)) {
    // Merece la pena decir qué códec es: el 10 bits es el caso que se repite
    // —el decodificador del aparato admite HEVC, pero solo de 8 bits— y así se
    // sabe que no es un fichero roto ni un problema de red.
    if (/video\/hevc/.test(detalle)) {
      const diezBits = /hvc1\.2|hev1\.2|Main10/.test(detalle);
      return diezBits
        ? 'Este vídeo va en HEVC de 10 bits y el aparato no sabe decodificarlo. Prueba otra calidad del mismo título.'
        : 'El aparato no puede con el HEVC de este vídeo.';
    }
    return 'El aparato no puede decodificar este vídeo o su audio.';
  }
  return 'No se pudo reproducir.';
}

interface Pista {
  indice: number;
  nombre: string;
}

/** Nombre presentable de una pista: idioma, título, o su número. */
function nombreDePista(pista: { language?: string; title?: string }, indice: number): string {
  const partes = [pista.title, pista.language].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : `Pista ${indice + 1}`;
}

export function Reproductor({
  biblioteca,
  medio,
  perfiles,
  perfil,
  cola,
  onCambiar,
  programacion,
  arbitro,
  continua = false,
  caja,
  resaltado,
  onAbrir,
}: Props) {
  /** En pequeño, dentro de la columna: sin controles y sin rótulos. */
  const compacto = Boolean(caja);
  /** En directo no hay línea de tiempo: ni duración, ni saltos, ni reanudar. */
  const enDirecto = medio.clase === 'canal';
  const video = useRef<VideoRef | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [calidad, setCalidad] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Segundos que faltan para volver a intentarlo.
   *
   * No es un error: es que las conexiones de la casa están ocupadas —por otro
   * aparato, o por lo que este mismo acaba de cerrar, que el panel tarda medio
   * minuto en soltar—. Con un mensaje de fallo, uno cierra y vuelve a entrar;
   * con una cuenta atrás, espera.
   */
  const [espera, setEspera] = useState<number | null>(null);
  /** Sube en cada reintento: es lo que rehace la petición y remonta el vídeo. */
  const [intento, setIntento] = useState(0);

  const [pausado, setPausado] = useState(false);
  const [tiempo, setTiempo] = useState(0);
  const [total, setTotal] = useState(0);
  /** Segundo hasta el que hay vídeo descargado por delante. */
  const [cargadoHasta, setCargadoHasta] = useState(0);
  /** true mientras ExoPlayer espera datos: al abrir y en cada salto. */
  const [cargando, setCargando] = useState(true);
  const [formato, setFormato] = useState<string | null>(null);

  const [audios, setAudios] = useState<Pista[]>([]);
  const [subtitulos, setSubtitulos] = useState<Pista[]>([]);
  const [audio, setAudio] = useState(0);
  // -1 es "sin subtítulos", que es como debe empezar.
  const [subtitulo, setSubtitulo] = useState(-1);
  const [panel, setPanel] = useState<'ninguno' | 'audio' | 'subtitulos'>('ninguno');
  /*
    Dónde está el mando dentro del reproductor.

    En `video`, las flechas saltan y el OK pausa, que es lo que uno espera con
    un mando delante de la tele. Bajando se entra en la fila de botones
    —principio, audio, subtítulos, siguiente—, que hasta ahora **no había
    forma de alcanzar**: con el dedo se tocan, pero un televisor no tiene dedo.
    Y con un panel de pistas abierto, el mando es suyo.
  */
  /*
    Dónde está el mando dentro del reproductor, **de arriba abajo y en el orden
    en que se ven las cosas**: la barra de tiempo, la fila de reproducir y la
    fila de ajustes.

    El foco entra en `video` —el círculo de reproducir—, que es lo que uno
    quiere tocar el 90 % de las veces. Desde ahí, arriba lleva a la barra y
    abajo a los ajustes: cada cosa donde se ve, sin recorridos que aprender.
  */
  const [zona, setZona] = useState<'creditos' | 'barra' | 'video' | 'botones' | 'pistas'>('video');
  /**
   * Cuántas veces seguidas se ha movido la barra sin soltar.
   *
   * Es lo que hace que mantener pulsado corra: cada pulsación salta un minuto,
   * y al mantener va subiendo hasta diez. Sin esto, cruzar una película de dos
   * horas serían ciento veinte pulsaciones.
   */
  const racha = useRef({ ultimo: 0, veces: 0 });

  /**
   * Cuánto salta la siguiente pulsación, según lo que se lleve pulsado.
   *
   * Un minuto de entrada y, manteniendo, hasta diez. Cada llamada cuenta como
   * una pulsación: si pasa más de medio segundo entre dos, la racha se rompe y
   * se vuelve a empezar por el escalón corto.
   */
  const saltoDeLaRacha = useCallback((): number => {
    const ahora = Date.now();
    const seguida = ahora - racha.current.ultimo < RACHA_MS;
    racha.current = { ultimo: ahora, veces: seguida ? racha.current.veces + 1 : 0 };

    // Cada cuatro pulsaciones seguidas se sube un escalón: con tres se
    // disparaba en cuanto uno dejaba el dedo puesto un instante de más.
    const escalon = Math.min(Math.floor(racha.current.veces / 4), SALTOS_LARGOS_S.length - 1);
    return SALTOS_LARGOS_S[escalon]!;
  }, []);

  const [focoBoton, setFocoBoton] = useState(0);
  const [focoPista, setFocoPista] = useState(0);

  /** Segundo por el que se quedó la última vez, si es que ya lo había visto. */
  const [reanudar, setReanudar] = useState<number | null>(null);
  const ultimaAnotacion = useRef(0);
  const [anchoBarra, setAnchoBarra] = useState(0);
  /** Lo que echan ahora en el canal, para la franja del directo. */
  const [programa, setPrograma] = useState<Programa | null>(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [visible, setVisible] = useState(true);
  const opacidad = useRef(new Animated.Value(1)).current;
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
    Qué ranura se pide. La vista previa es otra cosa que el reproductor
    entero: vale menos —se cede antes— y las dos pueden convivir si la cuenta
    tiene ranuras de sobra.
  */
  const idRanura = compacto ? 'previa' : 'reproductor';
  const usoRanura: Uso = compacto ? 'previa' : 'reproducir';

  /** Enseña los controles y programa su desaparición. */
  const despertar = useCallback(() => {
    setVisible(true);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setVisible(false), OCULTAR_MS);
  }, []);

  useEffect(() => {
    Animated.timing(opacidad, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, opacidad]);

  // Con un panel de pistas abierto o el vídeo parado, los controles se quedan.
  useEffect(() => {
    if (panel !== 'ninguno' || pausado) {
      if (temporizador.current) clearTimeout(temporizador.current);
      setVisible(true);
    } else {
      despertar();
    }
  }, [panel, pausado, despertar]);

  useEffect(() => {
    let vigente = true;
    setUrl(null);
    setError(null);
    setTiempo(0);
    setTotal(0);
    /*
      **Y el punto de reanudar, que es del capítulo que se deja.**

      Sin esto, el siguiente arrancaba por donde iba el anterior: como se
      encadena al final, el que venía empezaba en los créditos, se daba por
      terminado en el acto y cargaba el siguiente, y así hasta el infinito.
      Un capítulo al que se llega desde el anterior empieza por el principio.
    */
    setReanudar(null);

    perfiles
      .avanceDe(perfil.id, medio.clase as ClaseMedio, medio.id)
      .then((guardado) => {
        // Solo se ofrece reanudar si quedaba algo por ver.
        if (vigente && guardado && vaAnotado(guardado)) setReanudar(guardado.segundos);
      })
      .catch(() => {});

    biblioteca
      .variantes(medio.clase, medio.id)
      .then((variantes) => {
        if (!vigente) return;
        // Vienen ordenadas de mejor a peor: la primera es la que toca.
        const mejor = variantes[0];
        if (!mejor) {
          setError('Esta ficha no tiene ninguna URL asociada.');
          return;
        }
        setCalidad(mejor.calidad);

        /*
          La ranura, antes de abrir. Si no la hay, no se intenta siquiera: el
          panel contestaría 403 y el reproductor lo enseñaría como un fallo
          suyo, que es lo que confundía.
        */
        const permiso = arbitro?.pedir(idRanura, usoRanura, Date.now());
        if (permiso && !permiso.concedido) {
          setEspera(Math.max(1, Math.ceil(permiso.esperar / 1000)));
          return;
        }
        setEspera(null);
        setUrl(mejor.url);
      })
      .catch((fallo) => vigente && setError(String(fallo)));

    return () => {
      vigente = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
    // `intento` está a propósito: subirlo es lo que rehace la petición.
  }, [biblioteca, medio, intento, arbitro, idRanura, usoRanura]);

  /*
    La cuenta atrás del reintento.

    Se cuenta en la pantalla porque esperar sin saber cuánto es lo que hace que
    uno cierre la aplicación. Al llegar a cero se vuelve a pedir la ranura.
  */
  useEffect(() => {
    if (espera === null) return;
    if (espera <= 0) {
      setEspera(null);
      setIntento((antes) => antes + 1);
      return;
    }
    const reloj = setTimeout(() => setEspera((quedan) => (quedan === null ? null : quedan - 1)), 1000);
    return () => clearTimeout(reloj);
  }, [espera]);

  /*
    Al cerrar, la ranura se suelta **siempre**. Es la mitad que falla en los
    reproductores comerciales: dejan la conexión colgada y la cuenta se queda
    bloqueada hasta que el panel la caduca por su cuenta.
  */
  useEffect(() => {
    return () => arbitro?.soltar(idRanura, Date.now());
  }, [arbitro, idRanura]);

  // Qué echan en el canal, para poner el programa donde iría la duración.
  useEffect(() => {
    if (!enDirecto || !programacion) {
      setPrograma(null);
      return;
    }

    let vigente = true;
    const mirar = () => {
      const instante = new Date();
      programacion
        .deCanal(medio.id)
        .then((programas) => {
          if (!vigente) return;
          setAhora(instante);
          setPrograma(programaActual(programas, instante));
        })
        .catch(() => vigente && setPrograma(null));
    };

    mirar();
    // Cada minuto: para que la barra avance y para relevar el programa cuando
    // termine. La respuesta viene de la caché salvo que haya caducado.
    const reloj = setInterval(mirar, 60_000);
    return () => {
      vigente = false;
      clearInterval(reloj);
    };
  }, [enDirecto, programacion, medio.id]);

  /** El anterior y el siguiente de la cola, si los hay. */
  const vecino = useCallback(
    (paso: -1 | 1): Reproducible | null => {
      if (!cola) return null;
      return cola.medios[cola.indice + paso] ?? null;
    },
    [cola],
  );

  const anterior = vecino(-1);
  const siguiente = vecino(1);

  /*
    Los créditos, sin más dato que la duración.

    No hay quien nos diga dónde empiezan de verdad —el panel no marca
    segmentos y los ficheros habría que analizarlos—, así que se toma el mismo
    umbral con el que se da un capítulo por visto: a partir de ahí, lo que
    queda son títulos. En un capítulo de 50 minutos son los últimos dos y
    medio, y el error es siempre por defecto: el botón aparece un poco tarde,
    nunca en mitad de la escena.

    Solo con algo detrás que poner: sin siguiente no hay botón que ofrecer.
  */
  const enCreditos = !enDirecto && Boolean(siguiente) && total > 0 && tiempo >= total * FIN_EPISODIO;

  const saltar = useCallback(
    (segundos: number) => {
      const destino = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, tiempo + segundos));
      video.current?.seek(destino);
      setTiempo(destino);
      // Saltar vacía el búfer: hay que volver a descargar desde ese punto.
      setCargadoHasta(destino);
      setCargando(true);
      despertar();
    },
    [despertar, tiempo, total],
  );

  /*
    La fila de abajo, armada como datos y no como JSX suelto.

    Es lo que permite que el mando la recorra: para saber cuál está enfocado y
    activarlo desde el manejador de teclas hace falta una lista, no una
    sucesión de etiquetas.
  */
  const secundarios: Array<{
    clave: string;
    etiqueta: string;
    activo?: boolean;
    onPress: () => void;
    onLongPress?: () => void;
  }> = [
    ...(enDirecto
      ? []
      : [
          {
            clave: 'principio',
            etiqueta: 'Desde el principio',
            onPress: () => saltar(-tiempo),
          },
        ]),
    ...(audios.length > 1
      ? [
          {
            clave: 'audio',
            etiqueta: 'Audio',
            activo: panel === 'audio',
            onPress: () => setPanel((abierto) => (abierto === 'audio' ? 'ninguno' : 'audio')),
          },
        ]
      : []),
    ...(subtitulos.length > 0
      ? [
          {
            clave: 'subtitulos',
            etiqueta: 'Subtítulos',
            activo: panel === 'subtitulos' || subtitulo >= 0,
            onPress: () => setPanel((abierto) => (abierto === 'subtitulos' ? 'ninguno' : 'subtitulos')),
          },
        ]
      : []),
    ...(!enDirecto && siguiente
      ? [{ clave: 'siguiente', etiqueta: 'Siguiente', onPress: () => onCambiar?.(siguiente) }]
      : []),
  ];

  /** Las pistas del panel abierto, para poder recorrerlas con el mando. */
  const pistas: Array<{ etiqueta: string; onPress: () => void }> =
    panel === 'ninguno'
      ? []
      : [
          ...(panel === 'subtitulos'
            ? [
                {
                  etiqueta: 'Sin subtítulos',
                  onPress: () => {
                    setSubtitulo(-1);
                    setPanel('ninguno');
                    setZona('botones');
                  },
                },
              ]
            : []),
          ...(panel === 'audio' ? audios : subtitulos).map((pista) => ({
            etiqueta: pista.nombre,
            onPress: () => {
              if (panel === 'audio') setAudio(pista.indice);
              else setSubtitulo(pista.indice);
              setPanel('ninguno');
              setZona('botones');
            },
          })),
        ];

  /*
    Al cerrarse los controles el mando vuelve al vídeo —si no, al despertarlos
    el foco seguiría en un botón que ya no se recuerda dónde estaba—, salvo
    durante los créditos: ahí lo que hay en pantalla es el aviso del siguiente
    capítulo, así que **el foco es suyo** y basta con pulsar OK.
  */
  useEffect(() => {
    if (!visible) {
      setZona(enCreditos ? 'creditos' : 'video');
      setPanel('ninguno');
    }
  }, [visible, enCreditos]);

  // Un panel de pistas que se abre se lleva el foco: es lo que se acaba de
  // pedir, y sin esto habría que bajar otra vez a ciegas.
  useEffect(() => {
    if (panel !== 'ninguno') {
      setZona('pistas');
      setFocoPista(0);
    }
  }, [panel]);

  /*
    "Atrás" cierra primero lo que esté abierto **dentro** del reproductor.

    Estando en la fila de botones o en las pistas, atrás salía del vídeo y
    devolvía a la serie, que es dos pantallas de más: lo que uno quiere cerrar
    es el menú que tiene delante. El manejador de la aplicación sigue detrás
    para cuando no hay nada abierto, y por eso este devuelve `false` entonces:
    Android va llamando a los manejadores del último registrado al primero
    hasta que uno diga que sí.
  */
  useEffect(() => {
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      if (compacto) return false;

      // Primero las pistas, que es lo último que se abrió.
      if (panel !== 'ninguno') {
        setPanel('ninguno');
        setZona('botones');
        return true;
      }
      /*
        Y con los controles puestos, atrás **los esconde**: da igual en qué
        botón esté el foco. Solo cuando ya no hay nada delante, el segundo
        atrás sale del vídeo, que es lo que uno espera de un mando.
      */
      if (visible) {
        if (temporizador.current) clearTimeout(temporizador.current);
        setVisible(false);
        setZona(enCreditos ? 'creditos' : 'video');
        return true;
      }
      return false;
    });
    return () => suscripcion.remove();
  }, [compacto, panel, visible, enCreditos]);

  useTVEventHandler((evento) => {
    // En pequeño manda la lista de canales, no el reproductor.
    if (compacto) return;
    /*
      Los créditos, con los controles escondidos: en pantalla solo está el
      aviso del siguiente capítulo, así que el OK lo activa directamente. Bajar
      saca los controles de siempre, que es lo que uno hace si lo que quería
      era otra cosa.
    */
    if (zona === 'creditos' && !visible) {
      if (evento.eventType === 'select') {
        if (siguiente) onCambiar?.(siguiente);
        return;
      }
      // Cualquier otra tecla saca los controles, y el foco pasa al vídeo.
      setZona('video');
      despertar();
      return;
    }

    despertar();

    // Con las pistas abiertas, el mando es suyo hasta que se elija una.
    if (zona === 'pistas') {
      switch (evento.eventType) {
        case 'left':
          setFocoPista((actual) => Math.max(0, actual - 1));
          return;
        case 'right':
          setFocoPista((actual) => Math.min(pistas.length - 1, actual + 1));
          return;
        case 'select':
          pistas[focoPista]?.onPress();
          return;
        case 'up':
        case 'down':
          setPanel('ninguno');
          setZona('botones');
          return;
        default:
          return;
      }
    }

    /*
      La barra de tiempo, que está **encima** de los botones: se sube a ella y
      se baja de vuelta. Aquí las flechas mueven de medio minuto en adelante y
      van corriendo si se mantiene pulsado; los diez segundos finos se quedan
      abajo, en el círculo de reproducir.
    */
    if (zona === 'barra') {
      switch (evento.eventType) {
        case 'left':
        case 'right': {
          const salto = saltoDeLaRacha();
          saltar(evento.eventType === 'left' ? -salto : salto);
          return;
        }
        case 'down':
          setZona('video');
          return;
        // El OK pausa, que es lo que uno espera con la barra delante.
        case 'select':
          setPausado((estaba) => !estaba);
          return;
        default:
          return;
      }
    }

    if (zona === 'botones') {
      // Mantener pulsado sobre un botón hace lo suyo, si es que hace algo:
      // hoy solo el de saltar la intro, que así se puede desmarcar.
      if (evento.eventType === 'longSelect') {
        secundarios[focoBoton]?.onLongPress?.();
        return;
      }
      switch (evento.eventType) {
        case 'left':
          setFocoBoton((actual) => Math.max(0, actual - 1));
          return;
        case 'right':
          setFocoBoton((actual) => Math.min(secundarios.length - 1, actual + 1));
          return;
        case 'select':
          secundarios[focoBoton]?.onPress();
          return;
        // Subiendo se vuelve al vídeo, que es la otra parada.
        case 'up':
          setZona('video');
          return;
        default:
          return;
      }
    }

    switch (evento.eventType) {
      /*
        Con el foco en reproducir, las flechas saltan **diez segundos**: es el
        salto fino, el de volver a oír una frase. Los saltos largos están en la
        barra, que se alcanza subiendo.

        En directo no hay a dónde saltar —el flujo no empieza ni acaba—, así
        que ahí las flechas cambian de canal.
      */
      case 'left':
      case 'right': {
        if (enDirecto) {
          const destino = evento.eventType === 'left' ? anterior : siguiente;
          if (destino) onCambiar?.(destino);
          break;
        }
        saltar(evento.eventType === 'left' ? -SALTO_S : SALTO_S);
        break;
      }
      case 'select':
        // Si los controles estaban escondidos, el primer OK solo los enseña.
        if (visible) setPausado((estaba) => !estaba);
        break;
      /*
        Bajando se entra en la fila de botones. Es el recorrido de cualquier
        televisor —flechas para saltar, abajo para los ajustes del vídeo— y es
        lo que faltaba para poder cambiar el audio o los subtítulos sin dedo.
      */
      case 'down':
        if (!visible) break;
        if (secundarios.length > 0) {
          setZona('botones');
          setFocoBoton((actual) => Math.min(actual, secundarios.length - 1));
        }
        break;
      /*
        Y arriba, la barra de tiempo, que es lo que hay justo encima. En
        directo no existe: no hay línea de tiempo que mover.
      */
      case 'up':
        if (visible && !enDirecto) setZona('barra');
        break;
    }
  });

  const avance = total > 0 ? Math.min(1, tiempo / total) : 0;
  const cargado = total > 0 ? Math.min(1, cargadoHasta / total) : 0;
  /** Segundos ya descargados por delante del punto actual. */
  const colchon = Math.max(0, cargadoHasta - tiempo);
  /** Lo que lleva del búfer que necesita para arrancar, en tanto por ciento. */
  const porcentajeBufer = Math.min(100, Math.round((colchon / BUFER_PARA_ARRANCAR_S) * 100));

  return (
    <View
      style={
        caja
          ? [
              estilos.capaCompacta,
              { left: caja.x, top: caja.y, width: caja.width, height: caja.height },
              resaltado && estilos.capaCompactaEnfocada,
            ]
          : estilos.capa
      }
    >
      {url ? (
        <Video
          key={intento}
          ref={video}
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          paused={pausado}
          bufferConfig={BUFER}
          progressUpdateInterval={500}
          selectedAudioTrack={{ type: 'index', value: audio }}
          selectedTextTrack={subtitulo >= 0 ? { type: 'index', value: subtitulo } : { type: 'disabled' }}
          onBuffer={({ isBuffering }) => setCargando(isBuffering)}
          onReadyForDisplay={() => setCargando(false)}
          onProgress={({ currentTime, playableDuration, seekableDuration }) => {
            setTiempo(currentTime);
            setCargadoHasta(currentTime + (playableDuration ?? 0));
            if (seekableDuration && !total) setTotal(seekableDuration);

            const ahora = Date.now();
            if (ahora - ultimaAnotacion.current < ANOTAR_CADA_MS) return;
            ultimaAnotacion.current = ahora;

            const anotacion = {
              clase: medio.clase as ClaseMedio,
              itemId: medio.id,
              titulo: medio.titulo,
              segundos: currentTime,
              duracion: total || seekableDuration || 0,
              visto: new Date().toISOString(),
            };
            /*
              Se anota también lo terminado, y **esa es la diferencia**: antes
              se borraba al pasar del umbral, con la idea de que no reapareciera
              en "seguir viendo". Pero sin esa fila no hay de dónde sacar que el
              capítulo se acabó, así que el siguiente no relevaba y la serie
              desaparecía de la fila en vez de avanzar.

              Ahora la fila se queda diciendo "esto está visto" y es la fila
              quien decide: una película vista se cae, un capítulo visto da paso
              al siguiente.

              Lo que sigue sin anotarse son los primeros segundos: abrir algo
              para ver qué es no debería llenar el historial.
            */
            if (anotacion.segundos >= MINIMO_ANOTABLE_S) {
              perfiles.anotarAvance(perfil.id, anotacion).catch(() => {});
            }
          }}
          onLoad={(datos) => {
            setTotal(datos.duration ?? 0);
            setFormato(
              [datos.naturalSize?.width, datos.naturalSize?.height].every(Boolean)
                ? `${datos.naturalSize?.width}x${datos.naturalSize?.height}`
                : null,
            );
            setAudios(
              (datos.audioTracks ?? []).map((pista, indice) => ({
                indice,
                nombre: nombreDePista(pista, indice),
              })),
            );
            setSubtitulos(
              (datos.textTracks ?? []).map((pista, indice) => ({
                indice,
                nombre: nombreDePista(pista, indice),
              })),
            );
            // Se retoma donde se dejó, que es de lo que sirve el historial.
            if (reanudar !== null && reanudar > 0) {
              video.current?.seek(reanudar);
              setTiempo(reanudar);
            }
            despertar();
          }}
          // Con un MKV por HTTP, las pistas a veces se conocen después de
          // empezar: estos avisos las traen cuando aparecen.
          onAudioTracks={({ audioTracks }) =>
            setAudios(
              (audioTracks ?? []).map((pista, indice) => ({ indice, nombre: nombreDePista(pista, indice) })),
            )
          }
          onTextTracks={({ textTracks }) =>
            setSubtitulos(
              (textTracks ?? []).map((pista, indice) => ({ indice, nombre: nombreDePista(pista, indice) })),
            )
          }
          /*
            Al terminar, el siguiente si así lo quiere el perfil.

            Solo con cola y solo hacia delante: en directo no hay final, y una
            película no encadena con nada.
          */
          onEnd={() => {
            if (continua && !enDirecto && siguiente) onCambiar?.(siguiente);
          }}
          onError={(fallo) => {
            // El detalle completo, al registro: se lee con `adb logcat`.
            console.warn('[reproductor]', JSON.stringify(fallo));

            /*
              El 403 del panel no es un fallo del vídeo: es que las conexiones
              de la casa están ocupadas. Se suelta lo que creíamos tener y se
              espera, en vez de dejar la pantalla en negro con un aviso.
            */
            if (arbitro && esLimiteDeConexiones(fallo)) {
              const ms = arbitro.rechazado(idRanura, Date.now());
              setUrl(null);
              setEspera(Math.max(1, Math.ceil(ms / 1000)));
              return;
            }
            setError(mensajeDeError(fallo));
          }}
        />
      ) : null}

      {!url && !error && espera === null ? <ActivityIndicator size="large" color={VERDE} /> : null}

      {/*
        Esperando ranura. Se dice **por qué** y **cuánto**: sin las dos cosas
        esto es indistinguible de un cuelgue.
      */}
      {espera !== null ? (
        <View style={[estilos.fallo, compacto && estilos.falloCompacto]} pointerEvents="none">
          {compacto ? null : <Text style={estilos.falloTitulo}>{medio.titulo}</Text>}
          <Text
            style={[estilos.falloTexto, compacto && estilos.falloTextoCompacto]}
            numberOfLines={compacto ? 3 : undefined}
          >
            Las conexiones de la lista están ocupadas. Reintentando en {espera} s…
          </Text>
          {compacto ? null : (
            <Text style={estilos.falloPie}>Se abrirá sola en cuanto quede una libre</Text>
          )}
        </View>
      ) : null}

      {/*
        El fallo, en su propia capa y sin desvanecerse.
        Estaba dentro de los controles, que se esconden a los cuatro segundos:
        lo que quedaba era una pantalla negra sin explicación, imposible de
        distinguir de un cuelgue. Ahora se queda hasta que se pulse atrás.
      */}
      {error ? (
        // En la vista previa no cabe el aviso entero, y tampoco hace falta: el
        // canal está ahí al lado con su nombre y su parrilla.
        <View style={[estilos.fallo, compacto && estilos.falloCompacto]} pointerEvents="none">
          {compacto ? null : <Text style={estilos.falloTitulo}>{medio.titulo}</Text>}
          <Text
            style={[estilos.falloTexto, compacto && estilos.falloTextoCompacto]}
            numberOfLines={compacto ? 3 : undefined}
          >
            {error}
          </Text>
          {compacto ? null : <Text style={estilos.falloPie}>Pulsa atrás para volver</Text>}
        </View>
      ) : null}

      {/* Al abrir y en cada salto hay que esperar a que baje el trozo nuevo. */}
      {url && cargando && !error ? (
        <View style={[estilos.cargandoCaja, compacto && estilos.cargandoCajaCompacta]}>
          <ActivityIndicator size={compacto ? 'small' : 'large'} color={VERDE} />
          {/*
            El porcentaje solo cuando de verdad hay algo que contar.
            ExoPlayer no siempre informa de cuánto vídeo lleva por delante —en
            el directo por TS y en los MKV progresivos no lo hace nunca—, y
            entonces se quedaba un "0 %" clavado que parecía que no avanzaba,
            hasta que de golpe empezaba la película.
          */}
          {compacto ? null : (
            <Text style={estilos.cargandoTexto}>
              {colchon > 0 ? `Cargando… ${porcentajeBufer}%` : 'Cargando…'}
            </Text>
          )}
          {colchon > 0 && !compacto ? (
            <Text style={estilos.cargandoPie}>{Math.round(colchon)} s de vídeo listos</Text>
          ) : null}
        </View>
      ) : null}

      {/* En pequeño, tocar abre el vídeo entero; en grande, enseña o esconde
          los controles. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole={compacto ? 'button' : undefined}
        accessibilityLabel={compacto ? 'Ver a pantalla completa' : undefined}
        onPress={() => {
          if (compacto) {
            onAbrir?.();
            return;
          }
          if (visible) setVisible(false);
          else despertar();
        }}
      />

      {/*
        El aviso de los créditos vive **fuera de los controles**: aparece solo,
        abajo a la derecha y ya enfocado, así que basta con pulsar OK. Meterlo
        en la fila de botones obligaba a sacar los controles y bajar dos veces
        para hacer lo único que uno quiere hacer en ese momento.
      */}
      {enCreditos && siguiente ? (
        <Pressable
          focusable={false}
          style={[estilos.creditos, zona === 'creditos' && !visible && estilos.creditosEnfocado]}
          onPress={() => onCambiar?.(siguiente)}
        >
          <Text style={estilos.creditosTexto}>Siguiente capítulo  ›</Text>
        </Pressable>
      ) : null}

      {compacto ? null : (
      <Animated.View style={[estilos.controles, { opacity: opacidad }]} pointerEvents={visible ? 'auto' : 'none'}>
        {/* Sombra de abajo arriba, en capas: da contraste a los iconos sin
            plantar una caja negra encima del vídeo. */}
        <View style={estilos.velo1} pointerEvents="none" />
        <View style={estilos.velo2} pointerEvents="none" />
        <View style={estilos.velo3} pointerEvents="none" />

        <View style={estilos.contenido}>
          <Text style={estilos.titulo} numberOfLines={1}>
            {medio.titulo}
          </Text>
          {enDirecto && programa ? (
            <Text style={estilos.programa} numberOfLines={1}>
              {programa.titulo}
            </Text>
          ) : null}
          {/* En directo no hay línea de tiempo que valga: el flujo no empieza
              ni acaba, y una barra a 0:00 con saltos de diez segundos es un
              control que no hace nada. En su lugar va el programa: cuándo
              empezó, qué es y cuándo acaba. */}
          {enDirecto ? (
            programa ? (
              <View style={estilos.lineaTiempo}>
                <Text style={estilos.tiempo}>{hora(programa.desde)}</Text>
                <View style={estilos.barra}>
                  <View style={estilos.riel} />
                  <View
                    style={[estilos.progreso, { width: `${avanceDePrograma(programa, ahora) * 100}%` }]}
                  />
                </View>
                <Text style={estilos.tiempo}>{hora(programa.hasta)}</Text>
              </View>
            ) : null
          ) : (
          <View style={estilos.lineaTiempo}>
            <Text style={estilos.tiempo}>{reloj(tiempo)}</Text>

            <Pressable
              focusable={false}
              style={estilos.barra}
              onLayout={(evento) => setAnchoBarra(evento.nativeEvent.layout.width)}
              onPress={(evento) => {
                if (!total || !anchoBarra) return;
                const proporcion = evento.nativeEvent.locationX / anchoBarra;
                const destino = Math.max(0, Math.min(total, total * proporcion));
                video.current?.seek(destino);
                setTiempo(destino);
                setCargadoHasta(destino);
                setCargando(true);
                despertar();
              }}
            >
              <View style={estilos.riel} />
              {/* Lo descargado por delante: se ve cuánto margen hay. */}
              <View style={[estilos.cargado, { width: `${cargado * 100}%` }]} />
              <View style={[estilos.progreso, { width: `${avance * 100}%` }]} />
              <View
                style={[
                  estilos.punto,
                  // Solo cuando el foco está en la barra: si se marcaran las
                  // dos cosas a la vez, no se sabría cuál mueven las flechas.
                  zona === 'barra' && estilos.puntoEnfocado,
                  { left: `${avance * 100}%` },
                ]}
              />
            </Pressable>

            <Text style={estilos.tiempo}>{total ? reloj(total) : '--:--'}</Text>
          </View>
          )}

          <View style={estilos.mandos}>
            {enDirecto ? (
              // Con el directo, los mandos laterales zapean por el grupo.
              <Icono
                etiqueta="Canal anterior"
                apagado={!anterior}
                onPress={() => anterior && onCambiar?.(anterior)}
              >
                <IconoAnterior />
              </Icono>
            ) : (
              <Icono etiqueta={`Retroceder ${SALTO_S} segundos`} pie={String(SALTO_S)} onPress={() => saltar(-SALTO_S)}>
                <IconoSalto hacia="izquierda" />
              </Icono>
            )}

            {/*
              Con el mando en el vídeo, el foco se enseña aquí: es donde está
              de verdad —las flechas saltan y el OK pausa— y sin marcarlo uno
              no sabe dónde ha quedado al subir desde los botones.
            */}
            <Icono
              etiqueta={pausado ? 'Reproducir' : 'Pausa'}
              principal
              enfocado={zona === 'video'}
              onPress={() => setPausado((estaba) => !estaba)}
            >
              {pausado ? <IconoPlay /> : <IconoPausa />}
            </Icono>

            {enDirecto ? (
              <Icono
                etiqueta="Canal siguiente"
                apagado={!siguiente}
                onPress={() => siguiente && onCambiar?.(siguiente)}
              >
                <IconoSiguiente />
              </Icono>
            ) : (
              <Icono etiqueta={`Avanzar ${SALTO_S} segundos`} pie={String(SALTO_S)} onPress={() => saltar(SALTO_S)}>
                <IconoSalto hacia="derecha" />
              </Icono>
            )}
          </View>

          <View style={estilos.secundarios}>
            {secundarios.map((boton, indice) => {
              const enfocado = zona === 'botones' && focoBoton === indice;
              const marcado = Boolean(boton.activo);

              return (
                <Icono
                  key={boton.clave}
                  etiqueta={boton.etiqueta}
                  activo={marcado}
                  enfocado={enfocado}
                  apagado={boton.clave === 'principio' && tiempo < 5}
                  onPress={boton.onPress}
                >
                  {boton.clave === 'principio' ? <IconoPrincipio /> : null}
                  {boton.clave === 'audio' ? <IconoAudio color={marcado ? VERDE : undefined} /> : null}
                  {boton.clave === 'subtitulos' ? (
                    <IconoSubtitulos color={marcado ? VERDE : undefined} />
                  ) : null}
                  {boton.clave === 'siguiente' ? <IconoSiguiente /> : null}
                </Icono>
              );
            })}
          </View>

          {pistas.length > 0 ? (
            <ScrollView style={estilos.pistas} horizontal showsHorizontalScrollIndicator={false}>
              {pistas.map((pista, indice) => {
                // Cuál está puesta ahora mismo, para marcarla.
                const puesta =
                  panel === 'audio'
                    ? audios[indice]?.indice === audio
                    : indice === 0
                      ? subtitulo === -1
                      : subtitulos[indice - 1]?.indice === subtitulo;
                return (
                  <Pastilla
                    key={pista.etiqueta}
                    texto={pista.etiqueta}
                    activo={puesta}
                    enfocada={zona === 'pistas' && focoPista === indice}
                    onPress={pista.onPress}
                  />
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      </Animated.View>
      )}
    </View>
  );
}

/**
 * Icono plano sobre el vídeo.
 *
 * Sin caja ni fondo: la sombra del velo ya da contraste, y una fila de botones
 * opacos encima de la imagen queda de aparato viejo. Solo el de reproducir
 * lleva círculo, para que se distinga del resto de un vistazo.
 */
function Icono({
  children,
  pie,
  etiqueta,
  onPress,
  principal,
  activo,
  enfocado,
  apagado,
}: {
  children: React.ReactNode;
  pie?: string;
  /** Para quien navegue con lector de pantalla: los dibujos no se leen. */
  etiqueta: string;
  onPress: () => void;
  principal?: boolean;
  activo?: boolean;
  /**
   * Enfocado **por el mando**, que no es el foco del sistema.
   *
   * En esta pantalla el recorrido lo lleva la aplicación —igual que en la
   * biblioteca— porque si además lo llevara Android, cada OK contaría dos
   * veces.
   */
  enfocado?: boolean;
  /** Sin destino: se deja a la vista pero atenuado, para que no baile la fila. */
  apagado?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      /*
        El foco del sistema no entra aquí, igual que en la biblioteca: en esta
        pantalla el recorrido lo lleva la aplicación, y si Android además le
        entregara el OK al botón enfocado, la pulsación no llegaría nunca al
        manejador de teclas. Era justo lo que pasaba: con el mando se podía
        llegar a los botones pero no activarlos.
      */
      focusable={false}
      disabled={apagado}
      style={({ focused, pressed }) => [
        estilos.icono,
        principal && estilos.iconoPrincipal,
        apagado && estilos.iconoApagado,
        (focused || pressed || enfocado) &&
          !apagado &&
          (principal ? estilos.iconoPrincipalEnfocado : estilos.iconoEnfocado),
      ]}
      onPress={onPress}
    >
      {children}
      {/* El "10" de los saltos, en pequeño bajo la flecha. */}
      {pie ? <Text style={estilos.pieSimbolo}>{pie}</Text> : null}
    </Pressable>
  );
}

/** Opción de una lista de pistas: aquí sí hay que leer el idioma. */
function Pastilla({
  texto,
  onPress,
  onLongPress,
  activo,
  enfocada,
}: {
  texto: string;
  onPress: () => void;
  /** Mantener pulsado, cuando el botón tenga algo que deshacer. */
  onLongPress?: () => void;
  activo?: boolean;
  /** Enfocada por el mando; con el dedo manda el foco del sistema. */
  enfocada?: boolean;
}) {
  return (
    <Pressable
      focusable={false}
      onLongPress={onLongPress}
      style={({ focused, pressed }) => [
        estilos.pastilla,
        activo && estilos.pastillaActiva,
        (focused || pressed || enfocada) && estilos.pastillaEnfocada,
      ]}
      onPress={onPress}
    >
      <Text style={[estilos.pastillaTexto, activo && estilos.pastillaTextoActivo]}>{texto}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  capa: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  // La vista previa: el mismo reproductor, colocado sobre el hueco que deja la
  // columna de la parrilla.
  capaCompacta: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
  },
  capaCompactaEnfocada: {
    borderColor: VERDE,
  },
  controles: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  // Tres capas de negro con opacidad creciente: imita un degradado sin
  // depender de ninguna librería.
  velo1: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    height: 60,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  velo2: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    bottom: 120,
    height: 120,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  velo3: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    bottom: 0,
    height: 120,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  contenido: {
    paddingBottom: 28,
    paddingHorizontal: 40,
    paddingTop: 40,
  },
  titulo: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  lineaTiempo: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  tiempo: {
    color: '#fff',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    // Ancho fijo: sin esto la barra se encoge y se estira con cada segundo.
    width: 64,
  },
  barra: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  riel: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 2,
    height: 4,
    width: '100%',
  },
  cargado: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 2,
    height: 4,
    position: 'absolute',
  },
  progreso: {
    backgroundColor: VERDE,
    borderRadius: 2,
    height: 4,
    position: 'absolute',
  },
  punto: {
    backgroundColor: VERDE,
    borderRadius: 8,
    height: 16,
    marginLeft: -8,
    position: 'absolute',
    width: 16,
  },
  mandos: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 40,
    marginTop: 10,
  },
  secundarios: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 28,
    marginTop: 2,
  },
  icono: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  /*
    Lo enfocado con el mando tiene que cantar desde el sofá, y el 18 % de
    blanco que había antes se pierde sobre un fotograma claro. Va el verde de
    la marca, que es como se marca el foco en el resto de la aplicación, sobre
    un fondo oscuro que garantiza el contraste sea cual sea la imagen.
  */
  iconoEnfocado: {
    backgroundColor: 'rgba(11,11,12,0.72)',
    borderColor: VERDE,
    borderWidth: 2,
  },
  // El de reproducir es el único con círculo, y translúcido: un botón opaco
  // encima de la imagen es lo que hacía que esto pareciera un aparato viejo.
  /*
    El de reproducir es el único con círculo, y translúcido. **Su borde es muy
    tenue a propósito**: con uno más marcado parecía que estaba enfocado
    siempre, y entonces el verde de abajo se leía como otra cosa. En esta
    pantalla el foco es una sola cosa —el aro verde— y todo lo demás es
    decoración.
  */
  iconoPrincipal: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 36,
    borderWidth: 1.5,
    height: 72,
    width: 72,
  },
  iconoPrincipalEnfocado: {
    backgroundColor: 'rgba(11,11,12,0.72)',
    borderColor: VERDE,
    borderWidth: 2,
    transform: [{ scale: 1.06 }],
  },
  // Un mando sin destino no se quita: se atenúa, o la fila baila al llegar al
  // primer o al último canal.
  iconoApagado: {
    opacity: 0.3,
  },
  pieSimbolo: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: -4,
  },
  programa: {
    color: '#c8d6e0',
    fontSize: 16,
    marginTop: 2,
  },
  fallo: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(6,19,28,0.92)',
    borderColor: 'rgba(240,67,58,0.5)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    maxWidth: 640,
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  falloCompacto: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  falloTextoCompacto: {
    fontSize: 14,
  },
  falloTitulo: {
    color: TINTA_SUAVE,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  falloTexto: {
    color: '#f0a24a',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  falloPie: {
    color: '#7f95a6',
    fontSize: 14,
  },
  /* El aviso de créditos, abajo a la derecha, como en cualquier servicio. */
  creditos: {
    alignItems: 'center',
    backgroundColor: 'rgba(11,11,12,0.82)',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    bottom: 60,
    paddingHorizontal: 22,
    paddingVertical: 14,
    position: 'absolute',
    right: 60,
  },
  // El mismo aro verde que en el resto: aquí es donde está el mando.
  creditosEnfocado: {
    borderColor: VERDE,
    transform: [{ scale: 1.04 }],
  },
  creditosTexto: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  /*
    La barra enfocada: **solo el punto se marca**, con un borde blanco.
    Engordar la barra entera con `scaleY` deformaba el punto en una elipse,
    que es lo que se veía raro: la escala se aplica a los hijos.
  */
  puntoEnfocado: {
    borderColor: '#fff',
    borderWidth: 3,
  },
  pistas: {
    alignSelf: 'center',
    marginTop: 10,
    maxHeight: 56,
  },
  pastilla: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'transparent',
    borderRadius: 20,
    borderWidth: 2,
    marginRight: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  /*
    Lo puesto ahora mismo —la pista de audio que suena— se marca con **el
    texto en verde**, no con el fondo: el fondo verde se leía como "esto es lo
    que tienes enfocado", que es lo que dice el aro, y con las dos cosas a la
    vez no había manera de saber dónde estaba el mando.
  */
  pastillaActiva: {
    backgroundColor: 'rgba(53,208,127,0.16)',
  },
  pastillaEnfocada: {
    backgroundColor: 'rgba(11,11,12,0.72)',
    borderColor: VERDE,
    transform: [{ scale: 1.04 }],
  },
  pastillaTexto: {
    color: '#fff',
    fontSize: 15,
  },
  pastillaTextoActivo: {
    color: VERDE,
    fontWeight: '700',
  },
  // En la vista previa solo la ruedecita: la caja entera taparía el recuadro.
  cargandoCajaCompacta: {
    backgroundColor: 'transparent',
    padding: 0,
  },
  cargandoCaja: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 16,
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 24,
    position: 'absolute',
  },
  cargandoTexto: {
    color: '#fff',
    fontSize: 20,
  },
  cargandoPie: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  error: {
    color: '#ff8080',
    fontSize: 15,
    marginTop: 6,
  },
});
