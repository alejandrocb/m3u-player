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
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Image,
  Platform,
  Pressable,
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
  Programacion,
  Reproducible,
} from '@m3u/ui';
import {
  AJUSTES_POR_DEFECTO,
  COLORES_PERFIL,
  COLUMNAS_POSIBLES,
  ClienteSync,
  GestorCuentas,
  elementosDeFila,
  Presentador,
  cantidad,
  mediasEstrellas,
  nota,
  numero,
} from '@m3u/ui';

import { almacenDeCuentas } from './src/almacen';
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

/**
 * El margen lateral de la pantalla, en un sitio del que poder restarlo.
 *
 * El destacado va a sangre —tiene que llegar a los bordes— y para eso cancela
 * este margen con uno negativo. Antes estaba escrito a mano en `estilos` y no
 * había forma de referirlo.
 */
const MARGEN_PANTALLA = 32;

/** Lo que ocupa la cabecera: el destacado se mete por debajo de ella. */
const MARGEN_CABECERA = 96;

/** Cada cuánto se sincroniza mientras la biblioteca está abierta. */
const CADA_SINCRONIZACION_MS = 2 * 60 * 1000;

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
      setCasa((await sync.current.estado())?.grupo?.nombre ?? null);
      // Sesión abierta de la vez anterior: se entra directo, sin preguntar.
      if (abierto.activa) await conectar(abierto.activa);
      else setFase({ tipo: 'listas' });
    })();
  }, [conectar]);

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
  onSincronizar,
  onCambioPerfil,
}: {
  biblioteca: Biblioteca;
  perfiles: AlmacenPerfiles;
  programacion: Programacion;
  perfil: Perfil;
  cuenta: Cuenta;
  medicion: Medicion;
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
  const [estado, setEstado] = useState<EstadoPantalla | null>(null);
  const [reproduciendo, setReproduciendo] = useState<Reproducible | null>(null);
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
      seguirViendo: () => perfiles.seguirViendo(perfil.id, 12),
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
    presentador.current = instancia;
    instancia.cargar().then(setEstado);
    // `ajustes.orden` no está entre las dependencias a propósito: cambiarlo se
    // aplica sobre el presentador vivo, no rehaciéndolo. Las columnas sí
    // obligan a rehacerlo porque la rejilla se monta con ellas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biblioteca, perfiles, perfil, ajustes.columnas]);

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
            setFocoCabecera((actual) => Math.min(botonesCabecera.length - 1, actual + 1));
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

        if (evento.eventType === 'up' && botonesCabecera.length > 0 && !estado?.lateral?.dentro && arribaDelTodo) {
          setFocoCabecera((actual) => Math.min(actual, botonesCabecera.length - 1));
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
          botonesCabecera[focoCabecera]?.onPress();
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

  /**
   * La cabecera: el título a la izquierda, la lupa y el perfil a la derecha.
   *
   * Se arma como variable porque en el inicio va dentro de la lista —para que
   * se desplace con ella— y en el resto de pantallas encima, fija.
   */
  const cabecera = (
<View style={estilos.cabecera}>
          <View style={estilos.tituloBloque}>
            <Text style={estilos.titulo}>{estado.titulo}</Text>
            {enInicio ? (
              <Text style={estilos.subtitulo}>
                {cuenta.nombre} · {cantidad(medicion.entradas, 'ficha', 'fichas')} ·{' '}
                {medicion.via === 'guardada'
                  ? `guardadas ${frescura(medicion.dias)}`
                  : `traídas del panel en ${(medicion.total / 1000).toFixed(0)} s`}
              </Text>
            ) : null}
          </View>
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
                      focoCabecera === indice &&
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
        La cabecera, ya solo con dos iconos.

        En el inicio **no se pinta aquí**: va dentro de la lista, como
        encabezado, y se va con el desplazamiento. Antes era una barra fija
        que se comía el alto y en el teléfono se pisaba con el contenido.
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
          cabecera={cabecera}
          enCabecera={enCabecera}
          inicio={estado.inicio}
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
  cabecera,
  enCabecera,
  inicio,
  onTocar,
}: {
  /** Va como encabezado de la lista, así que se desplaza con el contenido. */
  cabecera: ReactNode;
  /** El mando está arriba, en la lupa o el perfil. */
  enCabecera: boolean;
  inicio: Inicio;
  onTocar: (fila: number, columna: number) => void;
}) {
  const lista = useRef<FlatList<FilaInicio>>(null);
  const { height: alto } = useWindowDimensions();

  /*
    El destacado ocupa la mayor parte de la pantalla, y por arriba se mete por
    debajo de la cabecera. El tope es para que en un televisor de 4K no se
    coma la fila de "seguir viendo", que tiene que asomar: es lo que invita a
    bajar.
  */
  const altoDestacado = Math.min(520, Math.round(alto * 0.68)) + MARGEN_CABECERA;

  useEffect(() => {
    // Con el foco arriba hay que subir del todo: la cabecera va dentro de la
    // lista, y `scrollToIndex` solo sabe llegar a las filas de datos.
    if (enCabecera) {
      lista.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    // En la primera fila no se desplaza nada: la cabecera va justo encima y
    // moverse a ella la dejaría fuera de la pantalla nada más abrir.
    if (inicio.fila === 0 || inicio.filas.length === 0) return;
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
      ListHeaderComponent={<>{cabecera}</>}
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
              elemento={item.elemento}
              alto={altoDestacado}
              enfocado={activa}
              onTocar={() => onTocar(index, 0)}
            />
          );
        }

        return (
          <Carrusel
            titulo={item.tipo === 'carrusel' ? item.titulo : null}
            elementos={elementosDeFila(item)}
            grandes={item.tipo === 'secciones'}
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

function Destacado({
  elemento,
  alto,
  enfocado,
  onTocar,
}: {
  elemento: Elemento;
  alto: number;
  enfocado: boolean;
  onTocar: () => void;
}) {
  return (
    <Pressable focusable={false} onPress={onTocar} style={[estilos.destacado, { height: alto }]}>
      {elemento.logo ? (
        <Image source={{ uri: elemento.logo }} style={estilos.destacadoImagen} resizeMode="cover" />
      ) : null}

      {/*
        Dos degradados: uno de lado, que despeja la izquierda para el texto, y
        otro de abajo arriba, que funde la imagen con la fila de "seguir
        viendo" en vez de cortarla en seco.
      */}
      <View style={estilos.destacadoVelo} pointerEvents="none" />
      <View style={estilos.destacadoPie} pointerEvents="none" />

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

        <View style={[estilos.destacadoBoton, enfocado && estilos.destacadoBotonEnfocado]}>
          <Text style={estilos.destacadoBotonTexto}>▶  Reproducir</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Una fila horizontal de fichas: los carruseles y el menú de secciones. */
function Carrusel({
  titulo,
  elementos,
  grandes,
  activa,
  columna,
  onTocar,
}: {
  titulo: string | null;
  elementos: Elemento[];
  /** Las secciones se pintan más anchas y apaisadas: son el menú. */
  grandes: boolean;
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
      {titulo ? <Text style={[estilos.filaTitulo, activa && estilos.filaTituloActivo]}>{titulo}</Text> : null}
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
        renderItem={({ item, index }) => {
          const enfocado = activa && index === columna;
          return (
            <Pressable
              focusable={false}
              onPress={() => onTocar(index)}
              style={[
                grandes ? estilos.seccionFicha : estilos.fichaFila,
                enfocado && estilos.fichaFilaEnfocada,
              ]}
            >
              <View style={grandes ? estilos.seccionCaja : estilos.fichaCaratula}>
                {item.logo ? (
                  <Image
                    source={{ uri: item.logo }}
                    style={grandes ? estilos.seccionImagen : estilos.fichaImagen}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[grandes ? estilos.seccionImagen : estilos.fichaImagen, estilos.fichaSinImagen]}>
                    <Text
                      style={grandes ? estilos.seccionTexto : estilos.fichaSinImagenTexto}
                      numberOfLines={2}
                    >
                      {item.titulo}
                    </Text>
                  </View>
                )}
                {item.avance !== null ? (
                  <View style={estilos.fichaBarra}>
                    <View style={[estilos.fichaBarraVista, { width: `${Math.round(item.avance * 100)}%` }]} />
                  </View>
                ) : null}
              </View>
              {/*
                El nombre de una sección va dentro del recuadro, no debajo:
                puesto en los dos sitios salía repetido.
              */}
              {grandes ? null : (
                <Text style={estilos.fichaNombre} numberOfLines={1}>
                  {item.titulo}
                </Text>
              )}
              {item.detalle ? (
                <Text style={estilos.filaFichaDetalle} numberOfLines={1}>
                  {item.detalle}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
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

const VERDE = '#35d07f';

const estilos = StyleSheet.create({
  // La capa de fuera: sin márgenes, para que lo que se coloca con coordenadas
  // de pantalla —el reproductor— caiga donde debe.
  raiz: {
    backgroundColor: '#06131c',
    flex: 1,
  },
  pantalla: {
    backgroundColor: '#06131c',
    flex: 1,
    paddingHorizontal: MARGEN_PANTALLA,
  },
  centrado: {
    alignItems: 'center',
    gap: 20,
    justifyContent: 'center',
  },
  espera: {
    color: '#dfe7ee',
    fontSize: 20,
  },
  errorArriba: {
    backgroundColor: 'rgba(255,107,107,0.15)',
    color: '#ff6b6b',
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
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cerrarSesionTexto: {
    color: '#8fa3b3',
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
    color: '#dfe7ee',
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
    color: '#dfe7ee',
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
    color: '#dfe7ee',
    fontSize: 18,
  },
  opcionTextoActiva: {
    color: '#06131c',
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
    color: '#dfe7ee',
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
    color: '#06131c',
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
    color: '#06131c',
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
    color: '#dfe7ee',
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
    marginHorizontal: -MARGEN_PANTALLA,
    marginTop: -MARGEN_CABECERA,
    overflow: 'hidden',
    paddingHorizontal: MARGEN_PANTALLA,
  },
  destacadoImagen: {
    height: '100%',
    position: 'absolute',
    right: 0,
    // Ancha de verdad: con la imagen apaisada del panel llena casi todo, y el
    // degradado se encarga de despejar la izquierda.
    width: '78%',
  },
  destacadoVelo: {
    bottom: 0,
    experimental_backgroundImage:
      'linear-gradient(to right, #06131c 0%, #06131c 30%, rgba(6,19,28,0.70) 56%, rgba(6,19,28,0) 92%)',
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
      'linear-gradient(to bottom, rgba(6,19,28,0) 0%, rgba(6,19,28,0.85) 65%, #06131c 100%)',
    height: 120,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  destacadoTexto: {
    gap: 9,
    maxWidth: 620,
    paddingBottom: 30,
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
    fontSize: 38,
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
    color: '#8fa3b3',
    fontSize: 16,
  },
  destacadoSinopsis: {
    color: '#c6d3dd',
    fontSize: 16,
    lineHeight: 23,
  },
  destacadoReparto: {
    color: '#8fa3b3',
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
    marginBottom: 20,
  },
  filaTitulo: {
    color: '#8fa3b3',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  filaTituloActivo: {
    color: VERDE,
  },
  filaLista: {
    gap: 13,
    paddingRight: 20,
  },
  fichaFila: {
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 3,
    padding: 3,
    width: 126,
  },
  fichaFilaEnfocada: {
    borderColor: '#fff',
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
    color: '#8fa3b3',
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
  fichaNombre: {
    color: '#dfe7ee',
    fontSize: 14,
    marginTop: 6,
  },
  filaFichaDetalle: {
    color: '#5d6f7d',
    fontSize: 12,
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
    color: '#dfe7ee',
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
    color: '#dfe7ee',
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
    color: '#dfe7ee',
    fontSize: 19,
    fontWeight: '600',
  },
  datosEpisodio: {
    flexDirection: 'row',
    gap: 12,
  },
  datoEpisodio: {
    color: '#8fa3b3',
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
    color: '#dfe7ee',
    fontSize: 22,
  },
  textoEnfocado: {
    color: '#fff',
    fontWeight: '700',
  },
  fichaDetalle: {
    color: '#8fa3b3',
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
