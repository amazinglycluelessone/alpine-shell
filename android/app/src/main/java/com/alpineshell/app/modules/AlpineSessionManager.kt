package com.alpineshell.app.modules

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * AlpineSessionManager
 *
 * Responsible for:
 *  1. Detecting and extracting the Alpine miniRootfs tarball on first launch.
 *  2. Copying the pre-bundled PRoot binary from assets to internal storage and
 *     chmod-ing it executable.
 *  3. Starting and restarting the PRoot + /bin/sh process.
 *  4. Providing a thread-safe API for writing commands and reading output.
 *
 * DIRECTORY LAYOUT (inside app-private storage):
 *   <filesDir>/
 *     proot             – proot binary (extracted from assets/proot-<abi>)
 *     alpine-rootfs/    – Alpine miniRootfs (xz-tarball extracted here)
 *       bin/, etc/, lib/, usr/, var/, …
 *     alpine-rootfs/tmp/
 *     alpine-rootfs/proc/  (bind-mounted by PRoot at runtime)
 *     alpine-rootfs/dev/   (bind-mounted by PRoot at runtime)
 *     alpine-rootfs/sys/   (bind-mounted by PRoot at runtime)
 *
 * PROOT FLAGS USED:
 *   -r <rootfs>    – chroot-like root
 *   -0             – fake root (uid=0) – needed by apk etc.
 *   -b /proc       – bind /proc
 *   -b /dev        – bind /dev
 *   -b /sys        – bind /sys
 *   /bin/sh        – initial process
 */
object AlpineSessionManager {

    private const val TAG = "AlpineSessionManager"

    // Alpine miniRootfs download URL (ARM64 – falls back to x86_64 for emulators)
    private const val ALPINE_VERSION = "3.19.1"
    private const val ALPINE_BASE_URL =
        "https://dl-cdn.alpinelinux.org/alpine/v3.19/releases"
    private const val ROOTFS_DIR_NAME = "alpine-rootfs"
    private const val PROOT_BINARY_NAME = "proot"
    private const val BOOTSTRAP_STAMP = ".bootstrapped"

    // ── Shell I/O ──────────────────────────────────────────────────────────
    @Volatile private var shellProcess: Process? = null
    @Volatile private var outputReader: BufferedReader? = null
    @Volatile private var errorReader: BufferedReader? = null
    @Volatile private var inputWriter: BufferedWriter? = null
    @Volatile private var outputListenerThread: Thread? = null
    @Volatile private var errorListenerThread: Thread? = null

    // Registered callback (set by the NativeModule)
    var outputCallback: ((String) -> Unit)? = null

    // ─── Public API ─────────────────────────────────────────────────────────

    fun initialize(context: Context) {
        val filesDir = context.filesDir
        val rootfsDir = File(filesDir, ROOTFS_DIR_NAME)
        val stampFile = File(rootfsDir, BOOTSTRAP_STAMP)
        val prootBinary = File(filesDir, PROOT_BINARY_NAME)

        // 1. Extract PRoot binary if not already present
        ensureProotBinary(context, prootBinary)

        // 2. Bootstrap Alpine rootfs on first launch
        if (!stampFile.exists()) {
            emitOutput("\r\n\u001B[1;33m[Alpine Shell]\u001B[0m Bootstrapping Alpine Linux ${ALPINE_VERSION}…\r\n")
            bootstrapAlpine(context, rootfsDir, stampFile)
        }

        // 3. Start the interactive shell
        startShell(prootBinary, rootfsDir)
    }

    fun sendCommand(command: String) {
        try {
            inputWriter?.let {
                it.write(command)
                if (!command.endsWith("\n")) it.newLine()
                it.flush()
            } ?: Log.w(TAG, "sendCommand called but inputWriter is null")
        } catch (e: IOException) {
            Log.e(TAG, "sendCommand I/O error", e)
            emitOutput("\r\n\u001B[1;31m[error]\u001B[0m Shell write failed: ${e.message}\r\n")
        }
    }

    fun stopSession() {
        try {
            inputWriter?.close()
            outputReader?.close()
            errorReader?.close()
            shellProcess?.destroy()
            outputListenerThread?.interrupt()
            errorListenerThread?.interrupt()
        } catch (e: Exception) {
            Log.e(TAG, "stopSession error", e)
        } finally {
            shellProcess = null
            inputWriter = null
            outputReader = null
            errorReader = null
        }
    }

    fun isSessionAlive(): Boolean = shellProcess?.let {
        try { it.exitValue(); false } catch (e: IllegalThreadStateException) { true }
    } ?: false

