package com.m3utv

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.UUID
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * El puente de "Ver en la tele": la tele le pide el vídeo al teléfono, y el
 * teléfono se lo pide al panel.
 *
 * Mandarle a la tele la URL del panel directamente no funcionó con la Samsung
 * de casa, y no por el fichero —H.264 y AC3, lo más normal del mundo, servido
 * por rangos y sin redirecciones—, sino por **cómo hablan los dos**. El
 * reproductor DLNA de una tele es exigente: pregunta primero con `HEAD`,
 * quiere cabeceras DLNA concretas y abre varias conexiones al mismo fichero.
 * Un panel Xtream no está hecho para eso, y la tele acaba en un "Error
 * inesperado" sin más explicación.
 *
 * Aquí el teléfono hace de servidor bien educado: a la tele le contesta lo que
 * espera, y al panel le pide como un reproductor cualquiera (User-Agent de
 * VLC, `Range` tal cual). De paso **apunta en el registro qué pide la tele**
 * (`adb logcat -s Puente`), que es lo que no había forma de ver.
 *
 * El precio: el vídeo pasa por el teléfono, así que tiene que seguir encendido
 * y en la wifi mientras dura. Para eso coge un candado de wifi y otro de CPU
 * mientras el puente está abierto.
 */
class ModuloDePuente(contexto: ReactApplicationContext) : ReactContextBaseJavaModule(contexto) {

  override fun getName(): String = "Puente"

  private var servidor: ServerSocket? = null

  /** Qué hay detrás de cada dirección que se ha dado. Una cosa cada vez. */
  private val destinos = ConcurrentHashMap<String, Destino>()

  /** Cuánto se guarda del principio del fichero: con esto sobra para el tanteo. */
  private val PRINCIPIO = 1024 * 1024

  private var candadoWifi: WifiManager.WifiLock? = null
  private var candadoCpu: PowerManager.WakeLock? = null

  private class Destino(val url: String, val tipo: String, val parches: List<Parche>) {
    /**
     * El primer mega del fichero y lo que ocupa entero.
     *
     * Antes de empezar, la tele hace **cuatro `HEAD` y media docena de `GET`
     * de tanteo**: mira el principio, mira el final y vuelve al principio. Con
     * una conexión al panel por cada uno, empezar una película le pedía seis
     * conexiones a una cuenta que tiene tres, y el panel se atragantaba —y
     * cuanto más insistía uno, peor—.
     *
     * Casi todo ese tanteo es de los primeros kilobytes, así que se guardan
     * una vez y se contesta desde aquí. El tamaño total se aprende de la misma
     * petición, y con él los `HEAD` se contestan sin tocar el panel.
     */
    @Volatile var cache: ByteArray? = null

    @Volatile var total: Long = 0

    /** Se abre cuando el principio está listo, o cuando se ha renunciado. */
    val listo = CountDownLatch(1)
  }

  /**
   * Un trozo del fichero cambiado por otro **del mismo tamaño**.
   *
   * Es como se eligen el audio y los subtítulos: DLNA no sabe pedir una pista,
   * así que se reescriben las fichas de las pistas al pasar. Los bytes los
   * calcula `@m3u/core` (`parchesParaDejarSolo`), que es donde están las
   * pruebas; aquí solo se colocan en su sitio.
   */
  private data class Parche(val desde: Long, val bytes: ByteArray)

  /**
   * Abre el puente para una URL del panel y devuelve la que hay que darle a
   * la tele. Lleva un identificador al azar: en la red de casa cualquiera
   * podría pedir cosas a este puerto, y sin él sería un proxy abierto.
   */
  @ReactMethod
  fun abrir(url: String, tipo: String, parches: ReadableArray?, promesa: Promise) {
    try {
      val ip = ipDeLaWifi()
      if (ip == null) {
        promesa.reject("puente", "el teléfono no está en una wifi")
        return
      }
      val socket = servidor ?: ServerSocket(0).also {
        servidor = it
        atender(it)
      }
      candados(true)

      val aCambiar = mutableListOf<Parche>()
      for (i in 0 until (parches?.size() ?: 0)) {
        val parche = parches?.getMap(i) ?: continue
        val datos = parche.getString("datos") ?: continue
        aCambiar.add(Parche(parche.getDouble("desde").toLong(), Base64.decode(datos, Base64.DEFAULT)))
      }

      val clave = UUID.randomUUID().toString().replace("-", "")
      destinos.clear()
      val destino = Destino(url, tipo, aCambiar)
      destinos[clave] = destino
      adelantarElPrincipio(destino)
      if (aCambiar.isNotEmpty()) Log.i("Puente", "cambiando ${aCambiar.size} pistas al pasar")

      val extension = url.substringBefore('?').substringAfterLast('.', "mkv").take(4)
      val direccion = "http://$ip:${socket.localPort}/v/$clave.$extension"
      Log.i("Puente", "abierto en http://$ip:${socket.localPort}")
      promesa.resolve(direccion)
    } catch (fallo: Exception) {
      promesa.reject("puente", fallo.message ?: "no se pudo abrir el puente", fallo)
    }
  }

