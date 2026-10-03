# Privacy Policy for ZingTalk

**Effective Date**: October 3, 2026  
**Application Name**: ZingTalk (`com.zingtalk.com`)  
**Developer Contact**: `zingarenaoffi1@gmail.com`  
**Platform**: Android TV, Amazon Fire TV & Fire TV Stick (Leanback OS)

---

## 1. Introduction & Core Philosophy
Welcome to **ZingTalk**. We believe that personal communication must be private, decentralized, and ephemeral. ZingTalk is built on a **Zero Server Retention** architecture: we do not store your private text chats, audio recordings, video streams, or media on any persistent server. 

Your conversations belong exclusively to you and the person you are communicating with.

---

## 2. Zero Server Retention (Ephemeral Messaging & P2P Media)

### A. Real-Time Chat & Text Messages
- **No Central Server Database for Chat**: ZingTalk servers **DO NOT** write, store, or archive your text messages in any database (SQL, NoSQL, Firestore, or disk logs).
- **Instant Memory Delivery & Automatic Purge**: Messages are relayed in real-time through active WebSockets. If the recipient is temporarily unreachable, the encrypted payload is held temporarily in volatile server RAM **only until the recipient connects**. The moment the message is delivered, it is **instantly and permanently purged** from server memory.
- **Client-Side Storage**: Message history is stored **exclusively on your local device** (`localStorage` / local device storage). Clearing app storage deletes your history entirely.

### B. High-Definition Audio & Video Calls
- **Direct WebRTC Peer-to-Peer Encryption**: All video and audio streams flow directly from device to device using WebRTC (Web Real-Time Communication) with DTLS-SRTP military-grade end-to-end encryption.
- **Zero Media Recording**: No video or audio passes through any recording software, CDN, or cloud storage. Our backend server acts solely as a signaling coordinator to exchange network connection addresses (SDP/ICE), never touching the audio/video media itself.

---

## 3. Information We Collect & How It Is Used

### A. Authentication & User Profile
- **Randomized 10-Digit Unique Identifier (UID)**: Each user is allocated a unique 10-digit numeric ID (e.g. `2156774755`). This replaces phone numbers and physical SIM card identifiers, preserving user anonymity.
- **Google Sign-In / Email Authentication**: We use Google Firebase Authentication strictly to verify identity and enable cloud contact synchronization across your devices. We only store your email, display name, and your 10-digit UID.
- **Contacts Directory**: Your saved contacts (Name and 10-Digit UID) are stored so that you can quickly initiate calls or send messages. Contacts are private to your account.

### B. Device Permissions
- **Microphone**: Required exclusively during active audio and video calls. The microphone is active only while a call is in progress.
- **Camera**: Required exclusively during active video calls. Camera video is transmitted directly peer-to-peer and is immediately terminated when the call ends.
- **Network / Internet**: Required for WebSocket signaling, STUN NAT traversal, and peer connectivity.

---

## 4. Amazon Alexa Voice Integration Privacy

ZingTalk integrates with Amazon Alexa skills to allow remote-free voice dialing on Smart TVs:
- **Voice Intents Only**: Alexa interactions send high-level intent commands (e.g., `call Rahul` or `end call`) via a secure HTTPS webhook (`/api/alexa`).
- **No Voice Audio Transferred**: Your spoken voice is processed by Amazon's Alexa hardware; ZingTalk never receives, records, or stores any raw audio recordings or voice transcripts.
- **Device-Specific Pairing**: Alexa commands are routed strictly to your specific paired 10-digit UID using room isolation.

---

## 5. Security & Network Traversal (STUN / TURN)

- **Primary STUN**: Industry-standard Google STUN endpoints (`stun.l.google.com:19302`) are queried initially to discover public IP addresses for direct peer routing.
- **Failover Relay**: If both devices are behind symmetric firewalls or restricted NAT, encrypted fallback traversal via secure STUN/TURN (`18.234.224.25:3478`) is engaged. All relayed packets remain end-to-end encrypted.

---

## 6. User Rights & Complete Data Control

- **Right to Clear Data**: You can wipe all local chat history and cached contacts instantly by clearing app data in your device Settings or signing out.
- **Account Deletion**: You can request immediate removal of your account, email, and 10-digit UID mapping from Firebase by contacting `zingarenaoffi1@gmail.com`.
- **No Third-Party Advertising / Data Selling**: ZingTalk does not sell, rent, monetize, or share your data with advertisers, third-party data brokers, or marketing networks.

---

## 7. Children's Privacy
ZingTalk does not knowingly harvest personal information from children under the age of 13.

---

## 8. Updates to this Policy
We may periodically update this Privacy Policy. Any modifications will be displayed directly within the application's Privacy Policy screen.

---

## 9. Contact Developer
If you have any questions, suggestions, or privacy requests regarding ZingTalk, please contact:
- **Email**: `zingarenaoffi1@gmail.com`
- **Application Package**: `com.zingtalk.com`
- **Developer**: Aryan (ZingTalk Creator)
