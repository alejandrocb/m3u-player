package com.m3utv

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * Los módulos nativos propios de la aplicación. Se añade a mano en
 * `MainApplication`: el autoenlazado es para las dependencias de npm, y esto
 * es nuestro.
 *
 * - `Descargas`: el aviso de la barra que deja seguir bajando al fondo.
 * - `Teles`: buscar en la red las teles a las que mandar un vídeo.
 */
class PaqueteNativo : ReactPackage {

  override fun createNativeModules(contexto: ReactApplicationContext): List<NativeModule> =
    listOf(ModuloDeDescargas(contexto), ModuloDeTeles(contexto))

  override fun createViewManagers(
    contexto: ReactApplicationContext,
  ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
