/**
 * Pantalla de arranque: las listas dadas de alta.
 *
 * Es lo primero que se ve mientras no haya sesión abierta. Sobre cada lista se
 * puede conectar, editar o borrar; al conectar, la sesión queda guardada y los
 * arranques siguientes entran directos a la biblioteca.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Cuenta, GestorCuentas } from '@m3u/ui';
import { hostDe } from '@m3u/ui';
import { FONDO, ROJO, TINTA_SUAVE, TINTA_TENUE, VERDE } from './tema';

interface Props {
  gestor: GestorCuentas;
  onConectar: (cuenta: Cuenta) => void;
  /** Para repintar cuando el gestor cambia por dentro. */
  onCambio: () => void;
  /** Conectar el aparato con el servidor de casa, que reparte las listas. */
  onEmparejar: () => void;
  /**
   * A qué casa está conectado este aparato, si es que lo está.
   *
   * Sin esto no había forma de saberlo desde la tele: emparejabas, todo iba
   * bien, y la pantalla quedaba exactamente igual que antes —porque la lista
   * que reparte el servidor suele ser la misma que ya tenías puesta a mano, y
   * entonces no se añade nada—. Parecía que no había funcionado.
   */
  grupo: string | null;
  /** Desconectar del servidor. Lo guardado en el aparato se queda. */
  onDesemparejar: () => void;
}

type Modo = { tipo: 'lista' } | { tipo: 'alta' } | { tipo: 'edicion'; cuenta: Cuenta };