    // ─── PRoot Binary ────────────────────────────────────────────────────────

    private fun ensureProotBinary(context: Context, dest: File) {
        if (dest.exists() && dest.canExecute()) {
            Log.i(TAG, "PRoot binary already present: ${dest.absolutePath}")
            return
        }

        val abi = getPrimaryAbi()
        val assetName = "proot-$abi"   // e.g. proot-arm64-v8a

        Log.i(TAG, "Extracting PRoot binary for ABI $abi from assets/$assetName")

        try {
            context.assets.open(assetName).use { input ->
                dest.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            dest.setExecutable(true, false)
            Log.i(TAG, "PRoot binary installed: ${dest.absolutePath}")
        } catch (e: FileNotFoundException) {
            // Asset not bundled — this is expected in the source-only distribution.
            // The CI/CD script fetches proot at build time.
            Log.w(TAG, "PRoot asset '$assetName' not found in APK — was it added by the build script?")
            emitOutput("\r\n\u001B[1;31m[error]\u001B[0m PRoot binary missing. Please rebuild the APK with fetch_proot.sh.\r\n")
            throw RuntimeException("PRoot binary not bundled. Run fetch_proot.sh before building.")
        }
    }

    private fun getPrimaryAbi(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Build.SUPPORTED_ABIS.firstOrNull { it in listOf("arm64-v8a", "x86_64") }
                ?: "arm64-v8a"
        } else {
            @Suppress("DEPRECATION")
            if (Build.CPU_ABI == "x86_64") "x86_64" else "arm64-v8a"
        }
    }

    // ─── Rootfs Bootstrap ───────────────────────────────────────────────────

    private fun bootstrapAlpine(context: Context, rootfsDir: File, stamp: File) {
        rootfsDir.mkdirs()

        // Try bundled tarball first (assets/alpine-minirootfs.tar.gz)
        val bundledTar = File(context.cacheDir, "alpine-minirootfs.tar.gz")
        var useBundled = false

        try {
            context.assets.open("alpine-minirootfs.tar.gz").use { input ->
                bundledTar.outputStream().use { output -> input.copyTo(output) }
            }
            useBundled = true
            emitOutput("[alpine] Using bundled rootfs tarball.\r\n")
        } catch (e: FileNotFoundException) {
            emitOutput("[alpine] No bundled rootfs found — downloading from Alpine CDN…\r\n")
        }

        if (!useBundled) {
            downloadAlpineRootfs(bundledTar)
        }

        // Extract the tarball using the system 'tar' tool (available on all Android)
        emitOutput("[alpine] Extracting rootfs to ${rootfsDir.absolutePath}…\r\n")
        extractTarball(bundledTar, rootfsDir)
        bundledTar.delete()

        // Create required mount-point dirs inside rootfs
        listOf("proc", "sys", "dev", "dev/pts", "tmp", "run", "root").forEach { dir ->
            File(rootfsDir, dir).mkdirs()
        }

        // Write resolv.conf (Cloudflare + Google DNS)
        val etcDir = File(rootfsDir, "etc")
        etcDir.mkdirs()
        File(etcDir, "resolv.conf").writeText("nameserver 1.1.1.1\nnameserver 8.8.8.8\n")

        // Write a simple /etc/hosts
        File(etcDir, "hosts").writeText("127.0.0.1 localhost\n::1       localhost\n")

        // Stamp success
        stamp.writeText(System.currentTimeMillis().toString())
        emitOutput("[alpine] \u001B[1;32mBootstrap complete!\u001B[0m\r\n\r\n")
    }

    private fun downloadAlpineRootfs(dest: File) {
        val abi = getPrimaryAbi()
        val archName = if (abi == "arm64-v8a") "aarch64" else "x86_64"
        val fileName = "alpine-minirootfs-${ALPINE_VERSION}-${archName}.tar.gz"
        val urlStr = "$ALPINE_BASE_URL/$archName/$fileName"

        emitOutput("[alpine] Downloading: $urlStr\r\n")
        Log.i(TAG, "Downloading Alpine rootfs from $urlStr")

        val url = URL(urlStr)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 120_000

        try {
            conn.connect()
            val total = conn.contentLengthLong
            var downloaded = 0L
            var lastPercent = -1

            dest.outputStream().buffered().use { out ->
                conn.inputStream.buffered().use { input ->
                    val buf = ByteArray(8192)
                    var n: Int
                    while (input.read(buf).also { n = it } != -1) {
                        out.write(buf, 0, n)
                        downloaded += n
                        if (total > 0) {
                            val pct = (downloaded * 100 / total).toInt()
                            if (pct != lastPercent && pct % 10 == 0) {
                                lastPercent = pct
                                emitOutput("[alpine] Download progress: $pct%\r\n")
                            }
                        }
                    }
                }
            }
            emitOutput("[alpine] Download complete (${downloaded / 1024} KB).\r\n")
        } finally {
            conn.disconnect()
        }
    }

