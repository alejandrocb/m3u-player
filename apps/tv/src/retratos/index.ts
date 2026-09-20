/**
 * Los retratos que trae la aplicación.
 *
 * Lo que se guarda en el perfil es **el nombre** de uno de estos ("gato",
 * "buho"), no una imagen: así viaja con la sincronización en una palabra y se
 * pinta igual en la tele, en la tablet y en el teléfono, sin subir nada a
 * ninguna parte ni depender de que el aparato tenga el fichero descargado.
 *
 * Son siluetas en el negro de la aplicación con los huecos transparentes, y se
 * pintan **encima del color del perfil**: los diez valen para los cinco
 * colores, así que dos personas con el mismo bicho siguen distinguiéndose de
 * lejos.
 *
 * Un nombre desconocido —un retrato que existía en una versión más nueva y
 * llegó por sincronización— no rompe nada: `imagenDeRetrato` devuelve `null` y
 * el círculo cae en la inicial, que es como empiezan todos.
 */

import type { ImageSourcePropType } from 'react-native';

export interface Retrato {
  /** Lo que se guarda en el perfil. */
  id: string;
  /** Cómo se lee en la galería. */
  nombre: string;
  imagen: ImageSourcePropType;
}

export const RETRATOS: Retrato[] = [
  { id: 'gato', nombre: 'Gato', imagen: require('./gato.png') },
  { id: 'perro', nombre: 'Perro', imagen: require('./perro.png') },
  { id: 'buho', nombre: 'Búho', imagen: require('./buho.png') },
  { id: 'zorro', nombre: 'Zorro', imagen: require('./zorro.png') },
  { id: 'panda', nombre: 'Panda', imagen: require('./panda.png') },
  { id: 'rana', nombre: 'Rana', imagen: require('./rana.png') },
  { id: 'pulpo', nombre: 'Pulpo', imagen: require('./pulpo.png') },
  { id: 'robot', nombre: 'Robot', imagen: require('./robot.png') },
  { id: 'fantasma', nombre: 'Fantasma', imagen: require('./fantasma.png') },
  { id: 'astronauta', nombre: 'Astronauta', imagen: require('./astronauta.png') },
];

/** La imagen de un retrato, o `null` si no hay ninguno con ese nombre. */
export function imagenDeRetrato(id: string | undefined): ImageSourcePropType | null {
  if (!id) return null;
  return RETRATOS.find((uno) => uno.id === id)?.imagen ?? null;
}
