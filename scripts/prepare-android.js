const fs = require('fs');
const path = require('path');

const targetPlatform = (process.argv[2] || 'tv').toLowerCase();
console.log(`[prepare-android] Starting Android project configuration for [${targetPlatform.toUpperCase()}]...`);

// 1. Configure MainActivity.java
const mainActivityDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'zingtalk', 'com');
const mainActivityPath = path.join(mainActivityDir, 'MainActivity.java');
if (fs.existsSync(mainActivityPath)) {
    const customMainActivity = `package com.zingtalk.com;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 1234;
    private static final String CHANNEL_INCOMING = "zingtalk_incoming_calls";
    private static final String CHANNEL_ONGOING = "zingtalk_ongoing_calls";
    private static final int NOTIF_ID_INCOMING = 9001;
    private static final int NOTIF_ID_ONGOING = 9002;

    public static final String ACTION_ACCEPT_CALL = "com.zingtalk.ACTION_ACCEPT_CALL";
    public static final String ACTION_DECLINE_CALL = "com.zingtalk.ACTION_DECLINE_CALL";
    public static final String ACTION_END_CALL = "com.zingtalk.ACTION_END_CALL";

    private NotificationManager notificationManager;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannels();
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

                // Add JavascriptInterface for native notifications & permission status
                webView.addJavascriptInterface(new ZingNativeBridge(this, webView), "ZingNativeBridge");
            }
        } catch (Exception ignored) {}

        handleIntentAction(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntentAction(intent);
    }

    private void handleIntentAction(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        final String actionType;
        if (ACTION_ACCEPT_CALL.equals(action)) {
            actionType = "accept";
            cancelIncomingNotification();
        } else if (ACTION_DECLINE_CALL.equals(action)) {
            actionType = "decline";
            cancelIncomingNotification();
        } else if (ACTION_END_CALL.equals(action)) {
            actionType = "end";
            cancelOngoingNotification();
        } else {
            return;
        }

        try {
            final WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript("window.handleNativeCallAction && window.handleNativeCallAction('" + actionType + "');", null);
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Incoming Call Channel - High Importance (Heads-up banner + sound + vibration)
            NotificationChannel incomingChannel = new NotificationChannel(
                CHANNEL_INCOMING,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            incomingChannel.setDescription("High priority notifications for incoming ZingTalk voice and video calls");
            incomingChannel.enableVibration(true);
            incomingChannel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 800});
            Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (defaultSound != null) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();
                incomingChannel.setSound(defaultSound, audioAttributes);
            }
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(incomingChannel);
            }

            // Ongoing Call Channel - Low Importance (Silent, persistent status bar presence)
            NotificationChannel ongoingChannel = new NotificationChannel(
                CHANNEL_ONGOING,
                "Ongoing Calls",
                NotificationManager.IMPORTANCE_LOW
            );
            ongoingChannel.setDescription("Persistent status indicator while an active ZingTalk call is in progress");
            ongoingChannel.enableVibration(false);
            ongoingChannel.setSound(null, null);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(ongoingChannel);
            }
        }
    }

    public void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> permList = new java.util.ArrayList<>();
            permList.add(Manifest.permission.CAMERA);
            permList.add(Manifest.permission.RECORD_AUDIO);
            permList.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);

            if (Build.VERSION.SDK_INT >= 33) {
                permList.add("android.permission.POST_NOTIFICATIONS");
            }
            if (Build.VERSION.SDK_INT >= 31) {
                permList.add("android.permission.BLUETOOTH_CONNECT");
            }

            java.util.List<String> needed = new java.util.ArrayList<>();
            for (String p : permList) {
                try {
                    if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                        needed.add(p);
                    }
                } catch (Exception ignored) {}
            }

            if (!needed.isEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQ_CODE);
            }
        }
    }

    public void cancelIncomingNotification() {
        if (notificationManager != null) {
            notificationManager.cancel(NOTIF_ID_INCOMING);
        }
    }

    public void cancelOngoingNotification() {
        if (notificationManager != null) {
            notificationManager.cancel(NOTIF_ID_ONGOING);
        }
    }

    public void cancelAllCallNotifications() {
        cancelIncomingNotification();
        cancelOngoingNotification();
    }

    public class ZingNativeBridge {
        private final Context context;
        private final WebView webView;

        public ZingNativeBridge(Context context, WebView webView) {
            this.context = context;
            this.webView = webView;
        }

        @JavascriptInterface
        public void showIncomingCall(final String callerUid, final String callerName, final String callType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String title = (callerName != null && !callerName.isEmpty()) ? callerName : ("UID: " + callerUid);
                        String body = "Incoming " + (("video".equalsIgnoreCase(callType)) ? "HD Video Call" : "Audio Call");

                        Intent openIntent = new Intent(context, MainActivity.class);
                        openIntent.setAction(Intent.ACTION_MAIN);
                        openIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE) : PendingIntent.FLAG_UPDATE_CURRENT;
                        PendingIntent pendingOpen = PendingIntent.getActivity(context, 101, openIntent, flags);

                        Intent acceptIntent = new Intent(context, MainActivity.class);
                        acceptIntent.setAction(ACTION_ACCEPT_CALL);
                        PendingIntent pendingAccept = PendingIntent.getActivity(context, 102, acceptIntent, flags);

                        Intent declineIntent = new Intent(context, MainActivity.class);
                        declineIntent.setAction(ACTION_DECLINE_CALL);
                        PendingIntent pendingDecline = PendingIntent.getActivity(context, 103, declineIntent, flags);

                        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_INCOMING)
                            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setPriority(NotificationCompat.PRIORITY_MAX)
                            .setCategory(NotificationCompat.CATEGORY_CALL)
                            .setAutoCancel(true)
                            .setOngoing(true)
                            .setContentIntent(pendingOpen)
                            .setFullScreenIntent(pendingOpen, true)
                            .setVibrate(new long[]{0, 500, 300, 500, 300, 800})
                            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", pendingDecline)
                            .addAction(android.R.drawable.ic_menu_call, "Accept", pendingAccept);

                        if (notificationManager != null) {
                            notificationManager.notify(NOTIF_ID_INCOMING, builder.build());
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void showOngoingCall(final String callerUid, final String callerName, final String durationStr) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        cancelIncomingNotification();
                        String title = "ZingTalk Call: " + ((callerName != null && !callerName.isEmpty()) ? callerName : ("UID: " + callerUid));
                        String body = "Active Call • " + (durationStr != null ? durationStr : "Connected");

                        Intent openIntent = new Intent(context, MainActivity.class);
                        openIntent.setAction(Intent.ACTION_MAIN);
                        openIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE) : PendingIntent.FLAG_UPDATE_CURRENT;
                        PendingIntent pendingOpen = PendingIntent.getActivity(context, 201, openIntent, flags);

                        Intent endIntent = new Intent(context, MainActivity.class);
                        endIntent.setAction(ACTION_END_CALL);
                        PendingIntent pendingEnd = PendingIntent.getActivity(context, 202, endIntent, flags);

                        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ONGOING)
                            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setPriority(NotificationCompat.PRIORITY_LOW)
                            .setCategory(NotificationCompat.CATEGORY_CALL)
                            .setOngoing(true)
                            .setAutoCancel(false)
                            .setContentIntent(pendingOpen)
                            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Call", pendingEnd);

                        if (notificationManager != null) {
                            notificationManager.notify(NOTIF_ID_ONGOING, builder.build());
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void dismissCallNotifications() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    cancelAllCallNotifications();
                }
            });
        }

        @JavascriptInterface
        public void requestAllPermissions() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    checkAndRequestPermissions();
                }
            });
        }

        @JavascriptInterface
        public boolean areNotificationsEnabled() {
            try {
                return NotificationManagerCompat.from(context).areNotificationsEnabled();
            } catch (Exception e) {
                return true;
            }
        }
    }
}
`;
    fs.writeFileSync(mainActivityPath, customMainActivity, 'utf8');
}

