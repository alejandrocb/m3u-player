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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
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

import type {
  Ajustes,
  AlmacenPerfiles,
  Biblioteca,
  Cuenta,
  Elemento,
  EstadoPantalla,
  FilaInicio,
  Formato,
  Inicio,
  OpcionLateral,
  Perfil,
  Preparado,
  Programacion,
  Reproducible,
} from '@m3u/ui';
import {
  AJUSTES_POR_DEFECTO,
  COLORES_PERFIL,
  COLUMNAS_POSIBLES,
  ClienteSync,
  GestorCuentas,
  MODOS_INICIO,
  elementosDeFila,
  Presentador,
  cantidad,
  mediasEstrellas,
  nota,
  numero,
} from '@m3u/ui';

import { almacenDeCuentas } from './src/almacen';
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
import { cargarCatalogo } from './src/carga';
import type { Avance, Medicion } from './src/carga';
import { PantallaEmparejar } from './src/pantalla-emparejar';
import { PantallaListas } from './src/listas';
import { PantallaPerfiles } from './src/pantalla-perfiles';
import { Parrilla } from './src/parrilla';
import type { Caja } from './src/parrilla';
import { Reproductor } from './src/reproductor';
import type { Cola } from './src/reproductor';

/** Margen para que un segundo "atrás" cierre la app, como en Android. */
const MARGEN_SALIDA_MS = 3000;

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
  | { tipo: 'perfiles'; cuenta: Cuenta; medicion: Medicion }
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
        programacion: parrilla,
        medicion,
      } = await cargarCatalogo(
        elegida,
        (avance) => setFase({ tipo: 'conectando', nombre: elegida.nombre, avance }),
        { forzar },
      );
      biblioteca.current = datos;
      perfiles.current = almacen;
      programacion.current = parrilla;
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

      // Antes de la biblioteca, quién está viendo: cada perfil tiene su
      // historial y sus favoritos.
      setFase({ tipo: 'perfiles', cuenta: elegida, medicion });
    } catch (fallo) {
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

  if (fase.tipo === 'perfiles' && perfiles.current) {
    return (
      <PantallaPerfiles
        almacen={perfiles.current}
        onElegir={(perfil) => setFase({ tipo: 'biblioteca', cuenta: fase.cuenta, medicion: fase.medicion, perfil })}
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
      perfil={fase.perfil}
      cuenta={fase.cuenta}
      medicion={fase.medicion}
      onCerrarSesion={cerrarSesion}
      onCambiarPerfil={() => setFase({ tipo: 'perfiles', cuenta: fase.cuenta, medicion: fase.medicion })}
      onActualizar={() => conectar(fase.cuenta, true)}
      sincronizado={sincronizado}
      preparado={preparado}
      aparato={nombreAparato}
      onSincronizar={() => void sincronizar()}
      onCambioPerfil={(nuevo) =>
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
  onCerrarSesion,
  onCambiarPerfil,
  onActualizar,
  sincronizado,
  preparado,
  aparato,
  onSincronizar,
  onCambioPerfil,
}: {
  biblioteca: Biblioteca;
  perfiles: AlmacenPerfiles;
  programacion: Programacion;
  perfil: Perfil;
  cuenta: Cuenta;
  medicion: Medicion;
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
  /** El perfil ha cambiado de nombre o de color: hay que repintarlo arriba. */
  onCambioPerfil: (perfil: Perfil) => void;
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
  /** Dónde ha quedado el hueco del vídeo dentro de la columna. */
  const [cajaVista, setCajaVista] = useState<Caja | null>(null);
  /** El mando está sobre la vista previa, no sobre la lista de canales. */
  const [focoEnVideo, setFocoEnVideo] = useState(false);

  const [verAjustes, setVerAjustes] = useState(false);
  /** El menú que cuelga del círculo del perfil, con lo que es de cada uno. */
  const [verPerfil, setVerPerfil] = useState(false);
  const [focoPerfil, setFocoPerfil] = useState(0);
  /** Cuando se está escribiendo el nombre nuevo del perfil. */
  const [nombreNuevo, setNombreNuevo] = useState<string | null>(null);

  /*
    Estos dos van aquí arriba, con el resto de hooks, y no junto al menú que
    los usa. Es la cuarta vez que este proyecto se cae por lo mismo: React
    exige el mismo número de hooks en cada pintado, y más abajo hay un
    `return` temprano —"Cargando la biblioteca…"— que se los saltaba en el
    primero. El síntoma es "Rendered more hooks than during the previous
    render" y la aplicación cerrándose al entrar.
  */
  /** Guarda el nombre nuevo del perfil y cierra el campo. */
  const guardarNombre = useCallback(async () => {
    const limpio = (nombreNuevo ?? '').trim();
    setNombreNuevo(null);
    if (!limpio || limpio === perfil.nombre) return;

    await perfiles.renombrar(perfil.id, limpio);
    onCambioPerfil({ ...perfil, nombre: limpio });
  }, [nombreNuevo, perfil, perfiles, onCambioPerfil]);

  /** Pasa al siguiente color de la paleta, dando la vuelta al llegar al final. */
  const siguienteColor = useCallback(async () => {
    const actual = COLORES_PERFIL.indexOf(perfil.color as (typeof COLORES_PERFIL)[number]);
    const siguiente = COLORES_PERFIL[(actual + 1) % COLORES_PERFIL.length]!;
    await perfiles.recolorear(perfil.id, siguiente);
    onCambioPerfil({ ...perfil, color: siguiente });
  }, [perfil, perfiles, onCambioPerfil]);

  /** El mando está en la cabecera —buscar, ajustes, perfil— y no en la rejilla. */
  const [enCabecera, setEnCabecera] = useState(false);
  const [focoCabecera, setFocoCabecera] = useState(0);
  /** Cuál de las opciones del panel de ajustes tiene el mando encima. */
  const [focoAjustes, setFocoAjustes] = useState(0);
  const [avisoSalida, setAvisoSalida] = useState(false);

  const presentador = useRef<Presentador | null>(null);
  const salidaPendiente = useRef(false);
  /** La pantalla actual es la del directo: solo ahí hay vista previa. */
  const esDirecto = useRef(false);
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
    setTexto(nuevo);
    if (temporizadorBusqueda.current) clearTimeout(temporizadorBusqueda.current);
    temporizadorBusqueda.current = setTimeout(() => {
      presentador.current?.buscar(nuevo).then(setEstado);
    }, 250);
  }, []);

  const abrirBuscador = useCallback(() => {
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
      // Y de aquí los corazones y el grupo de favoritos, que son de cada uno.
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
      // Los géneros que el servidor haya averiguado se anotan en la base, y
      // desde ahí salen con cada ficha: en la carátula, en la rejilla y en lo
      // que se busque. Antes de cargar, para que la primera pantalla ya los
      // lleve.
      await biblioteca.guardarGeneros(preparado.generos);
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
   * El canal sobre el que está el foco, si es que hay uno.
   *
   * Se saca aquí y no dentro del efecto para que la dependencia sea el
   * identificador y no el estado entero, que cambia en cada pulsación.
   */
  const canalEnfocado =
    estado?.formato === 'canales' && !estado.lateral?.dentro
      ? estado.elementos[estado.foco]
      : undefined;
  const medioEnfocado =
    canalEnfocado?.accion.tipo === 'reproducir' ? canalEnfocado.accion.medio : null;
  const idEnfocado = medioEnfocado?.id ?? null;

  /**
   * La vista previa sigue al foco, con un segundo de retraso.
   *
   * Ese retraso es lo que hace que zapear por la lista no abra un flujo por
   * canal: con `max_connections` a uno, cada arranque ocupa la única ranura y
   * el panel tarda medio minuto en soltarla. Solo se previsualiza el canal en
   * el que uno se queda.
   */
  useEffect(() => {
    if (!idEnfocado || aPantallaCompleta) return;
    if (reproduciendo?.id === idEnfocado) return;

    const espera = setTimeout(() => {
      if (medioEnfocado) setReproduciendo(medioEnfocado);
    }, ESPERA_VISTA_PREVIA_MS);
    return () => clearTimeout(espera);
    // `medioEnfocado` se reconstruye en cada render; el identificador no.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEnfocado, aPantallaCompleta, reproduciendo?.id]);

  // Entrar y salir del directo: al entrar, el vídeo empieza en la columna; al
  // salir, se para, o seguiría ocupando la conexión mientras se navega por
  // películas.
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
    if (estado.formato === 'canales') {
      if (!reproduciendo && aPantallaCompleta) setAPantallaCompleta(false);
    } else {
      if (focoEnVideo) setFocoEnVideo(false);
      if (reproduciendo && !aPantallaCompleta) {
        setReproduciendo(null);
        setAPantallaCompleta(true);
      }
    }
  }, [estado, reproduciendo, aPantallaCompleta, focoEnVideo]);

  // Cambiar de pantalla devuelve el mando al contenido: la cabecera de la
  // pantalla nueva puede tener otros botones, o ninguno.
  useEffect(() => {
    setEnCabecera(false);
  }, [estado?.titulo]);

  const atras = useCallback((): boolean => {
    const instancia = presentador.current;
    if (!instancia) return false;

    // Lo que esté encima se cierra antes que nada, de más reciente a menos.
    if (nombreNuevo !== null) {
      setNombreNuevo(null);
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

    // Desde el vídeo entero se vuelve a la vista previa, que es de donde se
    // vino: cerrarlo del todo obligaría a esperar a que el panel suelte la
    // conexión para volver a verlo.
    if (reproduciendo && aPantallaCompleta && esDirecto.current) {
      setAPantallaCompleta(false);
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
  }, [reproduciendo, aPantallaCompleta, verAjustes, verPerfil, nombreNuevo]);

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

    instancia.aceptar().then(({ estado: nuevo, reproducir }) => {
      setEstado(nuevo);
      if (!reproducir) return;
      // Los canales estrenan en la columna; lo demás va a pantalla completa.
      setReproduciendo(reproducir);
      setAPantallaCompleta(reproducir.clase !== 'canal');
    });
  }, [reproduciendo, aPantallaCompleta]);

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
  const mantener = useCallback(
    (indice: number) => {
      const instancia = presentador.current;
      if (!instancia || reproduciendo) return;
      instancia.alternarFavorito(indice).then(setEstado);
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

        // La derecha salta de la lista al vídeo, y la izquierda vuelve: es el
        // camino que en una tablet hace el dedo tocando la vista previa.
        if (focoEnVideo) {
          if (evento.eventType === 'left') setFocoEnVideo(false);
          return;
        }
        if (evento.eventType === 'right' && esDirecto.current && reproduciendo && !estado?.lateral?.dentro) {
          setFocoEnVideo(true);
          return;
        }

        const direccion = {
          up: 'arriba',
          down: 'abajo',
          left: 'izquierda',
          right: 'derecha',
        }[evento.eventType] as 'arriba' | 'abajo' | 'izquierda' | 'derecha';
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

      case 'select':
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
        // Aceptar sobre la vista previa la abre entera.
        if (focoEnVideo) {
          setAPantallaCompleta(true);
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

  esDirecto.current = estado.formato === 'canales';

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
   * Lo que cuelga del círculo del perfil.
   *
   * Todo lo que es "de este usuario" vive aquí y no en la barra: cinco
   * botones de texto arriba tapaban contenido y no se leían de lejos.
   */
  const opcionesPerfil: Array<{ texto: string; onPress: () => void }> = [
    { texto: 'Editar nombre', onPress: () => setNombreNuevo(perfil.nombre) },
    { texto: 'Cambiar color', onPress: () => void siguienteColor() },
    { texto: 'Cambiar de perfil', onPress: onCambiarPerfil },
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
      ? [
          ...MODOS_INICIO.map((opcion) => ({
            clave: opcion.modo,
            nombre: opcion.nombre,
            activa: estado.inicio!.modo === opcion.modo,
            onPress: () => void presentador.current?.elegirModo(opcion.modo).then(setEstado),
          })),
          {
            clave: 'directo',
            nombre: 'TV en directo',
            activa: false,
            onPress: () => void presentador.current?.irADirecto().then(setEstado),
          },
        ]
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
      texto: inicialDe(perfil.nombre),
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
            {estado.inicio ? null : <Text style={estilos.titulo}>{estado.titulo}</Text>}
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
                    boton.perfil ? estilos.avatar : estilos.botonCabecera,
                    boton.perfil && { backgroundColor: perfil.color },
                    enCabecera &&
                      focoCabecera === pestanasCabecera.length + indice &&
                      (boton.perfil ? estilos.avatarEnfocado : estilos.botonCabeceraEnfocado),
                  ]}
                  onPress={boton.onPress}
                >
                  <Text style={boton.perfil ? estilos.avatarTexto : estilos.iconoCabecera}>{boton.texto}</Text>
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
        keyExtractor={(opcion) => (opcion.favoritos ? 'favoritos' : (opcion.grupo ?? 'todas'))}
        extraData={estado.lateral}
        renderItem={({ item, index }) => {
          // El grupo de favoritos no tiene nombre de categoría, así que se
          // compara por su marca y no por `grupo`, que es null.
          const activa = item.favoritos
            ? estado.lateral!.enFavoritos
            : !estado.lateral!.enFavoritos && item.grupo === estado.lateral!.activa;
          const enfocada = estado.lateral!.dentro && index === estado.lateral!.foco;
          return (
            <Pressable
              style={[estilos.categoria, activa && estilos.categoriaActiva, enfocada && estilos.categoriaEnfocada]}
              onPress={() =>
                presentador.current
                  ?.elegirCategoria(item.grupo, { favoritos: item.favoritos })
                  .then(setEstado)
              }
            >
              <Text style={[estilos.categoriaTexto, activa && estilos.textoEnfocado]} numberOfLines={2}>
                {item.favoritos ? '♥  Favoritos' : item.nombre}
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
            index === estado.foco && !estado.lateral?.dentro && !enCabecera && !verAjustes
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
            <View style={[estilos.avatarGrande, { backgroundColor: perfil.color }]}>
              <Text style={estilos.avatarGrandeTexto}>{inicialDe(perfil.nombre)}</Text>
            </View>
            <Text style={estilos.menuNombre}>{perfil.nombre}</Text>
          </View>
          {opcionesPerfil.map((opcion, indice) => (
            <Pressable
              key={opcion.texto}
              focusable={false}
              style={[estilos.menuOpcion, focoPerfil === indice && estilos.menuOpcionEnfocada]}
              onPress={() => {
                setVerPerfil(false);
                opcion.onPress();
              }}
            >
              <Text style={estilos.menuOpcionTexto}>{opcion.texto}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Escribir el nombre nuevo del perfil. */}
      {nombreNuevo !== null ? (
        <View style={estilos.menuPerfil}>
          <Text style={estilos.menuNombre}>Nombre del perfil</Text>
          <TextInput
            style={estilos.campoNombre}
            value={nombreNuevo}
            onChangeText={setNombreNuevo}
            autoFocus
            onSubmitEditing={() => void guardarNombre()}
          />
          <Pressable focusable={false} style={estilos.menuOpcionEnfocada} onPress={() => void guardarNombre()}>
            <Text style={estilos.menuOpcionTexto}>Guardar</Text>
          </Pressable>
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
          onTurno={(siguiente) => setEstado(presentador.current!.rotarDestacado(siguiente))}
          onTocar={(fila, columna) => {
            const instancia = presentador.current;
            if (!instancia) return;
            instancia.enfocarEnInicio(fila, columna);
            void instancia.aceptar().then(({ estado: nuevo, reproducir }) => {
              setEstado(nuevo);
              if (reproducir) setReproduciendo(reproducir);
            });
          }}
        />
      ) : null}

      <View style={[estilos.cuerpo, estado.inicio && estilos.cuerpoOculto]}>
        {/*
          En el directo la pantalla se parte por la mitad: la barra y la lista
          a un lado, la parrilla al otro. En el resto de pantallas la lista
          cuelga directamente del cuerpo, sin envoltorio: metido siempre, ese
          contenedor de más le comía el ancho a la lista —se quedaba en unos
          cuarenta píxeles y las fichas salían como tiras verticales—.
        */}
        {estado.formato === 'canales' ? (
          <View style={[estilos.columnaIzquierda, estilos.mitad]}>
            {barraLateral}
            {rejilla}
          </View>
        ) : (
          <>
            {barraLateral}
            {rejilla}
          </>
        )}

        {/* La programación del canal en el que está el foco. */}
        {estado.formato === 'canales' ? (
          <Parrilla
            canal={estado.elementos[estado.foco] ?? null}
            programacion={programacion}
            conVideo={Boolean(reproduciendo) && !aPantallaCompleta}
            enfocada={focoEnVideo}
            onCaja={setCajaVista}
            respectoA={raiz}
            onAbrir={() => reproduciendo && setAPantallaCompleta(true)}
          />
        ) : null}
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
          cola={colaDe(estado.elementos, reproduciendo)}
          onCambiar={setReproduciendo}
          programacion={programacion}
          caja={aPantallaCompleta ? null : cajaVista}
          resaltado={focoEnVideo}
          onAbrir={() => setAPantallaCompleta(true)}
        />
      ) : null}

      {avisoSalida ? (
        <View style={estilos.aviso}>
          <Text style={estilos.avisoTexto}>Pulsa atrás otra vez para salir</Text>
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
  onTocar,
  onTurno,
}: {
  /** El mando está arriba, en la lupa o el perfil. */
  enCabecera: boolean;
  inicio: Inicio;
  onTocar: (fila: number, columna: number) => void;
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
      // Son pocas filas y `scrollToIndex` necesita que estén montadas.
      initialNumToRender={8}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index }) => {
        const activa = index === inicio.fila;

        if (item.tipo === 'destacado') {
          return (
            <Destacado
              elementos={item.elementos}
              indice={inicio.destacado}
              alto={altoDestacado}
              enfocado={activa}
              onTurno={onTurno}
              onTocar={() => onTocar(index, 0)}
            />
          );
        }

        return (
          <Carrusel
            titulo={item.titulo}
            elementos={item.elementos}
            activa={activa}
            columna={inicio.columna}
            onTocar={(columna) => onTocar(index, columna)}
          />
        );
      }}
    />
  );
}

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
function Destacado({
  elementos,
  indice,
  alto,
  enfocado,
  onTurno,
  onTocar,
}: {
  elementos: Elemento[];
  indice: number;
  alto: number;
  enfocado: boolean;
  onTurno: (siguiente: number) => void;
  onTocar: () => void;
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
            onPress={onTocar}
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
}

/** Una fila horizontal de fichas: los carruseles y el menú de secciones. */
function Carrusel({
  titulo,
  elementos,
  activa,
  columna,
  onTocar,
}: {
  titulo: string;
  elementos: Elemento[];
  activa: boolean;
  columna: number;
  onTocar: (columna: number) => void;
}) {
  const lista = useRef<FlatList<Elemento>>(null);

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
        extraData={`${activa}-${columna}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={estilos.filaLista}
        initialNumToRender={8}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <FichaDeFila item={item} enfocado={activa && index === columna} onTocar={() => onTocar(index)} />
        )}
      />
    </View>
  );
}

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

/**
 * Una ficha de carrusel, que **crece al enfocarse**.
 *
 * El marco de tres píxeles se ve mal desde el sofá y el tamaño se ve siempre:
 * por eso lo enfocado se agranda, como en cualquier televisor. Va animado
 * sobre el hilo nativo (`useNativeDriver`) porque el JavaScript está ocupado
 * pintando la fila cuando el foco se mueve, y sin eso el crecimiento llega a
 * tirones.
 *
 * `zIndex` y `elevation` son para que la ficha crecida tape a la de al lado y
 * no al revés: entre hermanos manda el orden de pintado, y la siguiente se
 * dibuja después.
 */
function FichaDeFila({
  item,
  enfocado,
  onTocar,
}: {
  item: Elemento;
  enfocado: boolean;
  onTocar: () => void;
}) {
  const escala = useRef(new Animated.Value(1)).current;

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
    <Animated.View style={[estilos.fichaFilaCaja, enfocado && estilos.fichaFilaEncima, { transform: [{ scale: escala }] }]}>
      <Pressable
        focusable={false}
        onPress={onTocar}
        style={[estilos.fichaFila, enfocado && estilos.fichaFilaEnfocada]}
      >
        <View style={estilos.fichaCaratula}>
          {item.logo ? (
            <Image source={{ uri: item.logo }} style={estilos.fichaImagen} resizeMode="cover" />
          ) : (
            <View style={[estilos.fichaImagen, estilos.fichaSinImagen]}>
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
              <View style={estilos.fichaVeloDatos}>
                {item.valoracion !== null ? (
                  <Text style={estilos.fichaVeloNota}>★ {nota(item.valoracion)}</Text>
                ) : null}
                {pieDeFicha(item) ? (
                  <Text style={estilos.fichaVeloTexto} numberOfLines={1}>
                    {pieDeFicha(item)}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          {item.avance !== null ? (
            <View style={estilos.fichaBarra}>
              <View style={[estilos.fichaBarraVista, { width: `${Math.round(item.avance * 100)}%` }]} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * La letra que va dentro del círculo del perfil.
 *
 * Hace las veces de foto sin traerse un selector de imágenes, que en Android
 * es un módulo nativo. Con el color propio de cada perfil, cuatro personas se
 * distinguen de un vistazo.
 */
function inicialDe(nombre: string): string {
  return (nombre.trim()[0] ?? '?').toUpperCase();
}

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

  // Un canal es su logotipo: apaisado, con transparencia y sin recortar, que
  // es como los manda el proveedor. El nombre va debajo porque muchos logos no
  // lo llevan escrito.
  if (formato === 'canales') {
    return (
      <Pressable
        style={[estilos.canal, enfocado && estilos.fichaEnfocada]}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <View style={estilos.marcoLogo}>
          <Logo uri={elemento.logo} nombre={elemento.titulo} />
        </View>
        <Text style={[estilos.canalNombre, enfocado && estilos.textoEnfocado]} numberOfLines={2}>
          {elemento.titulo}
        </Text>
        {/* El corazón, al final de la fila: en el logotipo lo taparía. */}
        {elemento.favorito ? <Text style={estilos.corazonEnFila}>♥</Text> : null}
      </Pressable>
    );
  }

  // El episodio ocupa la fila entera: fotograma a la izquierda y su ficha a la
  // derecha, que es donde cabe la sinopsis.
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
  avatar: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 22,
    borderWidth: 3,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarEnfocado: {
    borderColor: '#fff',
  },
  avatarTexto: {
    color: FONDO,
    fontSize: 19,
    fontWeight: '700',
  },
  avatarGrande: {
    alignItems: 'center',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarGrandeTexto: {
    color: FONDO,
    fontSize: 23,
    fontWeight: '700',
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
    borderRadius: 8,
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
  campoNombre: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 18,
    padding: 14,
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
