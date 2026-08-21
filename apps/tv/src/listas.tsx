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

interface Props {
  gestor: GestorCuentas;
  onConectar: (cuenta: Cuenta) => void;
  /** Para repintar cuando el gestor cambia por dentro. */
  onCambio: () => void;
}

type Modo = { tipo: 'lista' } | { tipo: 'alta' } | { tipo: 'edicion'; cuenta: Cuenta };

export function PantallaListas({ gestor, onConectar, onCambio }: Props) {
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cuentas = gestor.cuentas;

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

      {cuentas.map((cuenta) => {
        const desplegada = abierta === cuenta.id;
        return (
          <View key={cuenta.id}>
            <Pressable
              style={[estilos.ficha, desplegada && estilos.fichaAbierta]}
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

      <Boton texto="+  Añadir lista" onPress={() => setModo({ tipo: 'alta' })} />
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

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>{titulo}</Text>

      <Text style={estilos.etiqueta}>Nombre</Text>
      <TextInput
        style={estilos.campo}
        value={nombre}
        onChangeText={setNombre}
        placeholder="Salón, casa de mis padres..."
        placeholderTextColor="#5d6f7d"
      />

      <Text style={estilos.etiqueta}>Dirección de la lista</Text>
      <TextInput
        style={estilos.campo}
        value={url}
        onChangeText={setUrl}
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
        peligro && estilos.botonPeligro,
        (focused || pressed) && estilos.botonEnfocado,
      ]}
      onPress={onPress}
    >
      <Text style={[estilos.botonTexto, principal && estilos.botonTextoPrincipal]}>{texto}</Text>
    </Pressable>
  );
}

const VERDE = '#35d07f';

const estilos = StyleSheet.create({
  pantalla: {
    backgroundColor: '#06131c',
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
    color: '#8fa3b3',
    fontSize: 18,
  },
  ficha: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    padding: 18,
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
    color: '#8fa3b3',
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
    color: '#dfe7ee',
    fontSize: 18,
  },
  botonTextoPrincipal: {
    color: '#06131c',
    fontWeight: '700',
  },
  etiqueta: {
    color: '#8fa3b3',
    fontSize: 16,
    marginTop: 8,
  },
  campo: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 18,
    padding: 16,
  },
  aviso: {
    color: '#5d6f7d',
    fontSize: 14,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 16,
  },
});
