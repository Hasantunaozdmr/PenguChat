import AVFoundation
import ExpoModulesCore
import HaishinKit
import RTMPHaishinKit
import UIKit
import WebKit

/// Kameranın bitrate'ini internete göre ayarlar (HaishinKit'in kendi algoritması) ve
/// saniyede bir gönderilen veri miktarını bildirir (ekrandaki 📶 değeri için).
final actor PenguBitRate: StreamBitRateStrategy {
  nonisolated let mamimumVideoBitRate: Int
  nonisolated let mamimumAudioBitRate: Int = 0
  private let inner: StreamVideoAdaptiveBitRateStrategy
  private let report: @Sendable (Int, Bool) -> Void

  init(max: Int, report: @Sendable @escaping (Int, Bool) -> Void) {
    mamimumVideoBitRate = max
    inner = StreamVideoAdaptiveBitRateStrategy(mamimumVideoBitrate: max)
    self.report = report
  }

  func adjustBitrate(_ event: NetworkMonitorEvent, stream: some StreamConvertible) async {
    switch event {
    case .status(let r): report(r.currentBytesOutPerSecond * 8, false)
    case .publishInsufficientBWOccured(let r): report(r.currentBytesOutPerSecond * 8, true)
    case .reset: break
    }
    await inner.adjustBitrate(event, stream: stream)
  }
}

/**
 * 📡 iPhone'dan yayın (Android'deki PenguLiveView.kt'nin karşılığı).
 * - Kamera görüntüsü aynı anda iki yere (0 = Twitch, 1 = Kick) gider; her biri kendi bitrate'ini internete göre ayarlar.
 * - Bağlantı koparsa yayıncı "Bitir"e basana kadar tekrar tekrar bağlanmayı dener.
 * - Logo, resim, donate bar ve ikinci kamera görüntünün üstüne eklenir (HaishinKit ScreenObject).
 * - Şarj azalınca / telefon ısınınca kare hızı sabitlenir (takılma ve ses kayması olmasın).
 */
final class PenguLiveView: ExpoView {
  let onStatus = EventDispatcher()
  let onStats = EventDispatcher()
  let onNotice = EventDispatcher()

  private static var factoryReady = false
  private let names = ["twitch", "kick"]
  private let multiCam = AVCaptureMultiCamSession.isMultiCamSupported

  private lazy var mixer = MediaMixer(captureSessionMode: multiCam ? .multi : .single)
  private let preview = MTHKView(frame: .zero)

  private var sessions: [(any Session)?] = [nil, nil]
  private var wanted = [false, false]
  private var urls = ["", ""]
  private var live = [false, false]
  private var sentBits = [0, 0]
  private var congested = [false, false]
  private var currentBitrate = [0, 0]

  private var running = false
  private var quality = "mid"
  private var presetBitrate = 3_000_000
  private var customBitrate = 0
  private var videoBitrate: Int { customBitrate > 0 ? customBitrate : presetBitrate }
  private var mainFront = false
  private var muted = false
  private var portrait = true
  private var fps: Float64 = 30
  private var ecoLevel = -1
  private var power: [String: Any] = [:]
  private var lowMode = false
  private var lowSince: Date?
  private var okSince: Date?
  private var statsTimer: Timer?
  private var webTimer: Timer?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    preview.videoGravity = .resizeAspect
    addSubview(preview)
    UIDevice.current.isBatteryMonitoringEnabled = true
    NotificationCenter.default.addObserver(self, selector: #selector(orientationChanged), name: UIDevice.orientationDidChangeNotification, object: nil)
  }

