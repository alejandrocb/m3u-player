package com.m3utv

import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  /**
   * Tiene que ser **exactamente** el `name` de app.json.
   *
   * Es lo que pide el lado nativo al arrancar y lo que registra `index.js`.
   * Si no coinciden, la aplicación se cierra nada más abrirse con
   * `"…" has not been registered`, y encima no se nota hasta que Gradle
   * rehace el bundle: mientras siga sirviendo el de antes, funciona.
   */
  override fun getMainComponentName(): String = "chocitatv"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    aPantallaCompleta()
  }

  /**
   * Vuelve a esconder las barras cada vez que la ventana recupera el foco.
   *
   * No basta con hacerlo una vez al arrancar: el sistema las saca solo al
   * deslizar desde el borde, al volver de otra aplicación o al girar la
   * tablet, y si no se vuelven a ocultar se quedan puestas para siempre.
   */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) aPantallaCompleta()
  }

  /**
   * Modo inmersivo: fuera la barra de estado y la de navegación.
   *
   * Esto es un reproductor a pantalla completa en una tablet o un televisor:
   * la hora y el nivel de batería encima del vídeo sobran, y la barra de
   * navegación se come una franja entera de la pantalla.
   *
   * `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` deja recuperarlas deslizando desde
   * el borde, y se esconden solas al rato: sin eso no habría forma de salir de
   * la aplicación en un aparato sin botones físicos.
   */
  private fun aPantallaCompleta() {
    // El contenido pasa a ocupar también lo que había debajo de las barras.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }
}
