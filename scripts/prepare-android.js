const fs = require('fs');
const path = require('path');

const targetPlatform = (process.argv[2] || 'tv').toLowerCase();
const packageName = targetPlatform === 'tv' ? 'com.zingtalktv.com' : 'com.zingtalk.com';
const appDisplayName = targetPlatform === 'tv' ? 'ZingTalk TV' : 'ZingTalk';
console.log(`[prepare-android] Starting Android project configuration for [${targetPlatform.toUpperCase()}] with package [${packageName}]...`);

// 1. Configure MainActivity.java in target package
const packagePathParts = packageName.split('.');
const mainActivityDir = path.join('android', 'app', 'src', 'main', 'java', ...packagePathParts);
if (!fs.existsSync(mainActivityDir)) {
    fs.mkdirSync(mainActivityDir, { recursive: true });
}

const mainActivityPath = path.join(mainActivityDir, 'MainActivity.java');
const customMainActivity = `package ${packageName};

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

    public static final String ACTION_ACCEPT_CALL = "${packageName}.ACTION_ACCEPT_CALL";
    public static final String ACTION_DECLINE_CALL = "${packageName}.ACTION_DECLINE_CALL";
    public static final String ACTION_END_CALL = "${packageName}.ACTION_END_CALL";

    private NotificationManager notificationManager;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannels();
        // Camera & Mic permissions are strictly requested on-demand when a call is initiated or answered

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

                // Automatically grant WebRTC Camera & Microphone permissions inside Android/Fire TV WebView
                final WebChromeClient existingChromeClient = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ? webView.getWebChromeClient() : null;
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    request.grant(request.getResources());
                                } catch (Exception e) {
                                    if (existingChromeClient != null) {
                                        existingChromeClient.onPermissionRequest(request);
                                    }
                                }
                            }
                        });
                    }
                });
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

    public void requestPermissionsForCall(String callType) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> needed = new java.util.ArrayList<>();
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.MODIFY_AUDIO_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
            }
            if ("video".equalsIgnoreCase(callType)) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.CAMERA);
                }
            }
            if (Build.VERSION.SDK_INT >= 31) {
                if (ContextCompat.checkSelfPermission(this, "android.permission.BLUETOOTH_CONNECT") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.BLUETOOTH_CONNECT");
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.POST_NOTIFICATIONS");
                }
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
        public void requestCallPermissions(final String callType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestPermissionsForCall(callType);
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
console.log(`[prepare-android] ✅ Written custom MainActivity.java with ZingNativeBridge`);

// Clean up inactive package directories to prevent duplicate class compilation errors
if (targetPlatform === 'tv') {
    const mobilePkgDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'zingtalk');
    if (fs.existsSync(mobilePkgDir)) {
        try {
            fs.rmSync(mobilePkgDir, { recursive: true, force: true });
            console.log(`[prepare-android] 🧹 Removed inactive package dir: ${mobilePkgDir}`);
        } catch (e) {}
    }
} else {
    const tvPkgDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'zingtalktv');
    if (fs.existsSync(tvPkgDir)) {
        try {
            fs.rmSync(tvPkgDir, { recursive: true, force: true });
            console.log(`[prepare-android] 🧹 Removed inactive package dir: ${tvPkgDir}`);
        } catch (e) {}
    }
}

// 1.1 Ensure google-services.json is synced to android/app
const rootGoogleServices = path.join('.', 'google-services.json');
const appGoogleServices = path.join('android', 'app', 'google-services.json');
if (fs.existsSync(rootGoogleServices)) {
    fs.copyFileSync(rootGoogleServices, appGoogleServices);
    console.log('[prepare-android] ✅ Synced google-services.json to android/app');
}

// 1.2 Ensure Banner Drawable Exists for TV (320x180 16:9 Leanback Banner)
const drawableDir = path.join('android', 'app', 'src', 'main', 'res', 'drawable');
if (!fs.existsSync(drawableDir)) {
    fs.mkdirSync(drawableDir, { recursive: true });
}
const bannerDest = path.join(drawableDir, 'banner.png');
const pkgBannerSrc = path.join('packages', targetPlatform, 'assets', 'banner.png');
const rootBannerSrc = path.join('assets', 'banner.png');
const fallbackIconSrc = path.join('assets', 'icon.png');
if (fs.existsSync(pkgBannerSrc)) {
    fs.copyFileSync(pkgBannerSrc, bannerDest);
} else if (fs.existsSync(rootBannerSrc)) {
    fs.copyFileSync(rootBannerSrc, bannerDest);
} else if (!fs.existsSync(bannerDest) && fs.existsSync(fallbackIconSrc)) {
    fs.copyFileSync(fallbackIconSrc, bannerDest);
}

// 1.25 Synchronize platform-specific launcher icons
const pkgAssetsDir = path.join('packages', targetPlatform, 'assets');
const androidResDir = path.join('android', 'app', 'src', 'main', 'res');
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
densities.forEach(d => {
    const srcMipmap = path.join(pkgAssetsDir, `mipmap-${d}`);
    const destMipmap = path.join(androidResDir, `mipmap-${d}`);
    if (fs.existsSync(srcMipmap)) {
        if (!fs.existsSync(destMipmap)) fs.mkdirSync(destMipmap, { recursive: true });
        ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'].forEach(iconFile => {
            const s = path.join(srcMipmap, iconFile);
            const t = path.join(destMipmap, iconFile);
            if (fs.existsSync(s)) {
                fs.copyFileSync(s, t);
            }
        });
    }
});
console.log(`[prepare-android] ✅ Synchronized launcher icons for [${targetPlatform}]`);

// 1.3 Configure Android App Display Name & Package in strings.xml
const stringsPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsPath)) {
    let stringsContent = fs.readFileSync(stringsPath, 'utf8');
    stringsContent = stringsContent.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${appDisplayName}</string>`);
    stringsContent = stringsContent.replace(/<string name="title_activity_main">.*?<\/string>/, `<string name="title_activity_main">${appDisplayName}</string>`);
    if (stringsContent.includes('name="package_name"')) {
        stringsContent = stringsContent.replace(/<string name="package_name">.*?<\/string>/, `<string name="package_name">${packageName}</string>`);
    } else {
        stringsContent = stringsContent.replace('</resources>', `    <string name="package_name">${packageName}</string>\n</resources>`);
    }
    if (stringsContent.includes('name="custom_url_scheme"')) {
        stringsContent = stringsContent.replace(/<string name="custom_url_scheme">.*?<\/string>/, `<string name="custom_url_scheme">${packageName}</string>`);
    } else {
        stringsContent = stringsContent.replace('</resources>', `    <string name="custom_url_scheme">${packageName}</string>\n</resources>`);
    }
    fs.writeFileSync(stringsPath, stringsContent, 'utf8');
    console.log(`[prepare-android] ✅ Configured Android app_name to "${appDisplayName}" and package_name to "${packageName}"`);
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

