# 🚀 ZINGTALK MASTER CONTEXT & ARCHITECTURE MEMORY
> **Founder:** 14-Year-Old Developer (`zingarenaoffi1@gmail.com`)  
> **Hardware:** 14+ Year-Old PC with only 2GB RAM (No TV at home)  
> **Event:** Amazon Fire TV & Alexa Innovation Hackathon  
> **Live Backend:** AWS EC2 (`http://18.234.224.25:3000`)  
> **App Name:** ZingTalk (TV-First Real-Time Communication Platform)

---

## 📌 1. The Inspiring Founder Backstory (फाउंडर प्रोफाइल)
* **Who is the Developer:** A 14-year-old passionate prodigy and hacker from India.
* **Extreme Constraints:** Developed on an old laptop with only **2GB RAM** (which cannot run heavy local Android Studio or local emulators) and **no physical Smart TV** at home.
* **The Ingenious Solution (Cloud-First Hacker Mindset):**
  1. Offloaded heavy Android APK compilation completely to the cloud via **GitHub Actions CI/CD (`build.yml`)**.
  2. Solved the lack of physical test hardware by using **AWS Device Farm** in the cloud (testing on physical devices in Oregon/Virginia racks in a 50-50 split screen).
  3. Hosted the 24/7 signaling and WebRTC backend on **Amazon AWS EC2 Ubuntu** (`18.234.224.25:3000`).
  4. Created a lightweight, standalone 4MB APK capable of sub-second real-time video calling.

---

## 🎯 2. ZingTalk: Core Vision & Purpose (प्रोजेक्ट का उद्देश्य)
Conventional calling apps (WhatsApp, Zoom, Google Meet) are designed for mobile screens, require SIM cards, phone numbers, and phone verification, and store chat logs on servers.
**ZingTalk** turns any living room Fire TV into a private, instant, voice-activated video calling screen for families, kids, and grandparents.

### 4 Core Pillars:
1. **No Phone Number / No SIM (10-Digit Anonymous UID):**
   * Every user or TV gets a unique 10-digit random identifier (e.g. `8492049182`).
   * No personal cell phone number, IMEI, or invasive tracking needed.
2. **Zero Server Retention (100% Ephemeral Privacy):**
   * Messages and media are transmitted via real-time WebSockets and WebRTC P2P DTLS-SRTP encrypted tunnels.
   * **Zero disk storage:** Messages are relayed through volatile server RAM solely until delivery (WhatsApp single-tick buffer) and immediately purged the moment they are received.
3. **10-Foot Leanback UI (TV Remote Optimized):**
   * Fully controllable with a standard Fire TV remote control using D-Pad navigation (Up, Down, Left, Right, Enter, Back).
4. **Amazon Alexa Voice First Integration:**
   * Controlled via voice commands from Fire TV voice remote or Alexa Echo devices (e.g. *"Alexa, call Rahul on ZingTalk"*, *"Alexa, answer call"*, *"Alexa, mute mic"*, *"Alexa, hang up"*).

---

## 🛠️ 3. Full Technical Architecture & Stack

### Backend Infrastructure:
* **Server:** Node.js, Express, Socket.IO v4 running on **AWS EC2 Ubuntu** (`http://18.234.224.25:3000`).
* **WebRTC STUN / NAT Traversal:**
  * **1st Priority:** Google Public STUN (`stun:stun.l.google.com:19302`, `stun1`, `stun2`, `stun3`, `stun4`).
  * **Backup:** AWS EC2 STUN (`stun:18.234.224.25:3478`) & Twilio STUN (`stun:global.stun.twilio.com:3478`).
* **Live Connection Verifier (`isUserOnline`):**
  * Verifies live socket status before routing calls so ghost/dead connections never hang callers.
* **Server URL Locking:**
  * App explicitly connects to `http://18.234.224.25:3000`. Never routes to GitHub Pages as a backend.

