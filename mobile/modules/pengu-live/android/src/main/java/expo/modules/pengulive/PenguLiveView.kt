package expo.modules.pengulive

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import com.pedro.common.ConnectChecker
import com.pedro.common.StreamingStatsReport
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.BitmapSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.multiple.MultiStream
import com.pedro.library.multiple.MultiType
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Kamera önizlemesi + aynı görüntüyü aynı anda iki yere (0 = Twitch, 1 = Kick) gönderir.
 * - Bağlantı koparsa yayıncı "Bitir"e basana kadar tekrar tekrar bağlanmayı dener.
 * - Gönderilen bitrate çok düşerse kamera yerine "Bitrate düşük, lütfen bekleyiniz" yazısına geçer,
 *   düzelince kameraya döner.
 */
class PenguLiveView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onStatus by EventDispatcher()
  private val onStats by EventDispatcher()

  private val main = Handler(Looper.getMainLooper())
  private val names = arrayOf("twitch", "kick")
  private val wanted = BooleanArray(2)      // yayıncı bu platformda yayın istiyor mu
  private val urls = arrayOfNulls<String>(2)
  private val live = BooleanArray(2)
  private val bitrate = LongArray(2)

  private var width = 1280
  private var height = 720
  private var videoBitrate = 3_000_000
  private var prepared = false
  private var frontCamera = false
  private var lowMode = false
  private var lowSince = 0L
  private var okSince = 0L

  private fun emit(platform: Int, state: String, message: String = "") {
    main.post {
      onStatus(mapOf("platform" to names[platform], "state" to state, "message" to message, "lowMode" to lowMode))
    }
  }

  private fun checker(i: Int) = object : ConnectChecker {
    override fun onConnectionStarted(url: String) { emit(i, "connecting") }
    override fun onConnectionSuccess() { live[i] = true; emit(i, "live") }
    override fun onConnectionFailed(reason: String) {
      live[i] = false
      if (wanted[i]) {
        // Yayıncı bitirmedi: 3 sn sonra tekrar bağlan (sınırsız)
        emit(i, "reconnecting", reason)
        main.postDelayed({
          if (!wanted[i]) return@postDelayed
          val client = stream.getStreamClient(MultiType.RTMP, i)
          if (!client.reTry(0, reason, null)) {
            client.setReTries(RETRIES)
            client.reTry(0, reason, null)
          }
        }, 3000)
      } else emit(i, "error", reason)
    }
    override fun onDisconnect() { live[i] = false; if (!wanted[i]) emit(i, "idle") }
    override fun onAuthError() { emit(i, "error", "Yayın anahtarı kabul edilmedi") }
    override fun onAuthSuccess() {}
    override fun onStreamingStats(report: StreamingStatsReport) {
      bitrate[i] = report.smoothedBitrate
      main.post { checkLowBitrate() }
    }
  }

  private val stream: MultiStream = MultiStream(context, arrayOf(checker(0), checker(1)), null, null, null).apply {
    getGlInterface().autoHandleOrientation = true
  }

  private val surfaceView = SurfaceView(context).also { sv ->
    addView(sv, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    sv.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        if (prepare() && !stream.isOnPreview) runCatching { stream.startPreview(sv) }
      }
      override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
        stream.getGlInterface().setPreviewResolution(w, h)
      }
      override fun surfaceDestroyed(holder: SurfaceHolder) {
        if (stream.isOnPreview) stream.stopPreview()
      }
    })
  }

  private val statsTick = object : Runnable {
    override fun run() {
      onStats(mapOf(
        "twitch" to (if (live[0]) bitrate[0] else 0L).toDouble(),
        "kick" to (if (live[1]) bitrate[1] else 0L).toDouble(),
        "target" to videoBitrate.toDouble(),
        "lowMode" to lowMode,
      ))
      main.postDelayed(this, 1000)
    }
  }

  init {
    main.post(statsTick)
  }

  fun setQuality(q: String) {
    val (w, h, b) = when (q) {
      "low" -> Triple(854, 480, 1_500_000)
      "high" -> Triple(1920, 1080, 6_000_000)
      else -> Triple(1280, 720, 3_000_000)
    }
    if (w == width && b == videoBitrate) return
    width = w; height = h; videoBitrate = b
    if (prepared && !stream.isStreaming) {
      // Önizleme sürerken ayar değişmez: önizlemeyi durdurup yeniden hazırla
      val wasOnPreview = stream.isOnPreview
      if (wasOnPreview) stream.stopPreview()
      prepared = false
      if (prepare() && wasOnPreview && surfaceView.holder.surface.isValid) runCatching { stream.startPreview(surfaceView) }
    }
  }

  private fun prepare(): Boolean {
    if (prepared) return true
    prepared = try {
      stream.prepareVideo(width, height, videoBitrate, 30, 2) && stream.prepareAudio(44100, true, 128_000, true, true)
    } catch (e: Exception) {
      false
    }
    return prepared
  }

  fun start(list: List<String>) {
    if (!prepare()) throw IllegalStateException("Kamera / mikrofon hazırlanamadı (izinleri kontrol et)")
    for (i in 0..1) {
      val url = list.getOrNull(i)?.trim().orEmpty()
      if (url.isEmpty() || wanted[i]) continue
      wanted[i] = true
      urls[i] = url
      stream.getStreamClient(MultiType.RTMP, i).setReTries(RETRIES)
      stream.startStream(MultiType.RTMP, i, url)
    }
  }

  fun stop() {
    for (i in 0..1) {
      if (!wanted[i]) continue
      wanted[i] = false
      runCatching { stream.stopStream(MultiType.RTMP, i) }
      live[i] = false
      emit(i, "idle")
    }
    // Kodlayıcıyı da durdur (bir sonraki yayın temiz başlasın)
    if (stream.isStreaming) runCatching { stream.stopStream() }
    if (lowMode) backToCamera()
  }

  fun switchCamera() {
    (stream.videoSource as? Camera2Source)?.let { it.switchCamera(); frontCamera = !frontCamera }
  }

  fun setMuted(muted: Boolean) {
    (stream.audioSource as? MicrophoneSource)?.let { if (muted) it.mute() else it.unMute() }
  }

  // ---- Bitrate çok düşerse bekleme görüntüsüne geç ----
  private fun checkLowBitrate() {
    if (!wanted[0] && !wanted[1]) return
    val active = (0..1).filter { live[it] }
    if (active.isEmpty()) return
    val worst = active.minOf { bitrate[it] }
    val now = System.currentTimeMillis()
    if (!lowMode) {
      if (worst in 1 until (videoBitrate * 0.25).toLong()) {
        if (lowSince == 0L) lowSince = now
        if (now - lowSince > 5000) switchToWaiting()
      } else lowSince = 0L
    } else {
      // Bekleme görüntüsü az veri kullanır: bağlantı rahatladıysa kameraya dön
      if (stream.getStreamClient(MultiType.RTMP, active.first()).getItemsInCache() < 5) {
        if (okSince == 0L) okSince = now
        if (now - okSince > 8000) backToCamera()
      } else okSince = 0L
    }
  }

  private fun waitingBitmap(): Bitmap {
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.drawColor(Color.rgb(17, 24, 39))
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER }
    p.textSize = height / 9f
    c.drawText("Bitrate düşük", width / 2f, height / 2f - p.textSize / 2, p)
    p.textSize = height / 16f
    p.color = Color.rgb(200, 200, 210)
    c.drawText("Lütfen bekleyiniz…", width / 2f, height / 2f + p.textSize * 1.5f, p)
    return bmp
  }

  private fun switchToWaiting() {
    if (lowMode) return
    runCatching { stream.changeVideoSource(BitmapSource(waitingBitmap())) }.onSuccess {
      lowMode = true
      okSince = 0L
      for (i in 0..1) if (wanted[i]) emit(i, if (live[i]) "live" else "reconnecting")
    }
  }

  private fun backToCamera() {
    if (!lowMode) return
    runCatching {
      val cam = Camera2Source(context)
      stream.changeVideoSource(cam)
      if (frontCamera) cam.switchCamera()
    }
    lowMode = false
    lowSince = 0L
    for (i in 0..1) if (wanted[i]) emit(i, if (live[i]) "live" else "reconnecting")
  }

  fun release() {
    main.removeCallbacksAndMessages(null)
    for (i in 0..1) wanted[i] = false
    runCatching { stream.release() }
  }

  companion object {
    private const val RETRIES = 100000
  }
}
