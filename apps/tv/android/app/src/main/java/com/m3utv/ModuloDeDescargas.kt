package com.m3utv

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * El puente: dos llamadas para encender y apagar el aviso de la barra.
 *
 * Quien decide es la cola, que vive en JavaScript y es la que sabe si queda
 * algo por bajar. Aquí solo se traduce eso a lo único que Android entiende
 * como "no me mates todavía".
 *
 * **Nada de esto puede tumbar la aplicación.** Arrancar un servicio en primer
 * plano falla si el sistema cree que la aplicación está en segundo plano sin
 * derecho a hacerlo, y eso es una excepción de verdad; que el aviso no salga
 * es un incordio, que la aplicación se cierre mientras baja una película es
 * perder el trabajo. Por eso todo va dentro de un `try`.
 */
class ModuloDeDescargas(contexto: ReactApplicationContext) : ReactContextBaseJavaModule(contexto) {

  override fun getName(): String = "Descargas"

  /** Enciende el aviso, o cambia el texto si ya estaba encendido. */
  @ReactMethod
  fun avisar(titulo: String, detalle: String, avance: Int) {
    val contexto = reactApplicationContext
    try {
      val orden = Intent(contexto, ServicioDeDescargas::class.java).apply {
        putExtra(ServicioDeDescargas.TITULO, titulo)
        putExtra(ServicioDeDescargas.DETALLE, detalle)
        putExtra(ServicioDeDescargas.AVANCE, avance)
      }
      ContextCompat.startForegroundService(contexto, orden)
    } catch (fallo: Exception) {
      Log.w("Descargas", "no se pudo encender el aviso", fallo)
    }
  }

  /** Lo apaga. Que no estuviera puesto no es un fallo. */
  @ReactMethod
  fun callar() {
    val contexto = reactApplicationContext
    try {
      contexto.stopService(Intent(contexto, ServicioDeDescargas::class.java))
    } catch (fallo: Exception) {
      Log.w("Descargas", "no se pudo apagar el aviso", fallo)
    }
  }
}
