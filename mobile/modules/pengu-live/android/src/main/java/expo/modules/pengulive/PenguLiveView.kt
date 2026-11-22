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
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.pedro.common.ConnectChecker
import com.pedro.common.StreamingStatsReport
import com.pedro.encoder.input.gl.render.filters.`object`.BaseObjectFilterRender
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.encoder.input.gl.render.filters.`object`.SurfaceFilterRender
import com.pedro.encoder.input.video.CameraHelper
import android.view.WindowManager
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
  private val onNotice by EventDispatcher()
  private val onLevel by EventDispatcher()

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

  private val stream: MultiStream = MultiStream(context, arrayOf(checker(0), checker(1)), null, null, null,
    Camera2Source(context), MixMicSource()).apply {
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
        "current" to (if (stream.isStreaming) curBitrate else videoBitrate).toDouble(),
        "lowMode" to lowMode,
        "camAspect" to (overlays["cam"]?.let { camAspect() } ?: 0f).toDouble(),
        "power" to power,
      ))
      if (++powerTick % 5 == 1) checkPower()
      adaptBitrate()
      // Telefon döndüyse ekran öğelerinin oranını düzelt
      val p = isPortrait()
      val r = displayDeg()
      if (p != lastPortrait || r != lastRot) { lastPortrait = p; lastRot = r; overlays.values.forEach { place(it) } }
      main.postDelayed(this, 1000)
    }
  }

  // 🎙️ Ses dalgası: saniyede 8 kez yayına giden sesin seviyesi
  private val levelTick = object : Runnable {
    override fun run() {
      (stream.audioSource as? MixMicSource)?.let { onLevel(mapOf("v" to it.takeLevel().toDouble())) }
      main.postDelayed(this, 125)
    }
  }

  init {
    main.post(statsTick)
    main.post(levelTick)
  }

  private var presetBitrate = 3_000_000
  private var customBitrate = 0 // yayıncının elle girdiği (bps), 0 = hazır kalitedeki değer

  private var wantW = 1280
  private var wantH = 720
  private var curBitrate = 3_000_000 // yayında şu an kullanılan (internet zayıflayınca kendiliğinden düşer)
  private var okTicks = 0

  fun setQuality(q: String) {
    val (w, h, b) = when (q) {
      "low" -> Triple(854, 480, 1_500_000)
      "high" -> Triple(1920, 1080, 6_000_000)
      else -> Triple(1280, 720, 3_000_000)
    }
    wantW = w; wantH = h; presetBitrate = b
    scheduleConfig()
  }

  // Elle bitrate (kbps). Yayın sürerken de hemen uygulanır.
  fun setBitrateKbps(kbps: Int) {
    customBitrate = if (kbps in 300..20000) kbps * 1000 else 0
    scheduleConfig()
  }

  // Kalite ve bitrate art arda değişince kamera iki kez kapanıp açılmasın: kısa bir süre bekleyip tek seferde uygula
  private val configRunnable = Runnable { applyConfig() }
  private fun scheduleConfig() {
    main.removeCallbacks(configRunnable)
    if (!prepared) applyConfig() else main.postDelayed(configRunnable, 700)
  }

  private fun applyConfig() {
    val b = if (customBitrate > 0) customBitrate else presetBitrate
    if (stream.isStreaming) {
      // Çözünürlük yayın sırasında değişmez; bitrate hemen değişir
      if (b != videoBitrate) { videoBitrate = b; curBitrate = b; okTicks = 0; runCatching { stream.setVideoBitrateOnFly(b) } }
      return
    }
    val resChanged = wantW != width || wantH != height
    width = wantW; height = wantH; videoBitrate = b
    // Sadece bitrate değiştiyse kamerayı yeniden başlatmaya gerek yok: yayın başlarken uygulanır
    if (resChanged) reprepare()
  }

  private fun reprepare() {
    if (!prepared) return
    val wasOnPreview = stream.isOnPreview
    if (wasOnPreview) stream.stopPreview()
    prepared = false
    if (prepare() && wasOnPreview && surfaceView.holder.surface.isValid) startPreview()
  }

  /**
   * İnternet yetişmeyince bitrate'i kendiliğinden düşürür, rahatlayınca yavaşça geri çıkarır.
   * Bunu yapmazsak kareler yığılıp atılıyor: görüntü takılıyor, ses kayıyor, izleyicide 144p'ye düşüyor.
   * İki platformdan hangisi yetişemiyorsa ona göre ayarlanır (tek kodlayıcı ikisine birden gönderir).
   */
  // ---- 🔋 Şarj / ısı koruması ----
  // Şarj azalınca, pil tasarrufu açılınca ya da telefon ısınınca telefon kendini yavaşlatır; kare hızı 15–30 arasında
  // zıplar. Bunun yerine sabit ve daha düşük bir kare hızına geçeriz: görüntü düzenli akar, ses ile görüntü ayrılmaz.
  private var powerTick = 0
  private var ecoLevel = -1 // 0 normal, 1 tasarruf, 2 çok sıcak
  private var power: Map<String, Any> = emptyMap()

  private fun checkPower() {
    runCatching {
      val bm = context.getSystemService(android.os.BatteryManager::class.java)
      val pm = context.getSystemService(android.os.PowerManager::class.java)
      val pct = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
      val charging = bm.isCharging
      val save = pm.isPowerSaveMode
      val thermal = if (android.os.Build.VERSION.SDK_INT >= 29) pm.currentThermalStatus else 0
      val level = when {
        thermal >= 3 -> 2 // THERMAL_STATUS_SEVERE ve üstü
        thermal >= 2 || save || (pct in 0..15 && !charging) -> 1 // MODERATE, pil tasarrufu ya da düşük şarj
        else -> 0
      }
      if (level != ecoLevel) {
        ecoLevel = level
        runCatching { stream.getGlInterface().forceFpsLimit(when (level) { 2 -> 20; 1 -> 24; else -> 30 }) }
        if (level == 2 && overlays["cam"] != null) {
          removeOverlay("cam")
          onNotice(mapOf("message" to "Telefon çok ısındı: ikinci kamera kapatıldı (yayın takılmasın diye)"))
        }
      }
      power = mapOf("battery" to pct.toDouble(), "charging" to charging, "save" to save, "thermal" to thermal.toDouble(), "eco" to level.toDouble())
    }
  }

  private fun adaptBitrate() {
    if (!stream.isStreaming || lowMode) return
    // Tasarruf modunda kodlayıcıyı daha az yor
    val cap = if (ecoLevel >= 1) minOf(videoBitrate, 2_500_000) else videoBitrate
    if (curBitrate > cap) { curBitrate = cap; runCatching { stream.setVideoBitrateOnFly(cap) } }
    val active = (0..1).filter { wanted[it] && live[it] }
    if (active.isEmpty()) return
    val congested = active.any { runCatching { stream.getStreamClient(MultiType.RTMP, it).hasCongestion(20f) }.getOrDefault(false) }
    val floor = maxOf(400_000, videoBitrate / 5)
    if (congested) {
      okTicks = 0
      val nb = maxOf(floor, (curBitrate * 0.75).toInt())
      if (nb < curBitrate) { curBitrate = nb; runCatching { stream.setVideoBitrateOnFly(nb) } }
    } else if (curBitrate < cap && ++okTicks >= 5) {
      okTicks = 0
      curBitrate = minOf(cap, (curBitrate * 1.1).toInt() + 100_000)
      runCatching { stream.setVideoBitrateOnFly(curBitrate) }
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
    curBitrate = videoBitrate
    okTicks = 0
    runCatching { stream.setVideoBitrateOnFly(videoBitrate) } // kalite seçiminden sonra elle girilen bitrate
    if (wanted[0] || wanted[1]) PenguLiveService.start(context)
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
    PenguLiveService.stop(context)
  }

  fun switchCamera() {
    val dual = overlays["cam"] != null
    if (dual) secondCam.close() // ana kamera diğerine geçerken ikinci kamera onu tutmasın
    (stream.videoSource as? Camera2Source)?.let { it.switchCamera(); frontCamera = !frontCamera }
    if (dual) main.postDelayed({ reopenSecondCam() }, 900)
  }

  fun setMuted(muted: Boolean) {
    (stream.audioSource as? MixMicSource)?.let { if (muted) it.mute() else it.unMute() }
  }

  // ---- Bitrate çok düşerse bekleme görüntüsüne geç ----
  private fun checkLowBitrate() {
    if (!wanted[0] && !wanted[1]) return
    val active = (0..1).filter { live[it] }
    if (active.isEmpty()) return
    val worst = active.minOf { bitrate[it] }
    val now = System.currentTimeMillis()
    if (!lowMode) {
      // Bitrate zaten en alta indirildiği halde gönderilen onun yarısına bile yetişmiyorsa
      val atFloor = curBitrate <= maxOf(400_000, videoBitrate / 5)
      if (atFloor && worst in 1 until (curBitrate * 0.5).toLong()) {
        if (lowSince == 0L) lowSince = now
        if (now - lowSince > 8000) switchToWaiting()
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
    val dual = overlays["cam"] != null
    if (dual) secondCam.close()
    if (dual) main.postDelayed({ reopenSecondCam() }, 900)
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
  private class Ov(val id: String, val type: String, val x: Float, val y: Float, val w: Float, val src: String, val shape: String, val sound: Boolean, val rot: Int, val mirror: Boolean)
  private class Live(var ov: Ov, val filter: BaseObjectFilterRender, var aspect: Float, var bmp: Bitmap?, val web: WebView?) {
    // Donate sayfası için iki resim sırayla kullanılır (her yarım saniyede yeni resim oluşturmamak için)
    val frames = arrayOfNulls<Bitmap>(2)
    var frameIdx = 0
  }

  /**
   * Görüntü motoru bir öğeyi bırakınca (uygulama arka plana gidip gelince vb.) kütüphane yerini ve boyutunu
   * tam ekrana sıfırlıyor. Bu sınıf yeri / boyutu hatırlar ve resmi yeniden yükletir: logo hiçbir zaman ekranı kaplamaz.
   */
  private class OvFilter : ImageObjectFilterRender() {
    private var sx = 0f; private var sy = 0f; private var px = 0f; private var py = 0f
    fun place(w: Float, h: Float, x: Float, y: Float) {
      sx = w; sy = h; px = x; py = y
      setScale(w, h); setPosition(x, y)
    }
    override fun release() {
      super.release()
      if (sx > 0f) { setScale(sx, sy); setPosition(px, py) }
      shouldLoad = true
    }
  }

  /** İkinci kameranın kutusu: yeri / boyutu / dönüşü / aynası hatırlanır. */
  private class CamFilter(cb: SurfaceFilterRender.SurfaceReadyCallback) : SurfaceFilterRender(cb) {
    private var sx = 0f; private var sy = 0f; private var px = 0f; private var py = 0f; private var rot = 0
    fun place(w: Float, h: Float, x: Float, y: Float, deg: Int, mirror: Boolean) {
      // Ayna: genişliği eksi verip yeri bir genişlik kaydırınca görüntü yatayda ters çevrilir
      sx = if (mirror) -w else w; sy = h; px = if (mirror) x + w else x; py = y; rot = deg
      apply()
    }
    private fun apply() { setScale(sx, sy); setPosition(px, py); rotation = rot }
    override fun release() {
      super.release()
      if (sy > 0f) apply()
    }
  }

  private val secondCam = SecondCam(context) { msg ->
    main.post {
      onNotice(mapOf("message" to msg))
      // Açılamadıysa kutuyu kaldır (yayında boş kutu kalmasın)
      overlays["cam"]?.let { removeOverlay("cam") }
    }
  }

  private fun displayDeg(): Int = runCatching {
    @Suppress("DEPRECATION")
    when (context.getSystemService(WindowManager::class.java).defaultDisplay.rotation) {
      android.view.Surface.ROTATION_90 -> 90
      android.view.Surface.ROTATION_180 -> 180
      android.view.Surface.ROTATION_270 -> 270
      else -> 0
    }
  }.getOrDefault(0)

  // İkinci kamera görüntüsünün dönüşü: kameranın kendi açısı + telefonun açısı + yayıncının ↻ ayarı
  private fun camDeg(o: Ov): Int {
    val d = displayDeg()
    val auto = if (secondCam.front) (secondCam.sensor + d) % 360 else (secondCam.sensor - d + 360) % 360
    return (auto + o.rot * 90) % 360
  }

  private fun camAspect(): Float {
    val o = overlays["cam"]?.ov ?: return 0f
    val turned = camDeg(o) % 180 != 0
    val w = secondCam.bufW.toFloat(); val h = secondCam.bufH.toFloat()
    return if (turned) w / h else h / w
  }

  private fun mainCam() = stream.videoSource as? Camera2Source

  private fun reopenSecondCam() {
    val l = overlays["cam"] ?: return
    val f = l.filter as? SurfaceFilterRender ?: return
    val st = f.surfaceTexture ?: return
    val sf = f.surface ?: return
    val mainFront = mainCam()?.getCameraFacing() == CameraHelper.Facing.FRONT || (mainCam() == null && frontCamera)
    secondCam.open(st, sf, !mainFront, mainCam()?.getCurrentCameraId())
    main.postDelayed({ overlays["cam"]?.let { place(it) } }, 600)
  }

  private val overlays = LinkedHashMap<String, Live>()
  private var lastPortrait = false
  private var lastRot = -1

  private fun isPortrait() = resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT

  fun setOverlays(json: String) {
    val list = runCatching {
      val a = JSONArray(json)
      (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optBoolean("on", true) }.map {
        Ov(it.optString("id"), it.optString("type"), it.optDouble("x", 0.0).toFloat(), it.optDouble("y", 0.0).toFloat(),
          it.optDouble("w", 15.0).toFloat(), it.optString("src"), it.optString("shape", "bar"), it.optBoolean("sound", true),
          it.optInt("rot", 0), it.optBoolean("mirror", false))
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
    if (o.type == "cam") {
      // Görüntü motoru kutuyu her hazırladığında (ilk açılış, arka plandan dönüş) kamerayı ona bağla
      val cam = CamFilter { main.post { reopenSecondCam() } }
      return Live(o, cam, 0.5625f, null, null)
    }
    val filter = OvFilter()
    return when (o.type) {
      "logo" -> {
        val bmp = BitmapFactory.decodeResource(resources, R.drawable.pengulive_logo) ?: run { main.post { onNotice(mapOf("message" to "PenguLive logosu yüklenemedi")) }; return null }
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
        Live(o, filter, ph.toFloat() / pw, null, makeWeb(o.id, o.src, pw, ph))
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

  // Sayfa bir ses çalınca (abone / bağış uyarısı) bize haber verir; sesi yayına biz ekleriz
  inner class AudioBridge(private val id: String) {
    private fun on() = overlays[id]?.ov?.sound ?: false
    @JavascriptInterface fun url(u: String, vol: Float) { if (on()) AlertAudio.playUrl(u, vol) }
    @JavascriptInterface fun bytes(b64: String, vol: Float) { if (on()) AlertAudio.playBytes(b64, vol) }
    @JavascriptInterface fun pcm(b64: String, rate: Int, ch: Int) { if (on()) AlertAudio.playPcm(b64, rate, ch, 1f) }
  }

  private fun hookAudio(wv: WebView) = wv.evaluateJavascript(AUDIO_HOOK, null)

  @SuppressLint("SetJavaScriptEnabled")
  private fun makeWeb(id: String, url: String, pw: Int, ph: Int): WebView {
    AlertAudio.tmpDir = context.cacheDir
    val wv = WebView(context)
    wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    wv.setBackgroundColor(Color.TRANSPARENT)
    wv.settings.javaScriptEnabled = true
    wv.settings.domStorageEnabled = true
    wv.settings.mediaPlaybackRequiresUserGesture = false
    wv.settings.allowFileAccess = false
    wv.addJavascriptInterface(AudioBridge(id), "PenguAudio")
    wv.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView, u: String?, favicon: Bitmap?) { hookAudio(view) }
      override fun onPageFinished(view: WebView, u: String?) { hookAudio(view) }
    }
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
          l.frameIdx = 1 - l.frameIdx
          var bmp = l.frames[l.frameIdx]
          if (bmp == null || bmp.width != wv.width || bmp.height != wv.height) {
            bmp = Bitmap.createBitmap(wv.width, wv.height, Bitmap.Config.ARGB_8888)
            l.frames[l.frameIdx] = bmp
          }
          bmp!!.eraseColor(Color.TRANSPARENT)
          wv.draw(Canvas(bmp))
          l.bmp = bmp
          (l.filter as? ImageObjectFilterRender)?.setImage(bmp)
        }
      }
      main.postDelayed(this, 500)
    }
  }

  private fun place(l: Live) {
    // Görüntünün en / boy oranı (yan: 16:9, dik: 9:16)
    val frame = if (isPortrait()) height.toFloat() / width else width.toFloat() / height
    val w = l.ov.w.coerceIn(2f, 100f)
    if (l.ov.type == "cam") l.aspect = camAspect().takeIf { it > 0f } ?: l.aspect
    val h = (w * l.aspect * frame).coerceIn(1f, 100f)
    val x = l.ov.x.coerceIn(0f, 100f - w)
    val y = l.ov.y.coerceIn(0f, 100f - h)
    when (val f = l.filter) {
      is OvFilter -> f.place(w, h, x, y)
      is CamFilter -> f.place(w, h, x, y, camDeg(l.ov), l.ov.mirror)
    }
  }

  private fun removeOverlay(id: String) {
    val l = overlays.remove(id) ?: return
    if (l.ov.type == "cam") secondCam.close()
    runCatching { stream.getGlInterface().removeFilter(l.filter) }
    l.web?.let { root.removeView(it); it.destroy() }
  }

  // Görüntü motoru yeniden başlayınca eklenen öğeler silinir: hepsini baştan ekle
  private fun syncFilters() {
    val gl = stream.getGlInterface()
    runCatching { gl.clearFilters() }
    for (l in overlays.values) {
      l.bmp?.let { (l.filter as? ImageObjectFilterRender)?.setImage(it) }
      runCatching { gl.addFilter(l.filter) }
      place(l)
    }
  }

  fun release() {
    main.removeCallbacksAndMessages(null)
    secondCam.release()
    PenguLiveService.stop(context)
    overlays.values.forEach { l -> l.web?.let { root.removeView(it); it.destroy() } }
    overlays.clear()
    for (i in 0..1) wanted[i] = false
    runCatching { stream.release() }
  }

  companion object {
    private const val RETRIES = 100000

    // Sayfadaki sesleri yakalar: <audio>/<video> çalınınca adresini, Web Audio ile çalınınca ham sesi gönderir.
    // Sayfanın kendi sesi kısılır (yayına bizim karıştırdığımız gider).
    private val AUDIO_HOOK = """
      (function(){
        if (window.__penguA || !window.PenguAudio) return; window.__penguA = 1;
        var B = window.PenguAudio;
        function b64(u8){ var s=''; for (var i=0;i<u8.length;i+=32768) s+=String.fromCharCode.apply(null,u8.subarray(i,i+32768)); return btoa(s); }
        function send(src, vol){
          try {
            if (!src) return;
            if (/^https:/i.test(src)) B.url(src, vol);
            else if (/^(blob|data):/i.test(src)) fetch(src).then(function(r){return r.arrayBuffer();}).then(function(a){ B.bytes(b64(new Uint8Array(a)), vol); }).catch(function(){});
          } catch(e) {}
        }
        var P = HTMLMediaElement.prototype, op = P.play;
        P.play = function(){
          try {
            var vol = this.muted ? 0 : (this.volume == null ? 1 : this.volume);
            var src = this.currentSrc || this.src;
            if (!src) { var so = this.querySelector && this.querySelector('source'); src = so && so.src; }
            this.muted = true;
            if (vol > 0) send(src, vol);
          } catch(e) {}
          return op.apply(this, arguments);
        };
        if (window.AudioBufferSourceNode) {
          var S = AudioBufferSourceNode.prototype, os = S.start;
          S.start = function(){
            try {
              var b = this.buffer;
              if (b && b.length < b.sampleRate * 90) {
                var ch = Math.min(2, b.numberOfChannels), n = b.length, out = new Int16Array(n*ch);
                for (var c=0;c<ch;c++){ var d=b.getChannelData(c); for (var i=0;i<n;i++){ var v=d[i]; v=v<-1?-1:v>1?1:v; out[i*ch+c]=v*32767; } }
                B.pcm(b64(new Uint8Array(out.buffer)), b.sampleRate, ch);
              }
            } catch(e) {}
            return os.apply(this, arguments);
          };
        }
      })();
    """.trimIndent()
  }
}
