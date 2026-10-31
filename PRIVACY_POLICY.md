# Privacy Policy for ZingTalk

**Effective Date**: October 30, 2026  
**Application Name**: ZingTalk (`com.zingtalk.com`)  
**Developer / Organization**: ZingTalk Developer Team  
**Support & Owner Contact**: `zingarenaoffi1@gmail.com`  
**Platforms Supported**: 
- **Amazon Fire TV & Fire TV Stick**: 10-Foot Living Room UI with D-Pad Remote & Alexa Voice Integration
- **Android Mobile**: Handheld Touchscreen UI with Portrait Video Calling & Camera Flip Controls
**Signaling Domain**: `https://zingtalk.duckdns.org` (WSS & HTTPS Port 3000 / 443 SSL Proxy)  
**STUN / TURN Relays**: `zingtalk.duckdns.org:3478`

---

## 1. Introduction & Multi-Platform Architecture

Welcome to **ZingTalk**. ZingTalk is a privacy-first, decentralized real-time communication platform built with two distinct client experiences sharing a unified high-performance signaling engine:

1. **Amazon Fire TV Client (`packages/tv`)**: Designed specifically for the living room sofa experience, elderly parents, and families. Features high-contrast oversized leanback elements, physical D-Pad remote spatial navigation, and hands-free Amazon Alexa Voice Skills control.
2. **Android Mobile Client (`packages/mobile`)**: Designed for modern handheld smartphones. Features a touch-first interface, bottom navigation, native incoming/outgoing call overlays, floating local video PIP, and front/rear camera switching without TV remote or Alexa requirements.

We believe that personal communication must remain strictly private, decentralized, and ephemeral. ZingTalk operates on an uncompromising **Zero Server Storage Architecture**: we do not store, archive, or monetize your private text chats, audio recordings, video streams, or contacts on any central cloud database or persistent server disk.

---

## 2. Zero Server Retention (Ephemeral Messaging & P2P Media)

### A. Real-Time Chat & Text Messages
- **No Cloud Database for Chats**: ZingTalk servers **DO NOT** write, store, index, or archive your text messages in any database (SQL, NoSQL, Firebase Firestore, or disk logs).
- **Instant Memory Delivery & Automatic Purge**: Messages are relayed in real-time through encrypted WebSockets. If the recipient is temporarily offline, the encrypted payload is held temporarily in volatile server RAM solely until delivery. The millisecond the recipient connects and receives the message, it is permanently and irreversibly purged from memory.
- **Client-Side Storage**: Chat history resides **exclusively inside your local device memory** (`localStorage` / local storage). Clearing your app cache or signing out permanently deletes all message records.

### B. High-Definition Audio & Video Calls
- **Direct WebRTC Peer-to-Peer Encryption**: All video and audio streams flow directly from device to device using WebRTC (Web Real-Time Communication) with DTLS-SRTP military-grade end-to-end encryption.
- **Zero Media Recording**: No video or audio passes through any recording software, CDN, or cloud storage. Our backend server acts solely as an ephemeral signaling coordinator to exchange network connection addresses (SDP/ICE), never touching the audio/video media itself.

---

## 3. Information We Collect & How It Is Used

### A. Authentication & Anonymous 10-Digit Identity
- **Randomized 10-Digit Unique Identifier (UID)**: Each user is allocated an anonymous 10-digit numeric ID (e.g., `2156774755`). This replaces phone numbers, SIM card telemetry, and hardware IMEI identifiers, protecting user anonymity.
- **Contacts Directory (100% Local Device Storage)**: Saved contacts (Name and 10-Digit UID) reside **strictly inside your local device memory** (`localStorage` / local device preferences). Contacts are **NEVER saved to Firebase Firestore, nor backed up to any cloud database**. During an active TV session, local contacts are mirrored solely in volatile in-memory RAM for real-time Alexa voice intent matching (e.g. *"Alexa, call Rahul"*), and are instantly purged from RAM upon sign out or disconnection. Contacts remain completely private to your device.

