package com.alpineshell.app.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.alpineshell.app.services.AlpineBackgroundService

/**
 * BootReceiver
 *
 * Listens for device boot events and immediately starts the Alpine background service
 * so the Linux environment is available before the user even opens the app.
 *
 * Registered intents:
 *   • ACTION_BOOT_COMPLETED          – normal boot (screen-unlocked)
 *   • ACTION_LOCKED_BOOT_COMPLETED   – direct-boot (CE storage not yet unlocked)
 *   • QUICKBOOT_POWERON variants     – HTC / fast-boot on some OEMs
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AlpineBootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        Log.i(TAG, "Boot event received: $action")

        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                launchAlpineService(context)
            }
            else -> Log.w(TAG, "Unhandled boot action: $action")
        }
    }

    private fun launchAlpineService(context: Context) {
        try {
            val serviceIntent = Intent(context, AlpineBackgroundService::class.java).apply {
                action = AlpineBackgroundService.ACTION_START_BOOT
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }

            Log.i(TAG, "AlpineBackgroundService started from boot")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start AlpineBackgroundService on boot", e)
        }
    }
}
