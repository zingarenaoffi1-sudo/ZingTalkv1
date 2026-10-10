# ZingTalk 📺⚡

> **Next-Generation TV-First Real-Time Communication Platform**  
> *Optimized for Amazon Fire TV, Smart TVs, Android Devices & Alexa Voice Control*

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer--to--Peer-blue.svg)](https://webrtc.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4-black.svg)](https://socket.io/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Android%20TV-blueviolet.svg)](https://capacitorjs.com/)
[![License](https://img.shields.io/badge/License-MIT-orange.svg)](#license)

---

## 🌟 Overview

**ZingTalk** turns any living room television or screen into an instant, private, voice-activated video calling hub. Traditional communication apps require mobile phone numbers, SIM cards, and invasive account tracking, storing gigabytes of personal chats on centralized disks. 

ZingTalk re-engineers communication from first principles with **Zero Server Retention**, **10-Digit Anonymous UIDs**, and a native **10-Foot Leanback UI** navigable with standard TV remotes and Alexa voice commands.

---

## 🚀 Key Features

* **🔑 10-Digit Anonymous UIDs**: No phone numbers, no SIM cards, and no personal credentials required. Each device or television receives a clean 10-digit ID in seconds.
* **🛡️ Zero Server Retention (Ephemeral Privacy)**:
  * Audio and video streams flow directly peer-to-peer via **WebRTC DTLS-SRTP** encryption.
  * Chat messages are relayed exclusively through volatile server RAM and permanently purged upon delivery. No persistent chat logs on server storage.
* **🎮 10-Foot Leanback UI (TV Remote Optimized)**: Complete directional navigation (D-Pad Up, Down, Left, Right, Select/Enter, Back) designed specifically for big-screen television viewing distances.
* **🎙️ Amazon Alexa Voice Integration**: Full Alexa Skill webhook integration (`/api/alexa`) enabling hands-free voice commands:
  * *"Alexa, call Rahul on ZingTalk"*
  * *"Alexa, answer call"*
  * *"Alexa, mute microphone"*
  * *"Alexa, end call"*
* **⚡ Sub-Second Latency Architecture**: Lightweight WebSocket signaling pipeline hosted on AWS EC2 paired with Google Public STUN servers for rapid NAT traversal.
* **📱 Cross-Platform Uniformity**: Runs seamlessly as a modern Web App, Progressive Web App (PWA), and a lightweight 4MB native Android/Fire TV APK.

---

## 🏗️ Architecture & Technology Stack

```
   ┌──────────────────────────────────────────────────────────────┐
   │                       ZingTalk Frontend                      │
   │  (Vanilla ES Modules + HTML5 Leanback UI + Capacitor Bridge) │
   └───────────────┬───────────────────────────────┬──────────────┘
                   │                               │
         WebSocket Signaling               WebRTC P2P Stream
       (ICE, SDP, Relay)                (DTLS-SRTP Video/Audio)
                   │                               │
                   ▼                               ▼
   ┌──────────────────────────────┐    ┌──────────────────────────┐
   │      AWS EC2 Backend         │    │    Google Public STUN    │
   │  (Node.js + Socket.IO v4)    │    │ (stun.l.google.com:19302)│
   └───────────────┬──────────────┘    └──────────────────────────┘
                   │
           Alexa Skill Hook
            (/api/alexa)
                   │
                   ▼
   ┌──────────────────────────────┐
   │    Amazon Alexa Devices      │
   │  (Echo, Fire TV Voice Remote)│
   └──────────────────────────────┘
```

* **Frontend**: Vanilla ES Modules, CSS3 responsive grid with TV-safe boundaries, Web Audio API synthetic chimes.
* **Mobile & TV Container**: Capacitor 8 with custom WebChromeClient permissions and Leanback launcher intent.
* **Signaling Backend**: Node.js, Express, Socket.IO v4.
* **Media Protocol**: WebRTC (Audio Processing: AEC, ANS, AGC).
* **CI/CD Pipeline**: GitHub Actions automated compilation with release keystore signing.

---

## 🛠️ Quick Start

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/zingarenaoffi1/ZingTalk.git
   cd ZingTalk
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local server**:
   ```bash
   npm start
   ```

4. **Access the application**:
   Open `http://localhost:3000` in your browser.

---

## 📦 Building the Android / Fire TV APK

### Via GitHub Actions (Recommended)
1. Push your changes to the `main` branch or trigger the **Build Official Signed ZingTalk APK** workflow under the **Actions** tab.
2. The workflow will automatically compile the project with Java 21 and output `ZingTalk.apk`.

### Manual Local Build
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

## 📄 License

This project is open-source under the [MIT License](LICENSE).
