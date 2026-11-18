package expo.modules.pengulive

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface

/**
 * 🤳 İkinci kamera (dual cam): ana kamera yayını çekerken diğer kamerayı da açar ve görüntüsünü
 * yayının üstündeki kutuya (SurfaceFilterRender) verir. Her telefon iki kamerayı aynı anda açamaz;
 * açamazsa onError ile Türkçe bir mesaj döner.
 */
class SecondCam(context: Context, private val onError: (String) -> Unit) {
  private val cm = context.getSystemService(CameraManager::class.java)
  private val thread = HandlerThread("pengu-cam2").apply { start() }
  private val h = Handler(thread.looper)
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var gen = 0 // eski açma isteklerinin geç gelen cevaplarını yok saymak için

  @Volatile var sensor = 270
  @Volatile var front = true
  @Volatile var bufW = 1280
  @Volatile var bufH = 720

  private fun idFor(front: Boolean): String? = runCatching {
    cm.cameraIdList.firstOrNull {
      cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
        (if (front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK)
    }
  }.getOrNull()

  @SuppressLint("MissingPermission")
  fun open(st: SurfaceTexture, surface: Surface, front: Boolean, mainId: String?) {
    close()
    val my = ++gen
    this.front = front
    val id = idFor(front) ?: return onError("Telefonda ${if (front) "ön" else "arka"} kamera bulunamadı")
    if (Build.VERSION.SDK_INT >= 30 && mainId != null && mainId != id) {
      val ok = runCatching { cm.concurrentCameraIds.any { it.contains(id) && it.contains(mainId) } }.getOrDefault(true)
      if (!ok) return onError("Bu telefon ön ve arka kamerayı aynı anda açamıyor (dual cam desteklemiyor)")
    }
    try {
      val ch = cm.getCameraCharacteristics(id)
      sensor = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: if (front) 270 else 90
      val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(SurfaceTexture::class.java) ?: emptyArray()
      // İki kamera aynı anda açıkken telefonlar genelde en fazla 720p'ye izin verir
      val size = sizes.filter { it.width <= 1280 && it.height <= 720 && it.width * 9 == it.height * 16 }.maxByOrNull { it.width * it.height }
        ?: sizes.filter { it.width <= 1280 && it.height <= 720 }.maxByOrNull { it.width * it.height }
      if (size != null) { bufW = size.width; bufH = size.height }
      st.setDefaultBufferSize(bufW, bufH)
      cm.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(d: CameraDevice) {
          if (my != gen) { d.close(); return }
          device = d
          try {
            @Suppress("DEPRECATION")
            d.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
              override fun onConfigured(s: CameraCaptureSession) {
                if (my != gen) { s.close(); return }
                session = s
                runCatching {
                  val rb = d.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                  rb.addTarget(surface)
                  s.setRepeatingRequest(rb.build(), null, h)
                }.onFailure { onError("İkinci kamera başlatılamadı") }
              }
              override fun onConfigureFailed(s: CameraCaptureSession) {
                if (my == gen) onError("İkinci kamera başlatılamadı (telefon iki kamerayı aynı anda desteklemiyor olabilir)")
              }
            }, h)
          } catch (e: Exception) {
            onError("İkinci kamera başlatılamadı")
          }
        }
        override fun onDisconnected(d: CameraDevice) { d.close(); if (device == d) device = null }
        override fun onError(d: CameraDevice, error: Int) {
          d.close()
          if (device == d) device = null
          if (my == gen) onError("İkinci kamera açılamadı (telefon iki kamerayı aynı anda desteklemiyor olabilir)")
        }
      }, h)
    } catch (e: Exception) {
      onError("İkinci kamera açılamadı: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  fun close() {
    gen++
    runCatching { session?.close() }
    runCatching { device?.close() }
    session = null
    device = null
  }

  fun release() {
    close()
    thread.quitSafely()
  }
}
