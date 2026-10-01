# ZingTalk Android Release Keystore & Signing Details

This file contains the production signing credentials for **ZingTalk (com.zingtalk.com)**.
These credentials are used by GitHub Actions to build a **Signed Release APK** that can be installed on Android devices and Amazon Fire Tablets, and uploaded to the Amazon Appstore or Google Play.

---

## 🔑 Keystore Credentials

- **Keystore File**: `zingtalk-release.keystore` (Root of repository)
- **Keystore Format**: PKCS12
- **Keystore Password**: `zingtalk123456`
- **Key Alias**: `zingtalk`
- **Key Password**: `zingtalk123456`
- **Validity**: **70 Years** (25,550 days, valid until Year 2096)
- **Organization / CN**: `CN=ZingTalk, OU=Mobile, O=ZingTalk, L=Delhi, ST=Delhi, C=IN`

---

## 🛡️ Certificate Fingerprints (SHA-1 & SHA-256)

These fingerprints match your **Firebase Console** configuration in `google-services.json`:
- **Package Name**: `com.zingtalk.com`
- **Mobile SDK App ID**: `1:214252384173:android:ad23e53e2d5a7c93f77b24`

### SHA-1 (Hex: 2225e7407aef0e47ab833ee9514addfe62fca569):
```
22:25:E7:40:7A:EF:0E:47:AB:83:3E:E9:51:4A:DD:FE:62:FC:A5:69
```

### SHA-256:
```
A5:09:11:14:BD:91:46:55:C4:2F:E3:8E:CE:5D:C1:2C:46:0C:F5:28:EE:5C:15:2E:47:1D:B5:04:6A:13:8D:39
```

---

## 🚀 GitHub Actions Output
When you push code or run the **Build Android APK** workflow in GitHub Actions, it will generate:
- **`ZingTalk-APK`**: The single official production signed APK (`ZingTalk.apk`) ready to install on Android phones, Amazon Fire Tablets, or upload to app stores. No confusion, single APK only.
