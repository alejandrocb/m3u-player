/**
 * Interfaz para Android: televisor con mando y tablet con el dedo.
 *
 * El arranque no es la biblioteca sino las listas dadas de alta. Al conectar
 * con una, la sesión queda guardada y los arranques siguientes entran directos
 * a su biblioteca, hasta que se cierre sesión.
 *
 * Toda la lógica —navegación, foco, paginación, cuentas— vive en `@m3u/ui` y
 * se comparte con la app de escritorio. Aquí solo se dibuja el estado y se
 * traducen las dos formas de manejarlo: las teclas del mando y el toque.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useTVEventHandler,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MandoDeTele,
  avanceDePrograma,
  tipoDeVideo,
  leerClaveDeEpisodio,
  loQueUnaTeleNoSabe,
  nombreDeCodec,
  programaActual,
  qualityRank,
} from '@m3u/core';
import type { Programa, Situacion, Tele } from '@m3u/core';
import type {
  Ajustes,
  AlmacenPerfiles,
  Marcable,
  Biblioteca,
  Cuenta,
  Descarga,
  Elemento,
  EstadoPantalla,
  Ficha as FichaDetalle,
  Marcha,
  FilaInicio,
  Formato,
  FormatoFila,
  Inicio,
  OpcionLateral,
  Perfil,
  Preparado,
  Programacion,
  Reproducible,
} from '@m3u/ui';
import {
  AJUSTES_POR_DEFECTO,
  COLUMNAS_POSIBLES,
  ClienteSync,
  GestorCuentas,
  Arbitro,
  ColaDeDescargas,
  MODOS_INICIO,
  TOPE_DE_MANO,
  claveDeDescarga,
  ficheroDe,
  urlSinCredenciales,
  varianteParaDescargar,
  canalDeElemento,
  medioDeElemento,
  elementosDeFila,
  Presentador,
  cantidad,
  mediasEstrellas,
  nota,
  numero,
} from '@m3u/ui';

import { almacenDeCuentas } from './src/almacen';
import { borrarFichero, espacio, rutaDe, transferenciaDeAndroid } from './src/descargas-base';
import { avisarDeLasDescargas } from './src/aviso-descarga';
import { buscarTeles, cerrarPuente, direccionParaLaTele, mirarElFichero, pedirALaTele } from './src/teles';
import {
  ESCALA_ENFOQUE,
  FONDO,
  FONDO_RGB,
  MARGEN_CABECERA,
  MARGEN_PANTALLA,
  ROJO,
  SUPERFICIE,
  TINTA,
  TINTA_SUAVE,
  TINTA_TENUE,
  VERDE,
} from './src/tema';
import { almacenDeSync } from './src/almacen-sync';
import { IconoPausa, IconoPlay, IconoSalto } from './src/iconos';
import { cargarCatalogo } from './src/carga';
import type { Avance, Medicion } from './src/carga';
import { PantallaEmparejar } from './src/pantalla-emparejar';
import { PantallaListas } from './src/listas';
import { PantallaPerfiles } from './src/pantalla-perfiles';
import { hora } from './src/reloj';
import { Retrato } from './src/retrato';
import { Reproductor } from './src/reproductor';
import type { Cola } from './src/reproductor';

/** Margen para que un segundo "atrás" cierre la app, como en Android. */
const MARGEN_SALIDA_MS = 3000;

/**
 * Lo que se espera antes de pedirle al panel la parrilla del canal enfocado.
 *
 * El foco se mueve más rápido de lo que responde el panel: sin esto, recorrer
 * una fila de canales sería una petición por pulsación. Con la parrilla del
 * servidor puesta no hace falta —eso sale de memoria—, pero el respaldo sigue
 * siendo el panel.
 */
const ESPERA_EPG_MS = 350;

/** Cada cuánto se repinta la parrilla, para que la barra avance sola. */
const RELOJ_EPG_MS = 30_000;

/**
 * Cuánto se espera con el foco quieto antes de arrancar la vista previa.
 *
 * Con una sola conexión, previsualizar en cada movimiento del foco dejaría la
 * ranura ocupada y el panel devolviendo 403 el resto del rato.
 */
const ESPERA_VISTA_PREVIA_MS = 1000;

/**
 * En un televisor, las listas no se desplazan solas.
 *
 * Android TV, al recibir una flecha, desplaza por su cuenta cualquier lista
 * que tenga debajo del foco. Como aquí el recorrido lo lleva la aplicación
 * —y luego coloca la lista con `scrollToIndex`—, se movían las dos cosas: un
 * salto del sistema y, un instante después, el resaltado. Se notaba como
 * "primero hace scroll y luego se mueve el foco".
 *
 * Con el dedo sí tiene que desplazarse, claro, así que solo se corta en la
 * tele.
 */
const DESPLAZA_EL_DEDO = !Platform.isTV;

/** Cada cuánto se sincroniza mientras la biblioteca está abierta. */
const CADA_SINCRONIZACION_MS = 2 * 60 * 1000;

/**
 * Y cada cuánto mientras algo se está reproduciendo.
 *
 * Mucho más seguido: es lo que decide cuánto tarda en callarse el aparato de
 * la otra habitación cuando esta persona empieza algo aquí. Dos minutos sería
 * inútil; doce segundos se nota como "casi al momento" y sigue siendo una
 * petición pequeña.
 */
const LATIDO_REPRODUCIENDO_MS = 12 * 1000;

/**
 * Lo que se espera a la sincronización antes de entrar.
 *
 * Sincronizar es un lujo, no un requisito: si el servidor tarda o no está, se
 * entra igual con lo que hay en el aparato y ya subirá luego. Bloquear el
 * arranque por esto sería cambiar un fallo raro por una app que no abre.
 */
const ESPERA_SINCRONIZAR_MS = 4000;

type Fase =
  | { tipo: 'abriendo' }
  | { tipo: 'listas'; error?: string }
  | { tipo: 'emparejar' }
  | { tipo: 'conectando'; nombre: string; avance: Avance }
  /*
    El `perfil` solo viene cuando se llega desde la biblioteca, con el botón
    "Perfiles" del menú: es lo que permite volver sin elegir. Al arrancar no
    hay adónde volver.
  */
  | { tipo: 'perfiles'; cuenta: Cuenta; medicion: Medicion; perfil?: Perfil }
  | { tipo: 'biblioteca'; cuenta: Cuenta; medicion: Medicion; perfil: Perfil };

function App() {
  return (
    <SafeAreaProvider>
      <Raiz />
    </SafeAreaProvider>
  );
}

function Raiz() {
  const [fase, setFase] = useState<Fase>({ tipo: 'abriendo' });
  const [version, setVersion] = useState(0);
  /** A qué casa está conectado el aparato, para poder decirlo en pantalla. */
  const [casa, setCasa] = useState<string | null>(null);
  /** Cómo se llama este aparato en la casa: "TV Salón". Lo pone quien lo aprueba. */
  const [nombreAparato, setNombreAparato] = useState<string | null>(null);
  /**
   * Sube cada vez que una sincronización trae algo de otro aparato.
   *
   * La biblioteca lo vigila para recargarse. Sin esto, los datos entraban en
   * SQLite y la pantalla seguía enseñando lo de antes hasta que la cerrabas y
   * la volvías a abrir: parecía que no había llegado nada.
   */
  const [sincronizado, setSincronizado] = useState(0);
  const gestor = useRef<GestorCuentas | null>(null);
  const biblioteca = useRef<Biblioteca | null>(null);
  const perfiles = useRef<AlmacenPerfiles | null>(null);
  const programacion = useRef<Programacion | null>(null);
  /*
    El árbitro de las conexiones del panel.

    Vive aquí y no dentro del reproductor porque la ranura no es de una
    pantalla: la comparten el vídeo, la vista previa y —cuando llegue— la
    descarga. Se crea una vez y se le dicen las ranuras al conectar.
  */
  const arbitro = useRef(new Arbitro(1));
  /*
    La cola de descargas, aquí al lado del árbitro y por el mismo motivo: la
    ranura del panel es de la casa, y quien la pide para bajar algo tiene que
    ser el mismo que la pide para reproducir. Se monta al conectar con la
    lista, que es cuando hay base donde apuntar.
  */
  const cola = useRef<ColaDeDescargas | null>(null);
  const [descargas, setDescargas] = useState<Descarga[]>([]);
  /**
   * El cliente de sincronización, uno para toda la vida de la app.
   *
   * Se crea antes de haber conectado con ninguna lista, porque emparejar es lo
   * primero que se hace en un aparato nuevo y todavía no hay almacén de
   * perfiles. Por eso lo lee de `perfiles.current` en cada llamada en vez de
   * quedárselo: cuando toque sincronizar de verdad, ya estará.
   */
  /** Lo que el servidor haya preparado: la portada y los géneros. */
  const [preparado, setPreparado] = useState<Preparado>({ portadas: [], generos: [] });

  const sync = useRef<ClienteSync>(
    new ClienteSync({
      almacen: almacenDeSync,
      perfiles: {
        cambiosDesde: async (marca) => (await perfiles.current?.cambiosDesde(marca)) ?? [],
        aplicarCambios: async (cambios) => {
          await perfiles.current?.aplicarCambios(cambios);
        },
      },
      buscar: (url, opciones) => fetch(url, opciones),
    }),
  );

  /**
   * Sincroniza si el aparato está emparejado, y se traga los fallos.
   *
   * Que no haya red, que el servidor esté caído o que el token ya no valga no
   * puede notarse en la interfaz: la app funciona igual sin sincronizar, con
   * lo que tiene guardado.
   */
  const sincronizar = useCallback(async () => {
    try {
      const hecho = await sync.current.sincronizar();
      // Se escribe siempre, aunque no haya nada: es lo único que distingue
      // "está al día" de "no está emparejada" cuando se depura desde fuera
      // con `adb logcat -s ReactNativeJS:V`.
      console.log(hecho ? `[sync] ${hecho.subidos} subidos, ${hecho.bajados} bajados` : '[sync] sin emparejar');
      // Solo se repinta si ha bajado algo: subir es cosa nuestra y no cambia
      // lo que se está viendo en pantalla.
      if (hecho && hecho.bajados > 0) setSincronizado((n) => n + 1);
      // El servidor devuelve cómo se llama este aparato en la casa. Se refresca
      // aquí para que lo aprendan también los que se emparejaron antes de que
      // eso existiera, y para enterarse si le cambias el nombre en la web.
      setNombreAparato((await sync.current.estado())?.aparato ?? null);
    } catch (fallo) {
      console.warn('[sync] no se pudo sincronizar', fallo);
    }
  }, []);

  const conectar = useCallback(async (elegida: Cuenta, forzar = false) => {
    setFase({
      tipo: 'conectando',
      nombre: elegida.nombre,
      avance: { seccion: 'Preguntando al panel', hecho: 0, total: 0 },
    });
    try {
      const {
        biblioteca: datos,
        perfiles: almacen,
        descargas: descargasDeLaBase,
        programacion: parrilla,
        medicion,
      } = await cargarCatalogo(
        elegida,
        (avance) => setFase({ tipo: 'conectando', nombre: elegida.nombre, avance }),
        // La parrilla del directo la prepara el servidor de la casa; si no
        // hay, la programación se le pide al panel canal a canal.
        // Y las fichas largas —género, sinopsis, reparto, fondo y tráiler—,
        // que el servidor va averiguando poco a poco: el catálogo del panel no
        // trae nada de eso.
        { forzar, parrilla: () => sync.current.epg(), fichas: (desde) => sync.current.fichas(desde) },
      );
      biblioteca.current = datos;
      perfiles.current = almacen;
      programacion.current = parrilla;

      cola.current = new ColaDeDescargas({
        arbitro: arbitro.current,
        transferencia: transferenciaDeAndroid(),
        almacen: descargasDeLaBase,
        alCambiar: setDescargas,
        // Quitar una descarga tiene que dejar el disco como estaba.
        borrarFichero,
      });
      // Lo que quedó a medias anoche sigue por donde iba.
      void cola.current.cargar();
      // Lo que diga el panel, no lo que supongamos: hay cuentas de 1 y de 3.
      if (medicion.conexiones) arbitro.current.ajustarRanuras(medicion.conexiones);
      await gestor.current?.conectar(elegida.id);

      /*
        Recién emparejado: este aparato tira sus perfiles y adopta los de la
        casa, que es lo que va a bajar en la sincronización de aquí abajo.

        Se hace ahora y no al emparejar porque el almacén de perfiles no está
        abierto hasta que se conecta con una lista: emparejar se hace antes,
        en la pantalla de listas.
      */
      if ((await sync.current.estado())?.adoptar) {
        await almacen.vaciarLoLocal();
        await sync.current.adoptado();
      }

      // Con el almacén ya abierto se sincroniza, antes de enseñar los
      // perfiles y con un tope de paciencia, para que el "seguir viendo" que
      // se ve sea el bueno: es el caso de dejar algo a medias en la tele y
      // abrir la tablet.
      await Promise.race([
        sincronizar(),
        new Promise<void>((sigue) => setTimeout(() => sigue(), ESPERA_SINCRONIZAR_MS)),
      ]);

      /*
        Antes de la biblioteca, quién está viendo: cada perfil tiene su
        historial y sus favoritos.

        Con uno solo no se pregunta. La pantalla de "¿quién está viendo?" con
        un único círculo no elige nada: es una pulsación de más en cada
        arranque. Quien quiera otro lo hace desde el menú, que es donde están
        los perfiles.
      */
      const suyos = await almacen.perfiles();
      if (suyos.length === 1) setFase({ tipo: 'biblioteca', cuenta: elegida, medicion, perfil: suyos[0]! });
      else setFase({ tipo: 'perfiles', cuenta: elegida, medicion });
    } catch (fallo) {
      // Sin esto, el fallo solo existía en la pantalla: un rótulo rojo que no
      // se puede copiar, sin nada que mirar después desde fuera.
      console.warn('[conectar] no se pudo abrir la lista', fallo);
      biblioteca.current = null;
      setFase({ tipo: 'listas', error: fallo instanceof Error ? fallo.message : String(fallo) });
    }
  }, [sincronizar]);

  useEffect(() => {
    (async () => {
      const abierto = await GestorCuentas.abrir(almacenDeCuentas);
      gestor.current = abierto;
      const emparejado = await sync.current.estado();
      setCasa(emparejado?.grupo?.nombre ?? null);
      setNombreAparato(emparejado?.aparato ?? null);
      // Sesión abierta de la vez anterior: se entra directo, sin preguntar.
      if (abierto.activa) await conectar(abierto.activa);
      else setFase({ tipo: 'listas' });
    })();
  }, [conectar]);

  /*
    Las sugerencias del inicio, preparadas por el servidor de la casa.

    Se piden al arrancar, mientras se elige lista y perfil, para que ya estén
    cuando se abra la biblioteca: llegando después, el presentador se rehace y
    el inicio se monta dos veces. La pantalla nunca espera por ellas —si el
    servidor no contesta, o esta casa no tiene, el presentador saca las suyas
    preguntando al panel como siempre—.
  */
  useEffect(() => {
    let vigente = true;
    void (async () => {
      const suyo = await sync.current.portadas();
      console.log(`[portadas] ${suyo.portadas.length} del servidor, ${suyo.generos.length} géneros`);
      if (vigente && (suyo.portadas.length > 0 || suyo.generos.length > 0)) setPreparado(suyo);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  // Mientras se está viendo la biblioteca, se sincroniza de vez en cuando.
  useEffect(() => {
    if (fase.tipo !== 'biblioteca') return;
    const reloj = setInterval(() => void sincronizar(), CADA_SINCRONIZACION_MS);
    return () => clearInterval(reloj);
  }, [fase.tipo, sincronizar]);

  /**
   * Y al volver la app al primer plano, que es el momento que importa.
   *
   * Coger la tablet para seguir lo que dejaste en la tele no pasa por
   * `conectar`: la app ya estaba abierta, solo se trae al frente. Sin esto
   * había que esperar al temporizador, o cerrarla del todo y abrirla otra vez.
   */
  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void sincronizar();
    });
    return () => suscripcion.remove();
  }, [sincronizar]);

  /*
    El aviso de la barra mientras quede algo por bajar.

    Va aquí, en la raíz, y no en el panel de descargas: la gracia es justo que
    siga con la pantalla apagada y la aplicación al fondo, que es cuando no hay
    ninguna pantalla montada que pueda encargarse.
  */
  useEffect(() => {
    avisarDeLasDescargas(descargas);
  }, [descargas]);

  const cerrarSesion = useCallback(async () => {
    await gestor.current?.cerrarSesion();
    biblioteca.current = null;
    setFase({ tipo: 'listas' });
  }, []);

  /**
   * Recién emparejado: se dan de alta las listas que reparte la casa.
   *
   * Se añaden a las que ya hubiera en vez de reemplazarlas. Quitar de un
   * aparato una lista que alguien puso a mano, sin avisar, sería justo lo que
   * no se espera de conectar con el servidor.
   */
  const traerListas = useCallback(async (grupo: string | null, listas: Array<{ nombre: string; url: string }>) => {
    const actual = gestor.current;
    if (!actual) return;

    for (const lista of listas) {
      if (actual.cuentas.some((cuenta) => cuenta.url === lista.url)) continue;
      await actual.anadir({ nombre: lista.nombre, url: lista.url });
    }
    setCasa(grupo);
    setVersion((n) => n + 1);
    setFase({ tipo: 'listas' });
  }, []);

  const desemparejar = useCallback(async () => {
    await sync.current.olvidar();
    setCasa(null);
    setVersion((n) => n + 1);
  }, []);

  if (fase.tipo === 'abriendo') return <Espera texto="Abriendo…" />;

  if (fase.tipo === 'conectando') {
    const { seccion, hecho, total } = fase.avance;
    const cuenta = total > 0 ? ` ${hecho}/${total}` : '';
    return <Espera texto={`${fase.nombre} · ${seccion}${cuenta}`} />;
  }

  if (fase.tipo === 'perfiles') {
    // Sin almacén no hay a quién enseñar: se conecta antes de llegar aquí, y
    // esto solo se ve el instante que tarde en abrirse.
    if (!perfiles.current) return <Espera texto="Un momento…" />;
    return (
      <PantallaPerfiles
        almacen={perfiles.current}
        // Lo que este aparato tiene abierto contra el panel, que es lo único
        // que se puede saber: lo de la casa entera no lo dice nadie.
        conexiones={arbitro.current.resumen()}
        onElegir={(perfil) => setFase({ tipo: 'biblioteca', cuenta: fase.cuenta, medicion: fase.medicion, perfil })}
        onVolver={
          fase.perfil
            ? () => {
                /*
                  Se relee el perfil antes de volver: en esta pantalla se
                  edita, y la copia que traíamos es de antes de tocarlo. Sin
                  esto, cambiabas de retrato y la cabecera seguía con la
                  inicial hasta el siguiente arranque.

                  Y si se ha borrado, no hay a dónde volver: se pregunta otra
                  vez quién está viendo.
                */
                const anterior = fase.perfil!;
                perfiles.current!.perfiles().then((todos) => {
                  const puesto = todos.find((uno) => uno.id === anterior.id);
                  if (puesto) {
                    setFase({ tipo: 'biblioteca', cuenta: fase.cuenta, medicion: fase.medicion, perfil: puesto });
                  } else {
                    setFase({ tipo: 'perfiles', cuenta: fase.cuenta, medicion: fase.medicion });
                  }
                });
              }
            : undefined
        }
      />
    );
  }

  if (fase.tipo === 'emparejar') {
    return (
      <PantallaEmparejar
        cliente={sync.current}
        onListo={(grupo, listas) => void traerListas(grupo, listas)}
        onCancelar={() => setFase({ tipo: 'listas' })}
      />
    );
  }

  if (fase.tipo === 'listas') {
    return (
      <View style={estilos.pantalla}>
        {fase.error ? <Text style={estilos.errorArriba}>{fase.error}</Text> : null}
        {gestor.current ? (
          <PantallaListas
            key={version}
            gestor={gestor.current}
            onConectar={conectar}
            onCambio={() => setVersion((n) => n + 1)}
            onEmparejar={() => setFase({ tipo: 'emparejar' })}
            grupo={casa}
            onDesemparejar={() => void desemparejar()}
          />
        ) : null}
      </View>
    );
  }

  return (
    <BibliotecaVista
      biblioteca={biblioteca.current!}
      perfiles={perfiles.current!}
      programacion={programacion.current!}
      cola={cola.current}
      descargas={descargas}
      perfil={fase.perfil}
      cuenta={fase.cuenta}
      medicion={fase.medicion}
      onCerrarSesion={cerrarSesion}
      onCambiarPerfil={() =>
        setFase({ tipo: 'perfiles', cuenta: fase.cuenta, medicion: fase.medicion, perfil: fase.perfil })
      }
      onActualizar={() => conectar(fase.cuenta, true)}
      sincronizado={sincronizado}
      preparado={preparado}
      aparato={nombreAparato}
      arbitro={arbitro.current}
      onSincronizar={() => void sincronizar()}
      onElegirPerfil={(nuevo) =>
        setFase((actual) => (actual.tipo === 'biblioteca' ? { ...actual, perfil: nuevo } : actual))
      }
    />
  );
}

function Espera({ texto }: { texto: string }) {
  return (
    <View style={[estilos.pantalla, estilos.centrado]}>
      <ActivityIndicator size="large" color={VERDE} />
      <Text style={estilos.espera}>{texto}</Text>
    </View>
  );
}

