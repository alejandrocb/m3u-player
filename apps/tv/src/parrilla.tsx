/**
 * La columna de la derecha del directo: qué es este canal y qué echan.
 *
 * El vídeo del canal se ve aquí mismo, en pequeño, antes de abrirlo entero.
 * **La columna no lo dibuja**: deja el hueco y mide dónde ha quedado, y el
 * reproductor —que vive fuera, en la capa de arriba— se coloca encima. Parece
 * un rodeo y no lo es: si el vídeo fuera hijo de esta columna, al pasar a
 * pantalla completa cambiaría de sitio en el árbol, React lo volvería a montar
 * y ExoPlayer soltaría la conexión. **El panel tarda unos treinta segundos en
 * liberarla**, así que agrandar el vídeo dejaría medio minuto de 403.
 *
 * Con una sola conexión, además, la vista previa ocupa la ranura: por eso solo
 * arranca cuando el foco se queda quieto un segundo, y no mientras se zapea.
 *
 * La parrilla llega del panel canal a canal, así que hay un momento de espera
 * al mover el foco: se enseña lo que ya se tenía hasta que llegue lo nuevo, en
 * vez de vaciar la columna y hacerla parpadear.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { avanceDePrograma, programaActual, programasSiguientes } from '@m3u/core';
import type { Programa } from '@m3u/core';
import type { Elemento, Programacion } from '@m3u/ui';
import { TINTA, TINTA_SUAVE, TINTA_TENUE, VERDE } from './tema';

/** Cuánto se espera antes de pedir, para no consultar en cada pulsación. */
const ESPERA_MS = 350;

/** Cada cuánto se repinta, para que la barra del programa avance sola. */
const RELOJ_MS = 30_000;

/** "20:15", con la hora del aparato: el panel manda los tiempos en UTC. */
export function hora(fecha: Date): string {
  const dosCifras = (valor: number): string => String(valor).padStart(2, '0');
  return `${dosCifras(fecha.getHours())}:${dosCifras(fecha.getMinutes())}`;
}

/** Dónde ha quedado el hueco del vídeo, en coordenadas de pantalla. */
export interface Caja {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function Parrilla({
  canal,
  programacion,
  conVideo,
  enfocada,
  onCaja,
  onAbrir,
  respectoA,
}: {
  /** El canal enfocado, o null si el foco está en la barra de categorías. */
  canal: Elemento | null;
  programacion: Programacion;
  /** true cuando el reproductor está puesto encima del hueco. */
  conVideo?: boolean;
  /** El mando está sobre el vídeo: se marca, que con mando no hay puntero. */
  enfocada?: boolean;
  /** Avisa de dónde está el hueco para que el vídeo se coloque ahí. */
  onCaja?: (caja: Caja) => void;
  /**
   * El contenedor donde flota el reproductor.
   *
   * La medida se toma **relativa a él** y no a la pantalla: los márgenes de la
   * interfaz desplazan el contenido, y midiendo en coordenadas absolutas el
   * vídeo salía unos píxeles alto, montado sobre los botones de la cabecera.
   */
  respectoA?: React.RefObject<View | null>;
  /** Pulsar sobre la vista previa la abre a pantalla completa. */
  onAbrir?: () => void;
}) {
  const hueco = useRef<View | null>(null);
  /** Lo último que se avisó, para no repetir el aviso en cada render. */
  const ultimaCaja = useRef<Caja | null>(null);
  const [programas, setProgramas] = useState<Programa[]>([]);
  const [cargando, setCargando] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());

  const canalId = canal?.id ?? null;

  useEffect(() => {
    if (!canalId) return;

    let vigente = true;
    setCargando(true);
    // El foco se mueve más rápido de lo que responde el panel: se espera un
    // momento y solo se pide del canal en el que uno se queda.
    const espera = setTimeout(() => {
      programacion
        .deCanal(canalId)
        .then((lista) => vigente && setProgramas(lista))
        .catch(() => vigente && setProgramas([]))
        .finally(() => vigente && setCargando(false));
    }, ESPERA_MS);

    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [canalId, programacion]);

  /**
   * Mide el hueco y lo avisa, si ha cambiado.
   *
   * No basta con `onLayout`: solo salta cuando cambia el **tamaño** del nodo,
   * y aquí lo que se mueve es su **posición** —el contenido baja cuando se
   * aplican los márgenes de la pantalla, que llegan un instante después—. Sin
   * volver a medir, el vídeo se quedaba unos píxeles alto y se montaba sobre
   * los botones de la cabecera.
   */
  const medir = useCallback(() => {
    const nodo = hueco.current;
    const referencia = respectoA?.current;
    if (!nodo || !referencia) return;

    const avisar = (x: number, y: number, width: number, height: number): void => {
      if (width <= 0 || height <= 0) return;
      const anterior = ultimaCaja.current;
      if (anterior && anterior.x === x && anterior.y === y && anterior.width === width && anterior.height === height) {
        return;
      }
      ultimaCaja.current = { x, y, width, height };
      onCaja?.({ x, y, width, height });
    };

    // Si la medida relativa falla —pasa mientras el árbol se está montando—,
    // se deja para el siguiente pintado en vez de colocar el vídeo a ciegas.
    nodo.measureLayout(referencia, avisar, () => {});
  }, [onCaja, respectoA]);

  // Se remide después de pintar, que es cuando el hueco ya está en su sitio.
  useEffect(medir);

  // El programa en curso se decide con la hora del aparato, así que hay que
  // volver a mirarla de vez en cuando o la barra se queda congelada.
  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);

