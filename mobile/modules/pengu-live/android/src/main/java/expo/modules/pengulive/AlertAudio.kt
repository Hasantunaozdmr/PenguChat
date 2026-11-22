package expo.modules.pengulive

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Base64
import com.pedro.encoder.Frame
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.input.sources.audio.AudioSource
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import java.io.File
import java.nio.ByteOrder
import java.util.concurrent.Executors

/**
 * Bağış / abone uyarılarının sesleri: donate sayfası bir ses çaldığında sesi burada çözüp
 * mikrofon sesinin üstüne karıştırırız. Böylece ses Twitch'e ve Kick'e gider.
 */
object AlertAudio {
  private class Clip(val pcm: ShortArray, var pos: Int, val vol: Float)

  private val clips = ArrayList<Clip>()
  private val cache = object : LinkedHashMap<String, ShortArray>(8, 0.75f, true) {
    override fun removeEldestEntry(e: MutableMap.MutableEntry<String, ShortArray>?) = size > 8
  }
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile var sampleRate = 44100
  @Volatile var channels = 2
  var tmpDir: File? = null

  private const val MAX_SECONDS = 90

  fun playUrl(url: String, vol: Float) {
    if (!url.startsWith("https://")) return
    worker.execute {
      val pcm = synchronized(cache) { cache[url] } ?: runCatching { decode { it.setDataSource(url, emptyMap()) } }.getOrNull()?.also { p ->
        synchronized(cache) { cache[url] = p }
      }
      pcm?.let { add(it, vol) }
    }
  }

  fun playBytes(b64: String, vol: Float) {
    worker.execute {
      val dir = tmpDir ?: return@execute
      val f = File(dir, "alert_" + System.nanoTime())
      runCatching {
        f.writeBytes(Base64.decode(b64, Base64.DEFAULT))
        decode { it.setDataSource(f.absolutePath) }?.let { add(it, vol) }
      }
      f.delete()
    }
  }

  // Sayfanın Web Audio ile çaldığı ham ses (16 bit, iç içe kanallar)
  fun playPcm(b64: String, rate: Int, ch: Int, vol: Float) {
    worker.execute {
      runCatching {
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        val sb = java.nio.ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val arr = ShortArray(sb.remaining()); sb.get(arr)
        add(convert(arr, rate, ch.coerceAtLeast(1)), vol)
      }
    }
  }

  private fun add(pcm: ShortArray, vol: Float) {
    if (pcm.isEmpty()) return
    synchronized(clips) {
      if (clips.size < 6) clips.add(Clip(pcm, 0, vol.coerceIn(0f, 1.5f)))
    }
  }

  fun clear() = synchronized(clips) { clips.clear() }

  /** Mikrofondan gelen 16 bit PCM'in üstüne çalan uyarı seslerini ekler. */
  fun mixInto(buf: ByteArray, off: Int, size: Int) {
    synchronized(clips) {
      if (clips.isEmpty()) return
      var i = off
      val end = off + size - 1
      while (i < end) {
        var s = (buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xff)
        for (c in clips) if (c.pos < c.pcm.size) s += (c.pcm[c.pos++] * c.vol).toInt()
        if (s > 32767) s = 32767 else if (s < -32768) s = -32768
        buf[i] = (s and 0xff).toByte()
        buf[i + 1] = (s shr 8).toByte()
        i += 2
      }
      clips.removeAll { it.pos >= it.pcm.size }
    }
  }

