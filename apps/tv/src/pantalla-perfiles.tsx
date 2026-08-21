/**
 * Quién está viendo.
 *
 * Sale tras conectar con la lista y antes de la biblioteca, como en cualquier
 * servicio de estos. Cada perfil tiene su historial y sus favoritos, así que
 * lo que uno deje a medias no aparece en el "seguir viendo" de los demás.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AlmacenPerfiles, Perfil } from '@m3u/ui';

interface Props {
  almacen: AlmacenPerfiles;
  onElegir: (perfil: Perfil) => void;
}

export function PantallaPerfiles({ almacen, onElegir }: Props) {
  const [perfiles, setPerfiles] = useState<Perfil[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');

  const recargar = (): void => {
    almacen.perfiles().then(setPerfiles);
  };

  useEffect(recargar, [almacen]);

  if (!perfiles) {
    return (
      <View style={[estilos.pantalla, estilos.centrado]}>
        <Text style={estilos.espera}>Un momento…</Text>
      </View>
    );
  }

  // La primera vez no hay ninguno: se pide uno directamente en vez de enseñar
  // una pantalla vacía.
  const enFormulario = creando || perfiles.length === 0;

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>{enFormulario ? '¿Cómo te llamas?' : '¿Quién está viendo?'}</Text>

      {enFormulario ? (
        <>
          <TextInput
            style={estilos.campo}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Nombre del perfil"
            placeholderTextColor="#5d6f7d"
            autoFocus
          />
          <View style={estilos.fila}>
            <Pressable
              style={[estilos.boton, estilos.botonPrincipal]}
              onPress={async () => {
                const creado = await almacen.crear(nombre);
                setNombre('');
                setCreando(false);
                onElegir(creado);
              }}
            >
              <Text style={estilos.botonTextoPrincipal}>Crear y entrar</Text>
            </Pressable>
            {perfiles.length > 0 ? (
              <Pressable style={estilos.boton} onPress={() => setCreando(false)}>
                <Text style={estilos.botonTexto}>Cancelar</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <View style={estilos.fila}>
            {perfiles.map((perfil) => (
              <Pressable
                key={perfil.id}
                style={({ focused, pressed }) => [
                  estilos.perfil,
                  (focused || pressed) && estilos.perfilEnfocado,
                ]}
                onPress={() => onElegir(perfil)}
              >
                {/* La inicial de color hace de retrato: se distinguen de lejos. */}
                <View style={[estilos.retrato, { backgroundColor: perfil.color }]}>
                  <Text style={estilos.inicial}>{perfil.nombre.slice(0, 1).toUpperCase()}</Text>
                </View>
                <Text style={estilos.nombre} numberOfLines={1}>
                  {perfil.nombre}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={estilos.fila}>
            <Pressable style={estilos.boton} onPress={() => setCreando(true)}>
              <Text style={estilos.botonTexto}>+  Añadir perfil</Text>
            </Pressable>
            {perfiles.length > 1 ? (
              <Pressable
                style={estilos.boton}
                onPress={async () => {
                  // Se borra el último añadido: sin menú de gestión todavía.
                  const ultimo = perfiles[perfiles.length - 1]!;
                  await almacen.borrar(ultimo.id);
                  recargar();
                }}
              >
                <Text style={estilos.botonTexto}>Borrar «{perfiles[perfiles.length - 1]!.nombre}»</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: {
    backgroundColor: '#06131c',
    flex: 1,
  },
  contenido: {
    gap: 24,
    padding: 40,
  },
  centrado: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  espera: {
    color: '#dfe7ee',
    fontSize: 20,
  },
  titulo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
  },
  fila: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  perfil: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 3,
    padding: 12,
    width: 160,
  },
  perfilEnfocado: {
    borderColor: '#fff',
  },
  retrato: {
    alignItems: 'center',
    borderRadius: 12,
    height: 120,
    justifyContent: 'center',
    width: 120,
  },
  inicial: {
    color: '#06131c',
    fontSize: 48,
    fontWeight: '700',
  },
  nombre: {
    color: '#dfe7ee',
    fontSize: 20,
    marginTop: 10,
  },
  boton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  botonPrincipal: {
    backgroundColor: '#35d07f',
  },
  botonTexto: {
    color: '#dfe7ee',
    fontSize: 18,
  },
  botonTextoPrincipal: {
    color: '#06131c',
    fontSize: 18,
    fontWeight: '700',
  },
  campo: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 20,
    padding: 16,
  },
});
