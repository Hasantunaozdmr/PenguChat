package expo.modules.pengulive

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.pedro.common.ConnectChecker
import com.pedro.common.StreamingStatsReport
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.BitmapSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.multiple.MultiStream
import com.pedro.library.multiple.MultiType
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray

/**
 * Kamera önizlemesi + aynı görüntüyü aynı anda iki yere (0 = Twitch, 1 = Kick) gönderir.
 * - Bağlantı koparsa yayıncı "Bitir"e basana kadar tekrar tekrar bağlanmayı dener.
 * - Gönderilen bitrate çok düşerse kamera yerine "Bitrate düşük, lütfen bekleyiniz" yazısına geçer,
 *   düzelince kameraya döner.
 * - Ekran öğeleri (PenguLive logosu, yayıncının kendi resimleri, donate bar linkleri) görüntünün üstüne
 *   eklenir; yeri ve boyutu yüzde olarak gelir (x, y = sol üst köşe, w = genişlik).
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

  // Önizleme + (görünmez) donate sayfaları aynı kutuda üst üste
  private val root = FrameLayout(context).also {
    addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private val surfaceView = SurfaceView(context).also { sv ->
    root.addView(sv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    sv.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        if (prepare() && !stream.isOnPreview) startPreview()
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
      // Telefon döndüyse ekran öğelerinin oranını düzelt
      val p = isPortrait()
      if (p != lastPortrait) { lastPortrait = p; overlays.values.forEach { place(it) } }
      main.postDelayed(this, 1000)
    }
  }

  init {
    main.post(statsTick)
  }

  private var presetBitrate = 3_000_000
  private var customBitrate = 0 // yayıncının elle girdiği (bps), 0 = hazır kalitedeki değer

  fun setQuality(q: String) {
    val (w, h, b) = when (q) {
      "low" -> Triple(854, 480, 1_500_000)
      "high" -> Triple(1920, 1080, 6_000_000)
      else -> Triple(1280, 720, 3_000_000)
    }
    presetBitrate = b
    applyConfig(w, h)
  }

  // Elle bitrate (kbps). Yayın sürerken de hemen uygulanır.
  fun setBitrateKbps(kbps: Int) {
    customBitrate = if (kbps in 300..20000) kbps * 1000 else 0
    applyConfig(width, height)
  }

  private fun applyConfig(w: Int, h: Int) {
    val b = if (customBitrate > 0) customBitrate else presetBitrate
    if (w == width && h == height && b == videoBitrate) return
    if (stream.isStreaming) {
      // Çözünürlük yayın sırasında değişmez; bitrate değişir
      if (w == width && h == height) { videoBitrate = b; runCatching { stream.setVideoBitrateOnFly(b) } }
      return
    }
    width = w; height = h; videoBitrate = b
    if (prepared) {
      // Önizleme sürerken ayar değişmez: önizlemeyi durdurup yeniden hazırla
      val wasOnPreview = stream.isOnPreview
      if (wasOnPreview) stream.stopPreview()
      prepared = false
      if (prepare() && wasOnPreview && surfaceView.holder.surface.isValid) startPreview()
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

  private fun startPreview() {
    runCatching { stream.startPreview(surfaceView) }.onSuccess { syncFilters() }
  }

  fun start(list: List<String>) {
    if (!prepare()) throw IllegalStateException("Kamera / mikrofon hazırlanamadı (izinleri kontrol et)")
    val glWasRunning = stream.getGlInterface().isRunning
    for (i in 0..1) {
      val url = list.getOrNull(i)?.trim().orEmpty()
      if (url.isEmpty() || wanted[i]) continue
      wanted[i] = true
      urls[i] = url
      stream.getStreamClient(MultiType.RTMP, i).setReTries(RETRIES)
      stream.startStream(MultiType.RTMP, i, url)
    }
    if (!glWasRunning) syncFilters()
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

  // ---- Ekran öğeleri (logo, resim, donate bar) ----
  private class Ov(val id: String, val type: String, val x: Float, val y: Float, val w: Float, val src: String, val shape: String)
  private class Live(var ov: Ov, val filter: ImageObjectFilterRender, var aspect: Float, var bmp: Bitmap?, val web: WebView?)

  private val overlays = LinkedHashMap<String, Live>()
  private var lastPortrait = false

  private fun isPortrait() = resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT

  fun setOverlays(json: String) {
    val list = runCatching {
      val a = JSONArray(json)
      (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optBoolean("on", true) }.map {
        Ov(it.optString("id"), it.optString("type"), it.optDouble("x", 0.0).toFloat(), it.optDouble("y", 0.0).toFloat(),
          it.optDouble("w", 15.0).toFloat(), it.optString("src"), it.optString("shape", "bar"))
      }
    }.getOrDefault(emptyList())
    val ids = list.map { it.id }.toSet()
    overlays.keys.filter { it !in ids }.forEach { removeOverlay(it) }
    for (o in list) {
      var l = overlays[o.id]
      if (l != null && (l.ov.type != o.type || l.ov.src != o.src || l.ov.shape != o.shape)) { removeOverlay(o.id); l = null }
      if (l == null) {
        l = createOverlay(o) ?: continue
        overlays[o.id] = l
        runCatching { stream.getGlInterface().addFilter(l.filter) }
      }
      l.ov = o
      place(l)
    }
    main.removeCallbacks(webTick)
    if (overlays.values.any { it.web != null }) main.postDelayed(webTick, 500)
  }

  private fun createOverlay(o: Ov): Live? {
    val filter = ImageObjectFilterRender()
    return when (o.type) {
      "logo" -> {
        val bmp = BitmapFactory.decodeResource(resources, R.drawable.pengulive_logo) ?: return null
        filter.setImage(bmp)
        Live(o, filter, bmp.height.toFloat() / bmp.width, bmp, null)
      }
      "image" -> {
        val bmp = loadImage(o.src) ?: return null
        filter.setImage(bmp)
        Live(o, filter, bmp.height.toFloat() / bmp.width, bmp, null)
      }
      "web" -> {
        if (!o.src.startsWith("https://")) return null
        val (pw, ph) = if (o.shape == "box") 800 to 600 else 1200 to 300
        Live(o, filter, ph.toFloat() / pw, null, makeWeb(o.src, pw, ph))
      }
      else -> null
    }
  }

  private fun loadImage(path: String): Bitmap? = runCatching {
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, opts)
    var sample = 1
    while (opts.outWidth / sample > 1280 || opts.outHeight / sample > 1280) sample *= 2
    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
  }.getOrNull()

  @SuppressLint("SetJavaScriptEnabled")
  private fun makeWeb(url: String, pw: Int, ph: Int): WebView {
    val wv = WebView(context)
    wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    wv.setBackgroundColor(Color.TRANSPARENT)
    wv.settings.javaScriptEnabled = true
    wv.settings.domStorageEnabled = true
    wv.settings.mediaPlaybackRequiresUserGesture = false
    wv.settings.allowFileAccess = false
    wv.webViewClient = WebViewClient()
    wv.isFocusable = false
    wv.isClickable = false
    wv.alpha = 0f // ekranda görünmez; sadece yayına çizilir
    wv.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    root.addView(wv, FrameLayout.LayoutParams(pw, ph))
    wv.loadUrl(url)
    return wv
  }

  // Donate sayfalarının görüntüsünü saniyede 2 kez yayına aktar
  private val webTick = object : Runnable {
    override fun run() {
      for (l in overlays.values) {
        val wv = l.web ?: continue
        if (wv.width <= 0 || wv.height <= 0) continue
        runCatching {
          val bmp = Bitmap.createBitmap(wv.width, wv.height, Bitmap.Config.ARGB_8888)
          wv.draw(Canvas(bmp))
          l.bmp = bmp
          l.filter.setImage(bmp)
        }
      }
      main.postDelayed(this, 500)
    }
  }

  private fun place(l: Live) {
    // Görüntünün en / boy oranı (yan: 16:9, dik: 9:16)
    val frame = if (isPortrait()) height.toFloat() / width else width.toFloat() / height
    val w = l.ov.w.coerceIn(2f, 100f)
    val h = (w * l.aspect * frame).coerceIn(1f, 100f)
    l.filter.setScale(w, h)
    l.filter.setPosition(l.ov.x.coerceIn(0f, 100f - w), l.ov.y.coerceIn(0f, 100f - h))
  }

  private fun removeOverlay(id: String) {
    val l = overlays.remove(id) ?: return
    runCatching { stream.getGlInterface().removeFilter(l.filter) }
    l.web?.let { root.removeView(it); it.destroy() }
  }

  // Görüntü motoru yeniden başlayınca eklenen öğeler silinir: hepsini baştan ekle
  private fun syncFilters() {
    val gl = stream.getGlInterface()
    runCatching { gl.clearFilters() }
    for (l in overlays.values) {
      l.bmp?.let { l.filter.setImage(it) }
      runCatching { gl.addFilter(l.filter) }
      place(l)
    }
  }

  fun release() {
    main.removeCallbacksAndMessages(null)
    overlays.values.forEach { l -> l.web?.let { root.removeView(it); it.destroy() } }
    overlays.clear()
    for (i in 0..1) wanted[i] = false
    runCatching { stream.release() }
  }

  companion object {
    private const val RETRIES = 100000
  }
}
