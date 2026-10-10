# ZingTalk 📺⚡

> **Next-Generation TV-First Real-Time Communication Platform**  
> *Optimized for Amazon Fire TV, Smart TVs, Android Devices & Alexa Voice Control*  
> **Confidential & Proprietary Submission for Amazon Hackathon**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer--to--Peer-blue.svg)](https://webrtc.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4-black.svg)](https://socket.io/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Android%20TV-blueviolet.svg)](https://capacitorjs.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license)

---

## 🌟 Overview

**ZingTalk** turns any living room television or screen into an instant, private, voice-activated video calling and messaging hub. Traditional communication apps require mobile phone numbers, SIM cards, and invasive account tracking, storing gigabytes of personal chats on centralized disks. 

ZingTalk re-engineers communication from first principles with **Zero Server Retention**, **10-Digit Anonymous UIDs**, and a native **10-Foot Leanback UI** navigable with standard TV remotes and Alexa voice commands.

---

## 🚀 Key Features

* **🔑 10-Digit Anonymous UIDs**: No phone numbers, no SIM cards, and no personal credentials required. Each device or television receives a clean 10-digit ID in seconds.
* **🛡️ Zero Server Retention (Ephemeral Privacy)**:
  * Audio and video streams flow directly peer-to-peer via **WebRTC DTLS-SRTP** encryption.
  * Chat messages are relayed exclusively through volatile server RAM and permanently purged upon delivery. No persistent chat logs on server storage.
* **🎮 10-Foot Leanback UI (TV Remote Optimized)**: Complete directional navigation (D-Pad Up, Down, Left, Right, Select/Enter, Back) designed specifically for big-screen television viewing distances.
* **🎙️ Amazon Alexa Voice Integration**: Dedicated Alexa Skill webhook integration (`/api/alexa`) enabling hands-free voice commands:
  * *"Alexa, call Rahul on ZingTalk"*
  * *"Alexa, answer call"*
  * *"Alexa, mute microphone"*
  * *"Alexa, end call"*
* **⚡ Sub-Second Latency Architecture**: Lightweight WebSocket signaling pipeline hosted on the user's dedicated AWS EC2 instance paired with multi-tier STUN/TURN failover for rapid NAT traversal.
* **📱 Cross-Platform Uniformity**: Runs seamlessly as a modern Web App, Progressive Web App (PWA), and a lightweight 4MB native Android/Fire TV APK.

---

## 🏗️ Architecture & Technology Stack

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                            ZingTalk Client                             │
   │      (Vanilla ES Modules + HTML5 Leanback UI + Capacitor Bridge)       │
   └───────────────┬────────────────────────────────────────┬───────────────┘
                   │                                        │
         WebSocket Signaling                        WebRTC P2P Stream
       (ICE, SDP, Real-Time Messages)             (DTLS-SRTP Video/Audio)
                   │                                        │
                   ▼                                        ▼
   ┌────────────────────────────────┐        ┌─────────────────────────────┐
   │    User Dedicated AWS EC2      │        │    Multi-Tier ICE Traversal │
   │      Signaling Server          │        │                             │
   │   (18.234.224.25:3000)         │        │ 1. Google Public STUN       │
   │  • Node.js & Socket.IO v4      │        │    (stun.l.google.com:19302)│
   │  • Sub-second RAM message relay│        │                             │
   │  • Zero disk storage           │        │ 2. Dedicated AWS EC2 STUN   │
   └───────────────┬────────────────┘        │    (18.234.224.25:3478)     │
                   │                         │                             │
           Alexa Skill Hook                  │ 3. Dedicated AWS EC2 TURN   │
            (/api/alexa)                     │    (coturn relay fallback)  │
                   │                         └─────────────────────────────┘
                   ▼
   ┌────────────────────────────────┐
   │      Amazon Alexa Devices      │
   │  (Echo, Fire TV Voice Remote)  │
   └────────────────────────────────┘
```

* **Frontend**: Vanilla ES Modules, CSS3 responsive grid with TV-safe boundaries, Web Audio API synthetic chimes.
* **Mobile & TV Container**: Capacitor 8 with custom WebChromeClient permissions and Leanback launcher intent.
* **Signaling Backend**: Hosted on user's AWS EC2 server (`18.234.224.25:3000`), Node.js, Express, Socket.IO v4.
* **Media & NAT Traversal**:
  * **Primary (1st Priority)**: Google Public STUN (`stun:stun.l.google.com:19302`)
  * **Secondary (2nd Priority)**: User AWS EC2 STUN Server (`stun:18.234.224.25:3478`)
  * **Relay Fallback**: User AWS EC2 TURN Server (`turn:18.234.224.25:3478`)
* **CI/CD Pipeline**: GitHub Actions automated compilation with release keystore signing.

---

## 📦 Building the Android / Fire TV APK

### Via GitHub Actions (Recommended)
1. Push your changes to the `main` branch or trigger the **Build Official Signed ZingTalk APK** workflow under the **Actions** tab.
2. The workflow will automatically compile the project with Java 21 and output `ZingTalk.apk`.

### Manual Build
```bash
npm run build
npx cap sync android
node scripts/prepare-android.js
cd android && ./gradlew assembleRelease
```

---

## 🔒 Security & Privacy

For full details on our zero-retention data architecture, please consult:
* [Privacy Policy](PRIVACY_POLICY.md)
* [Terms of Service](TERMS_OF_SERVICE.md)

---

## 📄 License & Confidentiality

**PROPRIETARY AND CONFIDENTIAL**  
Copyright (c) 2026 KM MAMATA / Sunny (zingarenaoffi1@gmail.com). All Rights Reserved.

This software, source code, and associated materials are proprietary, private, and confidential. Prepared and submitted exclusively for evaluation by the **Amazon Hackathon Judging Committee**.