  if (!canal) {
    return (
      <View style={[estilos.columna, estilos.centrada]}>
        <Text style={estilos.vacio}>Elige un canal para ver su programación</Text>
      </View>
    );
  }

  const actual = programaActual(programas, ahora);
  const siguientes = programasSiguientes(programas, ahora).slice(0, 6);

  return (
    <View style={estilos.columna}>
      {/*
        El hueco del vídeo. Mientras no haya reproducción se ve el logotipo;
        cuando la hay, el reproductor se coloca justo encima y este contenido
        queda detrás sin estorbar.
      */}
      <Pressable
        ref={hueco}
        style={[estilos.marco, enfocada && estilos.marcoEnfocado]}
        onPress={onAbrir}
        onLayout={medir}
      >
        {conVideo ? null : canal.logo ? (
          <Image source={{ uri: canal.logo }} style={estilos.logo} resizeMode="contain" />
        ) : (
          <Text style={estilos.sinLogo}>{canal.titulo}</Text>
        )}
      </Pressable>

      <Text style={estilos.nombre} numberOfLines={2}>
        {canal.titulo}
      </Text>

      {actual ? (
        <View style={estilos.ahora}>
          <View style={estilos.franjaHoras}>
            <Text style={estilos.horaFuerte}>{hora(actual.desde)}</Text>
            <Text style={estilos.horaFuerte}>{hora(actual.hasta)}</Text>
          </View>
          <View style={estilos.riel}>
            <View style={[estilos.progreso, { width: `${avanceDePrograma(actual, ahora) * 100}%` }]} />
          </View>
          <Text style={estilos.tituloPrograma} numberOfLines={2}>
            {actual.titulo}
          </Text>
          {actual.descripcion ? (
            <Text style={estilos.sinopsis} numberOfLines={4}>
              {actual.descripcion}
            </Text>
          ) : null}
        </View>
      ) : cargando ? (
        <ActivityIndicator style={estilos.espera} color={VERDE} />
      ) : (
        <Text style={estilos.vacio}>Este canal no trae programación</Text>
      )}

      {siguientes.length > 0 ? (
        <>
          <Text style={estilos.rotulo}>A continuación</Text>
          <ScrollView
            style={estilos.lista}
            showsVerticalScrollIndicator={false}
            // Por lo mismo que las listas de App.tsx: en la tele el
            // sistema la desplazaba sola al pulsar una flecha.
            focusable={false}
            isTVSelectable={false}
            scrollEnabled={!Platform.isTV}
          >
            {siguientes.map((programa) => (
              <View key={programa.desde.getTime()} style={estilos.fila}>
                <Text style={estilos.horaFila}>{hora(programa.desde)}</Text>
                <Text style={estilos.tituloFila} numberOfLines={2}>
                  {programa.titulo}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  columna: {
    // Poco menos de la mitad: le sobra para el vídeo y el programa, y lo que
    // cede se lo lleva la lista de canales, que lo necesita más.
    flex: 1,
    paddingLeft: 18,
    gap: 10,
  },
  centrada: {
    justifyContent: 'center',
  },
  marcoEnfocado: {
    borderColor: VERDE,
    borderWidth: 3,
  },
  marco: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  logo: {
    height: '70%',
    width: '70%',
  },
  sinLogo: {
    color: '#5d6f7d',
    fontSize: 18,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  nombre: {
    color: TINTA_SUAVE,
    fontSize: 19,
    fontWeight: '700',
  },
  ahora: {
    gap: 6,
  },
  franjaHoras: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  horaFuerte: {
    color: TINTA_TENUE,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  riel: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  progreso: {
    backgroundColor: VERDE,
    height: '100%',
  },
  tituloPrograma: {
    color: TINTA,
    fontSize: 17,
    fontWeight: '600',
  },
  sinopsis: {
    color: '#a9bcc9',
    fontSize: 13,
    lineHeight: 18,
  },
  rotulo: {
    color: '#5d6f7d',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  lista: {
    flex: 1,
  },
  fila: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  horaFila: {
    color: TINTA_TENUE,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    width: 42,
  },
  tituloFila: {
    color: '#c8d6e0',
    flex: 1,
    fontSize: 14,
  },
  espera: {
    marginTop: 20,
  },
  vacio: {
    color: '#5d6f7d',
    fontSize: 14,
    textAlign: 'center',
  },
});
