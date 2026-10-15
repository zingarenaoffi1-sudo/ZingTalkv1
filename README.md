# ZingTalk 📺⚡

> **Next-Generation Real-Time Communication Platform Built Exclusively for Amazon Fire TV**  
> *Engineered for Amazon Fire TV & Alexa Voice Control*  
> **Confidential & Proprietary Submission for Amazon Hackathon**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer--to--Peer-blue.svg)](https://webrtc.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4-black.svg)](https://socket.io/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Fire%20TV-blueviolet.svg)](https://capacitorjs.com/)
[![Judges Guide](https://img.shields.io/badge/Judges%20Guide-Interactive%20Testing%20Manual-brightgreen.svg)](TESTING_GUIDE.md)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license)

---

## 🌟 Overview

**ZingTalk** turns any Amazon Fire TV into an instant, private, voice-activated video calling and messaging hub. Traditional communication apps require mobile phone numbers, SIM cards, and invasive account tracking, storing gigabytes of personal chats on centralized disks. 

ZingTalk re-engineers communication from first principles with **Zero Server Retention**, **10-Digit Anonymous UIDs**, and a native **10-Foot Leanback UI** navigable with Amazon Fire TV remotes (D-Pad navigation) and Alexa voice commands.

---

## 🚀 Key Features

* **🔑 10-Digit Anonymous UIDs**: No phone numbers, no SIM cards, and no personal credentials required. Each Fire TV receives a clean 10-digit ID in seconds.
* **🛡️ Zero Server Retention (Ephemeral Privacy)**:
  * Audio and video streams flow directly peer-to-peer via **WebRTC DTLS-SRTP** encryption.
  * Chat messages are relayed exclusively through volatile server RAM and permanently purged upon delivery. No persistent chat logs on server storage.
* **🎮 10-Foot Leanback UI (Fire TV Remote & D-Pad Optimized)**: Complete directional navigation (D-Pad Up, Down, Left, Right, Select/Enter, Back) engineered specifically for big-screen television viewing distances.
* **🎙️ Amazon Alexa Voice Integration**: Dedicated Alexa Skill webhook integration (`/api/alexa`) enabling hands-free voice commands:
  * *"Alexa, call Rahul on ZingTalk"*
  * *"Alexa, answer call"*
  * *"Alexa, mute microphone"*
  * *"Alexa, end call"*
* **⚡ Sub-Second Latency Architecture**: Lightweight WebSocket signaling pipeline hosted on the user's dedicated AWS EC2 instance paired with multi-tier STUN/TURN failover for rapid NAT traversal.
* **📦 Lightweight Native 4MB Fire TV APK**: Dedicated Android TV / Fire TV native application bundle running on Amazon Fire TV devices with zero bloat.

---

## 🏗️ Architecture & Technology Stack

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                        ZingTalk Fire TV Client                         │
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
* **Fire TV Container**: Capacitor 8 with custom WebChromeClient permissions and Leanback launcher intent (`android.intent.category.LEANBACK_LAUNCHER`).
* **Signaling Backend**: Hosted on user's AWS EC2 server (`18.234.224.25:3000`), Node.js, Express, Socket.IO v4.
* **Media & NAT Traversal**:
  * **Primary (1st Priority)**: Google Public STUN (`stun:stun.l.google.com:19302`)
  * **Secondary (2nd Priority)**: User AWS EC2 STUN Server (`stun:18.234.224.25:3478`)
  * **Relay Fallback**: User AWS EC2 TURN Server (`turn:18.234.224.25:3478`)
* **CI/CD Pipeline**: GitHub Actions automated compilation with release keystore signing.

---

## 🧪 Judges & Evaluation Guide (How to Test ZingTalk)

> **For the Amazon Hackathon Judging Panel**:  
> For the complete exhaustive testing manual with exact curl payloads, WebRTC inspection steps, and Alexa Skill simulator inputs, please refer to the dedicated guide:  
> 👉 **[TESTING_GUIDE.md — Official Hackathon Evaluation & Testing Manual](TESTING_GUIDE.md)**

### ⚠️ Critical Architecture Note for Judges: Native Fire TV APK vs. HTTPS Web Browser

> **IMPORTANT**: ZingTalk is built strictly as a **Native Amazon Fire TV Application (APK)**, not a public browser website.
> 
> * **AWS EC2 Production Signaling**: The production signaling server runs on our dedicated AWS EC2 instance at `http://18.234.224.25:3000`.
> * **Browser Mixed-Content Policy**: If you attempt to open an HTTPS web preview URL in a desktop browser (Chrome, Edge, Safari), the browser will **block the WebSocket signaling connection** due to the browser's standard **Mixed Content Security Policy** (blocking unencrypted HTTP/WebSocket requests initiated from HTTPS pages).
> * **Native Fire TV APK Compatibility**: In the **Real Fire TV APK (`ZingTalk.apk`)**, native Android cleartext traffic permissions (`android:usesCleartextTraffic="true"`) and network security configurations (`network_security_config.xml`) allow direct, high-speed, sub-second communication with the AWS EC2 server.

---

### 📱 Official Evaluation Method: Sideload & Test the Native Fire TV APK

This is the primary and recommended method for the Amazon Hackathon Judging Panel:

1. **Obtain the APK**: Download the pre-built `ZingTalk.apk` from GitHub Actions Release Artifacts or build locally (`./gradlew assembleRelease`).
2. **Enable Fire TV Developer Options**:
   * On Fire TV: **Settings** > **My Fire TV** > **About** > Click device name 7 times.
   * Go to **Developer Options** > Enable **ADB Debugging** and **Apps from Unknown Sources**.
3. **Connect and Install via ADB**:
   ```bash
   adb connect <FIRE_TV_IP_ADDRESS>:5555
   adb install -r ZingTalk.apk
   ```
4. **Launch the Native Leanback App**:
   ```bash
   adb shell monkey -p com.zingtalk.com -c android.intent.category.LEANBACK_LAUNCHER 1
   ```
5. **Evaluate Live Calling & Ephemeral Chat**:
   * Launch `ZingTalk.apk` on two Fire TV devices (or one physical Fire TV and one Android TV/Fire OS Emulator).
   * Click **Guest Mode**, enter a TV Name (e.g., `Living Room TV` on Device A, `Bedroom TV` on Device B), and click **Start as Guest**.
   * Note the unique **10-Digit Anonymous UIDs** generated on each device.
   * Enter Device B's UID in Quick Connect on Device A and press **💬 Chat** or **🎥 Video Call**.
   * Instant sub-second WebRTC audio/video and RAM-only messaging is established!

---

### 💻 Local HTTP Developer Simulation (Without Mixed Content)

If an evaluator wishes to inspect the interface and signaling quickly on a computer without a physical Fire TV:

1. Clone the repository and run the local Node server:
   ```bash
   npm install
   npm start
   ```
2. Open **`http://localhost:3000`** in your browser.  
   *(Because `http://localhost:3000` is pure HTTP, the browser does NOT enforce HTTPS mixed-content blocking against `http://18.234.224.25:3000`, allowing live signaling simulation).*
3. Use keyboard navigation (`Arrow` keys, `Enter`, `Escape`) to simulate Fire TV Remote D-Pad controls.

---

### 🎮 Amazon Fire TV Remote & D-Pad Keyboard Controls
ZingTalk replaces mobile touch with a certified 10-foot TV directional navigation model:
* **D-Pad Directional Arrows**: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` (Spatial focus traversal with neon cyan halo glow `#00d29d`).
* **Select / Enter**: `Enter` (Activate buttons, open inputs, select tabs).
* **Back**: `Escape` / `Backspace` (Close modals, dismiss calls, exit chat).

### 🎙️ Alexa Voice Control & Webhook Testing
ZingTalk provides a live Alexa Skill webhook at `POST /api/alexa`. Judges can test hands-free voice control via the **Alexa Developer Console Simulator** or terminal curl commands:
* *"Alexa, open ZingTalk"* — Greets user and lists saved contacts.
* *"Alexa, pair UID 4819203841"* — Binds your Alexa device exclusively to your TV screen.
* *"Alexa, call Rahul on ZingTalk"* — Looks up saved contact and triggers outgoing call.
* *"Alexa, call UID 4819203841"* — Direct 10-digit voice dialing.
* *"Alexa, answer call"* — Answers incoming call hands-free.
* *"Alexa, mute microphone"* / *"Alexa, unmute"* — Toggles hardware microphone track.
* *"Alexa, end call"* — Terminates active peer connection.

*(See [TESTING_GUIDE.md](TESTING_GUIDE.md) for full JSON payloads and curl commands).*

---

## 📦 Building the Fire TV APK

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
* [Testing & Evaluation Guide](TESTING_GUIDE.md)

---

## 📄 License & Confidentiality

**PROPRIETARY AND CONFIDENTIAL**  
Copyright (c) 2026 KM MAMATA / Sunny (zingarenaoffi1@gmail.com). All Rights Reserved.

This software, source code, and associated materials are proprietary, private, and confidential. Prepared and submitted exclusively for evaluation by the **Amazon Hackathon Judging Committee**.
