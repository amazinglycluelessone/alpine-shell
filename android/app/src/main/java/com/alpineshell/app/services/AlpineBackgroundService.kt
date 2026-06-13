package com.alpineshell.app.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.alpineshell.app.MainActivity
import com.alpineshell.app.R
import com.alpineshell.app.modules.AlpineSessionManager
import java.io.File

/**
 * AlpineBackgroundService
 *
 * A persistent Foreground Service that:
 *  1. Acquires a CPU WakeLock so the Alpine instance survives screen-off.
 *  2. Calls AlpineSessionManager to bootstrap the Alpine rootfs and PRoot
 *     process on first run, then keeps it alive.
 *  3. Uses START_STICKY so the OS restarts it if it is killed.
 *  4. Owns the single persistent shell process shared with the UI via
 *     the AlpineShellModule NativeModule.
 */
class AlpineBackgroundService : Service() {

    companion object {
        private const val TAG = "AlpineBackgroundService"
        const val ACTION_START_BOOT = "com.alpineshell.app.ACTION_START_BOOT"
        const val ACTION_STOP_SERVICE = "com.alpineshell.app.ACTION_STOP_SERVICE"

        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "alpine_shell_channel"
        private const val CHANNEL_NAME = "Alpine Shell"

        // Singleton process handle accessible to the NativeModule
        @Volatile
        var shellProcess: Process? = null

        @Volatile
        var isRunning: Boolean = false
    }

    private var wakeLock: PowerManager.WakeLock? = null

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Alpine Linux starting…"))
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")

        if (intent?.action == ACTION_STOP_SERVICE) {
            shutdown()
            return START_NOT_STICKY
        }

        if (!isRunning) {
            isRunning = true
            // Bootstrap + start the shell on a background thread
            Thread {
                try {
                    AlpineSessionManager.initialize(applicationContext)
                    updateNotification("Alpine Linux running")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to initialize Alpine session", e)
                    updateNotification("Alpine Linux – startup error")
                }
            }.apply {
                name = "alpine-init"
                isDaemon = false
                start()
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.w(TAG, "Service destroyed – releasing resources")
        releaseWakeLock()
        isRunning = false
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Restart ourselves immediately if the user swipes away the app card
        Log.w(TAG, "Task removed – requesting restart")
        val restartIntent = Intent(applicationContext, AlpineBackgroundService::class.java).apply {
            action = ACTION_START_BOOT
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent)
        } else {
            startService(restartIntent)
        }
        super.onTaskRemoved(rootIntent)
    }

    // ─── Notification ───────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW   // silent but persistent
            ).apply {
                description = "Keeps Alpine Linux running in the background"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val tapPending = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, AlpineBackgroundService::class.java).apply {
            action = ACTION_STOP_SERVICE
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Alpine Shell")
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_terminal)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(tapPending)
            .addAction(0, "Stop", stopPending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    // ─── WakeLock ───────────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AlpineShell::AlpineWakeLock"
        ).also {
            it.acquire(/* indefinite – released on destroy */)
        }
        Log.i(TAG, "WakeLock acquired")
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
        Log.i(TAG, "WakeLock released")
    }

    // ─── Shutdown ───────────────────────────────────────────────────────────

    private fun shutdown() {
        AlpineSessionManager.stopSession()
        releaseWakeLock()
        isRunning = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
}
