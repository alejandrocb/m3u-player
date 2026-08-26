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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useTVEventHandler,
} from 'react-native';
import Video from 'react-native-video';
import type { VideoRef } from 'react-native-video';

import type { AlmacenPerfiles, Biblioteca, ClaseMedio, Perfil, Programacion, Reproducible } from '@m3u/ui';
import { reloj, vaAnotado } from '@m3u/ui';
import { avanceDePrograma, programaActual } from '@m3u/core';
import type { Programa } from '@m3u/core';

import { hora } from './parrilla';
import type { Caja } from './parrilla';
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
        setUrl(mejor.url);
      })
      .catch((fallo) => vigente && setError(String(fallo)));

    return () => {
      vigente = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [biblioteca, medio]);

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

  useTVEventHandler((evento) => {
    // En pequeño manda la lista de canales, no el reproductor.
    if (compacto) return;
    switch (evento.eventType) {
      // En directo no hay a dónde saltar: las flechas cambian de canal, que es
      // lo que uno hace con un mando delante de la tele.
      case 'left':
        if (enDirecto) {
          if (anterior) onCambiar?.(anterior);
        } else {
          saltar(-SALTO_S);
        }
        break;
      case 'right':
        if (enDirecto) {
          if (siguiente) onCambiar?.(siguiente);
        } else {
          saltar(SALTO_S);
        }
        break;
      case 'select':
        // Si los controles estaban escondidos, el primer OK solo los enseña.
        if (visible) setPausado((estaba) => !estaba);
        despertar();
        break;
      case 'up':
      case 'down':
        despertar();
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
            // Lo apenas empezado y lo ya terminado no ensucian el historial;
            // lo terminado, además, se borra para que no reaparezca.
            if (vaAnotado(anotacion)) {
              perfiles.anotarAvance(perfil.id, anotacion).catch(() => {});
            } else if (anotacion.duracion > 0 && anotacion.segundos > anotacion.duracion * 0.95) {
              perfiles.olvidarAvance(perfil.id, anotacion.clase, anotacion.itemId).catch(() => {});
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
          onError={(fallo) => {
            // El detalle completo, al registro: se lee con `adb logcat`.
            console.warn('[reproductor]', JSON.stringify(fallo));
            setError(mensajeDeError(fallo));
          }}
        />
      ) : null}

      {!url && !error ? <ActivityIndicator size="large" color={VERDE} /> : null}

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
              <View style={[estilos.punto, { left: `${avance * 100}%` }]} />
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

            <Icono etiqueta={pausado ? 'Reproducir' : 'Pausa'} principal onPress={() => setPausado((estaba) => !estaba)}>
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
            {/* Volver al principio: hace falta sobre todo cuando se ha
                reanudado por donde se iba y resulta que uno quería empezar. */}
            {enDirecto ? null : (
              <Icono etiqueta="Desde el principio" apagado={tiempo < 5} onPress={() => saltar(-tiempo)}>
                <IconoPrincipio />
              </Icono>
            )}

            {audios.length > 1 ? (
              <Icono
                etiqueta="Audio"
                activo={panel === 'audio'}
                onPress={() => setPanel((abierto) => (abierto === 'audio' ? 'ninguno' : 'audio'))}
              >
                <IconoAudio color={panel === 'audio' ? VERDE : undefined} />
              </Icono>
            ) : null}

            {subtitulos.length > 0 ? (
              <Icono
                etiqueta="Subtítulos"
                activo={panel === 'subtitulos' || subtitulo >= 0}
                onPress={() => setPanel((abierto) => (abierto === 'subtitulos' ? 'ninguno' : 'subtitulos'))}
              >
                <IconoSubtitulos color={panel === 'subtitulos' || subtitulo >= 0 ? VERDE : undefined} />
              </Icono>
            ) : null}

            {/* El siguiente episodio, que es lo que uno busca al acabar uno. */}
            {!enDirecto && siguiente ? (
              <Icono etiqueta="Siguiente" onPress={() => onCambiar?.(siguiente)}>
                <IconoSiguiente />
              </Icono>
            ) : null}
          </View>

          {panel !== 'ninguno' ? (
            <ScrollView style={estilos.pistas} horizontal showsHorizontalScrollIndicator={false}>
              {panel === 'subtitulos' ? (
                <Pastilla
                  texto="Sin subtítulos"
                  activo={subtitulo === -1}
                  onPress={() => {
                    setSubtitulo(-1);
                    setPanel('ninguno');
                  }}
                />
              ) : null}
              {(panel === 'audio' ? audios : subtitulos).map((pista) => (
                <Pastilla
                  key={pista.indice}
                  texto={pista.nombre}
                  activo={panel === 'audio' ? audio === pista.indice : subtitulo === pista.indice}
                  onPress={() => {
                    if (panel === 'audio') setAudio(pista.indice);
                    else setSubtitulo(pista.indice);
                    setPanel('ninguno');
                  }}
                />
              ))}
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
  apagado,
}: {
  children: React.ReactNode;
  pie?: string;
  /** Para quien navegue con lector de pantalla: los dibujos no se leen. */
  etiqueta: string;
  onPress: () => void;
  principal?: boolean;
  activo?: boolean;
  /** Sin destino: se deja a la vista pero atenuado, para que no baile la fila. */
  apagado?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      disabled={apagado}
      style={({ focused, pressed }) => [
        estilos.icono,
        principal && estilos.iconoPrincipal,
        apagado && estilos.iconoApagado,
        (focused || pressed) && !apagado && (principal ? estilos.iconoPrincipalEnfocado : estilos.iconoEnfocado),
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
function Pastilla({ texto, onPress, activo }: { texto: string; onPress: () => void; activo?: boolean }) {
  return (
    <Pressable
      style={({ focused, pressed }) => [
        estilos.pastilla,
        activo && estilos.pastillaActiva,
        (focused || pressed) && estilos.pastillaEnfocada,
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
  iconoEnfocado: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  // El de reproducir es el único con círculo, y translúcido: un botón opaco
  // encima de la imagen es lo que hacía que esto pareciera un aparato viejo.
  iconoPrincipal: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 36,
    borderWidth: 1.5,
    height: 72,
    width: 72,
  },
  iconoPrincipalEnfocado: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderColor: '#fff',
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
  pastillaActiva: {
    backgroundColor: VERDE,
  },
  pastillaEnfocada: {
    borderColor: '#fff',
  },
  pastillaTexto: {
    color: '#fff',
    fontSize: 15,
  },
  pastillaTextoActivo: {
    color: FONDO,
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