  deinit {
    statsTimer?.invalidate()
    webTimer?.invalidate()
    NotificationCenter.default.removeObserver(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
  }

  // Ekran açılınca kamerayı başlat, kapanınca her şeyi durdur
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      if !running { Task { await setUp() } }
    } else {
      Task { await tearDown() }
    }
  }

  private func dims() -> (Int, Int) {
    let (w, h): (Int, Int) = quality == "low" ? (854, 480) : quality == "high" ? (1920, 1080) : (1280, 720)
    return portrait ? (h, w) : (w, h)
  }

  private func emit(_ i: Int, _ state: String, _ message: String = "") {
    onStatus(["platform": names[i], "state": state, "message": message, "lowMode": lowMode])
  }

  private func notice(_ msg: String) {
    onNotice(["message": msg])
  }

  // ---- Kurulum ----
  private func setUp() async {
    guard !running else { return }
    running = true
    if !Self.factoryReady {
      Self.factoryReady = true
      await SessionBuilderFactory.shared.register(RTMPSessionFactory())
    }
    let audio = AVAudioSession.sharedInstance()
    try? audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetooth])
    try? audio.setActive(true)

    var vs = await mixer.videoMixerSettings
    vs.mode = .offscreen // logo / resim / ikinci kamera için ekran birleştirme
    await mixer.setVideoMixerSettings(vs)
    portrait = currentPortrait()
    await applyOrientation()
    await attachCameras()
    try? await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
    await mixer.startRunning()
    await mixer.addOutput(preview)
    await applyOverlays()

    statsTimer?.invalidate()
    statsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.tick() }
    }
  }

  private func tearDown() async {
    guard running else { return }
    running = false
    statsTimer?.invalidate(); statsTimer = nil
    webTimer?.invalidate(); webTimer = nil
    await stop()
    await mixer.removeOutput(preview)
    await mixer.stopRunning()
    try? await mixer.attachAudio(nil)
    try? await mixer.attachVideo(nil, track: 0)
    try? await mixer.attachVideo(nil, track: 1)
    for (_, o) in overlays { o.web?.removeFromSuperview() }
  }

  private func camera(_ front: Bool) -> AVCaptureDevice? {
    AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: front ? .front : .back)
  }

  // Ana kamera: track 0 = arka, track 1 = ön. İkinci kamera açıksa ikisi birden bağlanır.
  private func attachCameras() async {
    let dual = overlays["cam"] != nil
    if multiCam {
      let needBack = !mainFront || dual
      let needFront = mainFront || dual
      try? await mixer.attachVideo(needBack ? camera(false) : nil, track: 0) { unit in unit.isVideoMirrored = false }
      let mirror = overlays["cam"]?.mirror ?? false
      // ⇋ Ayna: yayıncının ayarı (varsayılan: izleyiciler gerçek görüntüyü görür)
      try? await mixer.attachVideo(needFront ? camera(true) : nil, track: 1) { unit in unit.isVideoMirrored = mirror }
      var vs = await mixer.videoMixerSettings
      vs.mainTrack = mainFront ? 1 : 0
      await mixer.setVideoMixerSettings(vs)
    } else {
      // Tek kamera destekleyen telefonlarda kamerayı değiştir
      try? await mixer.attachVideo(camera(mainFront), track: 0) { unit in unit.isVideoMirrored = false }
    }
    if let cam = overlays["cam"] { await placeCam(cam) }
    try? await mixer.setFrameRate(fps)
  }

  // ---- Telefon yönü ----
  private func currentPortrait() -> Bool {
    let o = window?.windowScene?.interfaceOrientation ?? .portrait
    return o == .portrait || o == .portraitUpsideDown
  }

  @objc private func orientationChanged() {
    let p = currentPortrait()
    guard running, p != portrait else {
      if running { Task { await applyOrientation() } }
      return
    }
    portrait = p
    Task {
      await applyOrientation()
      await applyOverlays()
    }
  }

  private func applyOrientation() async {
    let o = window?.windowScene?.interfaceOrientation ?? .portrait
    let vo: AVCaptureVideoOrientation = {
      switch o {
      case .landscapeLeft: return .landscapeLeft
      case .landscapeRight: return .landscapeRight
      case .portraitUpsideDown: return .portraitUpsideDown
      default: return .portrait
      }
    }()
    await mixer.setVideoOrientation(vo)
    let (w, h) = dims()
    await setScreenSize(CGSize(width: w, height: h))
    for i in 0..<2 {
      guard let s = sessions[i] else { continue }
      let st = await s.stream
      var v = await st.videoSettings
      v.videoSize = CGSize(width: w, height: h)
      try? await st.setVideoSettings(v)
    }
  }

  @ScreenActor
  private func setScreenSize(_ size: CGSize) async {
    await mixer.screen.size = size
    await mixer.screen.backgroundColor = UIColor.black.cgColor
  }

  // ---- Kalite / bitrate ----
  func setQuality(_ q: String) {
    let changed = q != quality
    quality = q
    presetBitrate = q == "low" ? 1_500_000 : q == "high" ? 6_000_000 : 3_000_000
    if changed, running { Task { await applyOrientation(); await applyOverlays() } }
    Task { await applyBitrate() }
  }

  func setBitrateKbps(_ kbps: Int) {
    customBitrate = (300...20000).contains(kbps) ? kbps * 1000 : 0
    Task { await applyBitrate() }
  }

  private func applyBitrate() async {
    for i in 0..<2 {
      guard let s = sessions[i] else { continue }
      let st = await s.stream
      var v = await st.videoSettings
      v.bitRate = videoBitrate
      try? await st.setVideoSettings(v)
      await st.setBitRateStrategy(makeStrategy(i))
    }
  }

  private func makeStrategy(_ i: Int) -> PenguBitRate {
    let cap = ecoLevel >= 1 ? min(videoBitrate, 2_500_000) : videoBitrate
    return PenguBitRate(max: cap) { [weak self] bits, insufficient in
      Task { @MainActor in
        self?.sentBits[i] = bits
        self?.congested[i] = insufficient
      }
    }
  }

  // ---- Yayın ----
  func start(_ list: [String]) async throws {
    if !running { await setUp() }
    let (w, h) = dims()
    for i in 0..<2 {
      let url = i < list.count ? list[i].trimmingCharacters(in: .whitespaces) : ""
      if url.isEmpty || wanted[i] { continue }
      guard let u = URL(string: url) else { emit(i, "error", "Adres hatalı"); continue }
      guard let s = try await SessionBuilderFactory.shared.make(u).setMode(.publish).build() else {
        emit(i, "error", "Bağlantı kurulamadı"); continue
      }
      sessions[i] = s
      wanted[i] = true
      urls[i] = url
      let st = await s.stream
      var v = await st.videoSettings
      v.videoSize = CGSize(width: w, height: h)
      v.bitRate = videoBitrate
      v.maxKeyFrameIntervalDuration = 2
      try? await st.setVideoSettings(v)
      var a = await st.audioSettings
      a.bitRate = 128_000
      try? await st.setAudioSettings(a)
      await st.setBitRateStrategy(makeStrategy(i))
      await mixer.addOutput(st)
      watchState(i, s)
      connect(i)
    }
    if wanted[0] || wanted[1] { UIApplication.shared.isIdleTimerDisabled = true }
  }

  private func watchState(_ i: Int, _ s: any Session) {
    Task { [weak self] in
      for await state in await s.readyState {
        await MainActor.run {
          guard let self, self.sessions[i] != nil else { return }
          switch state {
          case .connecting: self.emit(i, self.live[i] ? "reconnecting" : "connecting")
          case .open: self.live[i] = true; self.emit(i, "live")
          case .closing, .closed: self.live[i] = false
          }
        }
      }
    }
  }

  // Bağlan; koparsa ya da bağlanamazsa yayıncı bitirene kadar 3 sn'de bir tekrar dene
  private func connect(_ i: Int) {
    guard wanted[i], let s = sessions[i] else { return }
    Task { [weak self] in
      do {
        try await s.connect {
          Task { @MainActor [weak self] in
            guard let self, self.wanted[i] else { return }
            self.live[i] = false
            self.emit(i, "reconnecting", "Bağlantı koptu")
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.connect(i) }
          }
        }
      } catch {
        await MainActor.run {
          guard let self, self.wanted[i] else { return }
          let msg = String(describing: error)
          if msg.lowercased().contains("badname") || msg.lowercased().contains("unpublish") || msg.lowercased().contains("rejected") {
            self.emit(i, "error", "Yayın anahtarı kabul edilmedi")
          } else {
            self.emit(i, "reconnecting", "Bağlanılamadı, tekrar deneniyor")
          }
          DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.connect(i) }
        }
      }
    }
  }

  func stop() async {
    for i in 0..<2 {
      guard let s = sessions[i] else { continue }
      wanted[i] = false
      sessions[i] = nil
      live[i] = false
      sentBits[i] = 0
      try? await s.close()
      await mixer.removeOutput(await s.stream)
      emit(i, "idle")
    }
    if lowMode { await setLowMode(false) }
    UIApplication.shared.isIdleTimerDisabled = false
  }

  func switchCamera() async {
    mainFront.toggle()
    await attachCameras()
  }

  func setMuted(_ m: Bool) async {
    muted = m
    var s = await mixer.audioMixerSettings
    var t = s.tracks[0] ?? .init()
    t.isMuted = m
    s.tracks[0] = t
    await mixer.setAudioMixerSettings(s)
  }

  // ---- Saniyelik kontrol: istatistik, şarj / ısı, düşük bitrate ----
  private var tickCount = 0
  private func tick() {
    tickCount += 1
    if tickCount % 5 == 1 { checkPower() }
    checkLowBitrate()
    var cur = 0
    for i in 0..<2 where wanted[i] && live[i] { cur = cur == 0 ? sentBits[i] : min(cur, sentBits[i]) }
    onStats([
      "twitch": Double(live[0] ? sentBits[0] : 0),
      "kick": Double(live[1] ? sentBits[1] : 0),
      "target": Double(videoBitrate),
      "current": Double(cur > 0 ? cur : videoBitrate),
      "lowMode": lowMode,
      "camAspect": Double(overlays["cam"] != nil ? camAspect() : 0),
      "power": power,
    ])
  }

  private func checkPower() {
    let dev = UIDevice.current
    let pct = dev.batteryLevel >= 0 ? Int(dev.batteryLevel * 100) : -1
    let charging = dev.batteryState == .charging || dev.batteryState == .full
    let save = ProcessInfo.processInfo.isLowPowerModeEnabled
    let thermal: Int = {
      switch ProcessInfo.processInfo.thermalState {
      case .nominal: return 0
      case .fair: return 1
      case .serious: return 2
      case .critical: return 3
      @unknown default: return 0
      }
    }()
    let level = thermal >= 3 ? 2 : (thermal >= 2 || save || (pct >= 0 && pct <= 15 && !charging)) ? 1 : 0
    if level != ecoLevel {
      ecoLevel = level
      fps = level == 2 ? 20 : level == 1 ? 24 : 30
      Task {
        try? await mixer.setFrameRate(fps)
        await applyBitrate()
        if level == 2, overlays["cam"] != nil {
          await removeOverlay("cam")
          await attachCameras()
          notice("Telefon çok ısındı: ikinci kamera kapatıldı (yayın takılmasın diye)")
        }
      }
    }
    power = ["battery": Double(pct), "charging": charging, "save": save, "thermal": Double(thermal), "eco": Double(level)]
  }

  // İnternet en düşük bitrate'e bile yetmiyorsa "Bitrate düşük, lütfen bekleyiniz" görüntüsü
  private func checkLowBitrate() {
    let active = (0..<2).filter { wanted[$0] && live[$0] }
    guard !active.isEmpty else { return }
    let floor = max(400_000, videoBitrate / 10)
    let worst = active.map { sentBits[$0] }.min() ?? 0
    let bad = active.contains { congested[$0] } && worst > 0 && worst < floor
    let now = Date()
    if !lowMode {
      if bad { if lowSince == nil { lowSince = now }; if now.timeIntervalSince(lowSince!) > 8 { Task { await setLowMode(true) } } }
      else { lowSince = nil }
    } else {
      if !active.contains(where: { congested[$0] }) { if okSince == nil { okSince = now }; if now.timeIntervalSince(okSince!) > 8 { Task { await setLowMode(false) } } }
      else { okSince = nil }
    }
  }

  private var waiting: ImageScreenObject?
  private func setLowMode(_ on: Bool) async {
    guard on != lowMode else { return }
    lowMode = on
    lowSince = nil; okSince = nil
    let (w, h) = dims()
    let img = on ? waitingImage(w, h) : nil
    await setWaiting(img, CGSize(width: w, height: h))
    for i in 0..<2 where wanted[i] { emit(i, live[i] ? "live" : "reconnecting") }
  }

  @ScreenActor
  private func setWaiting(_ img: CGImage?, _ size: CGSize) async {
    if let old = await waiting { try? await mixer.screen.removeChild(old) }
    guard let img else { await MainActor.run { self.waiting = nil }; return }
    let o = ImageScreenObject()
    o.cgImage = img
    o.size = size
    try? await mixer.screen.addChild(o)
    await MainActor.run { self.waiting = o }
  }

  private func waitingImage(_ w: Int, _ h: Int) -> CGImage? {
    let r = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
    let img = r.image { ctx in
      UIColor(red: 17 / 255, green: 24 / 255, blue: 39 / 255, alpha: 1).setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
      let p = NSMutableParagraphStyle(); p.alignment = .center
      let big: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: CGFloat(h) / 9), .foregroundColor: UIColor.white, .paragraphStyle: p]
      let small: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: CGFloat(h) / 16), .foregroundColor: UIColor(white: 0.8, alpha: 1), .paragraphStyle: p]
      ("Bitrate düşük" as NSString).draw(in: CGRect(x: 0, y: CGFloat(h) / 2 - CGFloat(h) / 6, width: CGFloat(w), height: CGFloat(h) / 6), withAttributes: big)
      ("Lütfen bekleyiniz…" as NSString).draw(in: CGRect(x: 0, y: CGFloat(h) / 2 + CGFloat(h) / 30, width: CGFloat(w), height: CGFloat(h) / 10), withAttributes: small)
    }
    return img.cgImage
  }

  // ---- Ekran öğeleri (logo, resim, donate bar, ikinci kamera) ----
  final class Overlay {
    let id: String
    var type: String
    var x: Double, y: Double, w: Double
    var src: String, shape: String
    var mirror: Bool
    var aspect: Double = 1
    var image: ImageScreenObject?
    var cam: VideoTrackScreenObject?
    var web: WKWebView?
    init(id: String, type: String, x: Double, y: Double, w: Double, src: String, shape: String, mirror: Bool) {
      self.id = id; self.type = type; self.x = x; self.y = y; self.w = w; self.src = src; self.shape = shape; self.mirror = mirror
    }
  }

  private var overlays: [String: Overlay] = [:]
  private var overlayJson = "[]"

  func setOverlays(_ json: String) {
    overlayJson = json
    guard running else { return }
    Task { await applyOverlays() }
  }

  private func applyOverlays() async {
    guard let data = overlayJson.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    let list = arr.filter { ($0["on"] as? Bool) ?? true }
    let ids = Set(list.compactMap { $0["id"] as? String })
    for id in overlays.keys where !ids.contains(id) { await removeOverlay(id) }
    var camChanged = false
    for o in list {
      guard let id = o["id"] as? String, let type = o["type"] as? String else { continue }
      let src = o["src"] as? String ?? "", shape = o["shape"] as? String ?? "bar"
      let mirror = o["mirror"] as? Bool ?? false
      var ov = overlays[id]
      if let cur = ov, cur.type != type || cur.src != src || cur.shape != shape { await removeOverlay(id); ov = nil }
      if ov == nil {
        let n = Overlay(id: id, type: type, x: 0, y: 0, w: 15, src: src, shape: shape, mirror: mirror)
        guard await create(n) else { continue }
        overlays[id] = n
        ov = n
        if type == "cam" { camChanged = true }
      }
      guard let ov else { continue }
      if ov.type == "cam" && ov.mirror != mirror { camChanged = true }
      ov.x = o["x"] as? Double ?? 0
      ov.y = o["y"] as? Double ?? 0
      ov.w = o["w"] as? Double ?? 15
      ov.mirror = mirror
      await place(ov)
    }
    if camChanged { await attachCameras() }
    let hasWeb = overlays.values.contains { $0.web != nil }
    webTimer?.invalidate(); webTimer = nil
    if hasWeb {
      webTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
        Task { @MainActor in self?.snapWeb() }
      }
    }
  }

  private func create(_ o: Overlay) async -> Bool {
    switch o.type {
    case "logo":
      let bundle = Bundle(for: PenguLiveView.self).url(forResource: "PenguLiveAssets", withExtension: "bundle").flatMap { Bundle(url: $0) }
      guard let path = bundle?.path(forResource: "pengulive_logo", ofType: "png"),
            let img = UIImage(contentsOfFile: path)?.cgImage else { return false }
      o.aspect = Double(img.height) / Double(img.width)
      o.image = await makeImageObject(img)
      return o.image != nil
    case "image":
      guard let ui = UIImage(contentsOfFile: o.src), let img = downscale(ui) else { return false }
      o.aspect = Double(img.height) / Double(img.width)
      o.image = await makeImageObject(img)
      return o.image != nil
    case "web":
      guard o.src.hasPrefix("https://"), let u = URL(string: o.src) else { return false }
      let (pw, ph) = o.shape == "box" ? (800, 600) : (1200, 300)
      o.aspect = Double(ph) / Double(pw)
      let cfg = WKWebViewConfiguration()
      cfg.allowsInlineMediaPlayback = true
      cfg.mediaTypesRequiringUserActionForPlayback = []
      let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: pw, height: ph), configuration: cfg)
      wv.isOpaque = false
      wv.backgroundColor = .clear
      wv.scrollView.backgroundColor = .clear
      wv.isUserInteractionEnabled = false
      wv.alpha = 0.01 // ekranda görünmez; sadece yayına çizilir
      insertSubview(wv, at: 0)
      wv.load(URLRequest(url: u))
      o.web = wv
      o.image = await makeImageObject(nil)
      return true
    case "cam":
      guard multiCam else {
        notice("Bu iPhone ön ve arka kamerayı aynı anda açamıyor (dual cam iPhone XS ve sonrasında var)")
        return false
      }
      o.aspect = 9.0 / 16.0
      o.cam = await makeCamObject()
      return true
    default:
      return false
    }
  }

  private func downscale(_ ui: UIImage) -> CGImage? {
    let maxSide: CGFloat = 1280
    let s = ui.size
    let k = min(1, maxSide / max(s.width, s.height))
    if k >= 1 { return ui.cgImage }
    let size = CGSize(width: s.width * k, height: s.height * k)
    let f = UIGraphicsImageRendererFormat(); f.scale = 1
    return UIGraphicsImageRenderer(size: size, format: f).image { _ in ui.draw(in: CGRect(origin: .zero, size: size)) }.cgImage
  }

  @ScreenActor
  private func makeImageObject(_ img: CGImage?) async -> ImageScreenObject? {
    let o = ImageScreenObject()
    o.cgImage = img
    o.horizontalAlignment = .left
    o.verticalAlignment = .top
    try? await mixer.screen.addChild(o)
    return o
  }

  @ScreenActor
  private func makeCamObject() async -> VideoTrackScreenObject {
    let o = VideoTrackScreenObject()
    o.cornerRadius = 12
    o.videoGravity = .resizeAspectFill
    o.horizontalAlignment = .left
    o.verticalAlignment = .top
    try? await mixer.screen.addChild(o)
    return o
  }

  private func removeOverlay(_ id: String) async {
    guard let o = overlays.removeValue(forKey: id) else { return }
    o.web?.stopLoading()
    o.web?.removeFromSuperview()
    await removeObjects(o.image, o.cam)
  }

  @ScreenActor
  private func removeObjects(_ a: ImageScreenObject?, _ b: VideoTrackScreenObject?) async {
    if let a { try? await mixer.screen.removeChild(a) }
    if let b { try? await mixer.screen.removeChild(b) }
  }

  // İkinci kameranın görüntüsü ekranın yönüyle aynı oranda gelir
  private func camAspect() -> Double {
    let (w, h) = dims()
    return Double(h) / Double(w)
  }

  private func place(_ o: Overlay) async {
    let (sw, sh) = dims()
    if o.type == "cam" { o.aspect = camAspect() }
    let wPct = min(max(o.w, 2), 100)
    let width = Double(sw) * wPct / 100
    let height = min(width * o.aspect, Double(sh))
    let hPct = height / Double(sh) * 100
    let x = Double(sw) * min(max(o.x, 0), 100 - wPct) / 100
    let y = Double(sh) * min(max(o.y, 0), 100 - hPct) / 100
    await layoutObject(o.image, o.cam, CGSize(width: width, height: height), UIEdgeInsets(top: y, left: x, bottom: 0, right: 0))
  }

  private func placeCam(_ o: Overlay) async {
    await setCamTrack(o.cam, mainFront ? 0 : 1)
    await place(o)
  }

  @ScreenActor
  private func setCamTrack(_ cam: VideoTrackScreenObject?, _ track: UInt8) async {
    cam?.track = track
  }

  @ScreenActor
  private func layoutObject(_ img: ImageScreenObject?, _ cam: VideoTrackScreenObject?, _ size: CGSize, _ margin: UIEdgeInsets) async {
    for obj in [img as ScreenObject?, cam as ScreenObject?] {
      guard let obj else { continue }
      obj.size = size
      obj.layoutMargin = margin
      obj.invalidateLayout()
    }
  }

  // Donate sayfalarının görüntüsünü saniyede 2 kez yayına aktar
  private func snapWeb() {
    for o in overlays.values {
      guard let wv = o.web, let obj = o.image else { continue }
      let cfg = WKSnapshotConfiguration()
      cfg.afterScreenUpdates = false
      wv.takeSnapshot(with: cfg) { img, _ in
        guard let cg = img?.cgImage else { return }
        Task { @ScreenActor in obj.cgImage = cg }
      }
    }
  }
}
