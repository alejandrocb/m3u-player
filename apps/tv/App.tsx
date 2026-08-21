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
  BackHandler,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useTVEventHandler,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  Ajustes,
  AlmacenPerfiles,
  Biblioteca,
  Cuenta,
  Elemento,
  EstadoPantalla,
  Formato,
  Perfil,
  Programacion,
  Reproducible,
} from '@m3u/ui';
import {
  AJUSTES_POR_DEFECTO,
  COLUMNAS_POSIBLES,
  GestorCuentas,
  Presentador,
  cantidad,
  nota,
  numero,
} from '@m3u/ui';

import { almacenDeCuentas } from './src/almacen';
import { cargarCatalogo } from './src/carga';
import type { Avance, Medicion } from './src/carga';
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

type Fase =
  | { tipo: 'abriendo' }
  | { tipo: 'listas'; error?: string }
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
  const gestor = useRef<GestorCuentas | null>(null);
  const biblioteca = useRef<Biblioteca | null>(null);
  const perfiles = useRef<AlmacenPerfiles | null>(null);
  const programacion = useRef<Programacion | null>(null);

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
      // Antes de la biblioteca, quién está viendo: cada perfil tiene su
      // historial y sus favoritos.
      setFase({ tipo: 'perfiles', cuenta: elegida, medicion });
    } catch (fallo) {
      biblioteca.current = null;
      setFase({ tipo: 'listas', error: fallo instanceof Error ? fallo.message : String(fallo) });
    }
  }, []);

  useEffect(() => {
    (async () => {
      const abierto = await GestorCuentas.abrir(almacenDeCuentas);
      gestor.current = abierto;
      // Sesión abierta de la vez anterior: se entra directo, sin preguntar.
      if (abierto.activa) await conectar(abierto.activa);
      else setFase({ tipo: 'listas' });
    })();
  }, [conectar]);

  const cerrarSesion = useCallback(async () => {
    await gestor.current?.cerrarSesion();
    biblioteca.current = null;
    setFase({ tipo: 'listas' });
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
  const [avisoSalida, setAvisoSalida] = useState(false);

  const presentador = useRef<Presentador | null>(null);
  const salidaPendiente = useRef(false);
  /** La pantalla actual es la del directo: solo ahí hay vista previa. */
  const esDirecto = useRef(false);
  /** Contra este contenedor se mide el hueco del vídeo. */
  const raiz = useRef<View | null>(null);
  const lista = useRef<FlatList<Elemento> | null>(null);
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_POR_DEFECTO);
  const [verAjustes, setVerAjustes] = useState(false);
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
  useEffect(() => {
    if (!estado) return;
    if (estado.formato === 'canales') {
      if (!reproduciendo && aPantallaCompleta) setAPantallaCompleta(false);
    } else if (reproduciendo && !aPantallaCompleta) {
      setReproduciendo(null);
      setAPantallaCompleta(true);
    }
  }, [estado, reproduciendo, aPantallaCompleta]);

  const atras = useCallback((): boolean => {
    const instancia = presentador.current;
    if (!instancia) return false;

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
  }, [reproduciendo, aPantallaCompleta]);

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
    const enfocado = instancia.estado().elementos[instancia.estado().foco];
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
        if (reproduciendo) return;
        const direccion = {
          up: 'arriba',
          down: 'abajo',
          left: 'izquierda',
          right: 'derecha',
        }[evento.eventType] as 'arriba' | 'abajo' | 'izquierda' | 'derecha';
        instancia.mover(direccion).then((nuevo) => {
          setEstado(nuevo);
          // Con mando, el foco puede irse fuera de lo visible: la lista lo sigue.
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
        aceptar();
        break;

      // El botón de menú del mando de Apple TV hace de "atrás"; en Android
      // llega por BackHandler.
      case 'menu':
        atras();
        break;
    }
  });

  if (!estado) return <Espera texto="Cargando la biblioteca…" />;

  esDirecto.current = estado.formato === 'canales';

  const enInicio = presentador.current?.pantalla.tipo === 'inicio';

  return (
    // Dos capas: la de dentro lleva los márgenes de la interfaz y la de fuera
    // no lleva ninguno. El reproductor cuelga de la de fuera a propósito: se
    // coloca con coordenadas de pantalla —las que mide la parrilla para su
    // hueco— y desde un contenedor con relleno saldría desplazado justo esos
    // 32 píxeles, montándose sobre los botones de la cabecera.
    <View style={estilos.raiz} ref={raiz}>
    <View style={[estilos.pantalla, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
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
        {enInicio || estado.lateral ? (
          <View style={estilos.botonera}>
            <Pressable style={estilos.botonCabecera} onPress={abrirBuscador}>
              <Text style={estilos.cerrarSesionTexto}>Buscar</Text>
            </Pressable>
            {enInicio ? (
              <Pressable style={estilos.botonCabecera} onPress={onActualizar}>
                <Text style={estilos.cerrarSesionTexto}>Actualizar</Text>
              </Pressable>
            ) : null}
            {estado.lateral ? (
              <Pressable style={estilos.botonCabecera} onPress={() => setVerAjustes((abierto) => !abierto)}>
                <Text style={estilos.cerrarSesionTexto}>⚙</Text>
              </Pressable>
            ) : null}
            {enInicio ? (
              <Pressable style={estilos.botonCabecera} onPress={onCambiarPerfil}>
                <Text style={estilos.cerrarSesionTexto}>{perfil.nombre}</Text>
              </Pressable>
            ) : null}
            {enInicio ? (
              <Pressable style={estilos.botonCabecera} onPress={onCerrarSesion}>
                <Text style={estilos.cerrarSesionTexto}>Cerrar sesión</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {verAjustes && estado.lateral ? (
        <View style={estilos.ajustes}>
          <Text style={estilos.ajustesTitulo}>Carátulas por fila</Text>
          <View style={estilos.ajustesFila}>
            {COLUMNAS_POSIBLES.map((cuantas) => (
              <Pressable
                key={cuantas}
                style={[estilos.opcion, ajustes.columnas === cuantas && estilos.opcionActiva]}
                onPress={async () => {
                  await perfiles.guardarAjuste(perfil.id, 'columnas', String(cuantas));
                  setAjustes({ ...ajustes, columnas: cuantas });
                  setVerAjustes(false);
                }}
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
            {(
              [
                ['titulo', 'Título'],
                ['valoracion', 'Valoración'],
                ['reciente', 'Novedades'],
              ] as const
            ).map(([clave, nombre]) => (
              <Pressable
                key={clave}
                style={[estilos.opcion, ajustes.orden === clave && estilos.opcionActiva]}
                onPress={async () => {
                  await perfiles.guardarAjuste(perfil.id, 'orden', clave);
                  setAjustes({ ...ajustes, orden: clave });
                  setVerAjustes(false);
                  // Se reordena la pantalla en la que estamos: recrear el
                  // presentador devolvería al inicio, y lo que uno quiere es
                  // ver esta misma categoría ordenada de otra manera.
                  presentador.current?.ordenarPor(clave).then(setEstado);
                }}
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

      <View style={estilos.cuerpo}>
        {/* En el directo, la barra y la lista se reparten una mitad y la
            parrilla se queda la otra: es donde va el vídeo. */}
        <View style={[estilos.columnaIzquierda, estado.formato === 'canales' && estilos.mitad]}>
        {estado.lateral ? (
          <View style={[estilos.barra, estado.lateral.dentro && estilos.barraEnfocada]}>
            <FlatList
              data={estado.lateral.opciones}
              keyExtractor={(opcion) => (opcion.favoritos ? 'favoritos' : (opcion.grupo ?? 'todas'))}
              extraData={estado.lateral}
              renderItem={({ item, index }) => {
                // El grupo de favoritos no tiene nombre de categoría, así que
                // se compara por su marca y no por `grupo`, que es null.
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
        ) : null}

      <FlatList
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
        removeClippedSubviews
        onEndReachedThreshold={0.6}
        onEndReached={() => presentador.current?.cargarMas().then(setEstado)}
        ListFooterComponent={
          estado.hayMas ? <ActivityIndicator style={estilos.pie} color={VERDE} /> : null
        }
        style={estilos.listaPrincipal}
        renderItem={({ item, index }) => (
          <Ficha
            elemento={item}
            enfocado={index === estado.foco && !estado.lateral?.dentro}
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

      {/* La programación del canal en el que está el foco. */}
      {estado.formato === 'canales' ? (
        <Parrilla
          canal={estado.elementos[estado.foco] ?? null}
          programacion={programacion}
          conVideo={Boolean(reproduciendo) && !aPantallaCompleta}
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
    paddingHorizontal: 32,
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
  // Las dos mitades de la pantalla del directo.
  mitad: {
    flex: 1,
  },
  listaPrincipal: {
    flex: 1,
  },
  barra: {
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    // Ancho fijo: las categorías son nombres cortos y la rejilla se queda con
    // el resto, que es lo que hay que ver.
    width: 260,
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
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
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
