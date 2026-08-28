/**
 * Quién está viendo.
 *
 * Sale tras conectar con la lista y antes de la biblioteca, como en cualquier
 * servicio de estos. Cada perfil tiene su historial y sus favoritos, así que
 * lo que uno deje a medias no aparece en el "seguir viendo" de los demás.
 *
 * **Aquí se administra el perfil, y en ningún otro sitio.** Antes el nombre y
 * el color se cambiaban desde el menú de la biblioteca, de uno en uno y a
 * ciegas —"Cambiar color" iba dando la vuelta a la lista—. En esta pantalla
 * están los perfiles delante, así que editar es entrar en el que quieras y ver
 * lo que estás eligiendo.
 *
 * Los perfiles son de la casa: lo que se toque aquí viaja a los demás
 * aparatos con la sincronización, borrarlo incluido. Por eso el borrado avisa.
 */

import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AlmacenPerfiles, Perfil } from '@m3u/ui';
import { COLORES_PERFIL } from '@m3u/ui';
import { Retrato } from './retrato';
import { RETRATOS } from './retratos';
import { FONDO, ROJO, TINTA, TINTA_SUAVE, TINTA_TENUE, VERDE } from './tema';

const LOGOTIPO = require('./marca/logotipo.png');

/** El diámetro del círculo de cada perfil en la fila de elegir. */
const RETRATO = 132;

/** El de la galería, que enseña diez y tiene que caber en una tablet. */
const RETRATO_GALERIA = 84;

interface Props {
  almacen: AlmacenPerfiles;
  onElegir: (perfil: Perfil) => void;
  /**
   * Volver sin elegir.
   *
   * Solo lo hay cuando se llega desde el menú de la biblioteca: al arrancar no
   * hay adónde volver, y un botón que no lleva a ninguna parte confunde.
   */
  onVolver?: () => void;
}

/** A quién se está editando: uno de la casa, o el que se está creando. */
type Edicion = { perfil: Perfil | null; nombre: string; color: string; avatar: string };

