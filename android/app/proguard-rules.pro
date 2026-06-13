-keep class com.alpineshell.app.** { *; }
-keep class com.facebook.react.** { *; }
-dontwarn com.facebook.react.**
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
# Keep native methods
-keepclassmembers class * {
    native <methods>;
}