### B. Device Hardware Permissions
- **Microphone**: Required exclusively during active audio and video calls. The microphone is active only while a call is in progress.
- **Camera**: Required exclusively during active video calls. Camera video is transmitted directly peer-to-peer and is immediately terminated when the call ends. Mobile users have a one-tap flip camera feature to switch between front and back cameras.
- **Network / Internet**: Required for WebSocket signaling, STUN NAT traversal, and peer connectivity.

---

## 4. Amazon Alexa Voice Integration Privacy (Exclusively for Fire TV)

ZingTalk integrates with Amazon Alexa Skills to provide hands-free voice dialing for senior citizens and elderly parents **exclusively on Amazon Fire TV**:

- **Strictly for Fire TV (Not Mobile)**: Alexa voice skill integration is engineered exclusively for Fire TV remotes and living-room screens. The mobile app operates independently via standard touch gestures.
- **Voice Intents Only**: Alexa interactions send high-level intent commands (e.g., `call Rahul`, `answer call`, `mute microphone`, `hang up`, `toggle camera`, `redial`, or `pair UID`) via a secure HTTPS webhook (`/alexa` or `/api/alexa`).
- **No Spoken Audio Transferred to ZingTalk**: Spoken audio is processed by Amazon's Alexa platform according to Amazon's privacy standards; ZingTalk never receives, records, or stores any raw audio recordings or spoken transcripts.
- **Device-Specific Pairing**: Alexa commands are routed strictly to your specific paired 10-digit UID room, preventing cross-device interference.

---

## 5. Security & Network Traversal (STUN / TURN)

- **Primary STUN**: Industry-standard Google STUN endpoints (`stun.l.google.com:19302`) are queried initially to discover public IP addresses for direct peer routing.
- **Failover Relay**: If both devices are behind symmetric firewalls or restricted NAT, encrypted fallback traversal via secure STUN/TURN (`zingtalk.duckdns.org:3478`) is engaged. All relayed packets remain end-to-end encrypted.

---

## 6. User Rights & Complete Data Control

- **Right to Erasure**: You can wipe all local chat history and cached contacts instantly by clicking the Sign Out button or clearing app data in your device Settings.
- **Account Deletion**: You can request immediate removal of your account, email, and 10-digit UID mapping by contacting `zingarenaoffi1@gmail.com`.
- **Private Data Protection**: ZingTalk never sells, leases, or exposes your private personal conversations, audio, or video streams to third parties.

---

## 7. Age Restriction & Audience Intent (Not for Children Under 13)

- **Audience Focus**: ZingTalk is explicitly designed and marketed as an assistive communication tool for **elderly parents, senior citizens, and adult family caregivers**.
- **Not for Children**: ZingTalk is **NOT designed for, marketed to, or intended for use by unsupervised children under the age of 13**.
- **COPPA & GDPR-K Compliance**: ZingTalk does not knowingly harvest, collect, or solicit personal information from children under 13. If you believe a child under 13 has registered or provided personal information without parental consent, please contact us immediately at `zingarenaoffi1@gmail.com` and we will promptly terminate the account and purge any associated identifiers.

---

## 8. No Emergency Services Disclaimer

**CRITICAL NOTICE**: ZingTalk is an internet-based over-the-top communication service and is **NOT a replacement for traditional landline or mobile telephone services**. ZingTalk **CANNOT** be used to contact emergency services (such as 911, 112, 999, or ambulance/police/fire dispatchers). Families and caregivers of elderly users must ensure that alternative emergency telephone equipment is always accessible in the home.

---

## 9. Updates to this Policy

We may periodically update this Privacy Policy to reflect technical enhancements or regulatory standards. Any modifications will be displayed directly within the application's Privacy Policy screen and repository with a revised Effective Date.

---

## 10. Contact Developer

If you have any questions, suggestions, or privacy requests regarding ZingTalk, please contact:
- **Email**: `zingarenaoffi1@gmail.com`
- **Application Package**: `com.zingtalk.com`
- **Developer / Organization**: ZingTalk Developer Team
- **Owner Contact**: `zingarenaoffi1@gmail.com`
