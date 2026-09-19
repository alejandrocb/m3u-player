package com.m3utv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Lo que deja salir de la aplicación mientras algo suena en la tele.
 *
 * Con "Ver en la tele" el vídeo **pasa por el teléfono** (`ModuloDePuente`), así
 * que el teléfono tiene que seguir vivo. Sin esto, en cuanto la aplicación se
 * iba al fondo MIUI le quitaba el candado de CPU al puente —el registro lo dice
 * tal cual: `disabled: true, procState: 15, reason: Process Priority`— y a los
 * pocos segundos la tele se quedaba sin vídeo.
 *
 * Es el mismo mecanismo que `ServicioDeDescargas`, y por los mismos tres
 * motivos: que no maten el proceso, que el reloj de JavaScript siga andando
 * (es el que pregunta a la tele por dónde va y apunta "seguir viendo") y que
 * el aparato no se duerma. Cambia el tipo: aquí es `mediaPlayback`, que es lo
 * que es —y no tiene el tope de seis horas de `dataSync`—.
 *
 * Y el aviso trae **Pausa y Parar**, como el de cualquier aplicación que
 * emite: para pausar la película no debería hacer falta abrir nada. Los
 * botones no hablan con la tele: le pasan la orden a JavaScript, que es quien
 * tiene el mando.
 */
class ServicioDeTele : HeadlessJsTaskService() {

  companion object {
    const val CANAL = "tele"
    const val AVISO = 2
    const val TAREA = "tele"

    const val TITULO = "titulo"
    const val DETALLE = "detalle"
    const val SONANDO = "sonando"

    /** Lo que llega de un botón del aviso, no de la aplicación. */
    const val ORDEN = "com.m3utv.ORDEN_DE_TELE"
    const val CUAL = "cual"

    /** El nombre del evento que escucha JavaScript. */
    const val EVENTO = "ordenDeTele"
  }

  private var tareaEnMarcha = false

  override fun onCreate() {
    super.onCreate()
    crearCanal()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    /*
      Un botón del aviso: se le pasa a JavaScript y ya está. No se vuelve a
      poner el aviso: lo refresca la aplicación cuando la tele diga que ha
      hecho caso, que es lo que de verdad ha pasado.
    */
    if (intent?.action == ORDEN) {
      val cual = intent.getStringExtra(CUAL) ?: return START_NOT_STICKY
      reactContext?.emitDeviceEvent(EVENTO, cual)
      return START_NOT_STICKY
    }

    val titulo = intent?.getStringExtra(TITULO) ?: getString(R.string.app_name)
    val detalle = intent?.getStringExtra(DETALLE) ?: ""
    val sonando = intent?.getBooleanExtra(SONANDO, true) ?: true

    // Lo primero y siempre: cinco segundos tiene Android de paciencia.
    ServiceCompat.startForeground(
      this,
      AVISO,
      aviso(titulo, detalle, sonando),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0,
    )

    if (!tareaEnMarcha) {
      tareaEnMarcha = true
      startTask(HeadlessJsTaskConfig(TAREA, Arguments.createMap(), 0, true))
    }
    return START_NOT_STICKY
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    tareaEnMarcha = false
    super.onHeadlessJsTaskFinish(taskId)
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun crearCanal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val gestor = getSystemService(NotificationManager::class.java) ?: return
    if (gestor.getNotificationChannel(CANAL) != null) return
    gestor.createNotificationChannel(
      NotificationChannel(CANAL, "En la tele", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Lo que se está viendo en una tele de casa"
        setShowBadge(false)
      },
    )
  }

  private fun boton(cual: String, codigo: Int): PendingIntent =
    PendingIntent.getService(
      this,
      codigo,
      Intent(this, ServicioDeTele::class.java).setAction(ORDEN).putExtra(CUAL, cual),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun aviso(titulo: String, detalle: String, sonando: Boolean): Notification {
    val abrir = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, CANAL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(titulo)
      .setContentText(detalle)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(abrir)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .addAction(
        if (sonando) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (sonando) "Pausa" else "Seguir",
        boton("alternar", 1),
      )
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", boton("parar", 2))
      .build()
  }
}