  /** Lo cierra todo: servidor, candados y lo que hubiera detrás. */
  @ReactMethod
  fun cerrar() {
    destinos.clear()
    try {
      servidor?.close()
    } catch (_: Exception) {
    }
    servidor = null
    candados(false)
    Log.i("Puente", "cerrado")
  }

  private fun candados(poner: Boolean) {
    val app = reactApplicationContext.applicationContext
    if (poner) {
      if (candadoWifi == null) {
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        @Suppress("DEPRECATION")
        candadoWifi = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "chocitatv-puente")?.apply {
          setReferenceCounted(false)
          acquire()
        }
      }
      if (candadoCpu == null) {
        val energia = app.getSystemService(Context.POWER_SERVICE) as? PowerManager
        candadoCpu = energia?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chocitatv:puente")?.apply {
          setReferenceCounted(false)
          acquire()
        }
      }
    } else {
      candadoWifi?.release()
      candadoWifi = null
      candadoCpu?.release()
      candadoCpu = null
    }
  }

  /**
   * Se trae el primer mega del fichero y su tamaño, una sola vez.
   *
   * En un hilo aparte para no hacer esperar a quien manda el vídeo: mientras
   * llega, quien pida algo espera unos segundos en `listo`, que es mucho menos
   * de lo que costaría otra conexión al panel.
   */
  private fun adelantarElPrincipio(destino: Destino) {
    Thread {
      try {
        val panel = (URL(destino.url).openConnection() as HttpURLConnection).apply {
          instanceFollowRedirects = true
          connectTimeout = 15_000
          readTimeout = 30_000
          setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20")
          setRequestProperty("Accept", "*/*")
          setRequestProperty("Range", "bytes=0-${PRINCIPIO - 1}")
        }
        try {
          val rango = panel.getHeaderField("Content-Range")
          destino.total = rango?.substringAfterLast('/')?.toLongOrNull()
            ?: panel.contentLengthLong.takeIf { it >= 0 } ?: 0

          val recogido = ByteArrayOutputStream()
          val trozo = ByteArray(64 * 1024)
          panel.inputStream.use { origen ->
            while (recogido.size() < PRINCIPIO) {
              val leidos = origen.read(trozo)
              if (leidos < 0) break
              recogido.write(trozo, 0, leidos)
            }
          }
          destino.cache = recogido.toByteArray()
          Log.i("Puente", "principio guardado: ${recogido.size()} bytes de ${destino.total}")
        } finally {
          panel.disconnect()
        }
      } catch (fallo: Exception) {
        // Sin adelanto se sigue como siempre, pidiéndoselo todo al panel.
        Log.w("Puente", "no se pudo adelantar el principio: ${fallo.message}")
      } finally {
        destino.listo.countDown()
      }
    }.start()
  }

  private fun atender(socket: ServerSocket) {
    Thread {
      while (!socket.isClosed) {
        val cliente = try {
          socket.accept()
        } catch (_: Exception) {
          break
        }
        // Un hilo por conexión: la tele abre varias a la vez al mismo fichero.
        Thread { servir(cliente) }.start()
      }
    }.start()
  }

  private fun servir(cliente: Socket) {
    cliente.use { conexionTele ->
      val entrada = BufferedInputStream(conexionTele.getInputStream())
      val salida = BufferedOutputStream(conexionTele.getOutputStream())

      val lineas = leerCabecera(entrada)
      if (lineas.isEmpty()) return
      val partes = lineas.first().split(" ")
      val metodo = partes.getOrElse(0) { "GET" }
      val camino = partes.getOrElse(1) { "/" }
      val cabeceras = lineas.drop(1).mapNotNull { linea ->
        val dos = linea.indexOf(':')
        if (dos <= 0) null else linea.substring(0, dos).trim().lowercase() to linea.substring(dos + 1).trim()
      }.toMap()

      Log.i(
        "Puente",
        "tele → $metodo ${camino.substringBefore('?').takeLast(12)} · Range=${cabeceras["range"] ?: "-"}" +
          " · UA=${cabeceras["user-agent"] ?: "-"} · ${cabeceras.keys.joinToString(",")}",
      )

      val clave = camino.removePrefix("/v/").substringBefore('.')
      val destino = destinos[clave]
      if (destino == null) {
        escribirCabecera(salida, "404 Not Found", mapOf("Content-Length" to "0", "Connection" to "close"))
        return
      }

      // Lo que se pide, en bytes. Sin cabecera `Range` es desde el principio.
      val pedidoDesde = cabeceras["range"]?.substringAfter("bytes=")?.substringBefore('-')?.trim()?.toLongOrNull() ?: 0L

      // Un momento por si el principio aún viene de camino.
      destino.listo.await(8, TimeUnit.SECONDS)
      // Sin nulos: vacío quiere decir que no hay nada guardado todavía.
      val guardado = destino.cache ?: ByteArray(0)

      /*
        Un `HEAD` solo pregunta el tamaño, y el tamaño ya se sabe: se contesta
        aquí mismo. Cada uno de estos era una conexión al panel para nada.
      */
      if (metodo == "HEAD" && destino.total > 0) {
        Log.i("Puente", "  de memoria (HEAD, ${destino.total} bytes)")
        escribirCabecera(
          salida,
          "200 OK",
          cabecerasDlna(destino.tipo) + mapOf("Content-Length" to destino.total.toString()),
        )
        return
      }

      /*
        Y el tanteo del principio, también: la tele pide unos kilobytes, los
        mira y cierra. Si se pone a leer de verdad, al acabarse lo guardado se
        sigue por el panel desde ese punto, con una sola conexión.
      */
      if (metodo == "GET" && destino.total > 0 && pedidoDesde < guardado.size) {
        Log.i("Puente", "  de memoria, byte $pedidoDesde")
        val conRango = cabeceras["range"] != null
        val cabecera = cabecerasDlna(destino.tipo).toMutableMap()
        cabecera["Content-Length"] = (destino.total - pedidoDesde).toString()
        if (conRango) cabecera["Content-Range"] = "bytes $pedidoDesde-${destino.total - 1}/${destino.total}"
        escribirCabecera(salida, if (conRango) "206 Partial Content" else "200 OK", cabecera)

        val trozo = guardado.copyOfRange(pedidoDesde.toInt(), guardado.size)
        cambiarLoQueToque(trozo, trozo.size, pedidoDesde, destino.parches)
        try {
          salida.write(trozo)
          salida.flush()
        } catch (corte: Exception) {
          // La tele ya tenía bastante: ni se ha tocado el panel.
          Log.i("Puente", "  le bastó con el principio")
          return
        }
        seguirPorElPanel(destino, guardado.size.toLong(), salida)
        return
      }

      val panel = (URL(destino.url).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = true
        connectTimeout = 15_000
        readTimeout = 30_000
        setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20")
        setRequestProperty("Accept", "*/*")
        // A un HEAD se le contesta con el tamaño, y para saberlo basta con
        // pedir el primer byte: el panel lo dice en Content-Range.
        val rango = if (metodo == "HEAD") "bytes=0-0" else cabeceras["range"]
        if (rango != null) setRequestProperty("Range", rango)
      }

      try {
        val estado = panel.responseCode
        val rangoPanel: String? = panel.getHeaderField("Content-Range")
        val total = rangoPanel?.substringAfterLast('/')?.toLongOrNull()
          ?: panel.contentLengthLong.takeIf { it >= 0 && estado == 200 }
        Log.i("Puente", "  panel ← $estado · ${rangoPanel ?: "sin rango"} · total ${total ?: "?"}")

        val comunes = cabecerasDlna(destino.tipo)

        if (estado >= 400) {
          escribirCabecera(salida, "$estado Error", mapOf("Content-Length" to "0", "Connection" to "close"))
          return
        }
        if (metodo == "HEAD") {
          val cabecera = comunes.toMutableMap()
          if (total != null) cabecera["Content-Length"] = total.toString()
          escribirCabecera(salida, "200 OK", cabecera)
          return
        }

        val cabecera = comunes.toMutableMap()
        if (estado == 206 && rangoPanel != null) cabecera["Content-Range"] = rangoPanel
        panel.contentLengthLong.takeIf { it >= 0 }?.let { cabecera["Content-Length"] = it.toString() }
        escribirCabecera(salida, if (estado == 206) "206 Partial Content" else "200 OK", cabecera)

        /*
          Por qué byte del fichero empieza lo que viene: lo dice el propio
          panel en `Content-Range`, y sin rango es desde el principio. Hace
          falta para saber si lo que pasa por aquí cae dentro de un hueco.
        */
        val empiezaEn = rangoPanel?.substringAfter("bytes ")?.substringBefore('-')?.trim()?.toLongOrNull() ?: 0L
        val pasados = panel.inputStream.use { origen -> copiar(origen, salida, empiezaEn, destino.parches) }
        Log.i("Puente", "  terminado, ${pasados / 1_000_000} MB")
      } catch (fallo: Exception) {
        // Que la tele cierre una conexión a medias es lo normal: salta a otro
        // sitio del fichero y abre otra. No es un fallo del puente.
        Log.i("Puente", "  cortado: ${fallo.message}")
      } finally {
        panel.disconnect()
      }
    }
  }

  /** Lo que una tele DLNA espera oír: que se puede saltar y que es vídeo. */
  private fun cabecerasDlna(tipo: String): Map<String, String> = mapOf(
    "Content-Type" to tipo,
    "Accept-Ranges" to "bytes",
    "Connection" to "close",
    "contentFeatures.dlna.org" to "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
    "transferMode.dlna.org" to "Streaming",
  )

  /**
   * Sigue mandando desde donde se acabó lo guardado, ya con el panel.
   *
   * La cabecera ya se mandó con el tamaño de todo, así que aquí solo van
   * bytes: para la tele es la misma respuesta, y no se entera de que la
   * primera parte salió de la memoria.
   */
  private fun seguirPorElPanel(destino: Destino, desde: Long, salida: OutputStream) {
    val panel = (URL(destino.url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 15_000
      readTimeout = 30_000
      setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20")
      setRequestProperty("Accept", "*/*")
      setRequestProperty("Range", "bytes=$desde-")
    }
    try {
      Log.i("Puente", "  sigue por el panel desde $desde (${panel.responseCode})")
      val pasados = panel.inputStream.use { origen -> copiar(origen, salida, desde, destino.parches) }
      Log.i("Puente", "  terminado, ${pasados / 1_000_000} MB")
    } catch (fallo: Exception) {
      Log.i("Puente", "  cortado: ${fallo.message}")
    } finally {
      panel.disconnect()
    }
  }

  private fun leerCabecera(entrada: InputStream): List<String> {
    val lineas = mutableListOf<String>()
    val linea = StringBuilder()
    while (true) {
      val byte = entrada.read()
      if (byte < 0) break
      if (byte == '\n'.code) {
        val texto = linea.toString().trimEnd('\r')
        if (texto.isEmpty()) break
        lineas.add(texto)
        linea.setLength(0)
      } else {
        linea.append(byte.toChar())
      }
      if (lineas.size > 100) break
    }
    return lineas
  }

  private fun escribirCabecera(salida: OutputStream, estado: String, cabeceras: Map<String, String>) {
    val texto = StringBuilder("HTTP/1.1 $estado\r\n")
    for ((nombre, valor) in cabeceras) texto.append(nombre).append(": ").append(valor).append("\r\n")
    texto.append("\r\n")
    salida.write(texto.toString().toByteArray(Charsets.ISO_8859_1))
    salida.flush()
  }

  private fun copiar(origen: InputStream, destino: OutputStream, empiezaEn: Long, parches: List<Parche>): Long {
    val trozo = ByteArray(64 * 1024)
    var total = 0L
    var puesto = empiezaEn
    while (true) {
      val leidos = origen.read(trozo)
      if (leidos < 0) break
      if (parches.isNotEmpty()) cambiarLoQueToque(trozo, leidos, puesto, parches)
      destino.write(trozo, 0, leidos)
      total += leidos
      puesto += leidos
    }
    destino.flush()
    return total
  }

  /**
   * Coloca en su sitio los trozos cambiados que caigan dentro de lo que se
   * está mandando.
   *
   * La tele pide el fichero a trozos y por donde le parece, así que un parche
   * puede caer entero, a medias o no caer: se copia solo lo que solape. Los
   * bytes ya vienen calculados y **miden lo mismo que lo que sustituyen**, de
   * modo que ninguna posición del fichero se mueve y la tele puede seguir
   * saltando.
   */
  private fun cambiarLoQueToque(trozo: ByteArray, leidos: Int, puesto: Long, parches: List<Parche>) {
    val ultimo = puesto + leidos - 1
    for (parche in parches) {
      val finDelParche = parche.desde + parche.bytes.size - 1
      val desde = maxOf(parche.desde, puesto)
      val hasta = minOf(finDelParche, ultimo)
      if (desde > hasta) continue
      for (byte in desde..hasta) {
        trozo[(byte - puesto).toInt()] = parche.bytes[(byte - parche.desde).toInt()]
      }
    }
  }

  /** La dirección del teléfono en la wifi de casa, que es la que ve la tele. */
  private fun ipDeLaWifi(): String? {
    val direcciones = NetworkInterface.getNetworkInterfaces().toList()
      .filter { it.isUp && !it.isLoopback }
      .flatMap { interfaz -> interfaz.inetAddresses.toList().map { interfaz.name to it } }
      .filter { (_, direccion) -> direccion is Inet4Address && direccion.isSiteLocalAddress }
    // La wifi primero: con datos móviles puede haber otra interfaz privada.
    return (direcciones.firstOrNull { (nombre, _) -> nombre.startsWith("wlan") } ?: direcciones.firstOrNull())
      ?.second?.hostAddress
  }
}
