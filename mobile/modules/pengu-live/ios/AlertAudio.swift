import AVFoundation
import HaishinKit
import WebKit

/**
 * 🔊 Bağış / abone uyarılarının sesleri (Android'deki AlertAudio.kt'nin karşılığı).
 * Donate sayfası bir ses çaldığında sayfadaki kanca bize haber verir; sesi burada çözüp
 * yayının ses karıştırıcısına ikinci kanal olarak (mikrofonun yanına) gerçek zamanlı veririz.
 */
final class AlertAudio: NSObject, WKScriptMessageHandler {
  static let track: UInt8 = 1
  private static let rate: Double = 44_100
  private static let chunk: AVAudioFrameCount = 1024 // ~23 ms
  private let format = AVAudioFormat(standardFormatWithSampleRate: AlertAudio.rate, channels: 2)!

  private final class Clip {
    let buffer: AVAudioPCMBuffer
    var pos: AVAudioFrameCount = 0
    let volume: Float
    init(_ b: AVAudioPCMBuffer, _ v: Float) { buffer = b; volume = v }
  }

  private let queue = DispatchQueue(label: "pengu.alertaudio")
  private var clips: [Clip] = []
  private var cache: [String: AVAudioPCMBuffer] = [:]
  private var cacheOrder: [String] = []
  private var timer: DispatchSourceTimer?
  private var samplePos: AVAudioFramePosition = 0
  private weak var mixer: MediaMixer?
  /// Hangi donate bar'ın sesi açık (🔊 / 🔇)
  var soundOn: (String) -> Bool = { _ in true }

  init(mixer: MediaMixer) {
    self.mixer = mixer
    super.init()
  }

