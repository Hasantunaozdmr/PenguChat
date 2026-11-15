package expo.modules.pengulive

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PenguLiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PenguLive")

    View(PenguLiveView::class) {
      Events("onStatus", "onStats")

      // "low" | "mid" | "high" — yayın başlamadan önce ayarlanır
      Prop("quality") { view: PenguLiveView, quality: String ->
        view.setQuality(quality)
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
