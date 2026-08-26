/**
 * Los iconos del reproductor, dibujados a mano.
 *
 * Antes eran emojis (⏪ ⏩ ⏮), y ahí está el problema: Android los pinta con
 * **su propia paleta**, así que salían con el fondo naranja del emoji del
 * sistema —imposible de quitar por estilo— encima del vídeo. Poner una fuente
 * de iconos o `react-native-svg` traería una dependencia nativa entera para
 * cinco formas geométricas.
 *
 * Un triángulo se hace con bordes: se le da tamaño cero y se rellena solo el
 * borde del lado que apunta, dejando los otros dos transparentes. Es el mismo
 * truco de siempre en CSS y en React Native funciona igual.
 */

import { StyleSheet, View } from 'react-native';
import { TINTA } from './tema';

interface Props {
  /** Alto del icono en píxeles independientes. El ancho sale de él. */
  tamano?: number;
  color?: string;
}

/** Triángulo suelto, la pieza de la que salen casi todos los demás. */
function Triangulo({ tamano, color, hacia }: Required<Props> & { hacia: 'izquierda' | 'derecha' }) {
  const mitad = tamano / 2;
  // El ancho de un triángulo equilátero tumbado, redondeado: se ve mejor algo
  // más estrecho que alto, como en cualquier mando.
  const ancho = Math.round(tamano * 0.62);
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: mitad,
        borderBottomWidth: mitad,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(hacia === 'derecha'
          ? { borderLeftWidth: ancho, borderLeftColor: color }
          : { borderRightWidth: ancho, borderRightColor: color }),
      }}
    />
  );
}

/** Barra vertical: la de pausa y el tope de "al principio" y "siguiente". */
function Barra({ tamano, color, ancho = 3 }: Required<Props> & { ancho?: number }) {
  return <View style={{ width: ancho, height: tamano, borderRadius: ancho / 2, backgroundColor: color }} />;
}

export function IconoPlay({ tamano = 26, color = TINTA }: Props) {
  // Desplazado un pelo a la derecha: un triángulo centrado por su caja parece
  // descentrado a la vista, y más dentro de un círculo.
  return (
    <View style={[estilos.fila, { marginLeft: Math.round(tamano * 0.12) }]}>
      <Triangulo tamano={tamano} color={color} hacia="derecha" />
    </View>
  );
}

export function IconoPausa({ tamano = 24, color = TINTA }: Props) {
  const ancho = Math.max(3, Math.round(tamano * 0.18));
  return (
    <View style={[estilos.fila, { gap: Math.round(tamano * 0.22) }]}>
      <Barra tamano={tamano} color={color} ancho={ancho} />
      <Barra tamano={tamano} color={color} ancho={ancho} />
    </View>
  );
}

/** Doble triángulo de los saltos. El número va aparte, bajo el icono. */
export function IconoSalto({ tamano = 20, color = TINTA, hacia }: Props & { hacia: 'izquierda' | 'derecha' }) {
  return (
    <View style={[estilos.fila, { gap: 2 }]}>
      <Triangulo tamano={tamano} color={color} hacia={hacia} />
      <Triangulo tamano={tamano} color={color} hacia={hacia} />
    </View>
  );
}

/** Volver al principio: la barra primero y el triángulo contra ella. */
export function IconoPrincipio({ tamano = 20, color = TINTA }: Props) {
  return (
    <View style={[estilos.fila, { gap: 3 }]}>
      <Barra tamano={tamano} color={color} />
      <Triangulo tamano={tamano} color={color} hacia="izquierda" />
    </View>
  );
}

/** Siguiente: el triángulo y la barra que lo remata. */
export function IconoSiguiente({ tamano = 20, color = TINTA }: Props) {
  return (
    <View style={[estilos.fila, { gap: 3 }]}>
      <Triangulo tamano={tamano} color={color} hacia="derecha" />
      <Barra tamano={tamano} color={color} />
    </View>
  );
}

/** Anterior: el mismo, del revés. Es el zapeo hacia atrás en directo. */
export function IconoAnterior({ tamano = 20, color = TINTA }: Props) {
  return (
    <View style={[estilos.fila, { gap: 3 }]}>
      <Barra tamano={tamano} color={color} />
      <Triangulo tamano={tamano} color={color} hacia="izquierda" />
    </View>
  );
}

/** Pistas de audio: una nota, que aquí sí es un carácter y no un emoji. */
export function IconoAudio({ tamano = 20, color = TINTA }: Props) {
  const palo = Math.round(tamano * 0.62);
  const bola = Math.round(tamano * 0.42);
  return (
    <View style={{ height: tamano, justifyContent: 'flex-end' }}>
      <View style={[estilos.fila, { alignItems: 'flex-end', gap: 2 }]}>
        <View style={{ width: bola, height: bola, borderRadius: bola / 2, backgroundColor: color }} />
        <View style={{ width: 2.5, height: palo, borderRadius: 2, backgroundColor: color }} />
      </View>
    </View>
  );
}

/** Subtítulos: un rectángulo con dos rayas dentro, como en cualquier mando. */
export function IconoSubtitulos({ tamano = 18, color = TINTA }: Props) {
  const ancho = Math.round(tamano * 1.45);
  return (
    <View
      style={{
        width: ancho,
        height: tamano,
        borderColor: color,
        borderRadius: 3,
        borderWidth: 1.6,
        justifyContent: 'flex-end',
        paddingBottom: 3,
        paddingHorizontal: 3,
        gap: 2.5,
      }}
    >
      <View style={{ height: 1.8, width: '100%', backgroundColor: color, borderRadius: 1 }} />
      <View style={{ height: 1.8, width: '62%', backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
