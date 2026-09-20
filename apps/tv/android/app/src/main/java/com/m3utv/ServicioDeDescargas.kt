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
 * Lo que permite seguir bajando con la aplicación al fondo.
 *
 * **Aquí no se mueve un solo byte.** Los bytes los sigue moviendo el mismo
 * código de siempre —la cola de `@m3u/ui` y `react-native-blob-util`—, que
 * corre dentro del proceso de la aplicación. Lo que hace este servicio es
 * comprar las dos cosas que Android le quita a una aplicación que no se ve, y
 * sin las cuales una película de dos gigas no llega nunca al disco:
 *
 * 1. **Que no maten el proceso.** Un servicio en primer plano es la única
 *    forma de decirle al sistema "esto sigue aunque no se vea", y su precio es
 *    el aviso permanente de la barra. El aviso no es decorativo: **es el
 *    permiso**. Ya que está, lleva el título de lo que se baja y por dónde va.
 * 2. **Que el reloj de JavaScript siga andando.** Esta es la que no se ve
 *    venir: React Native **para los temporizadores** cuando la aplicación
 *    deja de estar delante (`JavaTimerManager.onHostPause`), y la cola los usa
 *    para lo que de verdad ocurre en una tablet con wifi flojo —reintentar
 *    tras un corte, volver a pedir la ranura cuando el árbitro la ha
 *    denegado—. Con el proceso vivo pero el reloj parado, la descarga se
 *    corta una vez y se queda ahí para siempre. Lo único que vuelve a
 *    arrancarlo es una **tarea sin interfaz**, así que el servicio abre una y
 *    la mantiene mientras quede algo por bajar.
 *
 * De regalo, `HeadlessJsTaskService` coge un `PARTIAL_WAKE_LOCK`: con la
 * pantalla apagada el aparato se suspende, y suspendido tampoco baja nada.
 *
 * La tarea la cierra JavaScript cuando la cola se vacía, y al cerrarse el
 * servicio se para solo y el aviso desaparece. El tipo es `dataSync` porque
 * eso es lo que hace; en Android 15 ese tipo tiene un tope de seis horas al
 * día y el sistema avisa por `onTimeout`.
 */
class ServicioDeDescargas : HeadlessJsTaskService() {

  companion object {
    /** El canal, que en Android es donde vive el "no molestes" de cada aviso. */
    const val CANAL = "descargas"

    /** Uno solo: el aviso se reemplaza, no se acumula uno por descarga. */
    const val AVISO = 1

    /** El mismo nombre con el que `index.js` registra la tarea. */
    const val TAREA = "descargas"

    const val TITULO = "titulo"
    const val DETALLE = "detalle"
    const val AVANCE = "avance"
  }

  /** Una tarea, no una por cada vez que cambia el texto del aviso. */
  private var tareaEnMarcha = false

  override fun onCreate() {
    super.onCreate()
    crearCanal()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val titulo = intent?.getStringExtra(TITULO) ?: getString(R.string.app_name)
    val detalle = intent?.getStringExtra(DETALLE) ?: ""
    // Negativo quiere decir que aún no se sabe cuánto ocupa: barra indefinida.
    val avance = intent?.getIntExtra(AVANCE, -1) ?: -1

    /*
      Lo primero y siempre, incluso si luego no hay tarea que arrancar:
      Android da cinco segundos desde que se pide el servicio hasta que
      aparece el aviso, y pasados los cinco mata la aplicación.
    */
    ServiceCompat.startForeground(
      this,
      AVISO,
      aviso(titulo, detalle, avance),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
    )

    if (!tareaEnMarcha) {
      tareaEnMarcha = true
      startTask(
        HeadlessJsTaskConfig(
          TAREA,
          Arguments.createMap(),
          // Sin tope: lo que decide cuándo acaba es que no quede nada en la
          // cola, y eso puede ser una película de dos horas por un wifi malo.
          0,
          // Se arranca con la aplicación delante —alguien acaba de darle a
          // descargar—, así que hay que decirlo expresamente.
          true,
        ),
      )
    }

    /*
      `START_NOT_STICKY`: si el sistema mata el proceso, no tiene ningún
      sentido que resucite el servicio solo. Sin la aplicación detrás no hay
      cola, ni árbitro, ni nadie que sepa por qué byte iba; lo que hay que
      hacer es reanudar al abrirla, que es justo lo que ya hace la cola.
    */
    return START_NOT_STICKY
  }

  /** Cuando JavaScript cierra la tarea, esto se para solo y el aviso se va. */
  override fun onHeadlessJsTaskFinish(taskId: Int) {
    tareaEnMarcha = false
    super.onHeadlessJsTaskFinish(taskId)
  }

  /**
   * Android 15 corta los servicios de tipo `dataSync` a las seis horas.
   *
   * Pararse aquí deja la descarga a medias, y eso no se pierde: lo bajado
   * sigue en el disco y se reanuda con `Range` la próxima vez. Ignorar el
   * aviso, en cambio, acaba con el sistema matando la aplicación.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /**
   * El canal, con importancia baja a propósito: ni sonido ni vibración.
   *
   * Una descarga que pita cada vez que cambia el porcentaje sería
   * insoportable. Lo que se quiere es que esté ahí, no que llame.
   */
  private fun crearCanal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val gestor = getSystemService(NotificationManager::class.java) ?: return
    if (gestor.getNotificationChannel(CANAL) != null) return
    gestor.createNotificationChannel(
      NotificationChannel(CANAL, "Descargas", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Lo que se está bajando al disco"
        setShowBadge(false)
      },
    )
  }

  private fun aviso(titulo: String, detalle: String, avance: Int): Notification {
    // Tocar el aviso abre la aplicación por donde estuviera, no una pantalla
    // nueva: de eso se encarga `singleTask` en el manifiesto.
    val abrir = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, CANAL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(titulo)
      .setContentText(detalle)
      .setProgress(100, if (avance < 0) 0 else avance, avance < 0)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(abrir)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .build()
  }
}