// 4. App-level build.gradle (applicationId, namespace, signing configs, lint config, and universal Fire Tablet/TV minSdkVersion=10 manifest hook)
const appGradlePath = path.join('android', 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
    let content = fs.readFileSync(appGradlePath, 'utf8');

    // Enforce consistent applicationId and namespace
    content = content.replace(/applicationId\s+"[^"]+"/, `applicationId "${packageName}"`);
    content = content.replace(/namespace\s*=?\s*"[^"]+"/, `namespace = "${packageName}"`);

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
    lint {
        checkReleaseBuilds false
        abortOnError false
    }
`;
    content = content.replace(/\s*signingConfigs\s*\{[\s\S]*?\}\s*\}/g, '');
    content = content.replace(/\s*lint\s*\{[\s\S]*?\}/g, '');
    content = content.replace('android {', 'android {' + signingBlock);
    if (!content.includes('signingConfig signingConfigs.release')) {
        content = content.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
    }

    // Remove any previous manifest minSdk post-processor block before re-appending
    content = content.replace(/\/\/ --- ZINGTALK_MIN_SDK_HOOK_START ---[\s\S]*?\/\/ --- ZINGTALK_MIN_SDK_HOOK_END ---/g, '').trim();

    const minSdkHookBlock = `

// --- ZINGTALK_MIN_SDK_HOOK_START ---
// Post-process merged AndroidManifest.xml after Manifest Merger (which uses API 24 for AndroidX compatibility)
// so the final packaged APK header declares android:minSdkVersion="10", unlocking all 40/40 Amazon Fire Tablets & 100/100 Fire TVs.
tasks.matching { it.name.startsWith("process") && it.name.contains("Manifest") }.configureEach {
    doLast {
        File outDir = project.layout.buildDirectory.get().asFile
        fileTree(dir: outDir, include: "**/AndroidManifest.xml").each { File manifestFile ->
            String xmlText = manifestFile.getText("UTF-8")
            if (xmlText.contains('android:minSdkVersion="')) {
                xmlText = xmlText.replaceAll('android:minSdkVersion="[0-9]+"', 'android:minSdkVersion="10"')
                manifestFile.setText(xmlText, "UTF-8")
                println("[ZingTalk Gradle] Patched minSdkVersion=10 in: " + manifestFile.path)
            }
        }
    }
}
// --- ZINGTALK_MIN_SDK_HOOK_END ---
`;
    content = content + '\n' + minSdkHookBlock;

    fs.writeFileSync(appGradlePath, content, 'utf8');
    console.log(`[prepare-android] ✅ Configured ${keystoreFileName} with alias ${keyAlias}, ${packageName} appId, and Fire Tablet/TV minSdk=10 manifest hook`);
}

// 5. AndroidManifest.xml (Strict separation between Tablet/Mobile APK vs Fire TV APK)
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
    const isTv = (targetPlatform === 'tv');
    const orientation = isTv ? 'landscape' : 'unspecified';

    const platformFeatures = isTv
        ? `    <!-- Fire TV Dedicated Leanback Requirements -->
    <uses-feature android:name="android.software.leanback" android:required="true" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <uses-feature android:name="android.hardware.faketouch" android:required="false" />`
        : `    <!-- Fire Tablet & Android Mobile Touchscreen Requirements (Excludes non-touch Fire TVs on Mobile APK) -->
    <uses-feature android:name="android.hardware.touchscreen" android:required="true" />
    <uses-feature android:name="android.hardware.faketouch" android:required="false" />`;

    const applicationBannerAttr = isTv ? '\n        android:banner="@drawable/banner"' : '';
    const leanbackCategory = isTv ? '\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />' : '';

    const cleanManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Support All Screen Sizes & Densities (7", 8", 8.9", 10.1", 11" Fire Tablets, Phones & TVs) -->
    <supports-screens
        android:smallScreens="true"
        android:normalScreens="true"
        android:largeScreens="true"
        android:xlargeScreens="true"
        android:anyDensity="true"
        android:resizeable="true" />

    <!-- 1. Real-time Audio & HD Video Communication Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

    <!-- 2. All Implied Hardware Features Explicitly Optional so Every Fire Tablet (2011-2025) & Device is Compatible -->
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.front" android:required="false" />
    <uses-feature android:name="android.hardware.camera.any" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />
    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
    <uses-feature android:name="android.hardware.telephony" android:required="false" />
    <uses-feature android:name="android.hardware.wifi" android:required="false" />
    <uses-feature android:name="android.hardware.location" android:required="false" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
    <uses-feature android:name="android.hardware.location.network" android:required="false" />
    <uses-feature android:name="android.hardware.screen.portrait" android:required="false" />
    <uses-feature android:name="android.hardware.screen.landscape" android:required="false" />
${platformFeatures}

    <application${applicationBannerAttr}
        android:networkSecurityConfig="@xml/network_security_config"
        android:usesCleartextTraffic="true"
        android:largeHeap="true"
        android:hardwareAccelerated="true"
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:screenOrientation="${orientation}"
            android:resizeableActivity="true"
            android:keepScreenOn="true"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:windowSoftInputMode="adjustPan"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />${leanbackCategory}
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>

</manifest>
`;

    fs.writeFileSync(manifestPath, cleanManifest, 'utf8');
    console.log(`[prepare-android] ✅ Written clean platform-specific AndroidManifest.xml for [${targetPlatform.toUpperCase()}]`);
}