### Frontend & TV Runtime:
* **Framework:** Vanilla JavaScript (ES Modules), HTML5, CSS3 Leanback UI (Zero bloat, high FPS).
* **Audio Engine:** Web Audio API 2-tone synthetic chime (no external MP3/WAV assets required). Mono 48kHz with software Echo Cancellation (AEC), Noise Suppression (ANS), and Auto Gain Control (AGC) for TV soundbars.
* **Mobile/TV Wrapper:** Capacitor 8 (`@capacitor/android`, `@capacitor/core`, `@capacitor/cli`).
* **Android Settings:** Cleartext HTTP allowed in `network_security_config.xml`, TV Leanback Category enabled in `AndroidManifest.xml`, screen orientation locked to landscape, WakeLock enabled to prevent sleep.

### Alexa Skills Kit Integration:
* **Skill Endpoint:** POST `/api/alexa` on the server.
* **Custom Intents Supported:**
  * `ZingaudioCallIntent` & `ZingvideoIntent` (e.g., "call {contact}")
  * `ZingPairAccountIntent` (e.g., "pair UID {uid}")
  * `ZingAnswerCallIntent` & `ZingRejectCallIntent`
  * `ZingMuteMicIntent` & `ZingUnmuteMicIntent`
  * `ZingTurnOffCameraIntent` & `ZingTurnOnCameraIntent`
  * `ZingEndCallIntent` & `ZingDialUidIntent`
* **Real-Time Relay:** Alexa webhook dispatches `alexa_command` socket event directly to the paired TV room.

---

## 🎬 4. The 3-Minute Zero-Editing Demo Video Master Plan
*(Used for live video recording without fancy editing)*

### Pre-Setup:
* Split computer screen 50-50 (Left side: AWS Device Farm Phone 1, Right side: AWS Device Farm Phone 2).
* Install ZingTalk APK on both cloud phones and turn on screen recording.

### Step 1: The Intro & Guest Mode (0:00 - 0:45)
* **Script:** *"Hello Judges! I am a 14-year-old developer. I built ZingTalk on a 14-year-old 2GB RAM laptop, so I am running this live demo entirely on AWS Device Farm."*
* **Action:** Click "Guest Mode" on both screens simultaneously.
* **Highlight:** Show how both devices instantly receive unique 10-digit UIDs in under 3 seconds without typing emails or passwords.

### Step 2: Live Chat & Sub-Second AWS Signaling (0:45 - 1:30)
* **Action:** Type the Right Phone's 10-digit UID on the Left Phone, open chat, type *"Hello AWS!"*, and press Send.
* **Script:** *"Let's test the live AWS EC2 signaling."*
* **Highlight:** The message appears on the Right Phone in a fraction of a second, proving sub-second latency and WebSocket relay.

### Step 3: The Climax — WebRTC HD Calling (1:30 - 2:30)
* **Action:** On Left Phone, press Video Call button.
* **Highlight:** Right Phone immediately rings with incoming call prompt and chime. Click "Accept" on Right Phone.
* **The Genius Camera Hook:**
  * **Script:** *"Since these physical AWS devices are locked inside dark data center server racks in Oregon/Virginia, the camera feed is dark. But as you can see, the WebRTC peer connection is 100% active and connected via Google STUN with live call duration and mute controls!"*
* **Action:** Show the live ticking call timer (`00:15 • HD Video`), toggle Mute button, and press End Call.

### Step 4: Confident Outro (2:30 - 3:00)
* **Script:** *"Zero storage, full privacy, and seamless voice-first TV communication. Built end-to-end using AWS EC2, Device Farm, Alexa Skills Kit, and WebRTC. Thank you!"*

---

## 🛡️ 5. Critical Bugs Solved & Lessons Learned
1. **GitHub Pages URL Mismatch:** Locked server URL explicitly to AWS EC2 (`http://18.234.224.25:3000`) so web clients never misidentify GitHub Pages as a backend.
2. **Guest UID Persistence:** Fixed server logic to preserve existing 10-digit UIDs across page refreshes and socket reconnections.
3. **Android `@drawable/banner.png` Fix:** Created and injected `banner.png` so AAPT Gradle builds never fail.
4. **Ghost Ringing Prevention:** Added 45-second auto-timeouts on outgoing and incoming call prompts.
5. **Autoplay Policy Fallback:** Added user interaction listeners so audio/video plays smoothly on all devices.
6. **Leanback D-Pad Enter Fix:** Separated mini call button key events from contact card open events on TV remotes.

---
*Save this document to provide complete project context in any conversation with Gemini.*