function BibliotecaVista({
  biblioteca,
  perfiles,
  programacion,
  perfil,
  cuenta,
  medicion,
  arbitro,
  cola,
  descargas,
  onCerrarSesion,
  onCambiarPerfil,
  onActualizar,
  sincronizado,
  preparado,
  aparato,
  onSincronizar,
  onElegirPerfil,
}: {
  biblioteca: Biblioteca;
  perfiles: AlmacenPerfiles;
  programacion: Programacion;
  perfil: Perfil;
  cuenta: Cuenta;
  medicion: Medicion;
  /** Reparte las conexiones del panel entre el vídeo y lo que venga. */
  arbitro: Arbitro;
  /** La cola de descargas. Nula hasta que se conecta con una lista. */
  cola: ColaDeDescargas | null;
  descargas: Descarga[];
  /** Lo que el servidor haya preparado para el inicio, si hay servidor. */
  preparado: Preparado;
  /** El nombre de este aparato en la casa, para poder decir dónde suena algo. */
  aparato: string | null;
  onCerrarSesion: () => void;
  onCambiarPerfil: () => void;
  onActualizar: () => void;
  /** Sube cuando ha llegado algo de otro aparato: hay que repintar. */
  sincronizado: number;
  /** Pide sincronizar ahora, sin esperar al temporizador. */
  onSincronizar: () => void;
  /**
   * Se pasa a otro perfil desde el menú, sin volver a la pantalla de perfiles.
   *
   * En una casa se cambia de persona a menudo —uno deja la tele y la coge
   * otro—, así que los demás perfiles están a dos pulsaciones y no detrás de
   * una pantalla entera.
   */
  onElegirPerfil: (perfil: Perfil) => void;
}) {
  const insets = useSafeAreaInsets();
  /*
    En un teléfono no caben las pestañas centradas entre la lupa y el perfil:
    se salían por los dos lados y encima se montaban con los botones. Por
    debajo de este ancho se bajan a su propia línea y se recorren con el dedo.
  */
  const { width: anchoPantalla } = useWindowDimensions();
  const estrecha = anchoPantalla < 700;
  const [estado, setEstado] = useState<EstadoPantalla | null>(null);
  const [reproduciendo, setReproduciendo] = useState<Reproducible | null>(null);
  /** Puesto cuando esta persona ha empezado algo en otro aparato y aquí se para. */
  const [interrumpido, setInterrumpido] = useState<string | null>(null);

  /**
   * false mientras el vídeo va en la columna de la parrilla.
   *
   * El reproductor es el mismo en los dos tamaños: esto solo decide dónde se
   * coloca. Ver el porqué en `parrilla.tsx`.
   */
  const [aPantallaCompleta, setAPantallaCompleta] = useState(true);

  const [verAjustes, setVerAjustes] = useState(false);
  /** La lista de descargas, que cuelga del menú del perfil. */
  const [verDescargas, setVerDescargas] = useState(false);
  /*
    "Ver en la tele": lo que suena en una tele de la casa, mandado desde aquí.

    `teleEnCurso` es lo que vale y `enLaTele` es su copia para pintar: el
    reloj que pregunta a la tele cada dos segundos necesita leer y apuntar sin
    esperar a que React vuelva a pintar, y con solo el estado leería siempre
    el de hace un pintado.
  */
  const [enLaTele, setEnLaTele] = useState<EnLaTele | null>(null);
  const teleEnCurso = useRef<EnLaTele | null>(null);
  const mandoTele = useRef<MandoDeTele | null>(null);
  /** Por dónde iba, para saltar ahí en cuanto la tele empiece a sonar. */
  const saltoPendiente = useRef<number | null>(null);
  const [verMando, setVerMando] = useState(false);
  /** Con más de una tele en casa, cuál: se pregunta en vez de adivinar. */
  const [elegirTele, setElegirTele] = useState<{ teles: Tele[]; medio: MedioParaTele } | null>(null);
  /** Cuánto ocupan y cuánto queda libre. Se mide al abrir, no en cada pintado. */
  const [disco, setDisco] = useState<{ ocupado: number; libre: number } | null>(null);
  /** A qué velocidad va lo que se está bajando, para el tiempo estimado. */
  const [marcha, setMarcha] = useState<Marcha>({ bytesPorSegundo: null, quedan: null });
  /**
   * El capítulo que va después del que se está viendo.
   *
   * Hace falta cuando se reproduce desde "seguir viendo": ahí la fila es de
   * series distintas, así que no hay cola de la que sacar el siguiente y el
   * botón de "Siguiente capítulo" no salía. Se pregunta a la biblioteca, que
   * sabe saltar de temporada.
   */
  const [siguienteSuelto, setSiguienteSuelto] = useState<Reproducible | null>(null);

  /** El menú que cuelga del círculo del perfil, con lo que es de cada uno. */
  const [verPerfil, setVerPerfil] = useState(false);
  const [focoPerfil, setFocoPerfil] = useState(0);
  /** Los demás perfiles de la casa, para poder pasarse a uno desde el menú. */
  const [otrosPerfiles, setOtrosPerfiles] = useState<Perfil[]>([]);
  /**
   * En el buscador, el mando está en el campo de texto y no en los resultados.
   *
   * Empieza ahí —se abre para escribir— y se sale con las flechas. Sin esto,
   * el primer resultado se quedaba marcado mientras uno seguía escribiendo, y
   * había dos focos a la vez.
   */
  const [enTexto, setEnTexto] = useState(true);
  /** Lo que echan en cada canal, para las filas de TV en directo. */
  const [programas, setProgramas] = useState<Record<string, Programa[]>>({});
  /**
   * El menú de mantener pulsado, con lo que se puede hacer con una ficha.
   *
   * Antes, mantener pulsado añadía a Mi Lista y ya. Ahora abre esto, porque
   * hay tres cosas que hacer con una película y solo una de ellas cabía en un
   * gesto: información, Mi Lista y descargar.
   */
  const [menuFicha, setMenuFicha] = useState<Marcable | null>(null);
  const [focoFicha, setFocoFicha] = useState(0);
  /** Un aviso corto abajo, para lo que no abre pantalla: "Añadido a Mi Lista". */
  const [aviso, setAviso] = useState<string | null>(null);
  /**
   * Un contador que sube con el reloj.
   *
   * Las filas son `FlatList`, que solo repinta sus fichas cuando cambia
   * `extraData`: sin esto, el programa en curso se quedaría clavado en el que
   * había al abrir la pantalla y la barra no avanzaría nunca.
   */
  const [sello, setSello] = useState(0);

  /*
    Estos dos van aquí arriba, con el resto de hooks, y no junto al menú que
    los usa. Es la cuarta vez que este proyecto se cae por lo mismo: React
    exige el mismo número de hooks en cada pintado, y más abajo hay un
    `return` temprano —"Cargando la biblioteca…"— que se los saltaba en el
    primero. El síntoma es "Rendered more hooks than during the previous
    render" y la aplicación cerrándose al entrar.
  */
  /*
    Los demás perfiles se leen al abrir el menú y no una vez al entrar: en esta
    casa los perfiles se sincronizan, así que la lista de hace media hora
    puede no ser la de ahora.
  */
  useEffect(() => {
    if (!verPerfil) return;
    perfiles.perfiles().then((todos) => setOtrosPerfiles(todos.filter((uno) => uno.id !== perfil.id)));
  }, [verPerfil, perfiles, perfil.id]);

  /*
    El aviso de abajo se va solo: es un acuse de recibo, no un mensaje. Pero
    dura lo que se tarda en leerlo: tres segundos valen para "a la cola de
    descargas" y se quedan cortos para explicar por qué la tele no abre algo.
  */
  useEffect(() => {
    if (!aviso) return;
    const reloj = setTimeout(() => setAviso(null), Math.max(3000, aviso.length * 70));
    return () => clearTimeout(reloj);
  }, [aviso]);

  /*
    La parrilla de los canales que están a la vista.

    Se piden **todos los de la fila de una vez** y solo de lo que el servidor
    tenga preparado: con la parrilla en memoria no cuesta ninguna petición.
    Caer al panel canal a canal aquí serían veinte peticiones por fila.
  */
  const canalesALaVista = (estado?.inicio?.filas ?? [])
    .flatMap((fila) => (fila.tipo === 'carrusel' && fila.formato === 'canal' ? fila.elementos : []))
    .map((elemento) => canalDeElemento(elemento))
    .filter((canal): canal is string => canal !== null)
    .join(',');

  useEffect(() => {
    if (!canalesALaVista) return;
    let vivo = true;
    void programacion.deCanales(canalesALaVista.split(',')).then((traidos) => {
      if (!vivo) return;
      setProgramas((antes) => ({ ...antes, ...traidos }));
      setSello((antes) => antes + 1);
    });
    return () => {
      vivo = false;
    };
  }, [canalesALaVista, programacion]);

  /*
    Y el que tiene el foco encima, con un respiro.

    Este sí puede acabar preguntándole al panel —es el camino para las casas
    sin servidor—, y el foco se mueve más rápido de lo que el panel responde:
    sin la espera, recorrer una fila de canales sería una petición por
    pulsación.
  */
  const filaEnfocada = estado?.inicio?.filas[estado.inicio.fila];
  const fichaEnfocada =
    filaEnfocada?.tipo === 'carrusel' && filaEnfocada.formato === 'canal'
      ? filaEnfocada.elementos[estado?.inicio?.columna ?? 0]
      : undefined;
  const canalEnfocado = fichaEnfocada ? canalDeElemento(fichaEnfocada) : null;

  useEffect(() => {
    if (!canalEnfocado || programas[canalEnfocado]) return;
    let vivo = true;
    const espera = setTimeout(() => {
      void programacion.deCanal(canalEnfocado).then((suyos) => {
        if (!vivo || suyos.length === 0) return;
        setProgramas((antes) => ({ ...antes, [canalEnfocado]: suyos }));
        setSello((antes) => antes + 1);
      });
    }, ESPERA_EPG_MS);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [canalEnfocado, programacion, programas]);

  /*
    El reloj de la parrilla. Solo corre si hay canales a la vista: en las
    demás pestañas no hay nada que repintar cada minuto.
  */
  useEffect(() => {
    if (!canalesALaVista) return;
    const reloj = setInterval(() => setSello((antes) => antes + 1), RELOJ_EPG_MS);
    return () => clearInterval(reloj);
  }, [canalesALaVista]);

  /*
    Y se pide al abrir cada capítulo: es una consulta a la base, y el panel
    solo entra si esta serie no se había abierto nunca en este aparato.
  */
  useEffect(() => {
    if (reproduciendo?.clase !== 'episodio') {
      setSiguienteSuelto(null);
      return;
    }
    let vigente = true;
    biblioteca
      .episodioSiguiente(reproduciendo.id)
      .then((siguiente) => {
        if (!vigente) return;
        setSiguienteSuelto(
          siguiente
            ? {
                clase: 'episodio',
                id: siguiente.clave,
                titulo: `${siguiente.serieTitulo} T${siguiente.temporada} E${siguiente.numero}`,
              }
            : null,
        );
      })
      .catch(() => vigente && setSiguienteSuelto(null));
    return () => {
      vigente = false;
    };
  }, [biblioteca, reproduciendo?.clase, reproduciendo?.id]);

  /** El mando está en la cabecera —buscar, ajustes, perfil— y no en la rejilla. */
  const [enCabecera, setEnCabecera] = useState(false);
  const [focoCabecera, setFocoCabecera] = useState(0);
  /** Cuál de las opciones del panel de ajustes tiene el mando encima. */
  const [focoAjustes, setFocoAjustes] = useState(0);
  const [avisoSalida, setAvisoSalida] = useState(false);

  const presentador = useRef<Presentador | null>(null);
  const salidaPendiente = useRef(false);
  /** La pantalla actual es la del directo: solo ahí hay vista previa. */
  /** Contra este contenedor se mide el hueco del vídeo. */
  const raiz = useRef<View | null>(null);
  const lista = useRef<FlatList<Elemento> | null>(null);
  /** La lista de categorías: se desplaza sola para seguir a su foco. */
  const barra = useRef<FlatList<OpcionLateral> | null>(null);
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_POR_DEFECTO);

  const [texto, setTexto] = useState('');
  const temporizadorBusqueda = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Se espera un momento entre teclas antes de buscar: sin esto, escribir
   * "matrix" lanza seis consultas y la lista parpadea en cada letra.
   */
  const teclear = useCallback((nuevo: string) => {
    // Escribir devuelve el foco al campo: es lo que se está tocando.
    setEnTexto(true);
    setTexto(nuevo);
    if (temporizadorBusqueda.current) clearTimeout(temporizadorBusqueda.current);
    temporizadorBusqueda.current = setTimeout(() => {
      presentador.current?.buscar(nuevo).then(setEstado);
    }, 250);
  }, []);

  const abrirBuscador = useCallback(() => {
    setEnTexto(true);
    setTexto('');
    presentador.current?.abrirBuscador().then(setEstado);
  }, []);

  // Las preferencias son de cada perfil: a uno le caben seis carátulas por
  // fila y otro las quiere grandes.
  useEffect(() => {
    perfiles.ajustes(perfil.id).then(setAjustes);
  }, [perfiles, perfil]);

  useEffect(() => {
    const instancia = new Presentador(biblioteca, {
      columnasRejilla: ajustes.columnas,
      orden: ajustes.orden,
      tamanoPagina: 60,
      // De aquí sale la barrita de "lo llevas por la mitad".
      avances: (medios) => perfiles.avancesDe(perfil.id, medios),
      // Y de aquí la fila de "seguir viendo" del inicio.
      // De más a propósito: el presentador deja una sola fila por serie, así
      // que pedir doce justas dejaría la fila a medias.
      seguirViendo: () => perfiles.seguirViendo(perfil.id, 40),
      vistas: () => perfiles.vistas(perfil.id),
      seriesEmpezadas: () => perfiles.seriesEmpezadas(perfil.id),
      /*
        Y de aquí sale si un canal sigue teniendo sitio en "seguir viendo":
        mientras no termine el programa que se estaba viendo. Solo de lo
        preparado —`deCanales` no pregunta al panel—, que si no sería una
        petición por canal cada vez que se pinta el inicio.
      */
      parrilla: (canalIds) => programacion.deCanales(canalIds),
      // Y de aquí el orden de las filas por categoría: primero lo que más ve.
      afinidad: () => perfiles.afinidad(perfil.id),
      // Y de aquí los corazones de Mi Lista, que son de cada uno.
      favoritos: {
        listar: async (clase) =>
          (await perfiles.favoritos(perfil.id))
            .filter((favorito) => favorito.clase === clase)
            .map((favorito) => favorito.itemId),
        alternar: async (clase, id, titulo) => {
          if (await perfiles.esFavorito(perfil.id, clase, id)) {
            await perfiles.desmarcarFavorito(perfil.id, clase, id);
            return false;
          }
          await perfiles.marcarFavorito(perfil.id, {
            clase,
            itemId: id,
            titulo,
            creado: new Date().toISOString(),
          });
          return true;
        },
      },
    });
    // Antes de cargar: si llegan después, el inicio se monta dos veces.
    instancia.usarPortadas(preparado.portadas);
    presentador.current = instancia;
    void (async () => {
      /*
        Los géneros que trae la portada del servidor se anotan también aquí.
        La recogida grande —el catálogo entero— se hace al conectar con la
        lista; esto son las cuarenta que presiden el inicio, y llegan por otro
        camino porque la portada se pide antes de elegir lista.
      */
      await biblioteca.guardarFichas(
        preparado.generos.map((uno) => ({ id: uno.id, clase: 'pelicula' as const, genero: uno.genero })),
      );
      setEstado(await instancia.cargar());
    })();
    // `ajustes.orden` no está entre las dependencias a propósito: cambiarlo se
    // aplica sobre el presentador vivo, no rehaciéndolo. Las columnas sí
    // obligan a rehacerlo porque la rejilla se monta con ellas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biblioteca, perfiles, perfil, ajustes.columnas, preparado]);

  /*
    Un perfil es una persona, y una persona no ve dos cosas a la vez.

    Al empezar algo aquí se anuncia —con el nombre de este aparato— en los
    ajustes del perfil, que viajan con la sincronización. Al parar se borra el
    anuncio. Y si al sincronizar aparece el anuncio de **otro** aparato, aquí
    se corta y se explica por qué: la última persona que le ha dado a
    reproducir manda, que es lo que uno espera.

    Con `max_connections` a 1 esto además es lo que libera la ranura del panel
    para el aparato nuevo; el árbitro que espere a que se libere de verdad
    todavía está por hacer.
  */
  useEffect(() => {
    if (!reproduciendo) return;

    void (async () => {
      await perfiles.anunciarReproduccion(perfil.id, {
        nombre: aparato ?? 'otro aparato',
        titulo: reproduciendo.titulo,
      });

      /*
        Y se apunta de qué categorías es lo que suena, que es lo que sube las
        filas del inicio. Al empezar y no al terminar: lo que uno pone dice lo
        que le gusta aunque luego se duerma a la media hora.
      */
      try {
        await perfiles.anotarUso(perfil.id, await biblioteca.gruposDe(reproduciendo.clase, reproduciendo.id));
      } catch (fallo) {
        console.warn('[perfiles] no se pudo apuntar el uso', fallo);
      }

      sincronizarAhora.current();
    })();

    return () => {
      void (async () => {
        /*
          Al parar se borra el anuncio —si no, el siguiente aparato en abrir la
          aplicación se creería interrumpido por algo que ya no suena— pero
          **solo si el anuncio sigue siendo el nuestro**.

          Si lo que nos ha parado es que esta persona ha empezado algo en otro
          sitio, el anuncio que hay puesto es el de ese otro aparato: borrarlo
          sería justo lo contrario de lo que queremos.
        */
        const anuncio = await perfiles.reproduccion(perfil.id);
        if (anuncio && !anuncio.propia) return;

        await perfiles.anunciarReproduccion(perfil.id, null);
        sincronizarAhora.current();
      })();
    };
    // Solo al empezar y al terminar de reproducir, no en cada repintado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo?.clase, reproduciendo?.id, perfil.id, aparato]);

  /*
    Mientras algo suena se sincroniza mucho más a menudo.

    Es el latido que hace que "para lo de la otra habitación" tarde segundos y
    no minutos. Fuera de la reproducción no hace falta: el "seguir viendo" no
    tiene prisa.
  */
  const sincronizarAhora = useRef(onSincronizar);
  sincronizarAhora.current = onSincronizar;

  useEffect(() => {
    if (!reproduciendo) return;
    /*
      Por referencia y con el reloj dependiendo solo de si suena algo.

      `onSincronizar` llega como una función nueva en cada pintado, así que
      tenerla en las dependencias rehacía el intervalo una y otra vez y los
      doce segundos no se cumplían jamás. Es el mismo tropiezo que ya nos pasó
      con el turno de la portada.
    */
    const reloj = setInterval(() => sincronizarAhora.current(), LATIDO_REPRODUCIENDO_MS);
    return () => clearInterval(reloj);
  }, [reproduciendo]);

  /* Y al recibir el anuncio de otro aparato, aquí se para. */
  useEffect(() => {
    if (!reproduciendo) return;
    let vigente = true;

    void (async () => {
      const anuncio = await perfiles.reproduccion(perfil.id);
      if (!vigente || !anuncio || anuncio.propia) return;

      setReproduciendo(null);
      setAPantallaCompleta(false);
      setInterrumpido(anuncio.nombre);
    })();

    return () => {
      vigente = false;
    };
  }, [sincronizado, reproduciendo, perfiles, perfil.id]);

  /** El aviso de "te has ido a ver a otro sitio" se quita solo. */
  useEffect(() => {
    if (!interrumpido) return;
    const reloj = setTimeout(() => setInterrumpido(null), 6000);
    return () => clearTimeout(reloj);
  }, [interrumpido]);


  /**
   * Al cerrar el reproductor, sincronizar: acaba de haber algo que contar.
   *
   * Es el momento en el que el avance de lo que se estaba viendo tiene su
   * valor definitivo. Dejarlo al temporizador de dos minutos significaba que
   * salir de la película y cerrar la app perdía el último tramo.
   *
   * Se vigila la transición a `null` y no el botón de atrás porque el
   * reproductor se cierra por varios caminos —atrás, cambiar de sección, el
   * efecto de aquí abajo— y todos cuentan igual.
   */
  const veniaReproduciendo = useRef(false);
  useEffect(() => {
    if (reproduciendo) {
      veniaReproduciendo.current = true;
      return;
    }
    if (veniaReproduciendo.current) {
      veniaReproduciendo.current = false;
      onSincronizar();
    }
  }, [reproduciendo, onSincronizar]);

  /** Ha llegado algo de otro aparato: se repinta con los datos nuevos. */
  useEffect(() => {
    if (sincronizado === 0) return;
    presentador.current?.cargar().then(setEstado);
  }, [sincronizado]);

  useEffect(() => {
    if (!estado) return;
    // Lo que suena siempre ocupa la pantalla: la vista previa vivía en la
    // columna del directo, y esa pantalla ya no existe.
    if (reproduciendo && !aPantallaCompleta) setAPantallaCompleta(true);
  }, [estado, reproduciendo, aPantallaCompleta]);

  // Cambiar de pantalla devuelve el mando al contenido: la cabecera de la
  // pantalla nueva puede tener otros botones, o ninguno.
  useEffect(() => {
    setEnCabecera(false);
  }, [estado?.titulo]);

  /*
    Al reproductor le hace falta poder parar lo que el árbitro eche. Va con
    `useCallback` porque baja como prop hasta un efecto: una función nueva por
    pintado lo volvería a disparar.
  */
  const pararDescarga = useCallback((id: string) => cola?.expulsar(id), [cola]);

  /*
    Mientras el panel de descargas está abierto se mira el disco y la
    velocidad una vez por segundo.

    Va con reloj y no con el aviso de la cola porque son dos cosas que no
    cambian al mismo ritmo: el avance llega dos veces por segundo y medir el
    disco es recorrer una carpeta, que no hay por qué hacer tan a menudo.
    Cerrado el panel, no se mide nada.
  */
  useEffect(() => {
    if (!verDescargas) return;

    const mirar = (): void => {
      setMarcha(cola?.marcha() ?? { bytesPorSegundo: null, quedan: null });
      void espacio().then(setDisco).catch(() => setDisco(null));
    };

    mirar();
    const reloj = setInterval(mirar, 1_000);
    return () => clearInterval(reloj);
  }, [verDescargas, cola]);

  /**
   * Lo que dura una película, si se sabe de algún sitio.
   *
   * El catálogo no lo trae —`get_vod_streams` da título, cartel, nota y año— y
   * el servidor todavía no lo manda. Lo único que hay es lo que apuntó el
   * reproductor si alguien la empezó, que para "cuántas horas llevo bajadas"
   * vale: lo que falte se cuenta como desconocido y se dice.
   */
  const duracionDePelicula = useCallback(
    async (id: string): Promise<number | null> => {
      // Primero la del catálogo, que la pone el servidor con la ficha larga.
      const ficha = await biblioteca.detalleDePelicula(id).catch(() => null);
      if (ficha?.duracion && ficha.duracion > 0) return Math.round(ficha.duracion);

      // Y si no, lo que apuntó el reproductor si alguien la empezó.
      const avance = await perfiles.avanceDe(perfil.id, 'pelicula', id).catch(() => null);
      return avance?.duracion && avance.duracion > 0 ? Math.round(avance.duracion) : null;
    },
    [biblioteca, perfiles, perfil.id],
  );

  const meterEnCola = useCallback(
    async (medio: { clase: string; id: string; titulo: string }) => {
      if (!cola) {
        setAviso('Las descargas no están listas todavía');
        return;
      }
      if (medio.clase !== 'pelicula' && medio.clase !== 'episodio') return;
      const clase = medio.clase;

      const variantes = await biblioteca.variantes(clase, medio.id).catch(() => []);
      /*
        **En la mano se baja más pequeño que en el salón.** El proveedor manda
        la misma película en varias calidades y la mejor son cinco gigas: en
        una pantalla de diez pulgadas 720p no se distingue y ocupa menos de la
        mitad. En el televisor manda la mejor, que ahí sí se nota y el disco no
        es el problema.
      */
      const mejor = varianteParaDescargar(variantes, Platform.isTV ? null : TOPE_DE_MANO, qualityRank);
      /*
        Qué variante se ha elegido de las que hay. En la mano se coge una más
        pequeña que en el televisor, así que si una baja y la otra no, esta
        línea es la que lo dice.
      */
      console.log(
        `[descarga] ${medio.titulo}: ${mejor?.calidad ?? 'sin calidad'} de ${variantes.length} variantes` +
          ` (${variantes.map((una) => una.calidad ?? '?').join(', ')})`,
      );
      if (!mejor) {
        setAviso('Esta ficha no tiene ninguna URL asociada');
        return;
      }

      /*
        De un episodio, el título que se guarda lleva **la serie, la temporada
        y el número**: en la lista de descargas, "El de George" a secas no dice
        de qué serie es ni por dónde va, y con media temporada bajada son diez
        títulos que no se distinguen.

        De paso sale la duración, que es lo que permite sumar cuántas horas de
        vídeo hay en el disco.
      */
      const episodio =
        clase === 'episodio' ? (await biblioteca.episodiosPorClave([medio.id]).catch(() => []))[0] : undefined;

      const titulo = episodio
        ? `${episodio.serieTitulo} · T${episodio.temporada} E${episodio.numero}${
            episodio.titulo ? ` · ${episodio.titulo}` : ''
          }`
        : medio.titulo;

      const clave = claveDeDescarga(clase, medio.id);
      const extension = mejor.url.split('.').pop()?.slice(0, 4) || 'mkv';
      await cola.anadir({
        id: clave,
        clase,
        itemId: medio.id,
        titulo,
        serieId: episodio?.serieId ?? null,
        url: mejor.url,
        fichero: ficheroDe(clave, extension),
        /*
          De una película todavía no hay duración en la base: el catálogo no la
          trae y el servidor no la manda. Lo que sí hay, si alguien la empezó,
          es lo que apuntó el reproductor.
        */
        duracion: episodio?.segundos ?? (await duracionDePelicula(medio.id)),
      });
      setAviso(`${medio.titulo} · a la cola de descargas${mejor.calidad ? ` (${mejor.calidad})` : ''}`);
    },
    // `duracionDePelicula` mira el avance de **este** perfil: sin la
    // dependencia, cambiar de persona dejaría aquí la de la anterior.
    [biblioteca, cola, duracionDePelicula],
  );

  /** Suelta la tele: la ranura, el mando y lo que se pinta. */
  const soltarTele = useCallback(
    (motivo: string | null) => {
      mandoTele.current = null;
      teleEnCurso.current = null;
      saltoPendiente.current = null;
      cerrarPuente();
      arbitro.soltar(RANURA_TELE, Date.now());
      setEnLaTele(null);
      setVerMando(false);
      if (motivo) setAviso(motivo);
    },
    [arbitro],
  );

  /**
   * Por qué la tele no ha podido abrir algo que el teléfono sí abre.
   *
   * La tele solo dice "Error inesperado", y casi siempre es el formato: el
   * teléfono decodifica casi todo por software y la tele solo lo que trae su
   * chip. Así que se leen los primeros kilobytes del fichero, que en un MKV
   * dicen en claro qué pistas trae, y se cuenta.
   *
   * **Solo cuando falla**: leer el fichero gasta una conexión del panel, y
   * cuando la tele reproduce bien no hace ninguna falta. Para entonces la de
   * la tele ya se ha soltado.
   */
  const fallarTele = useCallback(
    (actual: EnLaTele, texto: string) => {
      // Se suelta todo lo que gasta —ranura, puente, wifi—, pero la pantalla
      // se queda: es donde se lee qué ha pasado y desde donde se reintenta.
      mandoTele.current = null;
      saltoPendiente.current = null;
      cerrarPuente();
      arbitro.soltar(RANURA_TELE, Date.now());
      actual.fallo = texto;
      setEnLaTele({ ...actual });
      setVerMando(true);
    },
    [arbitro],
  );

  /**
   * Manda una ficha a una tele concreta y se queda de mando.
   *
   * Lo que viaja es **la URL de la mejor variante**, no la imagen: la tele se
   * la pide al panel por su cuenta y en calidad original. Por eso gasta una
   * ranura de la cuenta igual que si se reprodujera aquí, y se le pide al
   * árbitro como una reproducción más: si una descarga la estaba usando, se
   * echa a la descarga, que es lo único que no pierde nada.
   */
  const ponerEnLaTele = useCallback(
    async (tele: Tele, medio: MedioParaTele) => {
      const variantes = await biblioteca.variantes(medio.clase, medio.id).catch(() => []);
      const mejor = variantes[0];
      if (!mejor) {
        setAviso('Esta ficha no tiene ninguna URL asociada');
        return;
      }

      const permiso = arbitro.pedir(RANURA_TELE, 'reproducir', Date.now());
      if (!permiso.concedido) {
        setAviso(`Las conexiones están ocupadas; prueba en ${Math.max(1, Math.ceil(permiso.esperar / 1000))} s`);
        return;
      }
      for (const echado of permiso.expulsados) pararDescarga(echado);

      setAviso(`Mandando a ${tele.nombre}…`);
      console.log(`[tele] ${medio.titulo} → ${tele.nombre} · ${urlSinCredenciales(mejor.url)}`);
      const mando = new MandoDeTele(tele, pedirALaTele);
      try {
        // Lo que estuviera sonando, fuera: hay teles que no aceptan un vídeo
        // nuevo encima de otro. Que no hubiera nada no es un fallo.
        await mando.parar().catch(() => undefined);
        // Lo que se le da a la tele es el puente del teléfono, no el panel:
        // la Samsung no se entiende con el panel directamente.
        const direccion = await direccionParaLaTele(mejor.url, tipoDeVideo(mejor.url));
        await mando.poner(direccion, medio.titulo);
        await mando.reproducir();
      } catch (fallo) {
        cerrarPuente();
        arbitro.soltar(RANURA_TELE, Date.now());
        console.warn('[tele] no se pudo mandar', fallo);
        setAviso(fallo instanceof Error ? `No se pudo: ${fallo.message}` : 'No se pudo mandar a la tele');
        return;
      }

      /*
        Por donde iba, si iba por algún sitio. No se salta ya: hasta que la
        tele no está sonando, un salto se pierde o lo rechaza. Lo hace el reloj
        que pregunta, en cuanto la vea en marcha.
      */
      const avance =
        medio.clase === 'canal' ? null : await perfiles.avanceDe(perfil.id, medio.clase, medio.id).catch(() => null);
      saltoPendiente.current =
        avance && avance.segundos > 30 && (!avance.duracion || avance.segundos < avance.duracion * 0.9)
          ? avance.segundos
          : null;

      mandoTele.current = mando;
      teleEnCurso.current = {
        tele,
        medio,
        url: mejor.url,
        ...(await caraDeLoQueSuena(biblioteca, medio)),
        fallo: null,
        situacion: null,
        empezada: false,
        desde: Date.now(),
      };
      setEnLaTele({ ...teleEnCurso.current });
      setVerMando(true);
    },
    [biblioteca, arbitro, pararDescarga, perfiles, perfil.id],
  );

  /** Busca las teles y manda, o pregunta a cuál si hay más de una. */
  const mandarALaTele = useCallback(
    async (medio: MedioParaTele) => {
      setAviso('Buscando la tele…');
      const teles = await buscarTeles();
      if (teles.length === 0) {
        setAviso('No encuentro ninguna tele en la red. ¿Está encendida y en la misma wifi?');
        return;
      }
      if (teles.length === 1) {
        await ponerEnLaTele(teles[0]!, medio);
        return;
      }
      setAviso(null);
      setElegirTele({ teles, medio });
    },
    [ponerEnLaTele],
  );

  /** Apunta por dónde va, para "seguir viendo". Igual que el reproductor. */
  const apuntarLoDeLaTele = useCallback(
    (actual: EnLaTele) => {
      const { medio, situacion } = actual;
      if (medio.clase === 'canal') {
        // Un directo no tiene posición: se apunta cuánto lleva, como hace el
        // reproductor, y sobre todo cuándo.
        const segundos = (Date.now() - actual.desde) / 1000;
        if (segundos < 30) return;
        void perfiles
          .anotarAvance(perfil.id, {
            clase: 'canal',
            itemId: medio.id,
            titulo: medio.titulo,
            segundos,
            duracion: 0,
            visto: new Date().toISOString(),
          })
          .catch(() => undefined);
        return;
      }
      if (situacion?.posicion === null || situacion?.posicion === undefined || !situacion.duracion) return;
      if (situacion.posicion < 30) return;
      void perfiles
        .anotarAvance(perfil.id, {
          clase: medio.clase,
          itemId: medio.id,
          titulo: medio.titulo,
          segundos: situacion.posicion,
          duracion: situacion.duracion,
          visto: new Date().toISOString(),
        })
        .catch(() => undefined);
    },
    [perfiles, perfil.id],
  );

  const enLaTeleActiva = enLaTele !== null && enLaTele.fallo === null;

  /*
    Mientras hay algo en la tele, se le pregunta cada dos segundos en qué
    está. Es lo que mueve la barra del mando, lo que apunta "seguir viendo",
    lo que salta a donde ibas y lo que se entera de que ha terminado.

    **Ojo con el teléfono bloqueado**: el reloj de JavaScript se para —la
    trampa de los temporizadores del CLAUDE.md— y mientras tanto no se apunta
    nada. La tele sigue a lo suyo; al desbloquear, se pone al día.
  */
  useEffect(() => {
    if (!enLaTeleActiva) return;
    let fallos = 0;
    let preguntando = false;
    let ultimoApunte = 0;

    const mirar = async (): Promise<void> => {
      const mando = mandoTele.current;
      const actual = teleEnCurso.current;
      if (!mando || !actual || preguntando) return;
      preguntando = true;
      try {
        const situacion = await mando.situacion();
        fallos = 0;
        if (teleEnCurso.current !== actual) return;

        const suena = situacion.estado === 'PLAYING' || situacion.estado === 'PAUSED_PLAYBACK';
        actual.situacion = situacion;
        /*
          Sonar de verdad es **avanzar**, no pasar por PLAYING: la Samsung se
          pone en negro como si fuera a empezar y luego saca "Error
          inesperado". Contarlo como empezado haría que eso pareciera un final
          normal. Un directo no tiene posición, y ahí basta con el estado.
        */
        if (suena && (actual.medio.clase === 'canal' || (situacion.posicion ?? 0) >= 3)) actual.empezada = true;

        if (situacion.estado === 'PLAYING' && saltoPendiente.current !== null) {
          const destino = saltoPendiente.current;
          saltoPendiente.current = null;
          void mando.saltarA(destino).catch(() => undefined);
        }

        if (suena && Date.now() - ultimoApunte >= 10_000) {
          ultimoApunte = Date.now();
          apuntarLoDeLaTele(actual);
        }

        /*
          Parada quiere decir dos cosas distintas según haya sonado o no. Si ya
          sonaba, se ha terminado —o alguien la ha parado con el mando de la
          tele—. Si nunca llegó a sonar, la tele no pudo abrir el vídeo; se le
          dan treinta segundos, que al empezar pasa un momento por "parada".
        */
        const parada = situacion.estado === 'STOPPED' || situacion.estado === 'NO_MEDIA_PRESENT';
        if (parada && actual.empezada) {
          soltarTele('Se ha dejado de ver en la tele');
          return;
        }
        if (parada && Date.now() - actual.desde > 30_000) {
          fallarTele(actual, 'La tele no ha podido reproducirlo. Miro por qué…');
          void porQueNoLoAbreLaTele(actual.url).then((porque) => {
            if (teleEnCurso.current !== actual) return;
            actual.fallo = porque;
            setEnLaTele({ ...actual });
          });
          return;
        }
        setEnLaTele({ ...actual });
      } catch (fallo) {
        fallos += 1;
        console.warn('[tele] no contesta', fallo);
        if (fallos >= 5) soltarTele('Se ha perdido la conexión con la tele');
      } finally {
        preguntando = false;
      }
    };

    void mirar();
    const reloj = setInterval(() => void mirar(), 2_000);
    return () => clearInterval(reloj);
  }, [enLaTeleActiva, apuntarLoDeLaTele, soltarTele, fallarTele]);

  /** Lo que hacen los botones del mando. Todo va a la tele y nada espera. */
  const ordenALaTele = useCallback(
    (orden: 'alternar' | 'atras' | 'adelante' | 'parar') => {
      const mando = mandoTele.current;
      const actual = teleEnCurso.current;
      if (!mando || !actual) return;
      const posicion = actual.situacion?.posicion ?? 0;

      if (orden === 'parar') {
        apuntarLoDeLaTele(actual);
        void mando.parar().catch(() => undefined);
        soltarTele(null);
        return;
      }
      if (orden === 'alternar') {
        const sonando = actual.situacion?.estado === 'PLAYING';
        void (sonando ? mando.pausar() : mando.reproducir()).catch((fallo: unknown) =>
          setAviso(fallo instanceof Error ? fallo.message : 'La tele no ha hecho caso'),
        );
        // Se pinta ya lo que se ha pedido; la próxima pregunta lo confirma.
        if (actual.situacion) actual.situacion = { ...actual.situacion, estado: sonando ? 'PAUSED_PLAYBACK' : 'PLAYING' };
        setEnLaTele({ ...actual });
        return;
      }
      const destino = Math.max(0, posicion + (orden === 'adelante' ? 30 : -30));
      void mando.saltarA(destino).catch((fallo: unknown) =>
        setAviso(fallo instanceof Error ? fallo.message : 'La tele no ha hecho caso'),
      );
      if (actual.situacion) actual.situacion = { ...actual.situacion, posicion: destino };
      setEnLaTele({ ...actual });
    },
    [apuntarLoDeLaTele, soltarTele],
  );

  const atras = useCallback((): boolean => {
    const instancia = presentador.current;
    if (!instancia) return false;

    // Lo que esté encima se cierra antes que nada, de más reciente a menos.
    if (elegirTele) {
      setElegirTele(null);
      return true;
    }
    // Cerrar el mando no para la tele: se esconde, y se vuelve a él desde el
    // menú del perfil.
    if (verMando) {
      setVerMando(false);
      return true;
    }
    if (verDescargas) {
      setVerDescargas(false);
      return true;
    }
    if (menuFicha) {
      setMenuFicha(null);
      return true;
    }
    if (verPerfil) {
      setVerPerfil(false);
      return true;
    }
    if (verAjustes) {
      setVerAjustes(false);
      return true;
    }

    // Si hay vídeo en marcha, "atrás" lo cierra antes de tocar la navegación.
    if (reproduciendo) {
      setReproduciendo(null);
      // Se recarga para que la barrita de avance recoja lo que se acaba de ver.
      instancia.cargar().then(setEstado);
      return true;
    }

    instancia.atras().then(({ resultado, estado: nuevo }) => {
      if (resultado === 'retrocedido') {
        setEstado(nuevo);
        return;
      }
      // En la raíz: el primero avisa, el segundo cierra. Salir no cierra la
      // sesión: al volver a abrir se entra directo a esta misma lista.
      if (salidaPendiente.current) {
        BackHandler.exitApp();
        return;
      }
      salidaPendiente.current = true;
      setAvisoSalida(true);
      setTimeout(() => {
        salidaPendiente.current = false;
        setAvisoSalida(false);
      }, MARGEN_SALIDA_MS);
    });
    return true;
  }, [reproduciendo, aPantallaCompleta, verAjustes, verPerfil, menuFicha, verDescargas, elegirTele, verMando]);

  useEffect(() => {
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', atras);
    return () => suscripcion.remove();
  }, [atras]);

  /** Acepta sobre lo enfocado. La usan el OK del mando y el toque en pantalla. */
  const aceptar = useCallback(() => {
    const instancia = presentador.current;
    if (!instancia || (reproduciendo && aPantallaCompleta)) return;

    // En el directo, aceptar sobre el canal que ya se está previsualizando lo
    // abre entero: el primer toque lo enseña en pequeño, el segundo lo agranda.
    //
    // Solo cuenta si el foco está de verdad en ese canal. Con el foco en la
    // barra de categorías, la vista previa sigue siendo la del canal de al
    // lado, y aceptar allí abría el vídeo a pantalla completa en vez de
    // elegir el grupo.
    const actual = instancia.estado();
    const enfocado = actual.lateral?.dentro ? undefined : actual.elementos[actual.foco];
    const yaEnVista =
      reproduciendo &&
      !aPantallaCompleta &&
      enfocado?.accion.tipo === 'reproducir' &&
      enfocado.accion.medio.id === reproduciendo.id;
    if (yaEnVista) {
      setAPantallaCompleta(true);
      return;
    }

    instancia.aceptar().then(({ estado: nuevo, reproducir, abrir, descargar }) => {
      setEstado(nuevo);
      // El tráiler lo pone YouTube: aquí no hay reproductor que valga para él,
      // y además no gasta conexión del panel.
      if (abrir) {
        Linking.openURL(abrir).catch(() => setAviso('No se pudo abrir el tráiler'));
        return;
      }
      if (descargar) {
        void meterEnCola(descargar);
        return;
      }
      if (!reproducir) return;
      // Los canales estrenan en la columna; lo demás va a pantalla completa.
      setReproduciendo(reproducir);
      setAPantallaCompleta(reproducir.clase !== 'canal');
    });
    // `meterEnCola` va en la lista: cambia cuando aparece la cola de
    // descargas, y sin ella aquí se quedaría la versión de antes de que
    // existiera —la que contesta "las descargas no están listas todavía"—.
  }, [reproduciendo, aPantallaCompleta, meterEnCola]);

  /** Pulsar un botón de la ficha con el dedo: se enfoca y se acepta. */
  const aceptarEn = useCallback(
    (indice: number) => {
      const instancia = presentador.current;
      if (!instancia) return;
      setEstado(instancia.enfocar(indice));
      aceptar();
    },
    [aceptar],
  );

  /** En una tablet no hay mando: el dedo elige la ficha y la abre de una vez. */
  const tocar = useCallback(
    (indice: number) => {
      const instancia = presentador.current;
      if (!instancia || (reproduciendo && aPantallaCompleta)) return;
      setEstado(instancia.enfocar(indice));
      aceptar();
    },
    [aceptar, reproduciendo, aPantallaCompleta],
  );

  /**
   * Mantener pulsado marca como favorito.
   *
   * Es el gesto que no choca con el toque normal, que reproduce o entra, y en
   * un mando le corresponde la tecla larga de OK.
   */
  /*
    Mantener pulsado abre el menú de la ficha.

    El toque normal reproduce o entra, que es lo que uno quiere casi siempre;
    lo demás —ver la información, marcar, descargar— cuelga del gesto largo,
    que es el mismo con el dedo y con el OK del mando.
  */
  const mantener = useCallback(
    (indice: number) => {
      const instancia = presentador.current;
      if (!instancia || reproduciendo) return;
      const elemento = instancia.estado().elementos[indice];
      const medio = elemento ? medioDeElemento(elemento) : null;
      if (!medio) return;
      setFocoFicha(0);
      setMenuFicha(medio);
    },
    [reproduciendo],
  );

  /** Lo mismo sobre una ficha del inicio, que no está en la rejilla. */
  /*
    Estas dos van con `useCallback` **porque bajan hasta cada ficha**. Escritas
    en línea se recreaban en cada pintado, así que todas las filas veían una
    prop nueva y `memo` no evitaba nada: es lo que costaba casi un segundo por
    pulsación del mando en la tele.
  */
  const turnarDestacado = useCallback((siguiente: number) => {
    const instancia = presentador.current;
    if (instancia) setEstado(instancia.rotarDestacado(siguiente));
  }, []);

  const tocarEnInicio = useCallback((fila: number, columna: number) => {
    const instancia = presentador.current;
    if (!instancia) return;
    instancia.enfocarEnInicio(fila, columna);
    void instancia.aceptar().then(({ estado: nuevo, reproducir }) => {
      setEstado(nuevo);
      if (reproducir) setReproduciendo(reproducir);
    });
  }, []);

  const mantenerEnInicio = useCallback(
    (fila: number, columna: number) => {
      const instancia = presentador.current;
      if (!instancia || reproduciendo) return;
      const elemento = instancia.estado().inicio?.filas[fila]?.elementos[columna];
      const medio = elemento ? medioDeElemento(elemento) : null;
      if (!medio) return;
      setFocoFicha(0);
      setMenuFicha(medio);
    },
    [reproduciendo],
  );

  useTVEventHandler((evento) => {
    const instancia = presentador.current;
    if (!instancia) return;

    switch (evento.eventType) {
      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        // Con el panel de ajustes abierto, el mando es suyo: es lo que hay
        // encima de todo y lo demás queda detrás.
        if (verAjustes) {
          if (evento.eventType === 'left') {
            setFocoAjustes((actual) => Math.max(0, actual - 1));
          } else if (evento.eventType === 'right') {
            setFocoAjustes((actual) => Math.min(opcionesAjustes.length - 1, actual + 1));
          } else if (evento.eventType === 'up') {
            // Arriba y abajo saltan entre las dos filas: columnas y orden.
            setFocoAjustes((actual) => (actual >= COLUMNAS_POSIBLES.length ? 0 : actual));
          } else if (evento.eventType === 'down') {
            setFocoAjustes((actual) =>
              actual < COLUMNAS_POSIBLES.length ? COLUMNAS_POSIBLES.length : actual,
            );
          }
          return;
        }

        // La cabecera: se entra subiendo desde la primera fila y se sale
        // bajando. Sin esto, en un televisor no hay forma de llegar a buscar
        // ni a los ajustes, porque no hay dedo que los toque.
        // Igual que el del perfil: mientras está abierto, el menú manda.
        if (menuFicha) {
          if (evento.eventType === 'up') setFocoFicha((actual) => Math.max(0, actual - 1));
          else if (evento.eventType === 'down') {
            setFocoFicha((actual) => Math.min(opcionesFicha.length - 1, actual + 1));
          }
          return;
        }

        // El menú del perfil, mientras está abierto, se queda con las teclas.
        if (verPerfil) {
          if (evento.eventType === 'up') {
            setFocoPerfil((actual) => Math.max(0, actual - 1));
          } else if (evento.eventType === 'down') {
            setFocoPerfil((actual) => Math.min(opcionesPerfil.length - 1, actual + 1));
          }
          return;
        }

        if (enCabecera) {
          if (evento.eventType === 'left') {
            setFocoCabecera((actual) => Math.max(0, actual - 1));
          } else if (evento.eventType === 'right') {
            setFocoCabecera((actual) => Math.min(pestanasCabecera.length + botonesCabecera.length - 1, actual + 1));
          } else if (evento.eventType === 'down') {
            setEnCabecera(false);
          }
          return;
        }
        // En el inicio manda su propia fila, no el índice de la rejilla: ahí
        // `foco` vale siempre 0 y subir habría saltado a la cabecera desde
        // cualquier carrusel, en vez de recorrer las filas.
        const arribaDelTodo = estado?.inicio
          ? estado.inicio.fila === 0
          : (estado?.foco ?? 0) < (estado?.columnas ?? 1);

        const cuantosArriba = pestanasCabecera.length + botonesCabecera.length;
        if (evento.eventType === 'up' && cuantosArriba > 0 && !estado?.lateral?.dentro && arribaDelTodo) {
          setFocoCabecera((actual) => Math.min(actual, cuantosArriba - 1));
          setEnCabecera(true);
          return;
        }

        // Con el vídeo entero, las teclas son suyas. Con la vista previa no:
        // ahí el mando sigue gobernando la lista de canales, que es lo que se
        // está mirando —antes esto cortaba el mando entero en el directo, y
        // la pantalla se quedaba muerta—.
        if (reproduciendo && aPantallaCompleta) return;

        const direccion = {
          up: 'arriba',
          down: 'abajo',
          left: 'izquierda',
          right: 'derecha',
        }[evento.eventType] as 'arriba' | 'abajo' | 'izquierda' | 'derecha';
        // Mover con las flechas saca el mando del campo del buscador: a partir
        // de aquí lo que se recorre son los resultados.
        setEnTexto(false);
        instancia.mover(direccion).then((nuevo) => {
          setEstado(nuevo);

          // Cada lista sigue a su propio foco, y solo a él. Antes la del
          // centro se desplazaba también mientras uno recorría las
          // categorías: se movía media pantalla sin que cambiara nada de lo
          // señalado, y no había forma de saber dónde estaba el foco.
          if (nuevo.lateral?.dentro) {
            barra.current?.scrollToIndex({
              index: nuevo.lateral.foco,
              viewPosition: 0.5,
              animated: true,
            });
            return;
          }

          const fila = Math.floor(nuevo.foco / Math.max(nuevo.columnas, 1));
          lista.current?.scrollToIndex({
            index: nuevo.columnas > 1 ? fila : nuevo.foco,
            viewPosition: 0.5,
            animated: true,
          });
        });
        break;
      }

      /*
        Mantener pulsado el OK del mando añade a Mi Lista, igual que el
        toque largo con el dedo. Sin esto, en la tele no había forma de
        marcar nada: el gesto solo existía por pantalla táctil.
      */
      case 'longSelect':
        if (verAjustes || verPerfil || menuFicha || verDescargas || enCabecera || reproduciendo || !estado) return;
        if (estado.inicio) mantenerEnInicio(estado.inicio.fila, estado.inicio.columna);
        else if (!estado.lateral?.dentro) mantener(estado.foco);
        return;

      case 'select':
        if (menuFicha) {
          const opcion = opcionesFicha[focoFicha];
          setMenuFicha(null);
          opcion?.onPress();
          return;
        }
        if (verAjustes) {
          opcionesAjustes[focoAjustes]?.();
          return;
        }
        if (verPerfil) {
          const opcion = opcionesPerfil[focoPerfil];
          setVerPerfil(false);
          opcion?.onPress();
          return;
        }
        if (enCabecera) {
          // Un solo índice para pestañas y botones, en ese orden.
          const enPestanas = pestanasCabecera[focoCabecera];
          if (enPestanas) enPestanas.onPress();
          else botonesCabecera[focoCabecera - pestanasCabecera.length]?.onPress();
          return;
        }
        aceptar();
        break;

      // El botón de menú del mando de Apple TV hace de "atrás"; en Android
      // llega por BackHandler.
      case 'menu':
        atras();
        break;
    }
  });

  // Los hooks van todos antes del primer `return`: tenerlos detrás hacía
  // que React contara un número distinto en cada pintado y la aplicación
  // se cerraba nada más entrar en la biblioteca.
  /**
   * Las opciones del panel de ajustes, seguidas: primero las columnas y
   * detrás los criterios de orden.
   *
   * Van como una sola lista porque el mando las recorre así, aunque en
   * pantalla estén en dos filas con su rótulo.
   */
  const cambiarColumnas = useCallback(
    async (cuantas: number) => {
      await perfiles.guardarAjuste(perfil.id, 'columnas', String(cuantas));
      setAjustes((previos) => ({ ...previos, columnas: cuantas }));
      setVerAjustes(false);
    },
    [perfiles, perfil],
  );

  /**
   * Encadenar o no con el capítulo siguiente.
   *
   * Va en el menú del perfil y no en los ajustes de la rejilla porque es de
   * cada persona y se cambia de vez en cuando: hay a quien le gusta que siga
   * solo y hay a quien le parece que le roban la noche.
   */
  const alternarContinua = useCallback(async () => {
    const siguiente = !ajustes.continua;
    await perfiles.guardarAjuste(perfil.id, 'continua', siguiente ? 'si' : 'no');
    setAjustes((previos) => ({ ...previos, continua: siguiente }));
  }, [ajustes.continua, perfiles, perfil]);

  const cambiarOrden = useCallback(
    async (clave: Ajustes['orden']) => {
      await perfiles.guardarAjuste(perfil.id, 'orden', clave);
      setAjustes((previos) => ({ ...previos, orden: clave }));
      setVerAjustes(false);
      // Se reordena la pantalla en la que estamos: recrear el presentador
      // devolvería al inicio, y lo que uno quiere es ver esta misma
      // categoría ordenada de otra manera.
      presentador.current?.ordenarPor(clave).then(setEstado);
    },
    [perfiles, perfil],
  );

  const ORDENES: Array<[Ajustes['orden'], string]> = [
    ['titulo', 'Título'],
    ['valoracion', 'Valoración'],
    ['reciente', 'Novedades'],
  ];

  if (!estado) return <Espera texto="Cargando la biblioteca…" />;

  /*
    El campo del buscador tiene el mando: mientras se escribe, los resultados
    no llevan marca. Fuera del buscador esto no aplica.
  */
  const enElTexto = estado.busqueda !== null && enTexto;


  const enInicio = presentador.current?.pantalla.tipo === 'inicio';


  const opcionesAjustes: Array<() => void> = [
    ...COLUMNAS_POSIBLES.map((cuantas) => () => void cambiarColumnas(cuantas)),
    ...ORDENES.map(([clave]) => () => void cambiarOrden(clave)),
  ];

  /**
   * Los botones de la cabecera, en el orden en que los recorre el mando.
   *
   * Se arman como datos y no como JSX suelto porque con un mando hay que
   * poder señalar cuál está enfocado y ejecutarlo desde el manejador de
   * teclas: en la tele no hay dedo que los alcance.
   */
  /**
   * Lo que se puede hacer con una ficha, desde el menú de mantener pulsado.
   *
   * Un canal no tiene información que enseñar —ni sinopsis, ni reparto, ni
   * tráiler— así que ahí solo queda Mi Lista. Y una serie no se descarga: se
   * descargan sus episodios, desde dentro.
   */
  /**
   * Mete una película o un episodio en la cola de descargas.
   *
   * La URL sale de la mejor variante, que es la misma que se reproduciría: lo
   * que se baja es lo que se vería. El nombre del fichero conserva la
   * extensión que traiga la URL —el contenedor de verdad se mira al abrirlo, y
   * a `react-native-video` le da igual—.
   */

  const opcionesFicha: Array<{ texto: string; onPress: () => void }> = menuFicha
    ? [
        ...(menuFicha.clase === 'pelicula' || menuFicha.clase === 'serie'
          ? [
              {
                texto: 'Información',
                onPress: () =>
                  void presentador.current
                    ?.abrirFicha(menuFicha.clase as 'pelicula' | 'serie', menuFicha.id, menuFicha.titulo)
                    .then(setEstado),
              },
            ]
          : []),
        {
          texto: 'Mi Lista',
          onPress: () => {
            void presentador.current?.marcar(menuFicha).then(() => {
              setAviso(`${menuFicha.titulo} · Mi Lista`);
              // Y se recarga, que el corazón de la carátula tiene que cambiar.
              void presentador.current?.cargar().then(setEstado);
            });
          },
        },
        ...(menuFicha.clase === 'pelicula' || menuFicha.clase === 'episodio'
          ? [
              {
                texto: descargas.some((una) => una.id === claveDeDescarga(menuFicha.clase as 'pelicula', menuFicha.id))
                  ? 'Quitar de descargas'
                  : 'Descargar',
                onPress: () => {
                  const clave = claveDeDescarga(menuFicha.clase as 'pelicula', menuFicha.id);
                  if (descargas.some((una) => una.id === clave)) void cola?.quitar(clave);
                  else void meterEnCola(menuFicha);
                },
              },
            ]
          : []),
        /*
          Solo en la mano: una tele no le manda vídeo a otra tele. Y de una
          serie no, que no se reproduce entera: se manda un capítulo.
        */
        ...(!Platform.isTV &&
        (menuFicha.clase === 'pelicula' || menuFicha.clase === 'episodio' || menuFicha.clase === 'canal')
          ? [
              {
                texto: 'Ver en la tele',
                onPress: () =>
                  void mandarALaTele({
                    clase: menuFicha.clase as MedioParaTele['clase'],
                    id: menuFicha.id,
                    titulo: menuFicha.titulo,
                  }),
              },
            ]
          : []),
      ]
    : [];

  /**
   * Lo que cuelga del círculo del perfil.
   *
   * Todo lo que es "de este usuario" vive aquí y no en la barra: cinco
   * botones de texto arriba tapaban contenido y no se leían de lejos.
   *
   * **Empieza por las otras personas de la casa**, con su cara y su nombre.
   * Antes había un "Cambiar de perfil" que llevaba a otra pantalla para
   * acabar eligiendo lo mismo: aquí se ve directamente a quién se pasa.
   * Editar el nombre y el color se fue a la pantalla de perfiles, que es
   * donde se ve lo que se está tocando.
   */
  const opcionesPerfil: Array<{ texto: string; onPress: () => void; retrato?: Perfil }> = [
    // Lo que suena en la tele, arriba del todo: es lo único de aquí que está
    // pasando ahora mismo.
    ...(enLaTele && !verMando
      ? [{ texto: `En la tele: ${enLaTele.medio.titulo}`, onPress: () => setVerMando(true) }]
      : []),
    ...otrosPerfiles.map((otro) => ({
      texto: otro.nombre,
      retrato: otro,
      onPress: () => onElegirPerfil(otro),
    })),
    {
      texto: `Reproducción continua: ${ajustes.continua ? 'sí' : 'no'}`,
      onPress: () => void alternarContinua(),
    },
    ...(descargas.length > 0
      ? [{ texto: `Descargas (${descargas.length})`, onPress: () => setVerDescargas(true) }]
      : []),
    { texto: 'Perfiles', onPress: onCambiarPerfil },
    { texto: 'Actualizar catálogo', onPress: onActualizar },
    { texto: 'Cerrar sesión', onPress: onCerrarSesion },
  ];

  /**
   * Las pestañas del inicio, delante de los iconos en el recorrido del mando.
   *
   * Van en el mismo índice que los botones —izquierda y derecha los recorren
   * todos seguidos— porque para quien maneja el mando es una sola fila, por
   * mucho que se dibujen en dos sitios de la barra.
   */
  const pestanasCabecera: Array<{ clave: string; nombre: string; onPress: () => void; activa: boolean }> =
    estado.inicio
      ? // Las cinco filtran el inicio, TV en directo incluido: ya no es otra
        // pantalla, es el mismo inicio con una fila por grupo de canales. La
        // rejilla completa —con su barra y su vista previa— sigue estando a
        // una pulsación: aceptar sobre la pestaña que ya está puesta.
        MODOS_INICIO.map((opcion) => ({
          clave: opcion.modo,
          nombre: opcion.nombre,
          activa: estado.inicio!.modo === opcion.modo,
          onPress: () => void presentador.current?.elegirModo(opcion.modo).then(setEstado),
        }))
      : [];

  const botonesCabecera: Array<{ texto: string; onPress: () => void; perfil?: true }> = [
    { texto: '⌕', onPress: abrirBuscador },
    ...(estado.lateral
      ? [
          {
            texto: '⚙',
            onPress: () => {
              // El foco entra en la opción que ya está en uso, no en la
              // primera: es de donde uno querrá moverse.
              setFocoAjustes(Math.max(0, COLUMNAS_POSIBLES.indexOf(ajustes.columnas as never)));
              setVerAjustes(true);
            },
          },
        ]
      : []),
    {
      // El texto no se usa en este: lleva el retrato del perfil.
      texto: '',
      perfil: true as const,
      onPress: () => {
        setFocoPerfil(0);
        setVerPerfil(true);
      },
    },
  ];

  /*
    El selector de sección. Cambia la portada y los carruseles sin cambiar de
    pantalla: la forma se mantiene y uno no se pierde. TV en directo sí es
    otra pantalla —tiene parrilla y vista previa—, así que entra en vez de
    filtrar.

    Se arma aparte porque va en dos sitios según quepa: centrado sobre la
    barra en una tele o una tablet, y en su propia línea en un teléfono.
  */
  const pestanas =
    pestanasCabecera.length > 0 ? (
      <View style={estrecha ? estilos.pestanasEnLinea : estilos.pestanas}>
        {pestanasCabecera.map((pestana, indice) => (
          <Pressable
            key={pestana.clave}
            focusable={false}
            style={[estilos.pestana, enCabecera && focoCabecera === indice && estilos.pestanaEnfocada]}
            onPress={pestana.onPress}
          >
            <Text style={[estilos.pestanaTexto, pestana.activa && estilos.pestanaTextoActiva]}>
              {pestana.nombre}
            </Text>
            {/* La sección en la que estás se marca con una raya debajo, no con
                un fondo: la barra es transparente y un recuadro relleno vuelve
                a taparlo todo. */}
            {pestana.activa ? <View style={estilos.pestanaRaya} /> : null}
          </Pressable>
        ))}
      </View>
    ) : null;

  /**
   * La cabecera: el título a la izquierda, la lupa y el perfil a la derecha.
   *
   * Se arma como variable porque en el inicio va dentro de la lista —para que
   * se desplace con ella— y en el resto de pantallas encima, fija.
   */
  const cabecera = (
    <View>
      <View style={estilos.cabecera}>
          <View style={estilos.tituloBloque}>
            {/* En el inicio no va ninguno: lo dicen las pestañas, y el
                subtítulo se comía el sitio de la portada. */}
            {estado.inicio || estado.ficha ? null : <Text style={estilos.titulo}>{estado.titulo}</Text>}
            {enInicio && !estado.inicio ? (
              <Text style={estilos.subtitulo}>
                {cuenta.nombre} · {cantidad(medicion.entradas, 'ficha', 'fichas')} ·{' '}
                {medicion.via === 'guardada'
                  ? `guardadas ${frescura(medicion.dias)}`
                  : `traídas del panel en ${(medicion.total / 1000).toFixed(0)} s`}
              </Text>
            ) : null}
          </View>

          {estrecha ? null : pestanas}

          {botonesCabecera.length > 0 ? (
            <View style={estilos.botonera}>
              {botonesCabecera.map((boton, indice) => (
                <Pressable
                  key={boton.texto}
                  /*
                    El foco del sistema no entra aquí a propósito: en esta
                    pantalla el recorrido lo lleva la aplicación, y si Android
                    además entregase el OK al botón, cada pulsación contaría dos
                    veces. Eso hacía que los ajustes se abrieran y se cerraran
                    en el mismo golpe.
                  */
                  focusable={false}
                  style={[
                    boton.perfil ? null : estilos.botonCabecera,
                    enCabecera &&
                      focoCabecera === pestanasCabecera.length + indice &&
                      !boton.perfil &&
                      estilos.botonCabeceraEnfocado,
                  ]}
                  onPress={boton.onPress}
                >
                  {boton.perfil ? (
                    <Retrato
                      perfil={perfil}
                      tamano={44}
                      enfocado={enCabecera && focoCabecera === pestanasCabecera.length + indice}
                    />
                  ) : (
                    <Text style={estilos.iconoCabecera}>{boton.texto}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}
      </View>

      {/*
        En un teléfono, las pestañas van debajo y se recorren con el dedo: en
        ese ancho no caben centradas entre los botones.
      */}
      {estrecha ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.pestanasDesplazables}>
          {pestanas}
        </ScrollView>
      ) : null}
    </View>
  );

  /** La barra de categorías, temporadas o grupos. Solo en las pantallas que la tienen. */
  const barraLateral = estado.lateral ? (
    <View style={[estilos.barra, estado.lateral.dentro && estilos.barraEnfocada]}>
      <FlatList
        focusable={false}
        isTVSelectable={false}
        scrollEnabled={DESPLAZA_EL_DEDO}
        ref={barra}
        data={estado.lateral.opciones}
        keyExtractor={(opcion) => opcion.grupo ?? 'todas'}
        extraData={estado.lateral}
        renderItem={({ item, index }) => {
          const activa = item.grupo === estado.lateral!.activa;
          const enfocada = estado.lateral!.dentro && index === estado.lateral!.foco;
          return (
            <Pressable
              style={[estilos.categoria, activa && estilos.categoriaActiva, enfocada && estilos.categoriaEnfocada]}
              onPress={() => presentador.current?.elegirCategoria(item.grupo).then(setEstado)}
            >
              <Text style={[estilos.categoriaTexto, activa && estilos.textoEnfocado]} numberOfLines={2}>
                {item.nombre}
              </Text>
              {item.cuantos !== null ? (
                <Text style={estilos.categoriaCuantos}>{numero(item.cuantos)}</Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  ) : null;

  /**
   * La rejilla —o la lista— con el contenido de la pantalla.
   *
   * Va envuelta en una vista con `flex`. Un `ScrollView` puesto directamente
   * dentro de un contenedor en fila no siempre recibe el ancho: en la tele se
   * quedaba en cuarenta píxeles y las fichas salían como tiras verticales,
   * con el título partido letra a letra. El envoltorio le fija el reparto.
   */
  const rejilla = (
    <View style={estilos.zonaLista}>
    <FlatList
      focusable={false}
      isTVSelectable={false}
      scrollEnabled={DESPLAZA_EL_DEDO}
      ref={lista}
      data={estado.elementos}
      // Cambiar el número de columnas obliga a rehacer la lista entera.
      key={`columnas-${estado.columnas}`}
      numColumns={estado.columnas}
      keyExtractor={(elemento) => elemento.id}
      columnWrapperStyle={estado.columnas > 1 ? estilos.fila : undefined}
      contentContainerStyle={estilos.contenido}
      // Con miles de fichas, solo se monta lo que se ve: es lo que hace que
      // el desplazamiento vaya fino y que las imágenes se pidan por tandas.
      initialNumToRender={12}
      windowSize={5}
      // `removeClippedSubviews` iba aquí: en Android 8 dejaba las filas con
      // altura cero —la lista se veía como una raya— y en la tele no había
      // biblioteca que valiera. Es un fallo conocido de esa optimización en
      // versiones antiguas, y sin ella la lista sigue yendo fina.
      onEndReachedThreshold={0.6}
      onEndReached={() => presentador.current?.cargarMas().then(setEstado)}
      ListFooterComponent={
        estado.hayMas ? <ActivityIndicator style={estilos.pie} color={VERDE} /> : null
      }
      style={estilos.listaPrincipal}
      renderItem={({ item, index }) => (
        <Ficha
          elemento={item}
          // El foco es uno solo: si está arriba —en la cabecera o en los
          // ajustes—, la ficha deja de estar marcada. Con dos resaltes a la
          // vez no se sabe dónde se va a quedar la próxima pulsación.
          enfocado={
            index === estado.foco &&
            !estado.lateral?.dentro &&
            !enCabecera &&
            !verAjustes &&
            !enElTexto
          }
          formato={estado.formato}
          columnas={estado.columnas}
          // A partir de seis por fila la carátula es estrecha y el texto de
          // siempre no cabe: las pastillas y el título se encogen con ella.
          apretada={estado.columnas >= 6}
          onPress={() => tocar(index)}
          onLongPress={() => mantener(index)}
        />
        )}
      />
    </View>
  );


  return (
    // Dos capas: la de dentro lleva los márgenes de la interfaz y la de fuera
    // no lleva ninguno. El reproductor cuelga de la de fuera a propósito: se
    // coloca con coordenadas de pantalla —las que mide la parrilla para su
    // hueco— y desde un contenedor con relleno saldría desplazado justo esos
    // 32 píxeles, montándose sobre los botones de la cabecera.
    <View
      style={estilos.raiz}
      ref={raiz}
      /*
        Aquí se queda el foco del sistema, y en ningún otro sitio de esta
        pantalla. Android solo entrega las teclas si algo está enfocado, pero
        si además lo estuviera cada ficha o cada botón, la pulsación de OK
        contaría dos veces: una por el botón y otra por el manejador de
        teclas. Eso abría una película al entrar en la sección y hacía que
        los ajustes se cerrasen en el mismo golpe en que se abrían.
      */
      focusable
      hasTVPreferredFocus
    >
    <View style={[estilos.pantalla, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {/*
        La cabecera.

        En el inicio **flota sobre la portada**, pegada al borde de arriba, y
        por eso se pinta después que la lista: la portada llega hasta el borde
        y si la cabecera fuera antes quedaría debajo de la imagen. Eso es
        justo lo que pasó al hacerla a sangre y desaparecieron los botones.

        En el resto de pantallas va donde siempre, ocupando su sitio.
      */}
      {estado.inicio ? null : cabecera}

      {/*
        El menú del perfil: todo lo que es "de este usuario", colgando del
        círculo en vez de repartido por la barra de arriba.
      */}
      {verPerfil ? (
        <View style={estilos.menuPerfil}>
          <View style={estilos.menuCabecera}>
            <Retrato perfil={perfil} tamano={52} />
            <Text style={estilos.menuNombre}>{perfil.nombre}</Text>
          </View>
          {opcionesPerfil.map((opcion, indice) => (
            <Pressable
              key={opcion.retrato?.id ?? opcion.texto}
              focusable={false}
              style={[estilos.menuOpcion, focoPerfil === indice && estilos.menuOpcionEnfocada]}
              onPress={() => {
                setVerPerfil(false);
                opcion.onPress();
              }}
            >
              {opcion.retrato ? <Retrato perfil={opcion.retrato} tamano={32} /> : null}
              <Text style={estilos.menuOpcionTexto}>{opcion.texto}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/*
        El menú de la ficha: lo que se puede hacer con lo que se mantuvo
        pulsado. Cuelga del centro y no de la carátula: con el mando no hay
        puntero al que anclarlo, y con el dedo la carátula puede estar en un
        borde.
      */}
      {/*
        Las descargas: qué hay bajado, qué se está bajando y por dónde va.

        Va como panel y no como pantalla porque no se navega por ella: se mira,
        se quita algo si estorba y se sale. Con el mando se recorre con arriba
        y abajo, como el resto de menús.
      */}
      {/*
        Las descargas: lo bajado, lo que está bajando y cuánto ocupa todo.

        Va como panel y no como pantalla porque no se navega por ella. Cada
        descarga trae **dos acciones**, y no una: la de la izquierda cambia
        según el estado —reproducir lo bajado, pausar lo que corre, reanudar lo
        parado— y la de la derecha siempre borra. Tenerlo todo en un solo toque
        obligaba a quitar una descarga para pausarla.
      */}
      {verDescargas ? (
        <View style={estilos.panelDescargas}>
          <View style={estilos.descargaCabecera}>
            <Text style={estilos.menuNombre}>Descargas</Text>
            <Text style={estilos.descargaAyuda}>
              {cantidad(descargas.filter((una) => una.estado === 'hecha').length, 'bajada', 'bajadas')}
              {disco ? ` · ${megas(disco.ocupado)} ocupados · ${megas(disco.libre)} libres` : ''}
            </Text>
            {tiempoBajado(descargas) ? (
              <Text style={estilos.descargaAyuda}>{tiempoBajado(descargas)}</Text>
            ) : null}
          </View>

          <ScrollView style={estilos.descargaLista}>
            {descargas.length === 0 ? (
              <Text style={estilos.descargaAyuda}>
                Todavía no has descargado nada. Mantén pulsada una película y elige Descargar.
              </Text>
            ) : null}

            {descargas.map((una) => (
              <View key={una.id} style={estilos.descargaFila}>
                <Text style={estilos.menuOpcionTexto} numberOfLines={1}>
                  {una.titulo}
                </Text>
                <Text style={estilos.descargaEstado}>
                  {comoVaLaDescarga(una, una.estado === 'bajando' ? marcha : null)}
                </Text>

                {una.total && una.estado !== 'hecha' ? (
                  <View style={estilos.descargaBarra}>
                    <View
                      style={[
                        estilos.descargaBarraHecha,
                        { width: `${Math.min(100, Math.round((una.bytes / una.total) * 100))}%` },
                      ]}
                    />
                  </View>
                ) : null}

                <View style={estilos.descargaBotones}>
                  <Pressable
                    focusable={false}
                    style={estilos.descargaBoton}
                    onPress={() => {
                      if (una.estado === 'hecha') {
                        setVerDescargas(false);
                        setReproduciendo({ clase: una.clase, id: una.itemId, titulo: una.titulo });
                        setAPantallaCompleta(true);
                        return;
                      }
                      if (una.estado === 'pausada' || una.estado === 'fallida') {
                        void cola?.anadir(una);
                        return;
                      }
                      void cola?.pausar(una.id);
                    }}
                  >
                    <Text style={estilos.descargaBotonTexto}>
                      {una.estado === 'hecha'
                        ? 'Reproducir'
                        : una.estado === 'pausada' || una.estado === 'fallida'
                          ? 'Reanudar'
                          : 'Pausar'}
                    </Text>
                  </Pressable>

                  <Pressable
                    focusable={false}
                    style={estilos.descargaBoton}
                    onPress={() => void cola?.quitar(una.id)}
                  >
                    <Text style={estilos.descargaBotonTexto}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {elegirTele ? (
        <View style={estilos.menuPerfil}>
          <Text style={estilos.menuNombre}>¿En qué tele?</Text>
          {elegirTele.teles.map((tele) => (
            <Pressable
              key={tele.control}
              focusable={false}
              style={estilos.menuOpcion}
              onPress={() => {
                const { medio } = elegirTele;
                setElegirTele(null);
                void ponerEnLaTele(tele, medio);
              }}
            >
              <Text style={estilos.menuOpcionTexto}>{tele.nombre}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/*
        El mando de la tele. Lo que se ve es lo que dice la tele cada dos
        segundos, no lo que se le ha pedido: si alguien la pausa con su propio
        mando, aquí sale en pausa.
      */}
      {enLaTele && verMando ? (
        <View style={estilos.pantallaTele}>
          {enLaTele.imagen ? (
            <Image source={{ uri: enLaTele.imagen }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
          <View style={estilos.pantallaTeleVelo} />

          <View style={[estilos.pantallaTeleArriba, { paddingTop: insets.top + 16 }]}>
            <Text style={estilos.pantallaTeleDonde} numberOfLines={1}>
              En {enLaTele.tele.nombre}
            </Text>
            <Pressable focusable={false} style={estilos.pantallaTeleBoton} onPress={() => setVerMando(false)}>
              <Text style={estilos.pantallaTeleBotonTexto}>Esconder</Text>
            </Pressable>
          </View>

          <View style={estilos.pantallaTeleCentro}>
            {enLaTele.fallo ? (
              <Text style={estilos.pantallaTeleFallo}>{enLaTele.fallo}</Text>
            ) : (
              <View style={estilos.pantallaTeleControles}>
                {enLaTele.medio.clase !== 'canal' ? (
                  <Pressable focusable={false} style={estilos.pantallaTeleSalto} onPress={() => ordenALaTele('atras')}>
                    <IconoSalto hacia="izquierda" tamano={22} />
                    <Text style={estilos.pantallaTeleSaltoTexto}>30</Text>
                  </Pressable>
                ) : null}
                <Pressable focusable={false} style={estilos.pantallaTelePlay} onPress={() => ordenALaTele('alternar')}>
                  {enLaTele.situacion?.estado === 'PLAYING' ? <IconoPausa tamano={34} /> : <IconoPlay tamano={38} />}
                </Pressable>
                {enLaTele.medio.clase !== 'canal' ? (
                  <Pressable focusable={false} style={estilos.pantallaTeleSalto} onPress={() => ordenALaTele('adelante')}>
                    <IconoSalto hacia="derecha" tamano={22} />
                    <Text style={estilos.pantallaTeleSaltoTexto}>30</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          <View style={[estilos.pantallaTeleAbajo, { paddingBottom: insets.bottom + 28 }]}>
            <Text style={estilos.pantallaTeleTitulo} numberOfLines={2}>
              {enLaTele.titulo}
            </Text>
            {enLaTele.subtitulo ? (
              <Text style={estilos.pantallaTeleSubtitulo} numberOfLines={1}>
                {enLaTele.subtitulo}
              </Text>
            ) : null}

            {!enLaTele.fallo ? (
              <>
                <View style={estilos.pantallaTeleBarra}>
                  <View
                    style={[
                      estilos.pantallaTeleBarraHecha,
                      {
                        width:
                          enLaTele.situacion?.duracion && enLaTele.situacion.posicion !== null
                            ? `${Math.min(100, (enLaTele.situacion.posicion / enLaTele.situacion.duracion) * 100)}%`
                            : '0%',
                      },
                    ]}
                  />
                </View>
                <Text style={estilos.pantallaTeleEstado}>{comoVaLaTele(enLaTele)}</Text>
              </>
            ) : null}

            <View style={estilos.pantallaTeleBotones}>
              {enLaTele.fallo ? (
                <>
                  <Pressable
                    focusable={false}
                    style={estilos.pantallaTeleBoton}
                    onPress={() => void ponerEnLaTele(enLaTele.tele, enLaTele.medio)}
                  >
                    <Text style={estilos.pantallaTeleBotonTexto}>Reintentar</Text>
                  </Pressable>
                  <Pressable focusable={false} style={estilos.pantallaTeleBoton} onPress={() => soltarTele(null)}>
                    <Text style={estilos.pantallaTeleBotonTexto}>Cerrar</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable focusable={false} style={estilos.pantallaTeleBoton} onPress={() => ordenALaTele('parar')}>
                  <Text style={estilos.pantallaTeleBotonTexto}>Parar</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      ) : null}

      {menuFicha ? (
        <View style={estilos.menuPerfil}>
          <Text style={estilos.menuNombre} numberOfLines={2}>
            {menuFicha.titulo}
          </Text>
          {opcionesFicha.map((opcion, indice) => (
            <Pressable
              key={opcion.texto}
              focusable={false}
              style={[estilos.menuOpcion, focoFicha === indice && estilos.menuOpcionEnfocada]}
              onPress={() => {
                setMenuFicha(null);
                opcion.onPress();
              }}
            >
              <Text style={estilos.menuOpcionTexto}>{opcion.texto}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/*
        La barra flota sobre la portada, así que hay que quitarla a mano
        cuando el vídeo ocupa la pantalla: el reproductor se pinta por encima
        de todo lo demás, pero esto va en su propia capa y se quedaba puesto
        sobre la película.
      */}
      {estado.inicio && !(reproduciendo && aPantallaCompleta) ? (
        // El hueco de arriba es del sistema: en la tele no hay ninguno, pero
        // en un teléfono ahí están el reloj y la batería, y la barra se les
        // metía debajo.
        <View style={[estilos.cabeceraFlotante, { paddingTop: insets.top + 14 }]}>{cabecera}</View>
      ) : null}

      {verAjustes && estado.lateral ? (
        <View style={estilos.ajustes}>
          <Text style={estilos.ajustesTitulo}>Carátulas por fila</Text>
          <View style={estilos.ajustesFila}>
            {COLUMNAS_POSIBLES.map((cuantas, indice) => (
              <Pressable
                key={cuantas}
                focusable={false}
                style={[
                  estilos.opcion,
                  ajustes.columnas === cuantas && estilos.opcionActiva,
                  focoAjustes === indice && estilos.opcionEnfocada,
                ]}
                onPress={() => void cambiarColumnas(cuantas)}
              >
                <Text
                  style={[estilos.opcionTexto, ajustes.columnas === cuantas && estilos.opcionTextoActiva]}
                >
                  {cuantas}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[estilos.ajustesTitulo, estilos.ajustesSeparado]}>Ordenar por</Text>
          <View style={estilos.ajustesFila}>
            {ORDENES.map(([clave, nombre], indice) => (
              <Pressable
                key={clave}
                focusable={false}
                style={[
                  estilos.opcion,
                  ajustes.orden === clave && estilos.opcionActiva,
                  focoAjustes === COLUMNAS_POSIBLES.length + indice && estilos.opcionEnfocada,
                ]}
                onPress={() => void cambiarOrden(clave)}
              >
                <Text style={[estilos.opcionTexto, ajustes.orden === clave && estilos.opcionTextoActiva]}>
                  {nombre}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={estilos.ajustesPie}>Se guarda en el perfil «{perfil.nombre}»</Text>
        </View>
      ) : null}

      {estado.busqueda !== null ? (
        <TextInput
          style={estilos.campoBusqueda}
          value={texto}
          onChangeText={teclear}
          placeholder="Escribe para buscar…"
          placeholderTextColor="#5d6f7d"
          autoFocus
          autoCorrect={false}
        />
      ) : null}

      {/*
        El inicio es su propia pantalla: una sola lista vertical de filas.

        No pasa por el cuerpo de abajo —que es una fila horizontal pensada
        para barra + rejilla + parrilla— porque aquí lo que hace falta es
        justo lo contrario: que **todo baje junto**. Cuando eran dos bloques
        con desplazamiento propio, en el teléfono el primero se comía la
        pantalla y el menú no se veía.
      */}
      {estado.inicio ? (
        <PantallaInicio
          enCabecera={enCabecera}
          inicio={estado.inicio}
          programas={programas}
          sello={sello}
          onMantener={mantenerEnInicio}
          onTurno={turnarDestacado}
          onTocar={tocarEnInicio}
        />
      ) : null}

      <View style={[estilos.cuerpo, estado.inicio && estilos.cuerpoOculto]}>
        {estado.ficha ? (
          <PantallaFicha ficha={estado.ficha} botones={estado.elementos} foco={estado.foco} onTocar={aceptarEn} />
        ) : (
          <>
            {barraLateral}
            {rejilla}
          </>
        )}
      </View>
      </View>

      {reproduciendo ? (
        <Reproductor
          biblioteca={biblioteca}
          medio={reproduciendo}
          perfiles={perfiles}
          perfil={perfil}
          // La lista de la pantalla de la que se salió: de ahí salen el
          // episodio siguiente y el zapeo entre canales del grupo.
          /*
            La cola sale de la pantalla de la que se salió —los capítulos de
            una temporada, los canales de un grupo—, y si esa pantalla no era
            una lista de lo mismo, del capítulo siguiente que diga la
            biblioteca.
          */
          cola={colaDe(estado.elementos, reproduciendo) ?? colaDeUno(reproduciendo, siguienteSuelto)}
          onCambiar={setReproduciendo}
          programacion={programacion}
          arbitro={arbitro}
          /*
            Si esto ya está en el disco, se ve de ahí: ni petición al panel ni
            ranura ocupada. Es media razón de ser de las descargas —la otra es
            poder verlo sin red—.
          */
          ficheroLocal={ficheroBajadoDe(descargas, reproduciendo)}
          // Lo que el árbitro eche para dejar sitio a esta película: hoy solo
          // pueden ser descargas, que son lo único que vale menos.
          onExpulsar={pararDescarga}
          continua={ajustes.continua}
          onAbrir={() => setAPantallaCompleta(true)}
        />
      ) : null}

      {avisoSalida ? (
        <View style={estilos.aviso}>
          <Text style={estilos.avisoTexto}>Pulsa atrás otra vez para salir</Text>
        </View>
      ) : null}

      {/* Lo que no abre pantalla se dice aquí abajo y se va solo. */}
      {aviso ? (
        <View style={estilos.aviso}>
          <Text style={estilos.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}

      {interrumpido ? (
        <View style={estilos.aviso}>
          <Text style={estilos.avisoTexto}>
            Se ha parado: {perfil.nombre} ha empezado a ver algo en {interrumpido}
          </Text>
        </View>
      ) : null}
    </View>
  );
}


/**
 * El reparto, tal como lo manda el panel: "Seth Rogen,Olivia Wilde,…".
 *
 * Sin espacio detrás de la coma, así que se separa aquí con el mismo punto
 * medio que usa el resto de la interfaz.
 */
function separado(lista: string): string {
  return lista
    .split(',')
    .map((uno) => uno.trim())
    .filter(Boolean)
    .join(' · ');
}

/**
 * La pantalla de información de una película o de una serie.
 *
 * Es la única a la que no se llega pulsando: el toque normal reproduce, y esto
 * cuelga del menú de mantener pulsado. Enseña lo que no cabe en una carátula
 * —sinopsis, reparto, género— y los botones de lo que se puede hacer.
 *
 * El fondo apaisado va detrás y degradado hacia el negro de la aplicación:
 * cuando el panel no lo trae —que pasa a menudo—, queda el negro y ya está,
 * sin hueco ni marco vacío.
 */
function PantallaFicha({
  ficha,
  botones,
  foco,
  onTocar,
}: {
  ficha: FichaDetalle;
  /** Los botones vienen como elementos: así el mando los recorre igual. */
  botones: Elemento[];
  foco: number;
  onTocar: (indice: number) => void;
}) {
  return (
    <ScrollView style={estilos.infoPantalla} contentContainerStyle={estilos.infoContenido}>
      {ficha.fondo ? (
        <Image source={{ uri: ficha.fondo }} style={estilos.infoFondo} resizeMode="cover" />
      ) : null}
      <View style={estilos.infoVeloFondo} pointerEvents="none" />

      <View style={estilos.infoCuerpo}>
        {ficha.cartel ? (
          <Image source={{ uri: ficha.cartel }} style={estilos.infoCartel} resizeMode="cover" />
        ) : null}

        <View style={estilos.infoTexto}>
          <Text style={estilos.infoTitulo}>{ficha.titulo}</Text>

          <View style={estilos.infoDatos}>
            {ficha.valoracion !== null ? (
              <>
                <Estrellas valoracion={ficha.valoracion} />
                <Text style={estilos.infoNota}>{nota(ficha.valoracion)}</Text>
              </>
            ) : null}
            {ficha.anio !== null ? <Text style={estilos.infoDato}>{ficha.anio}</Text> : null}
            {ficha.genero ? <Text style={estilos.infoDato}>{ficha.genero}</Text> : null}
          </View>

          {/*
            Los botones van **antes de la sinopsis**, como en cualquier
            servicio de estos. Detrás, una sinopsis larga los empujaba fuera de
            la pantalla y no había forma de llegar a ellos con el mando.
          */}
          <View style={estilos.infoBotones}>
            {botones.map((boton, indice) => (
              <Pressable
                key={boton.id}
                focusable={false}
                style={[
                  estilos.infoBoton,
                  indice === 0 && estilos.infoBotonPrincipal,
                  foco === indice && estilos.infoBotonEnfocado,
                ]}
                onPress={() => onTocar(indice)}
              >
                <Text
                  style={[
                    estilos.infoBotonTexto,
                    indice === 0 && estilos.infoBotonTextoPrincipal,
                  ]}
                >
                  {boton.titulo}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Y la sinopsis, con tope: en una tele no se leen veinte líneas. */}
          {ficha.sinopsis ? (
            <Text style={estilos.infoSinopsis} numberOfLines={6}>
              {ficha.sinopsis}
            </Text>
          ) : null}
          {ficha.reparto ? (
            <Text style={estilos.infoReparto} numberOfLines={2}>
              {separado(ficha.reparto)}
            </Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Una ficha de la lista, en los cuatro formatos que hay.
 *
 * Las imágenes se piden solas al aparecer en pantalla y Android las cachea en
 * disco por su cuenta (Fresco): no hay que guardarlas nosotros, y así solo se
 * descargan las que de verdad se miran. Mientras llega la imagen queda el
 * hueco en gris, para que la rejilla no baile.
 */
/**
 * La pantalla de inicio: una sola lista vertical de filas.
 *
 * Todo baja junto. Cada fila lleva su propio desplazamiento horizontal, que es
 * lo natural en un carrusel, pero **el vertical es uno solo**: es la
 * diferencia entre una pantalla que se recorre y varios bloques que se pelean
 * por el alto, que era lo que dejaba el menú fuera de la vista en el teléfono.
 */
function PantallaInicio({
  enCabecera,
  inicio,
  programas,
  sello,
  onTocar,
  onMantener,
  onTurno,
}: {
  /** El mando está arriba, en la lupa o el perfil. */
  enCabecera: boolean;
  inicio: Inicio;
  /** Lo que echan en cada canal, para las filas de TV en directo. */
  programas: Record<string, Programa[]>;
  /** Sube con el reloj: es lo que hace que las fichas se repinten. */
  sello: number;
  onTocar: (fila: number, columna: number) => void;
  /** Mantener pulsado añade a Mi Lista, igual que en la rejilla. */
  onMantener: (fila: number, columna: number) => void;
  /** La portada pasa a la siguiente sugerencia. */
  onTurno: (siguiente: number) => void;
}) {
  const lista = useRef<FlatList<FilaInicio>>(null);
  const { height: alto } = useWindowDimensions();

  /*
    El destacado ocupa la mayor parte de la pantalla, y por arriba se mete por
    debajo de la cabecera. El tope es para que en un televisor de 4K no se
    coma la fila de "seguir viendo", que tiene que asomar: es lo que invita a
    bajar.
  */
  const altoDestacado = Math.min(470, Math.round(alto * 0.58)) + MARGEN_CABECERA;

  useEffect(() => {
    // Con el foco arriba hay que subir del todo: la cabecera va dentro de la
    // lista, y `scrollToIndex` solo sabe llegar a las filas de datos.
    if (enCabecera) {
      lista.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    /*
      La portada es la primera fila, así que volver a ella es subir del todo.
      `scrollToIndex` no vale aquí: dejaría su borde superior arriba y la
      cabecera, que va por encima, taparía media portada.

      Antes esto no hacía nada —para no desplazar nada al abrir— y era el
      único sitio donde el foco se movía sin que la pantalla lo siguiera:
      subiendo desde los carruseles, el botón de reproducir se quedaba fuera.
    */
    if (inicio.fila === 0) {
      lista.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    if (inicio.filas.length === 0) return;
    lista.current?.scrollToIndex({
      index: Math.min(inicio.fila, inicio.filas.length - 1),
      animated: true,
      viewPosition: 0.3,
    });
  }, [enCabecera, inicio.fila, inicio.filas.length]);

  return (
    <FlatList
      focusable={false}
      isTVSelectable={false}
      scrollEnabled={DESPLAZA_EL_DEDO}
      ref={lista}
      style={estilos.inicioLista}
      data={inicio.filas}
      keyExtractor={(fila, indice) => `${fila.tipo}-${indice}`}
      extraData={inicio}
      showsVerticalScrollIndicator={false}
      /*
        Sin portada arriba —Mi Lista, o un inicio sin nada que destacar— la
        primera fila se metería debajo de la barra flotante, que no ocupa
        sitio en el flujo. El hueco se lo pone la lista.
      */
      contentContainerStyle={inicio.filas[0]?.tipo === 'destacado' ? undefined : estilos.inicioSinPortada}
      // Son pocas filas y `scrollToIndex` necesita que estén montadas.
      initialNumToRender={8}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index }) => {
        /*
          Con el mando en la cabecera **ninguna fila está marcada**: si no, el
          botón de reproducir de la portada —o el último canal de una fila— se
          quedaba con su borde puesto mientras el foco estaba arriba, y había
          dos sitios marcados a la vez.
        */
        const activa = index === inicio.fila && !enCabecera;

        if (item.tipo === 'destacado') {
          return (
            <Destacado
              elementos={item.elementos}
              indice={inicio.destacado}
              alto={altoDestacado}
              enfocado={activa}
              fila={index}
              onTurno={onTurno}
              onTocar={onTocar}
            />
          );
        }

        if (item.tipo === 'filtros') {
          return (
            <Filtros
              elementos={item.elementos}
              activa={activa}
              columna={activa ? inicio.columna : 0}
              fila={index}
              onTocar={onTocar}
            />
          );
        }

        return (
          <Carrusel
            titulo={item.titulo}
            fila={index}
            elementos={item.elementos}
            formato={item.formato}
            activa={activa}
            /*
              **La columna solo se le da a la fila activa.** Dándosela a todas,
              cada movimiento del mando cambiaba una prop en las ocho filas de
              la pantalla y `memo` no servía de nada: se repintaban enteras. Es
              lo que costaba el segundo de retraso en la tele.
            */
            columna={activa ? inicio.columna : 0}
            programas={programas}
            sello={sello}
            onTocar={onTocar}
            onMantener={onMantener}
          />
        );
      }}
      ListEmptyComponent={
        inicio.modo === 'lista' ? (
          <View style={estilos.listaVacia}>
            <Text style={estilos.listaVaciaTexto}>Aquí va lo que marques con el corazón.</Text>
            <Text style={estilos.listaVaciaPista}>
              Mantén pulsado sobre una carátula —o deja el OK apretado con el mando— para añadirla.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

/**
 * La fila de filtros de Mi Lista.
 *
 * Es una fila más de la lista, no una barra aparte: así se recorre con el
 * mando igual que las carátulas y no hay que inventar otro sitio donde pueda
 * estar el foco.
 */
const Filtros = memo(function Filtros({
  elementos,
  activa,
  columna,
  fila,
  onTocar,
}: {
  elementos: Elemento[];
  activa: boolean;
  columna: number;
  fila: number;
  onTocar: (fila: number, columna: number) => void;
}) {
  return (
    <View style={estilos.filtros}>
      {elementos.map((elemento, indice) => {
        const enfocado = activa && indice === columna;
        // `favorito` marca cuál está puesto: lo pone el presentador.
        return (
          <Pressable
            key={elemento.id}
            focusable={false}
            onPress={() => onTocar(fila, indice)}
            style={[estilos.filtro, elemento.favorito && estilos.filtroPuesto, enfocado && estilos.filtroEnfocado]}
          >
            <Text style={[estilos.filtroTexto, elemento.favorito && estilos.filtroTextoPuesto]}>
              {elemento.titulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/**
 * La película que preside el inicio.
 *
 * El degradado son capas oscuras superpuestas, no un degradado de verdad:
 * React Native no los trae y la librería que los añade es un módulo nativo,
 * que es justo lo que este proyecto lleva evitando desde el principio. A este
 * tamaño no se distingue.
 *
 * El cartel va a la derecha y el texto a la izquierda porque el panel solo da
 * carteles verticales, no arte apaisado: estirarlo a pantalla ancha lo
 * deformaría.
 */
/**
 * Las cinco estrellas de la nota, dibujadas.
 *
 * La media no es un carácter sino una estrella llena **recortada a la mitad**
 * sobre una hueca. El carácter que existe para ella no está en la fuente de un
 * televisor y salía como un cuadrado vacío, que es peor que no ponerla.
 */
function Estrellas({ valoracion }: { valoracion: number }) {
  const medias = mediasEstrellas(valoracion);
  if (medias === 0) return null;

  return (
    <View style={estilos.estrellas}>
      {[0, 1, 2, 3, 4].map((posicion) => {
        const llenas = medias - posicion * 2;
        if (llenas >= 2) return <Text key={posicion} style={estilos.estrellaLlena}>★</Text>;
        if (llenas <= 0) return <Text key={posicion} style={estilos.estrellaHueca}>☆</Text>;

        return (
          <View key={posicion}>
            <Text style={estilos.estrellaHueca}>☆</Text>
            <View style={estilos.estrellaMitad}>
              <Text style={estilos.estrellaLlena}>★</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Cuánto se queda cada sugerencia antes de dar paso a la siguiente. */
const TURNO_PORTADA_MS = 8000;

/** Lo que tarda el fundido entre una y otra. */
const FUNDIDO_MS = 600;

/**
 * La portada del inicio, con sus sugerencias turnándose.
 *
 * **Lo único que se funde es la imagen.** La ficha —título, nota, sinopsis— se
 * cambia de golpe, en el mismo momento en que empieza el fundido.
 *
 * Las dos formas anteriores se veían raras, y las dos por lo mismo: por
 * fundir el texto. Apagar la portada entera y volver a encenderla deja un
 * hueco sin nada en medio; cruzar las dos capas deja dos títulos
 * superpuestos, y encima un bajón de luz, porque dos capas a media opacidad
 * sobre fondo oscuro suman menos que una entera.
 *
 * De la que sale se pinta solo su imagen, quieta y entera debajo, y la nueva
 * aparece encima. Así en ningún instante falta imagen ni sobra texto.
 *
 * El reloj lo lleva la vista y no el presentador porque es cosa de la
 * animación: el presentador solo apunta cuál se está enseñando, para que
 * aceptar reproduzca la correcta.
 */
const Destacado = memo(function Destacado({
  elementos,
  indice,
  alto,
  enfocado,
  fila,
  onTurno,
  onTocar,
}: {
  elementos: Elemento[];
  indice: number;
  alto: number;
  enfocado: boolean;
  fila: number;
  onTurno: (siguiente: number) => void;
  onTocar: (fila: number, columna: number) => void;
}) {
  /**
   * Cuál de las dos capas se está viendo: 0 la de abajo, 1 la de arriba.
   *
   * **Las dos capas no se desmontan nunca.** Es lo que quita el fotograma en
   * negro: antes, al cambiar de sugerencia, se montaba una imagen nueva y a
   * la otra se le cambiaba la dirección a la vez, así que las dos estaban
   * cargando al mismo tiempo y por un momento no había ninguna que pintar.
   *
   * Aquí la imagen nueva se le pone siempre a la capa que **no se está
   * viendo**, tapada del todo por la otra, y solo cuando ya ha cargado se
   * descubre. Cargar a escondidas y enseñar cuando está lista.
   */
  const capa = useRef(new Animated.Value(0)).current;
  const [imagenes, setImagenes] = useState<{ abajo: string | null; arriba: string | null }>({
    abajo: null,
    arriba: null,
  });
  /** Cuál manda ahora mismo. */
  const enArriba = useRef(false);
  /** La que está cargando a escondidas, esperando a que se la descubra. */
  const esperando = useRef<'abajo' | 'arriba' | null>(null);
  const puesta = useRef<string | null>(null);

  /*
    El índice y la función de turno se leen de una referencia, no de las
    dependencias del efecto.

    Si el efecto dependiera de ellos, el reloj se rehace en cada pintado —y
    `onTurno` llega como una función nueva cada vez—, así que nunca llegaba a
    cumplir su tiempo. Se notaba en la pestaña "Todo", que al tener más
    carruseles se repinta más: allí la portada no se turnaba jamás.
  */
  const actual = useRef(indice);
  actual.current = indice;
  const turno = useRef(onTurno);
  turno.current = onTurno;

  useEffect(() => {
    if (elementos.length < 2) return;
    const reloj = setInterval(() => turno.current(actual.current + 1), TURNO_PORTADA_MS);
    return () => clearInterval(reloj);
  }, [elementos.length]);

  /** Descubre la capa que estaba cargando, fundiéndola sobre la otra. */
  const descubrir = useCallback(
    (cual: 'abajo' | 'arriba') => {
      if (esperando.current !== cual) return;
      esperando.current = null;
      enArriba.current = cual === 'arriba';
      Animated.timing(capa, {
        toValue: cual === 'arriba' ? 1 : 0,
        duration: FUNDIDO_MS,
        useNativeDriver: true,
      }).start();
    },
    [capa],
  );

  const elemento = elementos[Math.min(indice, elementos.length - 1)] ?? null;

  /*
    El relevo se prepara **durante el pintado**, no en un efecto: un efecto se
    ejecuta cuando el pintado ya ha salido, y entonces se ve un fotograma con
    la sugerencia a medio cambiar. Cambiar el estado aquí es lo que React
    llama ajustarlo al vuelo —vuelve a pintar en el sitio, antes de enseñar
    nada— y el guardia del `if` lo corta en la segunda pasada.
  */
  if (elemento && puesta.current !== elemento.id) {
    const primera = puesta.current === null;
    puesta.current = elemento.id;

    if (primera) {
      // La primera no se funde con nada: se pone abajo y se ve.
      setImagenes({ abajo: elemento.logo, arriba: null });
      esperando.current = null;
    } else {
      const destino = enArriba.current ? 'abajo' : 'arriba';
      setImagenes((previas) => ({ ...previas, [destino]: elemento.logo }));
      esperando.current = destino;
    }
  }

  useEffect(() => {
    if (!esperando.current) return;
    const cual = esperando.current;
    /*
      Red de seguridad. Lo normal es que la descubra `onLoad` en cuanto la
      imagen esté lista —del caché, al instante—, pero si esa imagen no llega
      nunca (servidor caído, dirección rota) la portada se quedaría clavada
      en la anterior para siempre.
    */
    const plazo = setTimeout(() => descubrir(cual), 2000);
    return () => clearTimeout(plazo);
  }, [imagenes, descubrir]);

  if (!elemento) return null;

  return (
    <View style={[estilos.destacado, { height: alto }]}>
      {/*
        Las dos capas, siempre montadas. La de abajo se ve entera y la de
        arriba se funde encima; cuál manda va turnándose, así que a la que le
        toca cambiar de imagen siempre está tapada mientras carga.
      */}
      <View style={estilos.destacadoCapa} pointerEvents="none">
        {imagenes.abajo ? (
          <Image
            source={{ uri: imagenes.abajo }}
            style={estilos.destacadoImagen}
            resizeMode="cover"
            onLoad={() => descubrir('abajo')}
          />
        ) : null}
      </View>

      <Animated.View style={[estilos.destacadoCapa, { opacity: capa }]} pointerEvents="none">
        {imagenes.arriba ? (
          <Image
            source={{ uri: imagenes.arriba }}
            style={estilos.destacadoImagen}
            resizeMode="cover"
            onLoad={() => descubrir('arriba')}
          />
        ) : null}
      </Animated.View>

      {/*
        Tres degradados: uno de lado, que despeja la izquierda para el texto;
        otro abajo, que funde la imagen con la fila siguiente en vez de
        cortarla en seco; y otro arriba, para que la barra flotante se lea.

        Van fuera de las capas porque no cambian con la sugerencia: fundirlos
        con ella sería fundir el velo del texto, y el texto no se funde.
      */}
      <View style={estilos.destacadoVelo} pointerEvents="none" />
      <View style={estilos.destacadoPie} pointerEvents="none" />
      <View style={estilos.destacadoTecho} pointerEvents="none" />

      <View style={estilos.destacadoCapa} pointerEvents="box-none">
        <View style={estilos.destacadoTexto}>
          <Text style={estilos.destacadoEtiqueta}>Destacada</Text>
          <Text style={estilos.destacadoNombre} numberOfLines={2}>
            {elemento.titulo}
          </Text>

          <View style={estilos.destacadoDatos}>
            {elemento.valoracion !== null ? (
              <>
                <Estrellas valoracion={elemento.valoracion} />
                <Text style={estilos.destacadoNota}>{nota(elemento.valoracion)}</Text>
              </>
            ) : null}
            {elemento.anio !== null ? <Text style={estilos.destacadoAnio}>{elemento.anio}</Text> : null}
          </View>

          {/* Lo que el panel no rellene simplemente no se pinta. */}
          {elemento.resumen ? (
            <Text style={estilos.destacadoSinopsis} numberOfLines={3}>
              {elemento.resumen}
            </Text>
          ) : null}
          {elemento.detalle ? (
            <Text style={estilos.destacadoReparto} numberOfLines={1}>
              {elemento.detalle}
            </Text>
          ) : null}

          {/*
            Reproducir es un botón de verdad, y **el único sitio que responde
            al dedo**: con la portada entera pulsable, en la tablet arrancaba
            la película al tocar la imagen sin querer.
          */}
          <Pressable
            focusable={false}
            onPress={() => onTocar(fila, 0)}
            style={[estilos.destacadoBoton, enfocado && estilos.destacadoBotonEnfocado]}
          >
            <Text style={estilos.destacadoBotonTexto}>▶  Reproducir</Text>
          </Pressable>
        </View>

        {/* El género, en la esquina, donde no compite con el título. */}
        {elemento.genero ? (
          <Text style={estilos.destacadoGenero} numberOfLines={1}>
            {elemento.genero}
          </Text>
        ) : null}
      </View>

      {/* Los puntitos, para saber cuántas hay y por cuál va. */}
      {elementos.length > 1 ? (
        <View style={estilos.destacadoPuntos} pointerEvents="none">
          {elementos.map((una, posicion) => (
            <View
              key={una.id}
              style={[estilos.destacadoPunto, posicion === indice && estilos.destacadoPuntoActivo]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * Una fila horizontal de fichas: los carruseles y el menú de secciones.
 *
 * También con `memo`: al mover el foco entre filas, las demás no tienen nada
 * que repintar, y son ocho o diez por pantalla.
 */
/**
 * Cómo va una descarga, en una línea.
 *
 * En megas y no en porcentaje mientras no se sepa el tamaño: el panel no
 * siempre manda `Content-Length`, y un porcentaje inventado es peor que un
 * número que crece.
 */
function megas(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * Cuánto vídeo hay bajado, en palabras.
 *
 * Es la pregunta de antes de un vuelo: no cuántos ficheros hay, sino cuántas
 * horas se pueden ver sin red. Lo que no tiene duración conocida **se dice**
 * en vez de contarlo como cero: una película sin duración haría que el total
 * se quedara corto y nadie sabría por qué.
 */
/** Lo que se le puede mandar a una tele: una cosa que se reproduce entera. */
type MedioParaTele = { clase: 'pelicula' | 'episodio' | 'canal'; id: string; titulo: string };

/** Lo que está sonando en una tele de la casa, mandado desde aquí. */
interface EnLaTele {
  tele: Tele;
  medio: MedioParaTele;
  /** Lo que se le mandó. Hace falta para explicar un fallo, no para pintar. */
  url: string;
  /** Lo que se pinta: la serie o la película, y debajo el capítulo. */
  titulo: string;
  subtitulo: string | null;
  /** El fotograma del capítulo o el fondo de la película, quieto. */
  imagen: string | null;
  /**
   * Por qué no ha podido la tele. Mientras lo hay, la pantalla se queda con
   * el porqué a la vista en vez de cerrarse: un aviso de tres segundos abajo
   * se pierde, que uno está mirando la tele y no el teléfono.
   */
  fallo: string | null;
  /** Lo último que dijo la tele. Nulo hasta la primera respuesta. */
  situacion: Situacion | null;
  /** Si llegó a sonar: es lo que distingue "ha terminado" de "no pudo abrirlo". */
  empezada: boolean;
  /** Cuándo se mandó, en ms. */
  desde: number;
}

/**
 * La ranura que ocupa la tele en el árbitro. Una sola: mandar otra cosa
 * reemplaza lo que hubiera, igual que en la propia tele.
 */
const RANURA_TELE = 'tele';

/** `12:03` o `1:05:20`, como en el reproductor. */
function enReloj(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = String(total % 60).padStart(2, '0');
  return horas > 0 ? `${horas}:${String(minutos).padStart(2, '0')}:${resto}` : `${minutos}:${resto}`;
}

/**
 * Cómo se enseña lo que suena en la tele: título, capítulo e imagen.
 *
 * La imagen es **la del capítulo** si la hay —el fotograma, que es lo que uno
 * reconoce—, y si no el fondo apaisado de la serie o la película. La carátula
 * vertical va la última: estirada a pantalla completa se ve borrosa.
 */
async function caraDeLoQueSuena(
  biblioteca: Biblioteca,
  medio: MedioParaTele,
): Promise<{ titulo: string; subtitulo: string | null; imagen: string | null }> {
  if (medio.clase === 'episodio') {
    const episodio = (await biblioteca.episodiosPorClave([medio.id]).catch(() => []))[0];
    if (episodio) {
      const fondo = episodio.imagen
        ? null
        : ((await biblioteca.detalleDeSerie(episodio.serieId).catch(() => null))?.fondo ?? null);
      return {
        titulo: episodio.serieTitulo,
        subtitulo: `T${episodio.temporada} E${episodio.numero}${episodio.titulo ? ` · ${episodio.titulo}` : ''}`,
        imagen: episodio.imagen || fondo || episodio.serieLogo,
      };
    }
  }
  if (medio.clase === 'pelicula') {
    const ficha = await biblioteca.detalleDePelicula(medio.id).catch(() => null);
    return { titulo: medio.titulo, subtitulo: null, imagen: ficha?.fondo ?? null };
  }
  return { titulo: medio.titulo, subtitulo: medio.clase === 'canal' ? 'En directo' : null, imagen: null };
}

/**
 * Por qué la tele no ha podido abrir algo que el teléfono sí abre.
 *
 * La tele solo dice "Error inesperado". Se leen los primeros kilobytes del
 * fichero, que en un MKV dicen en claro qué pistas trae, y se cuenta.
 * **Solo cuando falla**: leer el fichero gasta una conexión del panel, y para
 * entonces la de la tele ya se ha soltado.
 */
async function porQueNoLoAbreLaTele(url: string): Promise<string> {
  const visto = await mirarElFichero(url).catch(() => null);
  if (!visto) return 'La tele no ha podido reproducirlo.';
  console.log(
    `[tele] el fichero: ${visto.estado}${visto.redirige ? ` · redirige a ${visto.redirige}` : ''}` +
      ` · ${visto.codecs.join(', ') || 'sin pistas reconocibles'}`,
  );

  const problemas = loQueUnaTeleNoSabe(visto.codecs);
  const pistas = visto.codecs.filter((codec) => !codec.startsWith('S_')).map(nombreDeCodec);
  if (problemas.length > 0) return `La tele no puede con este fichero: ${problemas.join('; ')}.`;
  if (visto.estado >= 400) return `La tele no ha podido abrirlo: el panel contesta ${visto.estado}.`;
  if (pistas.length > 0) {
    return `La tele no ha podido reproducirlo, y el fichero es normal (${pistas.join(', ')}). El problema está entre la tele y el servidor.`;
  }
  return 'La tele no ha podido reproducirlo.';
}

/** En qué está la tele, en una línea. */
function comoVaLaTele(enLaTele: EnLaTele): string {
  const situacion = enLaTele.situacion;
  if (!situacion || situacion.estado === 'TRANSITIONING' || !enLaTele.empezada) return 'Abriendo el vídeo en la tele…';
  const estado = situacion.estado === 'PAUSED_PLAYBACK' ? 'En pausa' : 'Sonando';
  if (enLaTele.medio.clase === 'canal') return `${estado} · en directo`;
  if (situacion.posicion === null) return estado;
  return `${estado} · ${enReloj(situacion.posicion)}${situacion.duracion ? ` de ${enReloj(situacion.duracion)}` : ''}`;
}

function tiempoBajado(descargas: Descarga[]): string {
  const hechas = descargas.filter((una) => una.estado === 'hecha');
  if (hechas.length === 0) return '';

  const segundos = hechas.reduce((suma, una) => suma + (una.duracion ?? 0), 0);
  const sinSaber = hechas.filter((una) => !una.duracion).length;

  const horas = Math.floor(segundos / 3600);
  const minutos = Math.round((segundos % 3600) / 60);
  const cuanto = segundos === 0 ? '' : horas > 0 ? `${horas} h ${minutos} min` : `${minutos} min`;

  if (sinSaber === hechas.length) return '';
  return `${cuanto} para ver${sinSaber > 0 ? ` (y ${sinSaber} sin medir)` : ''}`;
}

/**
 * Lo que falta, en palabras.
 *
 * En minutos redondos a partir de uno: "faltan 94 segundos" no lo lee nadie, y
 * sobre una descarga de hora y media la precisión del segundo es mentira.
 */
function loQueFalta(segundos: number): string {
  if (segundos < 60) return 'menos de un minuto';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min`;
}

/**
 * Cómo va una descarga, en una línea.
 *
 * En megas y no en porcentaje mientras no se sepa el tamaño: el panel no
 * siempre manda `Content-Length`, y un porcentaje inventado es peor que un
 * número que crece.
 */
function comoVaLaDescarga(descarga: Descarga, marcha: Marcha | null): string {
  if (descarga.estado === 'hecha') return `Bajada · ${megas(descarga.bytes)}`;
  if (descarga.estado === 'fallida') return `Falló · ${descarga.error ?? 'sin motivo'}`;
  if (descarga.estado === 'pausada') return `En pausa · ${megas(descarga.bytes)}`;
  if (descarga.estado === 'en cola') return 'Esperando turno';

  const cuanto = descarga.total
    ? `${Math.round((descarga.bytes / descarga.total) * 100)} % · ${megas(descarga.bytes)} de ${megas(descarga.total)}`
    : `Bajando · ${megas(descarga.bytes)}`;

  // La velocidad y el tiempo solo cuando hay con qué calcularlos: durante los
  // primeros segundos no hay ventana que medir, y un número inventado ahí es
  // el que luego nadie se cree.
  const aCuanto = marcha?.bytesPorSegundo
    ? ` · ${(marcha.bytesPorSegundo / 1_000_000).toFixed(1).replace('.', ',')} MB/s`
    : '';
  const falta = marcha?.quedan ? ` · faltan ${loQueFalta(marcha.quedan)}` : '';

  return `${cuanto}${aCuanto}${falta}`;
}

/**
 * El fichero ya bajado de lo que se va a reproducir, si lo hay.
 *
 * Solo cuenta lo terminado: media película en el disco no se puede ver, y
 * apuntar al fichero a medias daría un vídeo que se corta sin explicación.
 */
function ficheroBajadoDe(descargas: Descarga[], medio: { clase: string; id: string }): string | null {
  if (medio.clase !== 'pelicula' && medio.clase !== 'episodio') return null;
  const clave = claveDeDescarga(medio.clase, medio.id);
  const hecha = descargas.find((una) => una.id === clave && una.estado === 'hecha');
  return hecha ? rutaDe(hecha) : null;
}

const Carrusel = memo(function Carrusel({
  titulo,
  fila,
  elementos,
  formato,
  activa,
  columna,
  programas,
  sello,
  onTocar,
  onMantener,
}: {
  titulo: string;
  /** Qué puesto ocupa en la pantalla: lo que se devuelve al tocar una ficha. */
  fila: number;
  elementos: Elemento[];
  /** `canal` pinta el logotipo apaisado en vez del cartel vertical. */
  formato?: FormatoFila;
  activa: boolean;
  columna: number;
  /** La parrilla, por canal. Vacía en las filas que no son de directo. */
  programas: Record<string, Programa[]>;
  sello: number;
  onTocar: (fila: number, columna: number) => void;
  onMantener: (fila: number, columna: number) => void;
}) {
  const lista = useRef<FlatList<Elemento>>(null);

  // Estables entre pintados: es lo que permite que `memo` sirva de algo en las
  // fichas, que si no reciben dos funciones nuevas cada vez.
  const tocar = useCallback((columna: number) => onTocar(fila, columna), [onTocar, fila]);
  const mantener = useCallback((columna: number) => onMantener(fila, columna), [onMantener, fila]);

  useEffect(() => {
    if (!activa || elementos.length === 0) return;
    lista.current?.scrollToIndex({
      index: Math.min(columna, elementos.length - 1),
      animated: true,
      viewPosition: 0.5,
    });
  }, [activa, columna, elementos.length]);

  return (
    <View style={estilos.filaZona}>
      <Text style={[estilos.filaTitulo, activa && estilos.filaTituloActivo]}>{titulo}</Text>
      <FlatList
        focusable={false}
        isTVSelectable={false}
        scrollEnabled={DESPLAZA_EL_DEDO}
        ref={lista}
        horizontal
        data={elementos}
        keyExtractor={(elemento) => elemento.id}
        extraData={`${activa}-${columna}-${sello}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={estilos.filaLista}
        initialNumToRender={8}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <FichaDeFila
            item={item}
            indice={index}
            formato={formato}
            enfocado={activa && index === columna}
            programas={programas[canalDeElemento(item) ?? '']}
            onTocar={tocar}
            onMantener={mantener}
          />
        )}
      />
    </View>
  );
});

/**
 * La línea que acompaña al título dentro de la carátula.
 *
 * Género, año y lo que traiga la ficha —en "Seguir viendo", el capítulo—.
 * Lo que falte no deja hueco ni separador suelto: el panel rellena lo que
 * quiere y aquí no se pinta una raya para nada.
 */
function pieDeFicha(elemento: Elemento): string {
  return [elemento.genero, elemento.anio, elemento.detalle].filter(Boolean).join(' · ');
}

/*
  El marco de tres píxeles se ve mal desde el sofá y el tamaño se ve siempre:
  por eso lo enfocado se agranda, como en cualquier televisor. Va animado sobre
  el hilo nativo (`useNativeDriver`) porque el JavaScript está ocupado pintando
  la fila cuando el foco se mueve, y sin eso el crecimiento llega a tirones.

  `zIndex` y `elevation` son para que la ficha crecida tape a la de al lado y
  no al revés: entre hermanos manda el orden de pintado, y la siguiente se
  dibuja después.
*/
/**
 * Una ficha de carrusel, que **crece al enfocarse**.
 *
 * Va envuelta en `memo` y recibe su índice en vez de dos funciones nuevas por
 * pintado: sin eso, cada pulsación del mando repintaba las veinte fichas de la
 * fila —el `extraData` de la lista cambia con el foco— y en un televisor
 * modesto eso es casi un segundo por pulsación. Con la comparación de props,
 * solo se repintan las dos que cambian: la que suelta el foco y la que lo
 * coge.
 */
const FichaDeFila = memo(function FichaDeFila({
  item,
  indice,
  formato,
  enfocado,
  programas,
  onTocar,
  onMantener,
}: {
  item: Elemento;
  /** Qué puesto ocupa: lo que se le devuelve a la fila al tocarla. */
  indice: number;
  formato?: FormatoFila;
  enfocado: boolean;
  /** Lo que echan en este canal, si es un canal y hay parrilla. */
  programas?: Programa[];
  onTocar: (indice: number) => void;
  onMantener: (indice: number) => void;
}) {
  const esCanal = formato === 'canal';
  const escala = useRef(new Animated.Value(1)).current;

  /*
    El programa en curso se decide **con la hora del aparato**, no con lo que
    diga el panel: `now_playing` lo calcula el servidor al responder y
    envejece en cuanto la pantalla lleva un rato abierta.

    El minuto se recuerda para no rehacer esto en cada pintado, que en una
    fila de veinte canales es veinte veces por pulsación del mando.
  */
  const minuto = Math.floor(Date.now() / 60_000);
  const enCurso = useMemo(
    () => (programas?.length ? programaActual(programas, new Date()) : null),
    // El minuto es la dependencia de verdad: es lo que hace que la barra avance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [programas, minuto],
  );
  const avanceEnCurso = enCurso ? avanceDePrograma(enCurso, new Date()) : item.avance;
  // Con programa, el grupo sobra: lo dice el rótulo de la fila.
  const pie = enCurso ? null : pieDeFicha(item);

  /*
    Con el dedo **no hay foco**, así que no hay ficha que enseñar al enfocar:
    en una tablet no se vería nunca ni el título ni el año ni la nota. Ahí se
    enseñan siempre. Lo que cambia no es el aparato sino la forma de señalar:
    en el televisor hay un sitio marcado y en la tablet, no.
  */
  const verFicha = enfocado || DESPLAZA_EL_DEDO;

  useEffect(() => {
    Animated.spring(escala, {
      toValue: enfocado ? ESCALA_ENFOQUE : 1,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  }, [enfocado, escala]);

  return (
    <Animated.View
      style={[
        estilos.fichaFilaCaja,
        esCanal && estilos.fichaFilaCajaCanal,
        enfocado && estilos.fichaFilaEncima,
        { transform: [{ scale: escala }] },
      ]}
    >
      <Pressable
        focusable={false}
        onPress={() => onTocar(indice)}
        // El mismo gesto que en la rejilla: mantener pulsado lo añade a Mi
        // Lista, y el toque normal reproduce o entra.
        onLongPress={() => onMantener(indice)}
        style={[estilos.fichaFila, enfocado && estilos.fichaFilaEnfocada]}
      >
        <View style={estilos.fichaCaratula}>
          {item.logo ? (
            <Image
              source={{ uri: item.logo }}
              style={[estilos.fichaImagen, esCanal && estilos.fichaImagenCanal]}
              // El logotipo de un canal se enseña entero: recortarlo se lleva
              // por delante justo lo que se reconoce.
              resizeMode={esCanal ? 'contain' : 'cover'}
            />
          ) : (
            <View style={[estilos.fichaImagen, esCanal && estilos.fichaImagenCanal, estilos.fichaSinImagen]}>
              <Text style={estilos.fichaSinImagenTexto} numberOfLines={2}>
                {item.titulo}
              </Text>
            </View>
          )}
          {/*
            La ficha va **dentro** de la carátula y solo en la enfocada, sobre
            un degradado que oscurece el pie de la imagen: en blanco sobre el
            cartel a pelo, la mitad de las veces el texto cae encima de una
            cara clara y no se lee.

            Debajo no: con el texto fuera, la fila tenía que reservar un hueco
            que estaba vacío en todas las fichas menos una.
          */}
          {verFicha ? (
            <View style={estilos.fichaVelo} pointerEvents="none">
              <Text style={estilos.fichaVeloTitulo} numberOfLines={2}>
                {item.titulo}
              </Text>
              {/*
                El pie —género y año, o el grupo en un canal— **cede el sitio
                al programa** cuando lo hay: el grupo ya lo dice el rótulo de
                la fila, y la línea se aprovecha mejor diciendo qué echan.
              */}
              {pie || item.valoracion !== null ? (
                <View style={estilos.fichaVeloDatos}>
                  {item.valoracion !== null ? (
                    <Text style={estilos.fichaVeloNota}>★ {nota(item.valoracion)}</Text>
                  ) : null}
                  {pie ? (
                    <Text style={estilos.fichaVeloTexto} numberOfLines={1}>
                      {pie}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {/*
                Y en un canal, lo que están echando: la hora y el título, en
                dos líneas porque los títulos largos son la norma —"A 47
                metros 2 · El terror emerge"— y cortados no dicen nada.

                Sin programación no se pinta nada ni se reserva hueco: 272 de
                los 463 canales de la lista real no traen tvg-id y no tienen
                EPG por ningún camino, así que la ficha vacía no es la
                excepción sino más de la mitad de los casos.
              */}
              {enCurso ? (
                <Text style={estilos.fichaVeloTexto} numberOfLines={2}>
                  <Text style={estilos.fichaVeloHora}>{hora(enCurso.desde)}</Text>  {enCurso.titulo}
                </Text>
              ) : null}
            </View>
          ) : null}
          {/*
            La barra dice dos cosas distintas según qué ficha sea: en una
            película, por dónde ibas; en un canal, por dónde va el programa.
            No se pisan —un canal no tiene avance guardado— y las dos
            contestan a lo mismo: cuánto queda.
          */}
          {avanceEnCurso !== null ? (
            <View style={estilos.fichaBarra}>
              <View style={[estilos.fichaBarraVista, { width: `${Math.round(avanceEnCurso * 100)}%` }]} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
});

function Ficha({
  elemento,
  enfocado,
  formato,
  columnas,
  apretada,
  onPress,
  onLongPress,
}: {
  elemento: Elemento;
  enfocado: boolean;
  formato: Formato;
  columnas: number;
  apretada?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  /**
   * Techo de ancho por ficha.
   *
   * `FlatList` con varias columnas reparte el ancho entre lo que haya en la
   * fila, así que una fila incompleta —un solo favorito, o la última de la
   * lista— estira sus fichas hasta ocupar la pantalla entera. Con el techo
   * puesto se quedan en su sitio y la rejilla no se deforma.
   */
  const anchoMaximo = { maxWidth: `${100 / columnas}%` as const };
  if (formato === 'carteles') {
    const pastilla = apretada ? estilos.pastillaApretada : null;
    const textoPastilla = apretada ? estilos.pastillaTextoApretado : null;
    return (
      <Pressable
        focusable={false}
        style={[estilos.caratula, anchoMaximo, enfocado && estilos.fichaEnfocada]}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <View style={estilos.marcoCaratula}>
          {elemento.logo ? (
            <Image source={{ uri: elemento.logo }} style={estilos.imagenCaratula} resizeMode="cover" />
          ) : (
            <Text style={estilos.sinImagen}>Sin carátula</Text>
          )}

          {elemento.favorito ? <Corazon /> : null}

          {/*
            Nota y año van dentro de la imagen, en sus esquinas de abajo. Sobre
            un cartel cualquiera el texto suelto se pierde, así que cada uno
            lleva su pastilla oscura detrás.
          */}
          {elemento.valoracion || elemento.anio ? (
            <View style={estilos.esquinas} pointerEvents="none">
              {elemento.valoracion ? (
                <Text style={[estilos.pastilla, estilos.pastillaNota, pastilla, textoPastilla]}>
                  {nota(elemento.valoracion)}
                </Text>
              ) : (
                <View />
              )}
              {elemento.anio ? (
                <Text style={[estilos.pastilla, pastilla, textoPastilla]}>{elemento.anio}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Lo ya visto, pegado al borde inferior de la carátula. */}
          {elemento.avance !== null ? (
            <View style={estilos.avanceFondo}>
              <View style={[estilos.avanceBarra, { width: `${Math.round(elemento.avance * 100)}%` }]} />
            </View>
          ) : null}
        </View>
        <Text
          style={[estilos.caratulaTitulo, apretada && estilos.caratulaTituloApretado, enfocado && estilos.textoEnfocado]}
          numberOfLines={2}
        >
          {elemento.titulo}
        </Text>
      </Pressable>
    );
  }

  if (formato === 'episodios') {
    return (
      <Pressable
        focusable={false}
        style={[estilos.episodio, enfocado && estilos.fichaEnfocada]}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <View style={estilos.marcoFotograma}>
          {elemento.logo ? (
            <Image source={{ uri: elemento.logo }} style={estilos.imagenCaratula} resizeMode="cover" />
          ) : (
            <Text style={estilos.sinImagen}>▶</Text>
          )}
          {elemento.avance !== null ? (
            <View style={estilos.avanceFondo}>
              <View style={[estilos.avanceBarra, { width: `${Math.round(elemento.avance * 100)}%` }]} />
            </View>
          ) : null}
        </View>

        <View style={estilos.fichaEpisodio}>
          <Text style={[estilos.tituloEpisodio, enfocado && estilos.textoEnfocado]} numberOfLines={2}>
            {elemento.titulo}
          </Text>

          {/* Duración, nota y año en una línea, que ninguno llega siempre. */}
          <View style={estilos.datosEpisodio}>
            {elemento.detalle ? <Text style={estilos.datoEpisodio}>{elemento.detalle}</Text> : null}
            {elemento.valoracion ? (
              <Text style={[estilos.datoEpisodio, estilos.notaEpisodio]}>{nota(elemento.valoracion)}</Text>
            ) : null}
            {elemento.anio ? <Text style={estilos.datoEpisodio}>{elemento.anio}</Text> : null}
          </View>

          {elemento.resumen ? (
            <Text style={estilos.resumenEpisodio} numberOfLines={3}>
              {elemento.resumen}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      focusable={false}
      style={[estilos.ficha, enfocado && estilos.fichaEnfocada]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {elemento.logo ? (
        <Image source={{ uri: elemento.logo }} style={estilos.logo} resizeMode="contain" />
      ) : null}
      <View style={estilos.textos}>
        <Text style={[estilos.fichaTitulo, enfocado && estilos.textoEnfocado]} numberOfLines={2}>
          {elemento.titulo}
        </Text>
        {elemento.detalle ? <Text style={estilos.fichaDetalle}>{elemento.detalle}</Text> : null}
        {elemento.avance !== null ? (
          <View style={[estilos.avanceFondo, estilos.avanceEnLista]}>
            <View style={[estilos.avanceBarra, { width: `${Math.round(elemento.avance * 100)}%` }]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * El logotipo de un canal, con las iniciales por si no hay imagen.
 *
 * Muchos canales del proveedor traen `stream_icon` vacío, y otros apuntan a
 * una URL que ya no responde. Sin este respaldo la rejilla se queda con
 * huecos grises: se ve el marco pero no se sabe qué canal es.
 */
function Logo({ uri, nombre }: { uri: string | null; nombre: string }) {
  const [falla, setFalla] = useState(false);

  if (!uri || falla) {
    return <Text style={estilos.inicialCanal}>{iniciales(nombre)}</Text>;
  }
  return (
    <Image
      source={{ uri }}
      style={estilos.imagenLogo}
      resizeMode="contain"
      onError={() => setFalla(true)}
    />
  );
}

/** "La 1" -> "L1", "Antena 3" -> "A3": dos letras que quepan en el hueco. */
function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0]!.slice(0, 2).toUpperCase();
  return (palabras[0]![0]! + palabras[1]![0]!).toUpperCase();
}

/**
 * El corazón de favorito, arriba a la derecha de la imagen.
 *
 * Se queda puesto mientras lo esté: es la única señal de que esa ficha está
 * también en el grupo de favoritos.
 */
function Corazon() {
  return (
    <View style={estilos.corazon} pointerEvents="none">
      <Text style={estilos.corazonTexto}>♥</Text>
    </View>
  );
}

/**
 * Lo reproducible de la pantalla actual, y en qué puesto va lo que suena.
 *
 * Sirve para lo mismo en dos sitios: pasar al episodio siguiente dentro de una
 * temporada y zapear por los canales de un grupo. Lo que no se reproduce —una
 * serie, que abre pantalla— no entra en la cola.
 */
/**
 * Una cola de dos: lo que suena y lo que viene después.
 *
 * Es lo que hace que el botón de "Siguiente capítulo" y la reproducción
 * continua funcionen cuando se ha entrado desde "seguir viendo", donde la fila
 * es de series distintas y no hay cola que valga.
 */
function colaDeUno(actual: Reproducible, siguiente: Reproducible | null): Cola | undefined {
  return siguiente ? { medios: [actual, siguiente], indice: 0 } : undefined;
}

function colaDe(elementos: Elemento[], actual: Reproducible): Cola | undefined {
  const medios = elementos
    .filter((elemento) => elemento.accion.tipo === 'reproducir')
    .map((elemento) => (elemento.accion as { tipo: 'reproducir'; medio: Reproducible }).medio);

  const indice = medios.findIndex((medio) => medio.clase === actual.clase && medio.id === actual.id);
  return indice >= 0 ? { medios, indice } : undefined;
}

/** "hoy", "hace 2 días": para saber de cuándo es lo que se está viendo. */
function frescura(dias: number): string {
  if (dias < 1) return 'hoy';
  const enteros = Math.floor(dias);
  return enteros === 1 ? 'ayer' : `hace ${enteros} días`;
}

const estilos = StyleSheet.create({
  // La capa de fuera: sin márgenes, para que lo que se coloca con coordenadas
  // de pantalla —el reproductor— caiga donde debe.
  raiz: {
    backgroundColor: FONDO,
    flex: 1,
  },
  pantalla: {
    backgroundColor: FONDO,
    flex: 1,
    paddingHorizontal: MARGEN_PANTALLA,
  },
  centrado: {
    alignItems: 'center',
    gap: 20,
    justifyContent: 'center',
  },
  espera: {
    color: TINTA_SUAVE,
    fontSize: 20,
  },
  errorArriba: {
    backgroundColor: 'rgba(255,107,107,0.15)',
    color: ROJO,
    fontSize: 16,
    margin: 16,
    padding: 14,
  },
  cabecera: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  tituloBloque: {
    flex: 1,
  },
  titulo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
  },
  subtitulo: {
    color: '#5d6f7d',
    fontSize: 15,
    marginTop: 4,
  },
  botonera: {
    flexDirection: 'row',
    gap: 10,
  },
  // Con mando, el botón enfocado de la cabecera tiene que distinguirse.
  botonCabeceraEnfocado: {
    backgroundColor: 'rgba(53,208,127,0.22)',
    borderColor: VERDE,
  },
  botonCabecera: {
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cerrarSesionTexto: {
    color: TINTA_TENUE,
    fontSize: 16,
  },
  cuerpo: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  columnaIzquierda: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  /**
   * El reparto del directo.
   *
   * A partes iguales no salía: de la mitad izquierda, la barra de categorías
   * se llevaba 260 puntos y a la lista de canales le quedaban unos 170, con
   * los nombres cortados. La parrilla cede algo de sitio —le sobra para el
   * vídeo y el programa— y la lista respira.
   */
  mitad: {
    flex: 1.5,
  },
  listaPrincipal: {
    // Alto explícito y no `flex: 1`: en Android 8 el reparto no llegaba a la
    // vista nativa del scroll y la lista se quedaba en dos píxeles de alto,
    // con las filas bien medidas pero sin pintar. El envoltorio ya acota el
    // espacio, así que aquí basta con ocuparlo entero.
    height: '100%',
  },
  // El envoltorio de la lista: es quien recibe el ancho del reparto.
  // El envoltorio de la lista: es quien recibe el reparto del contenedor.
  zonaLista: {
    flex: 1,
  },
  barra: {
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    // Ancho fijo, y ajustado: lo que quite aquí se lo come la lista de al
    // lado. Los nombres largos se parten en dos líneas, que para una
    // categoría es aceptable; un canal con el nombre cortado, no.
    width: 200,
  },
  barraEnfocada: {
    borderColor: 'rgba(53,208,127,0.5)',
  },
  categoria: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoriaActiva: {
    backgroundColor: 'rgba(53,208,127,0.18)',
  },
  categoriaEnfocada: {
    backgroundColor: 'rgba(53,208,127,0.35)',
  },
  categoriaTexto: {
    color: TINTA_SUAVE,
    fontSize: 17,
  },
  categoriaCuantos: {
    color: '#5d6f7d',
    fontSize: 14,
    marginTop: 2,
  },
  ajustes: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    marginBottom: 16,
    padding: 16,
  },
  ajustesTitulo: {
    color: TINTA_SUAVE,
    fontSize: 18,
  },
  ajustesSeparado: {
    marginTop: 16,
  },
  ajustesFila: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  ajustesPie: {
    color: '#5d6f7d',
    fontSize: 14,
    marginTop: 10,
  },
  opcion: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  // El mando necesita ver dónde está, aparte de cuál es la opción en uso.
  opcionEnfocada: {
    borderColor: '#fff',
  },
  opcionActiva: {
    backgroundColor: VERDE,
  },
  opcionTexto: {
    color: TINTA_SUAVE,
    fontSize: 18,
  },
  opcionTextoActiva: {
    color: FONDO,
    fontWeight: '700',
  },
  campoBusqueda: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 20,
    marginBottom: 16,
    padding: 14,
  },
  contenido: {
    gap: 10,
    paddingBottom: 40,
  },
  fila: {
    gap: 10,
  },
  pie: {
    marginVertical: 20,
  },
  ficha: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 16,
    padding: 18,
  },
  textos: {
    flex: 1,
  },
  logo: {
    height: 52,
    width: 72,
  },
  iconoCabecera: {
    color: TINTA_SUAVE,
    fontSize: 24,
    lineHeight: 26,
  },
  descargaCabecera: {
    gap: 4,
    marginBottom: 4,
  },
  descargaLista: {
    maxHeight: 420,
  },
  descargaFila: {
    borderTopColor: '#1d3a4d',
    borderTopWidth: 1,
    gap: 4,
    paddingVertical: 10,
  },
  descargaBotones: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  descargaBoton: {
    backgroundColor: '#16324a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  descargaBotonTexto: {
    color: TINTA,
    fontSize: 14,
  },
  /*
    "En la tele": como el reproductor, pero con la imagen quieta. Ocupa la
    pantalla entera y va por encima de todo menos del aviso.
  */
  pantallaTele: {
    backgroundColor: FONDO,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
  pantallaTeleVelo: {
    ...StyleSheet.absoluteFillObject,
    experimental_backgroundImage: `linear-gradient(to bottom, rgba(${FONDO_RGB},0.55) 0%, rgba(${FONDO_RGB},0.25) 40%, rgba(${FONDO_RGB},0.92) 100%)`,
  },
  pantallaTeleArriba: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  pantallaTeleDonde: {
    color: TINTA_SUAVE,
    flexShrink: 1,
    fontSize: 15,
  },
  pantallaTeleCentro: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  pantallaTeleControles: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 40,
  },
  pantallaTelePlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 48,
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  pantallaTeleSalto: {
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  pantallaTeleSaltoTexto: {
    color: TINTA,
    fontSize: 13,
  },
  pantallaTeleFallo: {
    color: TINTA,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },
  pantallaTeleAbajo: {
    gap: 8,
    paddingHorizontal: 24,
  },
  pantallaTeleTitulo: {
    color: TINTA,
    fontSize: 26,
    fontWeight: '700',
  },
  pantallaTeleSubtitulo: {
    color: TINTA_SUAVE,
    fontSize: 16,
  },
  pantallaTeleBarra: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    height: 4,
    marginTop: 10,
    overflow: 'hidden',
  },
  pantallaTeleBarraHecha: {
    backgroundColor: VERDE,
    height: '100%',
  },
  pantallaTeleEstado: {
    color: TINTA_SUAVE,
    fontSize: 14,
  },
  pantallaTeleBotones: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  pantallaTeleBoton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  pantallaTeleBotonTexto: {
    color: TINTA,
    fontSize: 16,
  },
  panelDescargas: {
    backgroundColor: '#0d2231',
    borderRadius: 12,
    elevation: 12,
    gap: 10,
    maxHeight: '80%',
    padding: 18,
    position: 'absolute',
    right: 24,
    top: 78,
    width: 380,
    zIndex: 20,
  },
  descargaEstado: {
    color: '#9fb4c4',
    fontSize: 13,
    marginTop: 2,
  },
  descargaBarra: {
    backgroundColor: '#1d3a4d',
    borderRadius: 2,
    height: 4,
    marginTop: 6,
    overflow: 'hidden',
  },
  descargaBarraHecha: {
    backgroundColor: VERDE,
    height: 4,
  },
  descargaAyuda: {
    color: '#6f8798',
    fontSize: 12,
    marginTop: 4,
  },
  menuPerfil: {
    backgroundColor: '#0d2231',
    borderRadius: 12,
    elevation: 12,
    gap: 6,
    padding: 18,
    position: 'absolute',
    right: 24,
    top: 78,
    width: 300,
    zIndex: 20,
  },
  menuCabecera: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  menuNombre: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
  },
  menuOpcion: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuOpcionEnfocada: {
    backgroundColor: 'rgba(53,208,127,0.2)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuOpcionTexto: {
    color: TINTA_SUAVE,
    fontSize: 17,
  },
  inicioLista: {
    height: '100%',
  },
  cuerpoOculto: {
    display: 'none',
  },

  cabeceraFlotante: {
    // El respiro de arriba lo pone quien la pinta, que es el único que sabe
    // cuánto ocupan las barras del sistema en este aparato.
    /*
      Flota sobre la portada, pegada al borde. Va la última en el árbol para
      quedar por encima de la imagen, que llega hasta arriba del todo.
    */
    left: MARGEN_PANTALLA,
    position: 'absolute',
    right: MARGEN_PANTALLA,
    top: 0,
    zIndex: 10,
  },
  pestanas: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    /*
      Centradas respecto a la pantalla, no repartidas entre los otros dos
      bloques de la barra: si van en el flujo, los iconos de la derecha las
      empujan y dejan de estar en el medio.
    */
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  pestanasDesplazables: {
    // Que no se estire para llenar la fila: así el recorrido con el dedo
    // empieza donde empiezan las pestañas.
    flexGrow: 0,
  },
  pestanasEnLinea: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 4,
  },
  pestana: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  pestanaEnfocada: {
    // El foco del mando sí lleva recuadro: la raya de abajo ya significa otra
    // cosa —dónde estás—, y desde el sofá hacen falta las dos señales.
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: '#fff',
  },
  pestanaTexto: {
    color: TINTA_TENUE,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  pestanaTextoActiva: {
    color: '#fff',
    fontWeight: '700',
  },
  pestanaRaya: {
    backgroundColor: VERDE,
    borderRadius: 2,
    bottom: 0,
    height: 3,
    position: 'absolute',
    width: 26,
  },
  destacadoPuntos: {
    // Por debajo del botón: a la altura de antes se lo comía su borde.
    bottom: 8,
    flexDirection: 'row',
    gap: 7,
    left: MARGEN_PANTALLA,
    position: 'absolute',
  },
  destacadoPunto: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  destacadoPuntoActivo: {
    backgroundColor: VERDE,
    width: 18,
  },
  destacadoGenero: {
    bottom: 26,
    // Doble margen: el hijo absoluto no hereda el `paddingHorizontal` del
    // destacado, así que con uno solo el texto quedaba pegado al borde.
    color: TINTA_TENUE,
    fontSize: 14,
    letterSpacing: 1,
    position: 'absolute',
    right: MARGEN_PANTALLA * 2,
    textTransform: 'uppercase',
  },
  destacado: {
    /*
      A sangre: la imagen sale por los lados y por arriba, pasando por debajo
      de la cabecera. Los márgenes negativos cancelan el `paddingHorizontal`
      de la pantalla y el hueco que deja la cabecera encima.

      No se recorta arriba porque la lista empieza ahí: el destacado es la
      primera fila y la cabecera flota sobre ella.
    */
    justifyContent: 'flex-end',
    marginBottom: 4,
    marginTop: -MARGEN_CABECERA,
    overflow: 'hidden',
    paddingHorizontal: MARGEN_PANTALLA,
  },
  destacadoCapa: {
    /*
      Cada sugerencia se pinta entera en su capa —imagen, velos y ficha— para
      poder cruzarlas. Se sale por los lados, cancelando el
      `paddingHorizontal` del destacado, y lo devuelve dentro el texto: así la
      imagen llega a los bordes y la ficha se queda en su margen.
    */
    bottom: 0,
    justifyContent: 'flex-end',
    left: -MARGEN_PANTALLA,
    position: 'absolute',
    right: -MARGEN_PANTALLA,
    top: 0,
  },
  destacadoImagen: {
    /*
      Ocupa el rectángulo entero, saliéndose por los dos lados para cancelar
      el `paddingHorizontal` del destacado. Antes iba recortada al 82 % por la
      derecha, intentando que se perdiera por el borde, y lo que se veía era
      justo el corte. Ahora no se recorta: se **degrada** por la izquierda y
      por arriba, que es donde estorba al texto y a la barra.
    */
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  destacadoVelo: {
    bottom: 0,
    experimental_backgroundImage:
      `linear-gradient(to right, ${FONDO} 0%, rgba(${FONDO_RGB},0.92) 34%, rgba(${FONDO_RGB},0.55) 62%, rgba(${FONDO_RGB},0) 100%)`,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  destacadoTecho: {
    experimental_backgroundImage:
      `linear-gradient(to bottom, rgba(${FONDO_RGB},0.85) 0%, rgba(${FONDO_RGB},0.35) 60%, rgba(${FONDO_RGB},0) 100%)`,
    height: MARGEN_CABECERA + 20,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  destacadoPie: {
    // Funde el borde de abajo con el fondo, para que la fila siguiente no
    // aparezca pegada a un corte recto.
    bottom: 0,
    experimental_backgroundImage:
      `linear-gradient(to bottom, rgba(${FONDO_RGB},0) 0%, rgba(${FONDO_RGB},0.85) 65%, ${FONDO} 100%)`,
    height: 120,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  destacadoTexto: {
    gap: 7,
    // El margen que la capa canceló para poder ir a sangre.
    marginHorizontal: MARGEN_PANTALLA,
    maxWidth: 620,
    paddingBottom: 26,
  },
  destacadoEtiqueta: {
    color: VERDE,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  destacadoNombre: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  destacadoDatos: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  estrellas: {
    flexDirection: 'row',
    gap: 1,
  },
  estrellaLlena: {
    color: '#f0c14a',
    fontSize: 20,
  },
  estrellaHueca: {
    color: '#6b7681',
    fontSize: 20,
  },
  estrellaMitad: {
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    // La mitad justa: lo que asoma es media estrella llena sobre la hueca.
    width: '50%',
  },
  destacadoNota: {
    color: '#f0c14a',
    fontSize: 16,
    fontWeight: '700',
  },
  destacadoAnio: {
    color: TINTA_TENUE,
    fontSize: 16,
  },
  destacadoSinopsis: {
    // Blanca y del tamaño del reparto: se lee bien y no se come la portada.
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  destacadoReparto: {
    color: TINTA_TENUE,
    fontSize: 14,
  },
  destacadoBoton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 3,
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  destacadoBotonEnfocado: {
    backgroundColor: VERDE,
    borderColor: '#fff',
  },
  destacadoBotonTexto: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },

  filaZona: {
    marginBottom: 14,
    /*
      La fila llega a los bordes de la pantalla, cancelando el margen que pone
      `pantalla`, y el margen se devuelve dentro, en el relleno de la lista.

      Es lo que arregla la primera carátula: una lista horizontal recorta lo
      que se sale de ella, así que al crecer la de más a la izquierda perdía
      su mitad. Ahora tiene por dónde crecer, y de paso lo que se va por la
      derecha se pierde en el borde de la pantalla en vez de cortarse antes.
    */
    marginHorizontal: -MARGEN_PANTALLA,
  },
  filaTitulo: {
    color: TINTA,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 2,
    // La fila se sale por los lados; el rótulo no.
    marginLeft: MARGEN_PANTALLA,
  },
  filaTituloActivo: {
    color: VERDE,
  },
  filaLista: {
    gap: 16,
    // Hueco por los cuatro lados para lo que crece: sin él, la ficha enfocada
    // sale recortada por el borde de la fila.
    paddingHorizontal: MARGEN_PANTALLA,
    paddingVertical: 16,
  },
  fichaFilaCaja: {
    width: 168,
  },
  fichaFilaCajaCanal: {
    // Apaisada: es la forma del logotipo de un canal.
    width: 210,
  },
  fichaImagenCanal: {
    aspectRatio: 16 / 9,
    padding: 10,
  },
  filtros: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
    marginTop: 4,
  },
  filtro: {
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  filtroPuesto: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  filtroEnfocado: {
    borderColor: '#fff',
  },
  filtroTexto: {
    color: TINTA_TENUE,
    fontSize: 17,
  },
  filtroTextoPuesto: {
    color: '#fff',
    fontWeight: '700',
  },
  inicioSinPortada: {
    paddingTop: MARGEN_CABECERA,
  },
  listaVacia: {
    gap: 10,
    paddingTop: MARGEN_CABECERA,
  },
  listaVaciaTexto: {
    color: TINTA,
    fontSize: 22,
    fontWeight: '700',
  },
  listaVaciaPista: {
    color: TINTA_TENUE,
    fontSize: 16,
  },
  fichaFilaEncima: {
    elevation: 8,
    zIndex: 2,
  },
  fichaFila: {
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 3,
    padding: 3,
  },
  fichaFilaEnfocada: {
    borderColor: '#fff',
  },
  fichaVelo: {
    bottom: 0,
    experimental_backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 45%, rgba(0,0,0,0.94) 100%)`,
    gap: 2,
    justifyContent: 'flex-end',
    left: 0,
    padding: 8,
    paddingTop: 26,
    position: 'absolute',
    right: 0,
  },
  fichaVeloTitulo: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  fichaVeloDatos: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  fichaVeloNota: {
    color: '#f0c14a',
    fontSize: 12,
    fontWeight: '700',
  },
  fichaVeloTexto: {
    color: '#d6dde4',
    flexShrink: 1,
    fontSize: 12,
  },
  // La hora, en el verde de la marca: separa de un vistazo cuándo empezó de
  // cómo se llama, sin meter un guion ni un punto en medio.
  fichaVeloHora: {
    color: VERDE,
    fontWeight: '700',
  },
  fichaCaratula: {
    borderRadius: 6,
    overflow: 'hidden',
  },
  fichaImagen: {
    aspectRatio: 2 / 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    width: '100%',
  },
  fichaSinImagen: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  fichaSinImagenTexto: {
    color: TINTA_TENUE,
    fontSize: 13,
    textAlign: 'center',
  },
  fichaBarra: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    bottom: 0,
    height: 5,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  fichaBarraVista: {
    backgroundColor: VERDE,
    height: '100%',
  },

  seccionFicha: {
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    padding: 3,
    width: 210,
  },
  seccionCaja: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  seccionTexto: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  seccionImagen: {
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(53,208,127,0.14)',
    width: '100%',
  },

  caratula: {
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    // Estrecho a propósito: cada píxel que no se gasta en marco se lo queda la
    // carátula, que es lo que se mira desde el sofá.
    padding: 4,
  },
  marcoCaratula: {
    alignItems: 'center',
    // Las carátulas del proveedor son carteles verticales.
    aspectRatio: 2 / 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  imagenCaratula: {
    height: '100%',
    width: '100%',
  },
  avanceFondo: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    bottom: 0,
    height: 6,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  // En una lista no hay carátula donde pegarla: va bajo el texto.
  avanceEnLista: {
    borderRadius: 3,
    marginTop: 8,
    position: 'relative',
  },
  avanceBarra: {
    backgroundColor: VERDE,
    height: '100%',
  },
  sinImagen: {
    color: '#5d6f7d',
    fontSize: 14,
  },
  caratulaTitulo: {
    color: TINTA_SUAVE,
    fontSize: 18,
    marginTop: 6,
  },
  caratulaTituloApretado: {
    fontSize: 14,
  },
  /**
   * La fila de la nota y el año, pegada al fondo de la imagen y por encima de
   * la barra de avance, que se queda con los seis píxeles del borde.
   */
  esquinas: {
    alignItems: 'flex-end',
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 6,
    position: 'absolute',
    right: 6,
  },
  pastilla: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 6,
    color: '#e8eef4',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pastillaNota: {
    color: VERDE,
  },
  pastillaApretada: {
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pastillaTextoApretado: {
    fontSize: 11,
  },
  // El corazón va arriba a la derecha, donde no tapa ni la nota ni el año.
  corazon: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 5,
    top: 5,
    width: 26,
  },
  corazonTexto: {
    color: '#f0433a',
    fontSize: 15,
    textAlign: 'center',
  },

  // ---- Canales: una fila por canal, con su logotipo delante -----------
  canal: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  marcoLogo: {
    alignItems: 'center',
    // Los logotipos del proveedor son apaisados y con transparencia.
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 74,
  },
  imagenLogo: {
    height: '80%',
    width: '80%',
  },
  inicialCanal: {
    color: '#7f95a6',
    fontSize: 17,
    fontWeight: '700',
  },
  canalNombre: {
    color: TINTA_SUAVE,
    flex: 1,
    fontSize: 17,
  },
  corazonEnFila: {
    color: '#f0433a',
    fontSize: 15,
  },

  // ---- Episodios: fotograma y ficha al lado ---------------------------
  episodio: {
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    padding: 8,
  },
  marcoFotograma: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    // Ancho fijo: si se deja crecer, las filas bailan según llegan las
    // imágenes y la lista da saltos al desplazarse.
    width: 208,
  },
  fichaEpisodio: {
    flex: 1,
    gap: 6,
    justifyContent: 'center',
  },
  tituloEpisodio: {
    color: TINTA_SUAVE,
    fontSize: 19,
    fontWeight: '600',
  },
  datosEpisodio: {
    flexDirection: 'row',
    gap: 12,
  },
  datoEpisodio: {
    color: TINTA_TENUE,
    fontSize: 14,
  },
  notaEpisodio: {
    color: VERDE,
    fontWeight: '700',
  },
  resumenEpisodio: {
    color: '#a9bcc9',
    fontSize: 14,
    lineHeight: 19,
  },
  // El foco tiene que verse desde el sofá: borde grueso y fondo distinto.
  fichaEnfocada: {
    backgroundColor: 'rgba(53,208,127,0.18)',
    borderColor: VERDE,
  },
  fichaTitulo: {
    color: TINTA_SUAVE,
    fontSize: 22,
  },
  textoEnfocado: {
    color: '#fff',
    fontWeight: '700',
  },
  fichaDetalle: {
    color: TINTA_TENUE,
    fontSize: 16,
    marginTop: 6,
  },
  infoPantalla: {
    flex: 1,
  },
  infoContenido: {
    paddingBottom: 40,
  },
  /*
    El fondo apaisado, a sangre y detrás de todo. Va en posición absoluta para
    que el texto se monte encima: recortado a una banda dejaba una costura
    justo donde empieza la sinopsis.
  */
  infoFondo: {
    height: 420,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  infoVeloFondo: {
    experimental_backgroundImage: `linear-gradient(to bottom, rgba(${FONDO_RGB},0.35) 0%, rgba(${FONDO_RGB},0.85) 45%, rgba(${FONDO_RGB},1) 100%)`,
    height: 420,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  infoCuerpo: {
    flexDirection: 'row',
    gap: 28,
    paddingTop: MARGEN_CABECERA,
  },
  infoCartel: {
    backgroundColor: SUPERFICIE,
    borderRadius: 10,
    height: 300,
    width: 200,
  },
  infoTexto: {
    flex: 1,
    gap: 12,
  },
  infoTitulo: {
    color: TINTA,
    fontSize: 34,
    fontWeight: '700',
  },
  infoDatos: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  infoNota: {
    color: '#f0c14a',
    fontSize: 16,
    fontWeight: '700',
  },
  infoDato: {
    color: TINTA_TENUE,
    fontSize: 16,
  },
  infoSinopsis: {
    color: TINTA_SUAVE,
    fontSize: 17,
    lineHeight: 25,
    maxWidth: 900,
  },
  infoReparto: {
    color: TINTA_TENUE,
    fontSize: 15,
  },
  infoBotones: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  infoBoton: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  infoBotonPrincipal: {
    backgroundColor: VERDE,
  },
  // Con mando no hay puntero: lo enfocado tiene que cantar desde el sofá.
  infoBotonEnfocado: {
    borderColor: '#fff',
    transform: [{ scale: 1.04 }],
  },
  infoBotonTexto: {
    color: TINTA,
    fontSize: 17,
  },
  infoBotonTextoPrincipal: {
    color: FONDO,
    fontWeight: '700',
  },
  aviso: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 999,
    bottom: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    position: 'absolute',
  },
  avisoTexto: {
    color: '#fff',
    fontSize: 18,
  },
});

export default App;
