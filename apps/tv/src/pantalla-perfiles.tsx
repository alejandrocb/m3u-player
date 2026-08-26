/**
 * Quién está viendo.
 *
 * Sale tras conectar con la lista y antes de la biblioteca, como en cualquier
 * servicio de estos. Cada perfil tiene su historial y sus favoritos, así que
 * lo que uno deje a medias no aparece en el "seguir viendo" de los demás.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AlmacenPerfiles, Perfil } from '@m3u/ui';
import { FONDO, TINTA_SUAVE, VERDE } from './tema';

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

  // Ojo con el orden: **todos los hooks van antes del primer `return`**.
  // Tenerlos detrás del "Un momento…" hacía que React viera un número
  // distinto de hooks entre un pintado y otro, y la aplicación se cerraba
  // nada más abrirse en cuanto los perfiles terminaban de cargar.
  const lista = perfiles ?? [];

  // La primera vez no hay ninguno: se pide uno directamente en vez de enseñar
  // una pantalla vacía.
  const enFormulario = creando || lista.length === 0;

  const crear = useCallback(async () => {
    const creado = await almacen.crear(nombre);
    setNombre('');
    setCreando(false);
    onElegir(creado);
  }, [almacen, nombre, onElegir]);

  const borrarUltimo = useCallback(async () => {
    // Se borra el último añadido: sin menú de gestión todavía.
    const ultimo = lista[lista.length - 1];
    if (!ultimo) return;
    await almacen.borrar(ultimo.id);
    recargar();
    // `recargar` se rehace en cada pintado y no aporta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [almacen, lista]);

  if (!perfiles) {
    return (
      <View style={[estilos.pantalla, estilos.centrado]}>
        <Text style={estilos.espera}>Un momento…</Text>
      </View>
    );
  }

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
              hasTVPreferredFocus
              style={({ focused, pressed }) => [
                estilos.boton,
                estilos.botonPrincipal,
                (focused || pressed) && estilos.botonEnfocado,
              ]}
              onPress={crear}
            >
              <Text style={estilos.botonTextoPrincipal}>Crear y entrar</Text>
            </Pressable>
            {lista.length > 0 ? (
              <Pressable
                style={({ focused, pressed }) => [
                  estilos.boton,
                  (focused || pressed) && estilos.botonEnfocado,
                ]}
                onPress={() => setCreando(false)}
              >
                <Text style={estilos.botonTexto}>Cancelar</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <View style={estilos.fila}>
            {lista.map((perfil, indice) => (
              <Pressable
                key={perfil.id}
                // El sistema le da el foco al abrir la pantalla: sin un
                // elemento enfocado de verdad, el OK del mando no llega a
                // ninguna parte.
                hasTVPreferredFocus={indice === 0}
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
            <Pressable
              style={({ focused, pressed }) => [
                estilos.boton,
                (focused || pressed) && estilos.botonEnfocado,
              ]}
              onPress={() => setCreando(true)}
            >
              <Text style={estilos.botonTexto}>+  Añadir perfil</Text>
            </Pressable>
            {lista.length > 1 ? (
              <Pressable
                style={({ focused, pressed }) => [
                  estilos.boton,
                  (focused || pressed) && estilos.botonEnfocado,
                ]}
                onPress={borrarUltimo}
              >
                <Text style={estilos.botonTexto}>Borrar «{lista[lista.length - 1]!.nombre}»</Text>
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
    backgroundColor: FONDO,
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
    color: TINTA_SUAVE,
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
    color: FONDO,
    fontSize: 48,
    fontWeight: '700',
  },
  nombre: {
    color: TINTA_SUAVE,
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
    backgroundColor: VERDE,
  },
  // Con mando no hay puntero: el enfocado tiene que cantar desde el sofá.
  botonEnfocado: {
    borderColor: '#fff',
    borderWidth: 2,
    transform: [{ scale: 1.04 }],
  },
  botonTexto: {
    color: TINTA_SUAVE,
    fontSize: 18,
  },
  botonTextoPrincipal: {
    color: FONDO,
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
