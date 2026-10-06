const fs = require('fs');
const path = require('path');

console.log('[prepare-android] Starting Android project configuration...');

// 1. Configure MainActivity.java for Mixed Content, WebRTC Permissions & Direct AWS HTTP Access
const mainActivityDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'zingtalk', 'com');
const mainActivityPath = path.join(mainActivityDir, 'MainActivity.java');
if (fs.existsSync(mainActivityPath)) {
    const customMainActivity = `package com.zingtalk.com;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 1234;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        checkAndRequestPermissions();
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                settings.setDomStorageEnabled(true);
                settings.setJavaScriptEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                settings.setDatabaseEnabled(true);
                settings.setMediaPlaybackRequiresUserGesture(false);

                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> {
                            request.grant(request.getResources());
                        });
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] permissions = new String[]{
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            };
            boolean needRequest = false;
            for (String p : permissions) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    needRequest = true;
                    break;
                }
            }
            if (needRequest) {
                ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQ_CODE);
            }
        }
    }
}
`;
    fs.writeFileSync(mainActivityPath, customMainActivity, 'utf8');
    console.log('[prepare-android] ✅ MainActivity.java configured with MIXED_CONTENT_ALWAYS_ALLOW and WebRTC Camera/Mic permissions');
}

// 2. Configure network_security_config.xml for AWS EC2 Cleartext HTTP
const resXmlDir = path.join('android', 'app', 'src', 'main', 'res', 'xml');
if (!fs.existsSync(resXmlDir)) {
    fs.mkdirSync(resXmlDir, { recursive: true });
}
const netConfigPath = path.join(resXmlDir, 'network_security_config.xml');
const netConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">18.234.224.25</domain>
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`;
fs.writeFileSync(netConfigPath, netConfigContent, 'utf8');
console.log('[prepare-android] ✅ network_security_config.xml created');

// 3. Project-level build.gradle (Google Services plugin)
const rootGradle = path.join('android', 'build.gradle');
if (fs.existsSync(rootGradle)) {
    let content = fs.readFileSync(rootGradle, 'utf8');
    if (!content.includes('com.google.gms:google-services')) {
        content = content.replace(/(dependencies\s*\{)/, '$1\n        classpath "com.google.gms:google-services:4.4.2"');
        fs.writeFileSync(rootGradle, content, 'utf8');
        console.log('[prepare-android] ✅ Added google-services to android/build.gradle');
    }
}

// 4. App-level build.gradle (Google Services plugin)
const appGradle = path.join('android', 'app', 'build.gradle');
if (fs.existsSync(appGradle)) {
    let content = fs.readFileSync(appGradle, 'utf8');
    if (!content.includes('com.google.gms.google-services')) {
        content += "\napply plugin: 'com.google.gms.google-services'\n";
        fs.writeFileSync(appGradle, content, 'utf8');
        console.log('[prepare-android] ✅ Applied google-services plugin to android/app/build.gradle');
    }
}

// 5. AndroidManifest.xml (Permissions, TV Features, Cleartext, and Banner)
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
    let content = fs.readFileSync(manifestPath, 'utf8');

    const elementsToAdd = [
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
        '<uses-permission android:name="android.permission.CAMERA" />',
        '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
        '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '<uses-permission android:name="android.permission.WAKE_LOCK" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
        '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
        '<uses-feature android:name="android.hardware.camera" android:required="false" />',
        '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
        '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
        '<uses-feature android:name="android.software.leanback" android:required="false" />',
        '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
        '<uses-feature android:name="android.hardware.faketouch" android:required="false" />',
        '<uses-feature android:name="android.hardware.telephony" android:required="false" />',
        '<uses-feature android:name="android.hardware.wifi" android:required="false" />'
    ];

    const toInject = elementsToAdd.filter(e => !content.includes(e));
    if (toInject.length > 0 && content.includes('<application')) {
        const block = '\n    ' + toInject.join('\n    ') + '\n\n    ';
        content = content.replace('<application', block + '<application');
    }

    if (content.includes('<application')) {
        if (!content.includes('android:hardwareAccelerated')) {
            content = content.replace('<application', '<application android:hardwareAccelerated="true"');
        }
        if (!content.includes('android:largeHeap')) {
            content = content.replace('<application', '<application android:largeHeap="true"');
        }
        if (!content.includes('android:usesCleartextTraffic')) {
            content = content.replace('<application', '<application android:usesCleartextTraffic="true"');
        }
        if (!content.includes('android:networkSecurityConfig')) {
            content = content.replace('<application', '<application android:networkSecurityConfig="@xml/network_security_config"');
        }
        if (!content.includes('android:banner')) {
            content = content.replace('<application', '<application android:banner="@drawable/banner"');
        }
    }

    if (!content.includes('android.intent.category.LEANBACK_LAUNCHER') && content.includes('android.intent.category.LAUNCHER')) {
        content = content.replace(
            '<category android:name="android.intent.category.LAUNCHER" />',
            '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />'
        );
    }

    if (content.includes('<activity')) {
        if (!content.includes('android:screenOrientation')) {
            content = content.replace('<activity', '<activity android:screenOrientation="landscape"');
        }
        if (!content.includes('android:keepScreenOn')) {
            content = content.replace('<activity', '<activity android:keepScreenOn="true"');
        }
    }

    fs.writeFileSync(manifestPath, content, 'utf8');
    console.log('[prepare-android] ✅ AndroidManifest.xml successfully configured');
}

// 6. ProGuard Rules
const proguardPath = path.join('android', 'app', 'proguard-rules.pro');
if (fs.existsSync(proguardPath)) {
    const rules = `
# ZingTalk Production ProGuard Rules
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,JavascriptInterface

# Keep Capacitor Core & Native Plugins
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <methods>;
}

# Keep Firebase Authentication & Play Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keep class io.capawesome.capacitorjs.plugins.firebase.authentication.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Keep Android WebKit and JS Interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class android.webkit.** { *; }

# Keep WebRTC & MediaCodec decoders
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
`;
    fs.appendFileSync(proguardPath, '\n' + rules.trim() + '\n', 'utf8');
    console.log('[prepare-android] ✅ ProGuard rules injected');
}

// 7. Configure Release Signing in android/app/build.gradle
const appGradlePath = path.join('android', 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
    let content = fs.readFileSync(appGradlePath, 'utf8');
    const signingBlock = `
    signingConfigs {
        release {
            storeFile file("zingtalk-release.keystore")
            storePassword "zingtalk123456"
            keyAlias "zingtalk"
            keyPassword "zingtalk123456"
        }
    }
`;
    if (!content.includes('signingConfigs {')) {
        content = content.replace('android {', 'android {' + signingBlock);
    }
    if (!content.includes('signingConfig signingConfigs.release')) {
        content = content.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
    }
    fs.writeFileSync(appGradlePath, content, 'utf8');
    console.log('[prepare-android] ✅ Release signingConfig configured in android/app/build.gradle');
}

console.log('[prepare-android] Finished Android project configuration successfully!');
