package com.m3utv

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.Promise
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
import java.util.concurrent.ConcurrentHashMap

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

  private var candadoWifi: WifiManager.WifiLock? = null
  private var candadoCpu: PowerManager.WakeLock? = null

  private data class Destino(val url: String, val tipo: String)

  /**
   * Abre el puente para una URL del panel y devuelve la que hay que darle a
   * la tele. Lleva un identificador al azar: en la red de casa cualquiera
   * podría pedir cosas a este puerto, y sin él sería un proxy abierto.
   */
  @ReactMethod
  fun abrir(url: String, tipo: String, promesa: Promise) {
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

      val clave = UUID.randomUUID().toString().replace("-", "")
      destinos.clear()
      destinos[clave] = Destino(url, tipo)

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

        // Lo que una tele DLNA espera oír: que se puede saltar por bytes y
        // que esto es un vídeo que se reproduce mientras llega.
        val comunes = mapOf(
          "Content-Type" to destino.tipo,
          "Accept-Ranges" to "bytes",
          "Connection" to "close",
          "contentFeatures.dlna.org" to "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
          "transferMode.dlna.org" to "Streaming",
        )

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

        val pasados = panel.inputStream.use { origen -> copiar(origen, salida) }
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

  private fun copiar(origen: InputStream, destino: OutputStream): Long {
    val trozo = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
      val leidos = origen.read(trozo)
      if (leidos < 0) break
      destino.write(trozo, 0, leidos)
      total += leidos
    }
    destino.flush()
    return total
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
