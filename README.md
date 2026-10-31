# ZingTalk 📺📱⚡

> **High-Definition Real-Time Communication Platform for Smart TVs & Mobile Devices**  
> *Private, Ephemeral, Voice-Enabled Video Calling & Messaging*

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer--to--Peer-blue.svg)](https://webrtc.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4-black.svg)](https://socket.io/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Android%20TV%20%26%20Mobile-blueviolet.svg)](https://capacitorjs.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license)

---

## 🌟 Overview

**ZingTalk** connects Living Room Smart TVs (Amazon Fire TV / Android TV) and Smartphones into a unified, zero-friction communication network.

Traditional messaging applications require mobile phone numbers, invasive SIM telemetry, and store gigabytes of private chat records on central cloud disks. ZingTalk re-engineers calling from first principles:
- **Zero Server Retention**: Video and audio streams flow peer-to-peer (P2P) via WebRTC DTLS-SRTP encryption. Real-time messages are relayed purely through volatile server RAM and purged upon delivery.
- **10-Digit Anonymous UIDs**: No phone numbers or invasive tracking required. Every account is assigned a persistent 10-digit ID.
- **Dual-Client Experience**:
  - **Fire TV (`packages/tv`)**: 10-foot leanback user interface navigable with physical remote D-Pad controls (Up/Down/Left/Right/Select/Back) and Alexa voice control.
  - **Mobile (`packages/mobile`)**: Sleek touch-first smartphone interface with front/back camera flipping, dialpad, and bottom tab navigation.

---

## 🚀 Key Features

* **🔑 Persistent 10-Digit UIDs**: Clean 10-digit numeric identifiers mapped securely to your account.
* **🛡️ Zero Server Retention (Ephemeral Messaging)**:
  * Audio and video streams flow directly peer-to-peer via **WebRTC DTLS-SRTP** encryption.
  * Chat messages are relayed in volatile memory and purged immediately upon receipt.
* **🎮 Smart TV & Fire TV Remote Navigation**: Directional D-Pad spatial navigation engine with high-contrast focus rings and overscan safe margins.
* **👆 Front/Rear Camera Switching on Mobile**: Easily toggle between front and rear cameras during live video calls on smartphones and tablets.
* **🎙️ Amazon Alexa Voice Integration**: Dedicated webhook integration (`/api/alexa`) enabling hands-free voice commands (*"Alexa, call Rahul"*, *"Alexa, answer call"*, *"Alexa, end call"*).
* **⚡ Production Signaling & STUN/TURN**: High-speed WebSocket signaling hosted at `https://zingtalk.duckdns.org` with dedicated Coturn STUN/TURN traversal on port `3478`.

---

## 🏗️ Architecture & Monorepo Structure

```
ZingTalk/
├── server.js                          # Universal Signaling Backend (Socket.IO + Alexa)
├── ecosystem.config.js                # Production PM2 deployment config
├── index.html                         # Web / TV entry point
├── app.js                             # Web / TV application logic
├── style.css                          # Big-screen high-contrast TV stylesheet
│
├── packages/
│   ├── tv/                            # Amazon Fire TV / Android TV Client
│   │   ├── index.html                 # 10-foot TV UI with D-Pad focus & "How to Use" guide
│   │   ├── app.js                     # TV Remote D-Pad Navigation + WebRTC
│   │   ├── style.css                  # TV overscan margins & focus ring CSS
│   │   └── capacitor.config.json      # TV Capacitor App Config (com.zingtalk.tv)
│   │
│   └── mobile/                        # Android Mobile Client
│       ├── index.html                 # Touch-first smartphone layout with bottom nav
│       ├── app.js                     # Mobile gestures & front/back camera flipping
│       ├── style.css                  # Modern smartphone responsive stylesheet
│       └── capacitor.config.json      # Mobile Capacitor App Config (com.zingtalk.mobile)
│
└── .github/workflows/
    ├── build-tv.yml                   # Builds signed ZingTalk-FireTV.apk
    ├── build-mobile.yml               # Builds signed ZingTalk-Mobile.apk
    └── deploy.yml                     # Auto-deploys server to AWS EC2
```

---

## 🔑 Release Signing & Keystores

Both client APKs are built and signed independently using dedicated production keystores:

| Target | APK Name | Keystore File | Key Alias | Password |
|---|---|---|---|---|
| **Fire TV** | `ZingTalk-FireTV.apk` | `zingtalk-tv-release.keystore` | `zingtalk-tv` | `zingtalk123456` |
| **Mobile** | `ZingTalk-Mobile.apk` | `zingtalk-mobile-release.keystore` | `zingtalk-mobile` | `zingtalk123456` |

---

## 🌐 Production Infrastructure

* **Signaling Server**: `https://zingtalk.duckdns.org` (Port 443 / 3000)
* **Dedicated STUN**: `stun:zingtalk.duckdns.org:3478`
* **Dedicated TURN**: `turn:zingtalk.duckdns.org:3478?transport=udp` & `?transport=tcp`
* **Public Fallback STUN**: `stun:stun.l.google.com:19302`

---

## 🛠️ Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start the local signaling server
npm run dev

# 3. Build distribution assets for TV and Mobile
npm run build
```

---

## 📄 License & Support

Proprietary Software. Developed by **ZingTalk Developer Team** (`zingarenaoffi1@gmail.com`). All rights reserved.