  // ---- Sayfadan gelen mesajlar ----
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let id = body["id"] as? String, soundOn(id) else { return }
    let vol = Float((body["v"] as? Double) ?? 1)
    switch body["k"] as? String {
    case "url":
      if let s = body["u"] as? String, s.hasPrefix("https://"), let u = URL(string: s) { playURL(u, vol) }
    case "bytes":
      if let b = body["b"] as? String, let d = Data(base64Encoded: b) { decodeAndPlay(d, key: nil, vol) }
    case "pcm":
      if let b = body["b"] as? String, let d = Data(base64Encoded: b),
         let r = body["r"] as? Double, let c = body["c"] as? Int { playPCM(d, rate: r, channels: c) }
    default: break
    }
  }

  private func playURL(_ url: URL, _ vol: Float) {
    let key = url.absoluteString
    if let b = queue.sync(execute: { cache[key] }) { add(b, vol); return }
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let self, let data else { return }
      self.decodeAndPlay(data, key: key, vol)
    }.resume()
  }

  private func decodeAndPlay(_ data: Data, key: String?, _ vol: Float) {
    queue.async { [weak self] in
      guard let self else { return }
      let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("alert_\(UUID().uuidString)")
      defer { try? FileManager.default.removeItem(at: tmp) }
      guard (try? data.write(to: tmp)) != nil,
            let file = try? AVAudioFile(forReading: tmp),
            file.length > 0, file.length < AVAudioFramePosition(file.processingFormat.sampleRate * 90),
            let src = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
            (try? file.read(into: src)) != nil,
            let out = self.convert(src) else { return }
      if let key {
        self.cache[key] = out
        self.cacheOrder.append(key)
        if self.cacheOrder.count > 8 { self.cache.removeValue(forKey: self.cacheOrder.removeFirst()) }
      }
      self.addLocked(out, vol)
    }
  }

  // Sayfanın Web Audio ile çaldığı ham ses (16 bit, iç içe kanallar)
  private func playPCM(_ data: Data, rate: Double, channels: Int) {
    queue.async { [weak self] in
      guard let self, channels > 0, rate > 0,
            let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: AVAudioChannelCount(channels), interleaved: true) else { return }
      let frames = AVAudioFrameCount(data.count / (2 * channels))
      guard frames > 0, let src = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return }
      src.frameLength = frames
      data.withUnsafeBytes { raw in
        if let dst = src.int16ChannelData?[0], let base = raw.baseAddress {
          memcpy(dst, base, Int(frames) * 2 * channels)
        }
      }
      if let out = self.convert(src) { self.addLocked(out, 1) }
    }
  }

  // Yayının ses biçimine çevir (44.1 kHz, stereo)
  private func convert(_ src: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let conv = AVAudioConverter(from: src.format, to: format) else { return nil }
    let cap = AVAudioFrameCount(Double(src.frameLength) * format.sampleRate / src.format.sampleRate) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return nil }
    var given = false
    var err: NSError?
    conv.convert(to: out, error: &err) { _, status in
      if given { status.pointee = .endOfStream; return nil }
      given = true
      status.pointee = .haveData
      return src
    }
    return err == nil && out.frameLength > 0 ? out : nil
  }

  private func add(_ b: AVAudioPCMBuffer, _ vol: Float) {
    queue.async { [weak self] in self?.addLocked(b, vol) }
  }

  private func addLocked(_ b: AVAudioPCMBuffer, _ vol: Float) {
    guard clips.count < 6 else { return }
    clips.append(Clip(b, min(max(vol, 0), 1.5)))
    startTimer()
  }

  // Çalan uyarıları gerçek zamanlı küçük parçalar halinde karıştırıcıya ver
  private func startTimer() {
    guard timer == nil else { return }
    let t = DispatchSource.makeTimerSource(queue: queue)
    let interval = Double(Self.chunk) / Self.rate
    t.schedule(deadline: .now(), repeating: interval, leeway: .milliseconds(2))
    t.setEventHandler { [weak self] in self?.pump() }
    timer = t
    t.resume()
  }

  private func pump() {
    guard !clips.isEmpty, let mixer, let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: Self.chunk),
          let dst = out.floatChannelData else {
      timer?.cancel(); timer = nil
      return
    }
    out.frameLength = Self.chunk
    for ch in 0..<2 { memset(dst[ch], 0, Int(Self.chunk) * MemoryLayout<Float>.size) }
    for c in clips {
      guard let src = c.buffer.floatChannelData else { continue }
      let n = min(Self.chunk, c.buffer.frameLength - c.pos)
      let srcCh = Int(c.buffer.format.channelCount)
      for ch in 0..<2 {
        let s = src[min(ch, srcCh - 1)] + Int(c.pos)
        for i in 0..<Int(n) { dst[ch][i] += s[i] * c.volume }
      }
      c.pos += n
    }
    clips.removeAll { $0.pos >= $0.buffer.frameLength }
    for ch in 0..<2 { for i in 0..<Int(Self.chunk) { dst[ch][i] = min(max(dst[ch][i], -1), 1) } }
    let when = AVAudioTime(sampleTime: samplePos, atRate: Self.rate)
    samplePos += AVAudioFramePosition(Self.chunk)
    Task { await mixer.append(out, when: when, track: Self.track) }
  }

  func clear() {
    queue.async { [weak self] in
      self?.clips.removeAll()
      self?.timer?.cancel()
      self?.timer = nil
    }
  }

  // Sayfadaki sesleri yakalar (Android'deki ile aynı mantık): <audio>/<video> çalınınca adresini,
  // Web Audio ile çalınınca ham sesi gönderir; sayfanın kendi sesi kısılır.
  static func hookScript(id: String) -> String {
    let safeId = id.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "")
    return """
    (function(){
      if (window.__penguA || !window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.penguAudio) return;
      window.__penguA = 1;
      var H = window.webkit.messageHandlers.penguAudio, ID = '\(safeId)';
      var B = {
        url: function(u, v){ H.postMessage({ id: ID, k: 'url', u: u, v: v }); },
        bytes: function(b, v){ H.postMessage({ id: ID, k: 'bytes', b: b, v: v }); },
        pcm: function(b, r, c){ H.postMessage({ id: ID, k: 'pcm', b: b, r: r, c: c }); }
      };
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
    """
  }
}
