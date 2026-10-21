# Privacy Policy for ZingTalk

**Effective Date**: October 18, 2026  
**Application Name**: ZingTalk (`com.zingtalk.com`)  
**Developer Contact**: `zingarenaoffi1@gmail.com`  
**Platform**: Android TV, Amazon Fire TV & Fire TV Stick (Leanback OS)  
**Target Audience**: Families, Seniors, and Elderly Parents (Living Room TV Accessibility)

---

## 1. Introduction, Core Philosophy & Intended Purpose

Welcome to **ZingTalk**. ZingTalk is an accessible, 10-foot living-room communication platform engineered primarily to bridge the digital divide for **elderly parents, senior citizens, and families**. By pairing a high-contrast Smart TV interface with Amazon Alexa hands-free voice control, ZingTalk empowers older adults to initiate video and audio calls with their loved ones directly from their living room sofa without the physical strain of small smartphone touchscreens, SIM cards, or complex password menus.

We believe that personal family communication must remain strictly private, decentralized, and ephemeral. ZingTalk is built on an uncompromising **Zero Server Storage Architecture**: we do not store, archive, or monetize your private text chats, audio recordings, video streams, or contacts on any central cloud database or persistent disk.

Your communications belong exclusively to you and the family members you connect with.

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

### A. Authentication & User Profile
- **Randomized 10-Digit Unique Identifier (UID)**: Each user is allocated an anonymous 10-digit numeric ID (e.g., `2156774755`). This replaces phone numbers, SIM card telemetry, and hardware IMEI identifiers, protecting user anonymity.
- **Contacts Directory (100% Local Device Storage)**: Saved contacts (Name and 10-Digit UID) reside **strictly inside your local device memory** (`localStorage` / local device preferences). Contacts are **NEVER saved to Firebase Firestore, nor backed up to any cloud database**. During an active TV session, local contacts are mirrored solely in volatile in-memory RAM for real-time Alexa voice intent matching (e.g. *"Alexa, call Rahul"*), and are instantly purged from RAM upon sign out or disconnection. Contacts remain completely private to your device.

### B. Device Permissions
- **Microphone**: Required exclusively during active audio and video calls. The microphone is active only while a call is in progress.
- **Camera**: Required exclusively during active video calls. Camera video is transmitted directly peer-to-peer and is immediately terminated when the call ends.
- **Network / Internet**: Required for WebSocket signaling, STUN NAT traversal, and peer connectivity.

---

## 4. Amazon Alexa Voice Integration Privacy

ZingTalk integrates with Amazon Alexa skills to provide hands-free voice dialing for senior citizens and elderly parents:
- **Voice Intents Only**: Alexa interactions send high-level intent commands (e.g., `call Rahul` or `end call`) via a secure HTTPS webhook (`/api/alexa`).
- **No Voice Audio Transferred**: Spoken audio is processed by Amazon's Alexa hardware; ZingTalk never receives, records, or stores any raw audio recordings or spoken transcripts.
- **Device-Specific Pairing**: Alexa commands are routed strictly to your specific paired 10-digit UID room, preventing cross-device interference.

---

## 5. Security & Network Traversal (STUN / TURN)

- **Primary STUN**: Industry-standard Google STUN endpoints (`stun.l.google.com:19302`) are queried initially to discover public IP addresses for direct peer routing.
- **Failover Relay**: If both devices are behind symmetric firewalls or restricted NAT, encrypted fallback traversal via secure STUN/TURN (`18.234.224.25:3478`) is engaged. All relayed packets remain end-to-end encrypted.

---

## 6. User Rights & Complete Data Control

- **Right to Erasure**: You can wipe all local chat history and cached contacts instantly by clicking the Sign Out button or clearing app data in your device Settings.
- **Account Deletion**: You can request immediate removal of your account, email, and 10-digit UID mapping by contacting `zingarenaoffi1@gmail.com`.
- **Private Data Protection**: ZingTalk never sells, leases, or exposes your private personal conversations, audio, or video streams to third parties.

---

## 7. Age Restriction & Audience Intent (Not for Children Under 13)

- **Audience Focus**: ZingTalk is explicitly designed and marketed as an assistive living-room communication tool for **elderly parents, senior citizens, and adult family caregivers**.
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
- **Developer / Account Owner**: KM MAMATA / Sunny (Founder of ZingTalk)