    private fun extractTarball(tarball: File, destDir: File) {
        // Use 'tar' which is always present on Android
        val cmd = arrayOf(
            "tar", "-xzf", tarball.absolutePath,
            "-C", destDir.absolutePath,
            "--no-same-owner"
        )
        val proc = Runtime.getRuntime().exec(cmd)
        val exitCode = proc.waitFor()
        val errOutput = proc.errorStream.bufferedReader().readText()
        if (exitCode != 0) {
            Log.e(TAG, "tar extraction failed (code $exitCode): $errOutput")
            throw RuntimeException("tar extraction failed: $errOutput")
        }
        Log.i(TAG, "Extraction complete")
    }

    // ─── Shell Process ───────────────────────────────────────────────────────

    private fun startShell(prootBinary: File, rootfsDir: File) {
        stopSession()   // clean up any previous process

        val filesDir = rootfsDir.parentFile!!

        // Build the PRoot command
        //  -r  : rootfs path
        //  -0  : pretend to be root (UID 0), needed by apk/busybox
        //  -b  : bind system pseudo-filesystems into the rootfs
        //  -w  : start working directory inside the chroot
        //  --kill-on-exit : clean up when the outer process exits
        val cmd = mutableListOf(
            prootBinary.absolutePath,
            "-r", rootfsDir.absolutePath,
            "-0",
            "-b", "/dev:/dev",
            "-b", "/proc:/proc",
            "-b", "/sys:/sys",
            "-b", "${filesDir.absolutePath}:/host-rootdir",
            "-w", "/root",
            "--kill-on-exit",
            "/bin/sh", "-l"
        )

        val env = mutableMapOf(
            "HOME" to "/root",
            "TERM" to "xterm-256color",
            "SHELL" to "/bin/sh",
            "PATH" to "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "PROOT_NO_SECCOMP" to "1",   // required on many Android kernels
            "TMPDIR" to "/tmp",
            "LANG" to "en_US.UTF-8",
            "LC_ALL" to "en_US.UTF-8"
        )

        Log.i(TAG, "Starting PRoot: ${cmd.joinToString(" ")}")

        val pb = ProcessBuilder(cmd)
            .directory(filesDir)
            .redirectErrorStream(false)

        pb.environment().clear()
        pb.environment().putAll(env)

        shellProcess = pb.start()

        inputWriter = shellProcess!!.outputStream.bufferedWriter()
        outputReader = shellProcess!!.inputStream.bufferedReader()
        errorReader  = shellProcess!!.errorStream.bufferedReader()

        // Stream stdout
        outputListenerThread = Thread {
            try {
                val buf = CharArray(1024)
                var n: Int
                while (outputReader!!.read(buf).also { n = it } != -1) {
                    emitOutput(String(buf, 0, n))
                }
            } catch (e: IOException) {
                if (!Thread.currentThread().isInterrupted) {
                    Log.e(TAG, "stdout reader error", e)
                }
            }
            emitOutput("\r\n\u001B[1;31m[session ended]\u001B[0m\r\n")
        }.also { it.name = "alpine-stdout"; it.isDaemon = true; it.start() }

        // Stream stderr
        errorListenerThread = Thread {
            try {
                val buf = CharArray(512)
                var n: Int
                while (errorReader!!.read(buf).also { n = it } != -1) {
                    emitOutput("\u001B[1;31m" + String(buf, 0, n) + "\u001B[0m")
                }
            } catch (e: IOException) {
                if (!Thread.currentThread().isInterrupted) {
                    Log.e(TAG, "stderr reader error", e)
                }
            }
        }.also { it.name = "alpine-stderr"; it.isDaemon = true; it.start() }

        // Send an initial newline to get the prompt
        sendCommand("\n")

        Log.i(TAG, "PRoot shell process started (PID= available via reflection if needed)")
    }

    // ─── Output Emission ─────────────────────────────────────────────────────

    private fun emitOutput(data: String) {
        outputCallback?.invoke(data)
        Log.v(TAG, "shell> $data")
    }
}