export function PantallaListas({
  gestor,
  onConectar,
  onCambio,
  onEmparejar,
  grupo,
  onDesemparejar,
}: Props) {
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cuentas = gestor.cuentas;


  // El formulario es otra pantalla, pero el hook de arriba tiene que
  // haberse llamado igual: React exige el mismo número de hooks en cada
  // pintado, y tenerlo detrás de este `return` cerraba la aplicación.
  if (modo.tipo !== 'lista') {
    return (
      <Formulario
        titulo={modo.tipo === 'alta' ? 'Añadir lista' : 'Editar lista'}
        cuenta={modo.tipo === 'edicion' ? modo.cuenta : null}
        onCancelar={() => setModo({ tipo: 'lista' })}
        onGuardar={async (nombre, url) => {
          try {
            if (modo.tipo === 'alta') await gestor.anadir({ nombre, url });
            else await gestor.editar(modo.cuenta.id, { nombre, url });
            setModo({ tipo: 'lista' });
            onCambio();
          } catch (fallo) {
            setError(fallo instanceof Error ? fallo.message : String(fallo));
          }
        }}
      />
    );
  }


  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Tus listas</Text>
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {cuentas.length === 0 ? (
        <Text style={estilos.vacio}>
          Todavía no hay ninguna lista. Añade la dirección que te dio tu proveedor.
        </Text>
      ) : null}

      {cuentas.map((cuenta, posicion) => {
        const desplegada = abierta === cuenta.id;
        return (
          <View key={cuenta.id}>
            <Pressable
              // La primera lista se lleva el foco al abrir la pantalla: sin
              // un elemento enfocado, el mando no tiene por dónde empezar.
              hasTVPreferredFocus={posicion === 0}
              style={({ focused, pressed }) => [
                estilos.ficha,
                desplegada && estilos.fichaAbierta,
                (focused || pressed) && estilos.fichaEnfocada,
              ]}
              onPress={() => setAbierta(desplegada ? null : cuenta.id)}
            >
              <Text style={estilos.nombre}>{cuenta.nombre}</Text>
              {/* Solo el servidor: la URL lleva usuario y contraseña dentro. */}
              <Text style={estilos.detalle}>
                {hostDe(cuenta.url)} · {cuenta.tipo === 'xtream' ? 'panel Xtream' : 'lista M3U'}
                {cuenta.ultimoUso ? ' · usada antes' : ' · sin estrenar'}
              </Text>
            </Pressable>

            {desplegada ? (
              <View style={estilos.acciones}>
                <Boton texto="Conectar" principal onPress={() => onConectar(cuenta)} />
                <Boton texto="Editar" onPress={() => setModo({ tipo: 'edicion', cuenta })} />
                <Boton
                  texto="Borrar"
                  peligro
                  onPress={async () => {
                    await gestor.borrar(cuenta.id);
                    setAbierta(null);
                    onCambio();
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      <Boton
        texto="+  Añadir lista"
        // Sin ninguna lista todavía, este es el único sitio donde ir.
        primero={cuentas.length === 0}
        onPress={() => setModo({ tipo: 'alta' })}
      />

      {/*
        La vía corta, y la que se usa en los aparatos de la familia: en vez de
        escribir la dirección del panel con el mando, el aparato enseña un
        código y recibe las listas de su casa ya puestas.
      */}
      {grupo ? (
        <View style={estilos.conectado}>
          <Text style={estilos.conectadoTexto}>✓  Conectado a {grupo}</Text>
          <Text style={estilos.detalle}>
            El "seguir viendo" y los favoritos se comparten con los demás aparatos de esta casa.
          </Text>
          <View style={estilos.acciones}>
            <Boton texto="Desconectar" peligro onPress={onDesemparejar} />
          </View>
        </View>
      ) : (
        <>
          <Boton texto="⇄  Conectar con el servidor de casa" onPress={onEmparejar} />
          <Text style={estilos.aviso}>
            Comparte el "seguir viendo" y los favoritos con los demás aparatos, y trae sus listas.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function Formulario({
  titulo,
  cuenta,
  onGuardar,
  onCancelar,
}: {
  titulo: string;
  cuenta: Cuenta | null;
  onGuardar: (nombre: string, url: string) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '');
  const [url, setUrl] = useState(cuenta?.url ?? '');

  /**
   * Cuál de los campos tiene el cursor dentro, si es que hay alguno.
   *
   * Solo sirve para marcarlo: el recorrido entre campos y botones lo lleva el
   * foco del sistema, que es quien sabe dónde está cada cosa en pantalla.
   */
  const [editando, setEditando] = useState<number | null>(null);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>{titulo}</Text>

      <Text style={estilos.etiqueta}>Nombre</Text>
      <TextInput
        style={[estilos.campo, editando === 0 && estilos.campoEnfocado]}
        value={nombre}
        onChangeText={setNombre}
        onFocus={() => setEditando(0)}
        onBlur={() => setEditando(null)}
        placeholder="Salón, casa de mis padres..."
        placeholderTextColor="#5d6f7d"
      />

      <Text style={estilos.etiqueta}>Dirección de la lista</Text>
      <TextInput
        style={[estilos.campo, editando === 1 && estilos.campoEnfocado]}
        value={url}
        onChangeText={setUrl}
        onFocus={() => setEditando(1)}
        onBlur={() => setEditando(null)}
        placeholder="http://servidor:8080/get.php?username=...&password=...&type=m3u_plus"
        placeholderTextColor="#5d6f7d"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={estilos.aviso}>
        Se guarda en el llavero del aparato, cifrada. No sale de aquí.
      </Text>

      <View style={estilos.acciones}>
        <Boton texto="Guardar" principal onPress={() => onGuardar(nombre, url)} />
        <Boton texto="Cancelar" onPress={onCancelar} />
      </View>
    </ScrollView>
  );
}

function Boton({
  texto,
  onPress,
  principal,
  peligro,
  primero,
}: {
  texto: string;
  onPress: () => void;
  principal?: boolean;
  peligro?: boolean;
  /** Se lleva el foco al abrir la pantalla, si no hay nada antes que él. */
  primero?: boolean;
}) {
  return (
    <Pressable
      hasTVPreferredFocus={primero}
      style={({ focused, pressed }) => [
        estilos.boton,
        principal && estilos.botonPrincipal,
        peligro && estilos.botonPeligro,
        (focused || pressed) && estilos.botonEnfocado,
      ]}
      onPress={onPress}
    >
      <Text style={[estilos.botonTexto, principal && estilos.botonTextoPrincipal]}>{texto}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  pantalla: {
    backgroundColor: FONDO,
    flex: 1,
  },
  contenido: {
    gap: 14,
    padding: 32,
  },
  titulo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 10,
  },
  vacio: {
    color: TINTA_TENUE,
    fontSize: 18,
  },
  ficha: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    padding: 18,
  },
  campoEnfocado: {
    borderColor: '#fff',
  },
  fichaEnfocada: {
    borderColor: '#fff',
  },
  fichaAbierta: {
    backgroundColor: 'rgba(53,208,127,0.18)',
    borderColor: VERDE,
  },
  nombre: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  detalle: {
    color: TINTA_TENUE,
    fontSize: 16,
    marginTop: 6,
  },
  acciones: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
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
  botonPeligro: {
    backgroundColor: 'rgba(255,107,107,0.15)',
  },
  botonEnfocado: {
    borderColor: '#fff',
  },
  botonTexto: {
    color: TINTA_SUAVE,
    fontSize: 18,
  },
  botonTextoPrincipal: {
    color: FONDO,
    fontWeight: '700',
  },
  etiqueta: {
    color: TINTA_TENUE,
    fontSize: 16,
    marginTop: 8,
  },
  campo: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    color: '#fff',
    fontSize: 18,
    padding: 16,
  },
  aviso: {
    color: '#5d6f7d',
    fontSize: 14,
  },
  conectado: {
    backgroundColor: 'rgba(53,208,127,0.12)',
    borderColor: VERDE,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 18,
  },
  conectadoTexto: {
    color: VERDE,
    fontSize: 20,
    fontWeight: '700',
  },
  error: {
    color: ROJO,
    fontSize: 16,
  },
});
