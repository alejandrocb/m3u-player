package com.m3utv

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * Lo que registra el módulo. Se añade a mano en `MainApplication`: el
 * autoenlazado es para las dependencias de npm, y esto es nuestro.
 */
class PaqueteDeDescargas : ReactPackage {

  override fun createNativeModules(contexto: ReactApplicationContext): List<NativeModule> =
    listOf(ModuloDeDescargas(contexto))

  override fun createViewManagers(
    contexto: ReactApplicationContext,
  ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