// 1.1 Ensure Banner Drawable Exists for TV
const drawableDir = path.join('android', 'app', 'src', 'main', 'res', 'drawable');
if (!fs.existsSync(drawableDir)) {
    fs.mkdirSync(drawableDir, { recursive: true });
}
const bannerDest = path.join(drawableDir, 'banner.png');
const bannerSrc = path.join('assets', 'icon.png');
if (!fs.existsSync(bannerDest) && fs.existsSync(bannerSrc)) {
    fs.copyFileSync(bannerSrc, bannerDest);
}

// 1.2 Configure Android App Display Name in strings.xml (ZingTalk TV vs ZingTalk)
const stringsPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsPath)) {
    const appDisplayName = targetPlatform === 'tv' ? 'ZingTalk TV' : 'ZingTalk';
    let stringsContent = fs.readFileSync(stringsPath, 'utf8');
    stringsContent = stringsContent.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${appDisplayName}</string>`);
    stringsContent = stringsContent.replace(/<string name="title_activity_main">.*?<\/string>/, `<string name="title_activity_main">${appDisplayName}</string>`);
    fs.writeFileSync(stringsPath, stringsContent, 'utf8');
    console.log(`[prepare-android] ✅ Configured Android app_name to "${appDisplayName}"`);
}

// 2. Configure network_security_config.xml
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
        <domain includeSubdomains="true">zingtalk.duckdns.org</domain>
        <domain includeSubdomains="true">duckdns.org</domain>
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`;
fs.writeFileSync(netConfigPath, netConfigContent, 'utf8');

// 3. Project-level build.gradle
const rootGradle = path.join('android', 'build.gradle');
if (fs.existsSync(rootGradle)) {
    let content = fs.readFileSync(rootGradle, 'utf8');
    if (!content.includes('com.google.gms:google-services')) {
        content = content.replace(/(dependencies\s*\{)/, '$1\n        classpath "com.google.gms:google-services:4.4.2"');
        fs.writeFileSync(rootGradle, content, 'utf8');
    }
}

// 4. App-level build.gradle
const appGradle = path.join('android', 'app', 'build.gradle');
if (fs.existsSync(appGradle)) {
    let content = fs.readFileSync(appGradle, 'utf8');
    if (!content.includes('com.google.gms.google-services')) {
        content += "\napply plugin: 'com.google.gms.google-services'\n";
        fs.writeFileSync(appGradle, content, 'utf8');
    }
}

// 5. AndroidManifest.xml
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
    let content = fs.readFileSync(manifestPath, 'utf8');

    const elementsToAdd = [
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
        '<uses-permission android:name="android.permission.CAMERA" />',
        '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
        '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />',
        '<uses-permission android:name="android.permission.WAKE_LOCK" />',
        '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
        '<uses-permission android:name="android.permission.VIBRATE" />',
        '<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />',
        '<uses-permission android:name="android.permission.BLUETOOTH" />',
        '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
        '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
        '<uses-feature android:name="android.hardware.camera" android:required="false" />',
        '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
        '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
        '<uses-feature android:name="android.hardware.telephony" android:required="false" />',
        '<uses-feature android:name="android.hardware.wifi" android:required="false" />'
    ];

    if (targetPlatform === 'tv') {
        elementsToAdd.push(
            '<uses-feature android:name="android.software.leanback" android:required="false" />',
            '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
            '<uses-feature android:name="android.hardware.faketouch" android:required="false" />'
        );
    } else {
        elementsToAdd.push(
            '<uses-feature android:name="android.hardware.touchscreen" android:required="true" />'
        );
    }

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
        if (targetPlatform === 'tv' && !content.includes('android:banner')) {
            content = content.replace('<application', '<application android:banner="@drawable/banner"');
        }
    }

    if (targetPlatform === 'tv') {
        if (!content.includes('android.intent.category.LEANBACK_LAUNCHER') && content.includes('android.intent.category.LAUNCHER')) {
            content = content.replace(
                '<category android:name="android.intent.category.LAUNCHER" />',
                '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />'
            );
        }
    }

    const orientation = targetPlatform === 'tv' ? 'landscape' : 'portrait';
    if (content.includes('<activity')) {
        content = content.replace(/android:screenOrientation="[^"]*"/g, '');
        content = content.replace('<activity', `<activity android:screenOrientation="${orientation}"`);
        if (!content.includes('android:keepScreenOn')) {
            content = content.replace('<activity', '<activity android:keepScreenOn="true"');
        }
        if (!content.includes('android:showWhenLocked')) {
            content = content.replace('<activity', '<activity android:showWhenLocked="true"');
        }
        if (!content.includes('android:turnScreenOn')) {
            content = content.replace('<activity', '<activity android:turnScreenOn="true"');
        }
    }

    fs.writeFileSync(manifestPath, content, 'utf8');
}

