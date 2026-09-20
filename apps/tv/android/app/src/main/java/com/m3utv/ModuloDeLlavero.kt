package com.m3utv

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Limpiar el llavero cuando su fichero se ha corrompido.
 *
 * El llavero de Android que usa la aplicación (`react-native-keychain`) guarda
 * **todo en un solo fichero** —las listas con sus credenciales y el
 * emparejamiento con la casa—, y si ese fichero se estropea, la librería falla
 * con "Unable to parse preferences proto" en todo: no se puede leer ni
 * escribir nada. Pasó en la tablet Xiaomi, y por fuera se veía así: el
 * servidor aprobaba el emparejamiento una y otra vez y el aparato nunca
 * entraba en la casa, porque no conseguía guardarse el token.
 *
 * Con el fichero ilegible **no hay nada que perder**: lo que hubiera dentro ya
 * no se puede recuperar. Así que se borra y se empieza de cero, que es la
 * única salida sin desinstalar la aplicación entera.
 *
 * **Hay que reabrir la aplicación después.** El almacén ya está creado en
 * memoria con el error dentro, así que borrar el fichero no lo arregla hasta
 * el siguiente arranque; eso lo dice la pantalla, no se hace por las bravas.
 */
class ModuloDeLlavero(contexto: ReactApplicationContext) : ReactContextBaseJavaModule(contexto) {

  override fun getName(): String = "Llavero"

  @ReactMethod
  fun reparar(promesa: Promise) {
    try {
      var borrados = 0

      // Donde DataStore guarda lo suyo. En esta aplicación el único que lo usa
      // es el llavero, así que no hay nada más que llevarse por delante.
      val carpeta = File(reactApplicationContext.filesDir, "datastore")
      carpeta.listFiles()?.forEach { fichero ->
        if (fichero.name.startsWith("RN_KEYCHAIN") && fichero.delete()) borrados += 1
      }

      // Y el fichero viejo de SharedPreferences del que DataStore migra: si se
      // queda, la migración vuelve a meter lo mismo en el siguiente arranque.
      val viejo = File(reactApplicationContext.filesDir.parentFile, "shared_prefs/RN_KEYCHAIN.xml")
      if (viejo.exists() && viejo.delete()) borrados += 1

      Log.w("Llavero", "limpiado: $borrados ficheros")
      promesa.resolve(borrados > 0)
    } catch (fallo: Exception) {
      promesa.reject("llavero", fallo.message ?: "no se pudo limpiar el llavero", fallo)
    }
  }
}
