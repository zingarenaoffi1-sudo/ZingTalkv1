package com.zingtalktv.com;

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

    public static final String ACTION_ACCEPT_CALL = "com.zingtalktv.com.ACTION_ACCEPT_CALL";
    public static final String ACTION_DECLINE_CALL = "com.zingtalktv.com.ACTION_DECLINE_CALL";
    public static final String ACTION_END_CALL = "com.zingtalktv.com.ACTION_END_CALL";

    private NotificationManager notificationManager;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            getWindow().getDecorView().setBackgroundColor(android.graphics.Color.parseColor("#090d16"));
        } catch (Exception ignored) {}
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannels();
        // Camera & Mic permissions are strictly requested on-demand when a call is initiated or answered

        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.setBackgroundColor(android.graphics.Color.parseColor("#090d16"));
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