  private fun decode(setSource: (MediaExtractor) -> Unit): ShortArray? {
    val ex = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      setSource(ex)
      val track = (0 until ex.trackCount).firstOrNull {
        ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return null
      ex.selectTrack(track)
      val fmt = ex.getTrackFormat(track)
      var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var ch = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      val c = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      codec = c
      c.configure(fmt, null, null, 0)
      c.start()
      val out = ArrayList<ShortArray>()
      var total = 0
      val info = MediaCodec.BufferInfo()
      var inDone = false
      var outDone = false
      var idle = 0
      while (!outDone && idle < 500) {
        if (!inDone) {
          val i = c.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val b = c.getInputBuffer(i)!!
            val n = ex.readSampleData(b, 0)
            if (n < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inDone = true }
            else { c.queueInputBuffer(i, 0, n, ex.sampleTime, 0); ex.advance() }
          }
        }
        val o = c.dequeueOutputBuffer(info, 10_000)
        when {
          o >= 0 -> {
            idle = 0
            val b = c.getOutputBuffer(o)!!
            b.position(info.offset); b.limit(info.offset + info.size)
            val sb = b.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val arr = ShortArray(sb.remaining()); sb.get(arr)
            out.add(arr); total += arr.size
            c.releaseOutputBuffer(o, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
            if (total > rate * ch * MAX_SECONDS) outDone = true
          }
          o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            rate = c.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            ch = c.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
          else -> idle++
        }
      }
      val all = ShortArray(total)
      var p = 0
      for (a in out) { a.copyInto(all, p); p += a.size }
      return convert(all, rate, ch)
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      ex.release()
    }
  }

  // Yayının ses biçimine çevir (örnekleme hızı + kanal sayısı)
  private fun convert(src: ShortArray, rate: Int, ch: Int): ShortArray {
    val outCh = channels
    val frames = src.size / ch
    if (frames == 0 || rate <= 0) return ShortArray(0)
    val outFrames = (frames.toLong() * sampleRate / rate).toInt()
    val out = ShortArray(outFrames * outCh)
    for (i in 0 until outFrames) {
      val pos = i.toDouble() * rate / sampleRate
      val i0 = pos.toInt().coerceAtMost(frames - 1)
      val i1 = (i0 + 1).coerceAtMost(frames - 1)
      val t = pos - i0
      for (c in 0 until outCh) {
        val sc = if (c < ch) c else 0
        val v = src[i0 * ch + sc] * (1 - t) + src[i1 * ch + sc] * t
        out[i * outCh + c] = v.toInt().toShort()
      }
    }
    return out
  }
}

/** Mikrofon + uyarı sesleri. */
class MixMicSource : AudioSource(), GetMicrophoneData {
  val mic = MicrophoneSource()

  override fun create(sampleRate: Int, isStereo: Boolean, echoCanceler: Boolean, noiseSuppressor: Boolean): Boolean {
    AlertAudio.sampleRate = sampleRate
    AlertAudio.channels = if (isStereo) 2 else 1
    return mic.init(sampleRate, isStereo, echoCanceler, noiseSuppressor)
  }

  override fun start(getMicrophoneData: GetMicrophoneData) {
    this.getMicrophoneData = getMicrophoneData
    mic.start(this)
  }

  override fun stop() {
    mic.stop()
    getMicrophoneData = null
    AlertAudio.clear()
  }

  override fun isRunning(): Boolean = mic.isRunning()

  override fun release() = mic.release()

  override fun inputPCMData(frame: Frame) {
    AlertAudio.mixInto(frame.buffer, frame.offset, frame.size)
    measure(frame.buffer, frame.offset, frame.size)
    getMicrophoneData?.inputPCMData(frame)
  }

  // 🎙️ Ses dalgası: yayına giden sesin seviyesi (0 sessiz … 1 çok yüksek), 16 bit PCM
  @Volatile private var peak = 0f
  private fun measure(b: ByteArray, off: Int, size: Int) {
    var sum = 0.0
    var count = 0
    var i = off
    val end = off + size - 1
    while (i < end) {
      val v = ((b[i].toInt() and 0xff) or (b[i + 1].toInt() shl 8)).toShort() / 32768.0
      sum += v * v; count++
      i += 8 // her 4. örnek yeterli
    }
    if (count == 0) return
    val rms = Math.sqrt(sum / count)
    val db = 20 * Math.log10(Math.max(rms, 0.00001))
    val level = ((db + 55) / 50).coerceIn(0.0, 1.0).toFloat()
    if (level > peak) peak = level
  }
  fun takeLevel(): Float { val p = peak; peak = 0f; return p }

  fun mute() = mic.mute()
  fun unMute() = mic.unMute()
}
