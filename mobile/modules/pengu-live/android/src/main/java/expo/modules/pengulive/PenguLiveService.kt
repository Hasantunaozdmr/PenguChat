package expo.modules.pengulive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Yayın sürerken çalışan ön plan hizmeti. Android, arka plandaki uygulamaların kamerasını ve mikrofonunu keser;
 * bu hizmet sayesinde yayıncı başka bir uygulamaya geçse ya da ekranı kilitlese de yayın donmaz.
 * Bildirim çubuğunda "PenguLive yayında" yazar.
 */
class PenguLiveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val nm = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Canlı yayın", NotificationManager.IMPORTANCE_LOW))
      }
      val open = packageManager.getLaunchIntentForPackage(packageName)?.apply { addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP) }
      val pi = open?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
      @Suppress("DEPRECATION")
      val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
      val n = b.setSmallIcon(android.R.drawable.presence_video_online)
        .setContentTitle("PenguLive yayında")
        .setContentText("Yayın devam ediyor. Bitirmek için uygulamaya dön.")
        .setOngoing(true)
        .apply { if (pi != null) setContentIntent(pi) }
        .build()
      if (Build.VERSION.SDK_INT >= 30) {
        startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(ID, n)
      }
    } catch (e: Exception) {
      // Telefon izin vermezse yayın yine çalışır; sadece arka planda kamera durabilir
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "pengu_live"
    private const val ID = 4207

    fun start(ctx: Context) {
      runCatching { ctx.applicationContext.startService(Intent(ctx.applicationContext, PenguLiveService::class.java)) }
    }

    fun stop(ctx: Context) {
      runCatching { ctx.applicationContext.stopService(Intent(ctx.applicationContext, PenguLiveService::class.java)) }
    }
  }
}
