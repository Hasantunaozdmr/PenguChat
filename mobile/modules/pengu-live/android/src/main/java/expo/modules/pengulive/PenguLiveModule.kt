package expo.modules.pengulive

import android.net.Uri
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class PenguLiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PenguLive")

    // Galeriden seçilen resmi uygulamanın kendi klasörüne kopyalar (önbellek silinse de kalsın)
    AsyncFunction("importImage") { uri: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("no context")
      val dir = File(ctx.filesDir, "pengu_overlays").apply { mkdirs() }
      val out = File(dir, "img_" + System.currentTimeMillis())
      val input = if (uri.startsWith("content://")) ctx.contentResolver.openInputStream(Uri.parse(uri))
        else File(uri.removePrefix("file://")).inputStream()
      input?.use { i -> out.outputStream().use { o -> i.copyTo(o) } } ?: throw IllegalStateException("Resim açılamadı")
      out.absolutePath
    }

    AsyncFunction("deleteImage") { path: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val dir = File(ctx.filesDir, "pengu_overlays").canonicalPath
      val f = File(path)
      if (f.canonicalPath.startsWith(dir + File.separator)) f.delete() else false
    }

    View(PenguLiveView::class) {
      Events("onStatus", "onStats", "onNotice")

      // "low" | "mid" | "high" — yayın başlamadan önce ayarlanır
      Prop("quality") { view: PenguLiveView, quality: String ->
        view.setQuality(quality)
      }

      // Ekran öğeleri (JSON): [{id, type: logo|image|web, on, x, y, w, src, shape}]
      Prop("overlays") { view: PenguLiveView, json: String ->
        view.setOverlays(json)
      }

      // Elle bitrate (kbps); 0 = kalite seçimindeki değer
      Prop("bitrateKbps") { view: PenguLiveView, kbps: Int ->
        view.setBitrateKbps(kbps)
      }

      // urls[0] = Twitch, urls[1] = Kick (boş bırakılan atlanır)
      AsyncFunction("start") { view: PenguLiveView, urls: List<String> ->
        view.start(urls)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stop") { view: PenguLiveView ->
        view.stop()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("switchCamera") { view: PenguLiveView ->
        view.switchCamera()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setMuted") { view: PenguLiveView, muted: Boolean ->
        view.setMuted(muted)
      }.runOnQueue(Queues.MAIN)

      OnViewDestroys { view: PenguLiveView ->
        view.release()
      }
    }
  }
}