// 6. ProGuard Rules
const proguardPath = path.join('android', 'app', 'proguard-rules.pro');
if (fs.existsSync(proguardPath)) {
    const rules = `
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,JavascriptInterface
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin { public <methods>; }
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keep class android.webkit.** { *; }
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
`;
    fs.appendFileSync(proguardPath, '\n' + rules.trim() + '\n', 'utf8');
}

// 7. Configure Keystore Signing in android/app/build.gradle
const appGradlePath = path.join('android', 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
    let content = fs.readFileSync(appGradlePath, 'utf8');
    const keystoreFileName = targetPlatform === 'tv' ? 'zingtalk-tv-release.keystore' : 'zingtalk-mobile-release.keystore';
    const keyAlias = targetPlatform === 'tv' ? 'zingtalk-tv' : 'zingtalk-mobile';

    const signingBlock = `
    signingConfigs {
        release {
            storeFile file("${keystoreFileName}")
            storePassword "zingtalk123456"
            keyAlias "${keyAlias}"
            keyPassword "zingtalk123456"
        }
    }
`;
    content = content.replace(/signingConfigs\s*\{[\s\S]*?\}\s*\}/, '');
    content = content.replace('android {', 'android {' + signingBlock);
    if (!content.includes('signingConfig signingConfigs.release')) {
        content = content.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
    }
    fs.writeFileSync(appGradlePath, content, 'utf8');
    console.log(`[prepare-android] ✅ Configured ${keystoreFileName} with alias ${keyAlias}`);
}

// 8. Copy platform web assets to android/app/src/main/assets/public
const androidPublicDir = path.join('android', 'app', 'src', 'main', 'assets', 'public');
if (!fs.existsSync(androidPublicDir)) {
    fs.mkdirSync(androidPublicDir, { recursive: true });
}
const platformSourceDir = targetPlatform === 'mobile' ? path.join('packages', 'mobile') : path.join('packages', 'tv');
const filesToSync = ['index.html', 'style.css', 'app.js', 'manifest.json', 'capacitor.js', 'socket.io.min.js'];
filesToSync.forEach(f => {
    let src = path.join(platformSourceDir, f);
    if (!fs.existsSync(src)) {
        src = path.join('.', f);
    }
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(androidPublicDir, f));
    }
});
console.log(`[prepare-android] ✅ Synchronized web bundle from ${platformSourceDir} to Android assets public directory!`);

console.log(`[prepare-android] Android project successfully configured for ${targetPlatform}!`);