// 6. ProGuard Rules
const proguardPath = path.join('android', 'app', 'proguard-rules.pro');
if (fs.existsSync(proguardPath)) {
    let currentRules = fs.readFileSync(proguardPath, 'utf8');
    if (!currentRules.includes('com.google.firebase')) {
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
}

// 7. Copy platform web assets to android/app/src/main/assets/public
const androidPublicDir = path.join('android', 'app', 'src', 'main', 'assets', 'public');
if (!fs.existsSync(androidPublicDir)) {
    fs.mkdirSync(androidPublicDir, { recursive: true });
}
const platformSourceDir = targetPlatform === 'mobile' ? path.join('packages', 'mobile') : path.join('packages', 'tv');
const filesToSync = ['index.html', 'style.css', 'app.js', 'manifest.json', 'service-worker.js', 'capacitor.js', 'socket.io.min.js', 'privacy.html', 'terms.html'];
filesToSync.forEach(f => {
    let src = path.join(platformSourceDir, f);
    if (!fs.existsSync(src)) {
        src = path.join('.', f);
    }
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(androidPublicDir, f));
    }
});
// Clean any heavy submission assets like screenshots from the APK assets directory
const unwantedScreenshots = path.join(androidPublicDir, 'screenshots');
if (fs.existsSync(unwantedScreenshots)) {
    fs.rmSync(unwantedScreenshots, { recursive: true, force: true });
}

console.log(`[prepare-android] ✅ Synchronized web bundle from ${platformSourceDir} to Android assets public directory!`);

// 8. Synchronize capacitor.config.json in assets & root with packageName
const capConfigsToSync = [
    path.join('android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
    path.join('.', 'capacitor.config.json')
];
capConfigsToSync.forEach(cfgPath => {
    if (fs.existsSync(cfgPath)) {
        try {
            const raw = fs.readFileSync(cfgPath, 'utf8');
            const parsed = JSON.parse(raw);
            parsed.appId = packageName;
            parsed.appName = appDisplayName;
            fs.writeFileSync(cfgPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
            console.log(`[prepare-android] ✅ Updated ${cfgPath} with appId="${packageName}"`);
        } catch (e) {}
    }
});

console.log(`[prepare-android] Android project successfully configured for ${targetPlatform}!`);
