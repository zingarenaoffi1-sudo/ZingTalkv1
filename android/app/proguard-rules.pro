# ZingTalk Production R8 / ProGuard Rules
-repackageclasses 'z'
-allowaccessmodification
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,JavascriptInterface

# Keep Launch Activity Entry & Native WebView JS Bridge Methods
-keep public class * extends com.getcapacitor.BridgeActivity
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class android.webkit.** { *; }

# Keep Capacitor Core & Native Plugins
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <methods>;
}

# Keep Firebase Authentication & Google Play Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keep class io.capawesome.capacitorjs.plugins.firebase.authentication.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Keep WebRTC & MediaCodec Decoders
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
