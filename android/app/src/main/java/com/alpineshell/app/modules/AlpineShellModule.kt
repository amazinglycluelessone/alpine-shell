package com.alpineshell.app.modules

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.alpineshell.app.services.AlpineBackgroundService

/**
 * AlpineShellModule
 *
 * React Native NativeModule that exposes the Alpine/PRoot shell to JavaScript.
 *
 * Exposed methods (callable from JS via NativeModules.AlpineShell.*):
 *
 *   startAlpineSession()           – Boot service + shell, no return value
 *   stopAlpineSession()            – Stop shell + service
 *   sendShellCommand(cmd: String)  – Write a line to the shell's stdin
 *   isSessionRunning()             – Promise<boolean>
 *   isIgnoringBatteryOptimizations() – Promise<boolean>
 *   requestIgnoreBatteryOptimizations() – Opens system settings intent
 *
 * Events emitted to JS via RCTDeviceEventEmitter:
 *   "AlpineShellOutput" – { data: string }
 */
class AlpineShellModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "AlpineShellModule"
        const val EVENT_SHELL_OUTPUT = "AlpineShellOutput"
        const val MODULE_NAME = "AlpineShell"
    }

    init {
        // Wire the session manager's output callback to emit RN events
        AlpineSessionManager.outputCallback = { data ->
            sendOutputEvent(data)
        }
    }

    override fun getName(): String = MODULE_NAME

    // ─── Session Control ────────────────────────────────────────────────────

    @ReactMethod
    fun startAlpineSession() {
        Log.i(TAG, "startAlpineSession called from JS")
        val serviceIntent = Intent(reactContext, AlpineBackgroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(serviceIntent)
        } else {
            reactContext.startService(serviceIntent)
        }
    }

    @ReactMethod
    fun stopAlpineSession() {
        Log.i(TAG, "stopAlpineSession called from JS")
        AlpineSessionManager.stopSession()
        reactContext.stopService(Intent(reactContext, AlpineBackgroundService::class.java))
    }

    @ReactMethod
    fun sendShellCommand(command: String) {
        AlpineSessionManager.sendCommand(command)
    }

    @ReactMethod
    fun isSessionRunning(promise: Promise) {
        promise.resolve(AlpineSessionManager.isSessionAlive())
    }

    // ─── Battery Optimisations ──────────────────────────────────────────────

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val ignoring = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pm.isIgnoringBatteryOptimizations(reactContext.packageName)
        } else {
            true   // pre-M: no battery optimisation concept
        }
        promise.resolve(ignoring)
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${reactContext.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
        }
    }

    // Fallback: open the battery optimisation screen in settings
    @ReactMethod
    fun openBatteryOptimizationSettings() {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
    }

    // ─── Device Info ────────────────────────────────────────────────────────

    @ReactMethod
    fun getDeviceAbi(promise: Promise) {
        val abi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        } else {
            @Suppress("DEPRECATION") Build.CPU_ABI
        }
        promise.resolve(abi)
    }

    @ReactMethod
    fun getRootfsSizeBytes(promise: Promise) {
        val rootfsDir = java.io.File(reactContext.filesDir, "alpine-rootfs")
        promise.resolve(rootfsDir.walkBottomUp().sumOf { it.length().toDouble() })
    }

    // ─── Required listener registration boilerplate ──────────────────────────

    @ReactMethod
    fun addListener(eventName: String) { /* required by RN */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* required by RN */ }

    // ─── Private helpers ────────────────────────────────────────────────────

    private fun sendOutputEvent(data: String) {
        if (reactContext.hasActiveCatalystInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_SHELL_OUTPUT, data)
        }
    }
}
