import AVFoundation
import ExpoModulesCore

// 📡 iPhone'dan yayın: Android'deki PenguLiveModule.kt ile aynı arayüz (JS tarafı ikisini aynı kullanır)
public class PenguLiveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PenguLive")

    // Kamera + mikrofon izni (Android'de PermissionsAndroid ile isteniyor)
    AsyncFunction("requestPermissions") { () async -> Bool in
      let cam = await AVCaptureDevice.requestAccess(for: .video)
      let mic = await AVCaptureDevice.requestAccess(for: .audio)
      return cam && mic
    }

    // Galeriden seçilen resmi uygulamanın kendi klasörüne kopyalar (önbellek silinse de kalsın)
    AsyncFunction("importImage") { (uri: String) throws -> String in
      let fm = FileManager.default
      let dir = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("pengu_overlays", isDirectory: true)
      try fm.createDirectory(at: dir, withIntermediateDirectories: true)
      let src = uri.hasPrefix("file://") ? URL(string: uri)! : URL(fileURLWithPath: uri)
      let out = dir.appendingPathComponent("img_\(Int(Date().timeIntervalSince1970 * 1000))")
      try fm.copyItem(at: src, to: out)
      return out.path
    }

    AsyncFunction("deleteImage") { (path: String) -> Bool in
      let fm = FileManager.default
      let dir = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("pengu_overlays", isDirectory: true)
      let url = URL(fileURLWithPath: path).standardizedFileURL
      guard url.path.hasPrefix(dir.standardizedFileURL.path + "/") else { return false }
      return (try? fm.removeItem(at: url)) != nil
    }

    View(PenguLiveView.self) {
      Events("onStatus", "onStats", "onNotice")

      // "low" | "mid" | "high"
      Prop("quality") { (view: PenguLiveView, quality: String) in
        view.setQuality(quality)
      }

      // Elle bitrate (kbps); 0 = kalite seçimindeki değer
      Prop("bitrateKbps") { (view: PenguLiveView, kbps: Int) in
        view.setBitrateKbps(kbps)
      }

      // Ekran öğeleri (JSON): [{id, type: logo|image|web|cam, on, x, y, w, src, shape, mirror}]
      Prop("overlays") { (view: PenguLiveView, json: String) in
        view.setOverlays(json)
      }

      // urls[0] = Twitch, urls[1] = Kick (boş bırakılan atlanır)
      AsyncFunction("start") { (view: PenguLiveView, urls: [String]) in
        try await view.start(urls)
      }

      AsyncFunction("stop") { (view: PenguLiveView) in
        await view.stop()
      }

      AsyncFunction("switchCamera") { (view: PenguLiveView) in
        await view.switchCamera()
      }

      AsyncFunction("setMuted") { (view: PenguLiveView, muted: Bool) in
        await view.setMuted(muted)
      }
    }
  }
}