export function PantallaPerfiles({ almacen, onElegir, onVolver }: Props) {
  const [perfiles, setPerfiles] = useState<Perfil[] | null>(null);
  const [administrando, setAdministrando] = useState(false);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [borrando, setBorrando] = useState(false);

  const recargar = useCallback((): void => {
    almacen.perfiles().then(setPerfiles);
  }, [almacen]);

  useEffect(recargar, [recargar]);

  /*
    Ojo con el orden: **todos los hooks van antes del primer `return`**.

    Tenerlos detrás del "Un momento…" hacía que React viera un número distinto
    de hooks entre un pintado y otro, y la aplicación se cerraba nada más
    abrirse en cuanto los perfiles terminaban de cargar.
  */
  const lista = perfiles ?? [];

  const editar = useCallback((perfil: Perfil): void => {
    setBorrando(false);
    setEdicion({ perfil, nombre: perfil.nombre, color: perfil.color, avatar: perfil.avatar });
  }, []);

  const anadir = useCallback((): void => {
    setBorrando(false);
    // El color lo pone el almacén al crearlo, que es quien sabe cuáles están
    // cogidos; hasta entonces se enseña el primero.
    setEdicion({ perfil: null, nombre: '', color: COLORES_PERFIL[0], avatar: '' });
  }, []);

  const guardar = useCallback(async () => {
    if (!edicion) return;
    const nombre = edicion.nombre.trim();

    if (!edicion.perfil) {
      const creado = await almacen.crear(nombre, edicion.color);
      if (edicion.avatar) await almacen.ponerRetrato(creado.id, edicion.avatar);
      setEdicion(null);
      // Recién creado se entra con él: es lo que uno acaba de decir que es.
      onElegir({ ...creado, avatar: edicion.avatar });
      return;
    }

    const { perfil } = edicion;
    // Solo lo que cambie: cada escritura sella la fecha y se reparte, así que
    // guardar lo mismo tres veces es tráfico de más para nada.
    if (nombre && nombre !== perfil.nombre) await almacen.renombrar(perfil.id, nombre);
    if (edicion.color !== perfil.color) await almacen.recolorear(perfil.id, edicion.color);
    if (edicion.avatar !== perfil.avatar) await almacen.ponerRetrato(perfil.id, edicion.avatar);
    setEdicion(null);
    recargar();
  }, [almacen, edicion, onElegir, recargar]);

  const borrar = useCallback(async () => {
    if (!edicion?.perfil) return;
    await almacen.borrar(edicion.perfil.id);
    setBorrando(false);
    setEdicion(null);
    recargar();
  }, [almacen, edicion, recargar]);

  if (!perfiles) {
    return (
      <View style={[estilos.pantalla, estilos.centrado]}>
        <Text style={estilos.espera}>Un momento…</Text>
      </View>
    );
  }

  // La primera vez no hay ninguno: se pide uno directamente en vez de enseñar
  // una pantalla vacía con un botón.
  const editando = edicion ?? (lista.length === 0 ? { perfil: null, nombre: '', color: COLORES_PERFIL[0], avatar: '' } : null);

  const titulo = editando
    ? editando.perfil
      ? 'Editar perfil'
      : '¿Cómo te llamas?'
    : administrando
      ? 'Administrar perfiles'
      : '¿Quién está viendo?';

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Image source={LOGOTIPO} style={estilos.logotipo} resizeMode="contain" />
      <Text style={estilos.titulo}>{titulo}</Text>

      {editando ? (
        <Editor
          edicion={editando}
          alCambiar={(cambio) => setEdicion({ ...editando, ...cambio })}
          alGuardar={() => void guardar()}
          alCancelar={lista.length > 0 ? () => setEdicion(null) : undefined}
          alBorrar={
            // No se borra el único que hay: sin perfiles no se puede ver nada,
            // y la pantalla siguiente sería volver a crear uno.
            editando.perfil && lista.length > 1 ? () => setBorrando(true) : undefined
          }
          borrando={borrando}
          alConfirmarBorrado={() => void borrar()}
          alDejarloEstar={() => setBorrando(false)}
        />
      ) : (
        <>
          <View style={estilos.fila}>
            {lista.map((perfil, indice) => (
              <Pressable
                key={perfil.id}
                /*
                  El sistema le da el foco al abrir la pantalla: sin un
                  elemento enfocado de verdad, el OK del mando no llega a
                  ninguna parte.
                */
                hasTVPreferredFocus={indice === 0}
                style={estilos.perfil}
                onPress={() => (administrando ? editar(perfil) : onElegir(perfil))}
              >
                {({ focused, pressed }) => (
                  <>
                    <View style={(focused || pressed) && estilos.crecido}>
                      <Retrato perfil={perfil} tamano={RETRATO} enfocado={focused || pressed} />
                      {administrando ? (
                        <View style={estilos.lapiz}>
                          <Text style={estilos.lapizTexto}>✎</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={[estilos.nombre, (focused || pressed) && estilos.nombreEnfocado]}
                      numberOfLines={1}
                    >
                      {perfil.nombre}
                    </Text>
                  </>
                )}
              </Pressable>
            ))}

            {/* Añadir es un círculo más: en la fila, no en otro sitio. */}
            <Pressable style={estilos.perfil} onPress={anadir}>
              {({ focused, pressed }) => (
                <>
                  <View
                    style={[
                      estilos.anadir,
                      { borderRadius: RETRATO / 2, height: RETRATO, width: RETRATO },
                      (focused || pressed) && estilos.anadirEnfocado,
                      (focused || pressed) && estilos.crecido,
                    ]}
                  >
                    <Text style={estilos.mas}>+</Text>
                  </View>
                  <Text
                    style={[estilos.nombre, (focused || pressed) && estilos.nombreEnfocado]}
                    numberOfLines={1}
                  >
                    Añadir perfil
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={estilos.fila}>
            <Boton
              texto={administrando ? 'Listo' : 'Administrar perfiles'}
              onPress={() => setAdministrando((antes) => !antes)}
            />
            {onVolver ? <Boton texto="Volver" onPress={onVolver} /> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** Editar uno: el nombre, el color y el retrato, viéndolo mientras se toca. */
function Editor({
  edicion,
  alCambiar,
  alGuardar,
  alCancelar,
  alBorrar,
  borrando,
  alConfirmarBorrado,
  alDejarloEstar,
}: {
  edicion: Edicion;
  alCambiar: (cambio: Partial<Edicion>) => void;
  alGuardar: () => void;
  alCancelar?: () => void;
  alBorrar?: () => void;
  borrando: boolean;
  alConfirmarBorrado: () => void;
  alDejarloEstar: () => void;
}) {
  // El nombre vacío no vale ni para crear ni para renombrar: sin él el círculo
  // se queda sin inicial y la lista, sin nada que leer.
  const vale = edicion.nombre.trim().length > 0;

  if (borrando) {
    return (
      <View style={estilos.aviso}>
        <Text style={estilos.avisoTitulo}>¿Borrar «{edicion.perfil?.nombre}»?</Text>
        <Text style={estilos.avisoTexto}>
          Se lleva por delante lo que este perfil tenga a medias y su Mi Lista, y lo hace en todos
          los aparatos de la casa. No hay vuelta atrás.
        </Text>
        <View style={estilos.fila}>
          <Boton texto="Sí, borrar" onPress={alConfirmarBorrado} peligro />
          <Boton texto="Cancelar" onPress={alDejarloEstar} principal />
        </View>
      </View>
    );
  }

  return (
    <View style={estilos.editor}>
      <View style={estilos.previa}>
        <Retrato
          perfil={{ nombre: edicion.nombre || '?', color: edicion.color, avatar: edicion.avatar }}
          tamano={RETRATO}
        />
        <TextInput
          style={estilos.campo}
          value={edicion.nombre}
          onChangeText={(nombre) => alCambiar({ nombre })}
          placeholder="Nombre del perfil"
          placeholderTextColor={TINTA_TENUE}
          autoFocus={!edicion.perfil}
          onSubmitEditing={() => vale && alGuardar()}
        />
      </View>

      <Text style={estilos.rotulo}>Color</Text>
      <View style={estilos.fila}>
        {COLORES_PERFIL.map((color) => (
          <Pressable key={color} onPress={() => alCambiar({ color })}>
            {({ focused, pressed }) => (
              <View
                style={[
                  estilos.color,
                  { backgroundColor: color },
                  edicion.color === color && estilos.elegido,
                  (focused || pressed) && estilos.crecido,
                ]}
              />
            )}
          </Pressable>
        ))}
      </View>

      <Text style={estilos.rotulo}>Retrato</Text>
      <View style={estilos.fila}>
        {/* El primero quita el retrato: entonces vuelve la inicial. */}
        <Pressable onPress={() => alCambiar({ avatar: '' })}>
          {({ focused, pressed }) => (
            <View
              style={[
                estilos.sinRetrato,
                { borderRadius: RETRATO_GALERIA / 2, height: RETRATO_GALERIA, width: RETRATO_GALERIA },
                edicion.avatar === '' && estilos.elegido,
                (focused || pressed) && estilos.crecido,
              ]}
            >
              <Text style={estilos.sinRetratoTexto}>Aa</Text>
            </View>
          )}
        </Pressable>

        {RETRATOS.map((retrato) => (
          <Pressable key={retrato.id} onPress={() => alCambiar({ avatar: retrato.id })}>
            {({ focused, pressed }) => (
              <View style={(focused || pressed) && estilos.crecido}>
                <Retrato
                  perfil={{ nombre: retrato.nombre, color: edicion.color, avatar: retrato.id }}
                  tamano={RETRATO_GALERIA}
                  enfocado={edicion.avatar === retrato.id}
                />
              </View>
            )}
          </Pressable>
        ))}
      </View>

      <View style={estilos.fila}>
        <Boton texto={edicion.perfil ? 'Guardar' : 'Crear y entrar'} onPress={alGuardar} principal />
        {alCancelar ? <Boton texto="Cancelar" onPress={alCancelar} /> : null}
        {alBorrar ? <Boton texto="Borrar perfil" onPress={alBorrar} peligro /> : null}
      </View>
    </View>
  );
}

function Boton({
  texto,
  onPress,
  principal = false,
  peligro = false,
}: {
  texto: string;
  onPress: () => void;
  principal?: boolean;
  peligro?: boolean;
}) {
  return (
    <Pressable
      style={({ focused, pressed }) => [
        estilos.boton,
        principal && estilos.botonPrincipal,
        (focused || pressed) && estilos.botonEnfocado,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          estilos.botonTexto,
          principal && estilos.botonTextoPrincipal,
          peligro && estilos.botonTextoPeligro,
        ]}
      >
        {texto}
      </Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  pantalla: {
    backgroundColor: FONDO,
    flex: 1,
  },
  contenido: {
    alignItems: 'center',
    gap: 28,
    padding: 40,
  },
  centrado: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  espera: {
    color: TINTA_SUAVE,
    fontSize: 20,
  },
  logotipo: {
    height: 52,
    width: 220,
  },
  titulo: {
    color: TINTA,
    fontSize: 34,
    fontWeight: '700',
  },
  fila: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'center',
  },
  perfil: {
    alignItems: 'center',
    width: RETRATO + 40,
  },
  // El tamaño es lo que se ve desde el sofá; un marco de tres píxeles, no.
  crecido: {
    transform: [{ scale: 1.08 }],
  },
  lapiz: {
    alignItems: 'center',
    backgroundColor: 'rgba(11,11,12,0.55)',
    borderRadius: RETRATO / 2,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  lapizTexto: {
    color: TINTA,
    fontSize: 52,
  },
  nombre: {
    color: TINTA_TENUE,
    fontSize: 19,
    marginTop: 14,
  },
  nombreEnfocado: {
    color: TINTA,
  },
  anadir: {
    alignItems: 'center',
    borderColor: TINTA_TENUE,
    borderStyle: 'dashed',
    borderWidth: 3,
    justifyContent: 'center',
  },
  anadirEnfocado: {
    borderColor: '#fff',
    borderStyle: 'solid',
  },
  mas: {
    color: TINTA_TENUE,
    fontSize: 52,
    fontWeight: '300',
  },
  editor: {
    alignItems: 'center',
    gap: 18,
    maxWidth: 900,
  },
  previa: {
    alignItems: 'center',
    gap: 18,
  },
  rotulo: {
    color: TINTA_TENUE,
    fontSize: 15,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  color: {
    borderColor: 'transparent',
    borderRadius: 26,
    borderWidth: 3,
    height: 52,
    width: 52,
  },
  elegido: {
    borderColor: '#fff',
  },
  sinRetrato: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderWidth: 3,
    justifyContent: 'center',
  },
  sinRetratoTexto: {
    color: TINTA_SUAVE,
    fontSize: 24,
    fontWeight: '700',
  },
  aviso: {
    alignItems: 'center',
    gap: 18,
    maxWidth: 620,
  },
  avisoTitulo: {
    color: TINTA,
    fontSize: 24,
    fontWeight: '700',
  },
  avisoTexto: {
    color: TINTA_SUAVE,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },
  boton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  botonPrincipal: {
    backgroundColor: VERDE,
  },
  // Con mando no hay puntero: el enfocado tiene que cantar desde el sofá.
  botonEnfocado: {
    borderColor: '#fff',
    transform: [{ scale: 1.04 }],
  },
  botonTexto: {
    color: TINTA_SUAVE,
    fontSize: 18,
  },
  botonTextoPrincipal: {
    color: FONDO,
    fontWeight: '700',
  },
  botonTextoPeligro: {
    color: ROJO,
  },
  campo: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: TINTA,
    fontSize: 20,
    minWidth: 320,
    padding: 16,
    textAlign: 'center',
  },
});
