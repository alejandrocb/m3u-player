/**
 * El círculo del perfil.
 *
 * Redondo y no cuadrado a propósito: es lo que hace que se lea como "una
 * persona" y no como una ficha más de contenido, que en esta aplicación son
 * todas rectángulos.
 *
 * Sale en tres sitios y siempre igual —la cabecera, el menú y la pantalla de
 * perfiles—, así que lo único que cambia es el tamaño. La inicial y el borde
 * se calculan a partir de él para que a 44 y a 140 se vea lo mismo.
 */

import { Image, StyleSheet, Text, View } from 'react-native';

import type { Perfil } from '@m3u/ui';
import { imagenDeRetrato } from './retratos';
import { FONDO } from './tema';

interface Props {
  /** Lo justo para pintarlo: vale un perfil entero o los tres campos. */
  perfil: Pick<Perfil, 'nombre' | 'color' | 'avatar'>;
  tamano: number;
  /** Marca la elección: en la galería y en la pantalla de perfiles. */
  enfocado?: boolean;
}

export function Retrato({ perfil, tamano, enfocado = false }: Props) {
  const imagen = imagenDeRetrato(perfil.avatar);
  const borde = Math.max(2, Math.round(tamano * 0.035));

  return (
    <View
      style={[
        estilos.circulo,
        {
          backgroundColor: perfil.color,
          borderRadius: tamano / 2,
          borderWidth: borde,
          height: tamano,
          width: tamano,
        },
        enfocado && estilos.enfocado,
      ]}
    >
      {imagen ? (
        // La silueta ya viene con el hueco: se pinta encima del color.
        <Image source={imagen} style={{ height: tamano, width: tamano }} resizeMode="contain" />
      ) : (
        <Text style={[estilos.inicial, { fontSize: Math.round(tamano * 0.42) }]}>
          {perfil.nombre.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  circulo: {
    alignItems: 'center',
    // Sin recortar, la silueta se sale del círculo por las esquinas.
    borderColor: 'transparent',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  enfocado: {
    borderColor: '#fff',
  },
  inicial: {
    color: FONDO,
    fontWeight: '700',
  },
});
