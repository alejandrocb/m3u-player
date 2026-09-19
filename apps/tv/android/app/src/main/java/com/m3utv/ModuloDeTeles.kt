package com.m3utv

import android.content.Context
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * Busca en la red de casa las teles a las que se les puede mandar un vídeo.
 *
 * Es SSDP, lo mismo que hace cualquier móvil para encontrar un Chromecast o
 * una impresora: se pregunta en voz alta a una dirección multicast y quien
 * sepa reproducir contesta diciendo dónde está su ficha. Todo lo demás —leer
 * la ficha, mandar órdenes— es HTTP y lo hace JavaScript (`@m3u/core`, en
 * `dlna.ts`); esto es solo la parte que JavaScript no sabe hacer en Android,
 * que es hablar UDP.
 *
 * Devuelve las direcciones de las fichas, sin leerlas: una casa tiene router,
 * altavoces e impresora que también contestan, y decidir cuál es una tele lo
 * hace quien lee la ficha.
 */
class ModuloDeTeles(contexto: ReactApplicationContext) : ReactContextBaseJavaModule(contexto) {

  override fun getName(): String = "Teles"

  @ReactMethod
  fun buscar(milisegundos: Int, promesa: Promise) {
    // En un hilo aparte: esperar respuestas es bloquear, y el del puente no
    // se puede bloquear.
    Thread {
      /*
        Sin este candado, muchos Android **tiran los paquetes multicast** para
        ahorrar batería, y la búsqueda vuelve vacía aunque la tele esté ahí.
        Se suelta al terminar, pase lo que pase.
      */
      val wifi = reactApplicationContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      val candado = wifi?.createMulticastLock("chocitatv-teles")?.apply {
        setReferenceCounted(false)
        acquire()
      }

      val encontradas = linkedSetOf<String>()
      try {
        DatagramSocket().use { socket ->
          socket.soTimeout = 300
          val grupo = InetAddress.getByName("239.255.255.250")

          /*
            Dos preguntas: por "reproductor" y por "sabe reproducir". Hay teles
            que solo contestan a una de las dos. Y cada una dos veces, porque
            UDP se pierde y una tele medio dormida no contesta a la primera.
          */
          val buscados = listOf(
            "urn:schemas-upnp-org:device:MediaRenderer:1",
            "urn:schemas-upnp-org:service:AVTransport:1",
          )
          repeat(2) {
            for (buscado in buscados) {
              val pregunta = (
                "M-SEARCH * HTTP/1.1\r\n" +
                  "HOST: 239.255.255.250:1900\r\n" +
                  "MAN: \"ssdp:discover\"\r\n" +
                  "MX: 2\r\n" +
                  "ST: $buscado\r\n\r\n"
                ).toByteArray()
              socket.send(DatagramPacket(pregunta, pregunta.size, grupo, 1900))
            }
          }

          val ubicacion = Regex("(?im)^LOCATION:\\s*(\\S+)")
          val hasta = System.currentTimeMillis() + milisegundos
          val buffer = ByteArray(4096)
          while (System.currentTimeMillis() < hasta) {
            val paquete = DatagramPacket(buffer, buffer.size)
            try {
              socket.receive(paquete)
            } catch (espera: SocketTimeoutException) {
              continue
            }
            val texto = String(paquete.data, 0, paquete.length)
            ubicacion.find(texto)?.let { encontradas.add(it.groupValues[1]) }
          }
        }

        val lista = Arguments.createArray()
        encontradas.forEach { lista.pushString(it) }
        promesa.resolve(lista)
      } catch (fallo: Exception) {
        promesa.reject("teles", fallo.message ?: "no se pudo buscar en la red", fallo)
      } finally {
        candado?.release()
      }
    }.start()
  }
}
