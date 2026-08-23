/**
 * Emparejar el aparato con el servidor de casa.
 *
 * La pantalla enseña un código y espera. **No hay que teclear nada con el
 * mando**, que es el punto: el código se lee aquí y se escribe en la web,
 * desde un ordenador. Al aprobarlo, el aparato recibe su token y las listas
 * de la casa, así que tampoco hay que escribir ninguna dirección de panel.
 *
 * La única excepción es que el servidor no venga configurado —`servidor.local.js`
 * no existe—, y entonces sí se pide la dirección una vez.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ClienteSync, ListaRemota } from '@m3u/ui';
import { SERVIDOR } from 'servidor-sync';

/** Cada cuánto se le pregunta al servidor si ya lo has aprobado. */
const CADA_MS = 3000;

interface Props {
  cliente: ClienteSync;
  /** Se llama al quedar emparejado, con las listas que reparte el grupo. */
  onListo: (grupo: string | null, listas: ListaRemota[]) => void;
  onCancelar: () => void;
}

type Estado =
  | { tipo: 'direccion' }
  | { tipo: 'pidiendo' }
  | { tipo: 'esperando'; codigo: string; espera: string; servidor: string }
  | { tipo: 'fallo'; mensaje: string };

export function PantallaEmparejar({ cliente, onListo, onCancelar }: Props) {
  const [servidor, setServidor] = useState(SERVIDOR);
  const [estado, setEstado] = useState<Estado>(SERVIDOR ? { tipo: 'pidiendo' } : { tipo: 'direccion' });

  /** Para no seguir preguntando cuando la pantalla ya no está. */
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const pedirCodigo = useCallback(
    async (direccion: string) => {
      setEstado({ tipo: 'pidiendo' });
      try {
        const alta = await cliente.pedirAlta(direccion, apodoDelAparato());
        if (!vivo.current) return;
        setEstado({ tipo: 'esperando', codigo: alta.codigo, espera: alta.espera, servidor: direccion });
      } catch (fallo) {
        if (!vivo.current) return;
        setEstado({ tipo: 'fallo', mensaje: fallo instanceof Error ? fallo.message : String(fallo) });
      }
    },
    [cliente],
  );

  // El primer código, si ya se sabe a qué servidor.
  useEffect(() => {
    if (SERVIDOR) void pedirCodigo(SERVIDOR);
  }, [pedirCodigo]);

  // Y a partir de ahí, preguntar cada pocos segundos.
  useEffect(() => {
    if (estado.tipo !== 'esperando') return;

    const reloj = setInterval(async () => {
      try {
        const resultado = await cliente.comprobar(estado.servidor, estado.espera);
        if (!vivo.current) return;

        if (resultado.estado === 'aprobado') {
          clearInterval(reloj);
          onListo(resultado.grupo?.nombre ?? null, resultado.listas);
        } else if (resultado.estado === 'desconocido') {
          // El código ha caducado, o lo han borrado. Se pide otro.
          clearInterval(reloj);
          void pedirCodigo(estado.servidor);
        }
      } catch {
        // Un fallo de red no rompe la espera: se vuelve a intentar a la
        // siguiente vuelta, que es lo que quieres cuando la tele acaba de
        // encenderse y el wifi todavía no ha levantado.
      }
    }, CADA_MS);

    return () => clearInterval(reloj);
  }, [estado, cliente, onListo, pedirCodigo]);

  if (estado.tipo === 'direccion') {
    return (
      <View style={estilos.pantalla}>
        <Text style={estilos.titulo}>Dirección del servidor</Text>
        <Text style={estilos.parrafo}>
          No hay ninguna configurada en esta compilación. Escríbela una vez y ya no volverá a pedirla.
        </Text>
        <TextInput
          style={estilos.campo}
          value={servidor}
          onChangeText={setServidor}
          placeholder="https://sync.ejemplo.com"
          placeholderTextColor="#5d6f7d"
          autoCapitalize="none"
          autoCorrect={false}
          hasTVPreferredFocus
        />
        <View style={estilos.botones}>
          <Boton texto="Continuar" principal onPress={() => servidor.trim() && void pedirCodigo(servidor.trim())} />
          <Boton texto="Cancelar" onPress={onCancelar} />
        </View>
      </View>
    );
  }

  if (estado.tipo === 'fallo') {
    return (
      <View style={estilos.pantalla}>
        <Text style={estilos.titulo}>No se pudo conectar</Text>
        <Text style={estilos.error}>{estado.mensaje}</Text>
        <View style={estilos.botones}>
          <Boton
            texto="Reintentar"
            principal
            primero
            onPress={() => void pedirCodigo(servidor || SERVIDOR)}
          />
          <Boton texto="Cancelar" onPress={onCancelar} />
        </View>
      </View>
    );
  }

  if (estado.tipo === 'pidiendo') {
    return (
      <View style={estilos.pantalla}>
        <ActivityIndicator color={VERDE} size="large" />
        <Text style={estilos.parrafo}>Pidiendo un código…</Text>
      </View>
    );
  }

  return (
    <View style={estilos.pantalla}>
      <Text style={estilos.titulo}>Conectar este aparato</Text>
      <Text style={estilos.parrafo}>Escribe este código en la web de tu servidor y elige a qué casa pertenece.</Text>

      <Text style={estilos.codigo}>{estado.codigo}</Text>

      <View style={estilos.esperando}>
        <ActivityIndicator color={VERDE} />
        <Text style={estilos.suave}>Esperando a que lo apruebes…</Text>
      </View>

      <Boton texto="Cancelar" primero onPress={onCancelar} />
    </View>
  );
}

/**
 * Cómo se presenta este aparato en la web.
 *
 * Sirve para distinguir "Philips 50PUS" de "Xiaomi Pad" al aprobarlos, que si
 * no hay que adivinar cuál es cuál cuando se dan de alta tres seguidos.
 */
function apodoDelAparato(): string {
  const constantes = Platform.constants as { Model?: string; Brand?: string } | undefined;
  const marca = constantes?.Brand ?? '';
  const modelo = constantes?.Model ?? '';
  return `${marca} ${modelo}`.trim() || 'Aparato';
}

function Boton({
  texto,
  onPress,
  principal,
  primero,
}: {
  texto: string;
  onPress: () => void;
  principal?: boolean;
  primero?: boolean;
}) {
  return (
    <Pressable
      hasTVPreferredFocus={primero}
      style={({ focused, pressed }) => [
        estilos.boton,
        principal && estilos.botonPrincipal,
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
    alignItems: 'center',
    backgroundColor: '#06131c',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    padding: 40,
  },
  titulo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
  },
  parrafo: {
    color: '#8fa3b3',
    fontSize: 19,
    maxWidth: 640,
    textAlign: 'center',
  },
  codigo: {
    color: VERDE,
    fontSize: 76,
    fontWeight: '700',
    letterSpacing: 10,
    marginVertical: 10,
  },
  esperando: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  suave: {
    color: '#5d6f7d',
    fontSize: 17,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 17,
    maxWidth: 640,
    textAlign: 'center',
  },
  campo: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    color: '#fff',
    fontSize: 19,
    minWidth: 520,
    padding: 16,
  },
  botones: {
    flexDirection: 'row',
    gap: 14,
  },
  boton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 26,
    paddingVertical: 14,
  },
  botonPrincipal: {
    backgroundColor: VERDE,
  },
  botonEnfocado: {
    borderColor: '#fff',
  },
  botonTexto: {
    color: '#dfe7ee',
    fontSize: 19,
  },
  botonTextoPrincipal: {
    color: '#06131c',
    fontWeight: '700',
  },
});
