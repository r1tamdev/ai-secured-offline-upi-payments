<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-blue" />
</p>

<h1 align="center">📡 UPI Offline Mesh</h1>

<p align="center">
  <strong>Pay without internet. Trust no stranger.</strong>
</p>

<p align="center">
  A mesh-routed offline payment system where encrypted payment packets are carried by strangers who <em>cannot read, modify, or steal</em> a single rupee.
</p>

---

## The Idea in 30 Seconds

You're in a village with zero network. You need to pay ₹500 to a shopkeeper. A stranger next to you has 4G.

```
Your phone                      Stranger's phone                 Bank server
──────────                      ────────────────                 ───────────
Create payment ─── QR / BLE ──→ Scan the blob    ─── HTTPS ──→  Decrypt
Encrypt with RSA                Can't read it                    Validate
Show QR code                    Can't change it                  Settle ✅
                                Just carries it
```

The stranger is a **dumb pipe** — like a postman who carries a sealed envelope.

---

## Table of Contents

- [Why This Exists](#-why-this-exists)
- [Architecture](#-architecture)
- [Cryptographic Design](#-cryptographic-design)
- [API Reference](#-api-reference)
- [Database Schema](#-database-schema)
- [Client Pages & Routing](#-client-pages--routing)
- [Packet Transfer Methods](#-packet-transfer-methods)
- [Server-Side Ingest Pipeline](#-server-side-ingest-pipeline)
- [Project Structure](#-project-structure)
- [Setup Guide](#%EF%B8%8F-setup-guide)
- [Testing the Full Flow](#-testing-the-full-flow)
- [Security Analysis](#-security-analysis)
- [Limitations & Roadmap](#-limitations--roadmap)
- [Browser Support](#-browser-support)
- [Author & License](#-author--license)

---

## ❓ Why This Exists

India's UPI handles **14+ billion transactions per month**. Every single one requires the payer to have an active internet connection. This breaks in:

| Scenario | Reality |
|---|---|
| Remote Himalayan village | No cell tower within 30 km |
| Post-earthquake urban area | Towers destroyed, 10M people offline |
| Cricket stadium, 80K crowd | Towers congested, packets dropped |
| Migrant worker, data expired | ₹0 balance on prepaid SIM |
| International tourist | No local SIM, no UPI access |

**UPI Offline Mesh decouples the payer from the internet** by introducing a relay layer between the payer and the bank. The relay carries encrypted data it cannot understand.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAYER'S PHONE                            │
│  ┌─────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐  │
│  │ PayPage │──→│ Web Crypto   │──→│ QR Code  │   │ Web Share│  │
│  │  form   │   │ RSA+AES enc  │   │ display  │   │ / BLE    │  │
│  └─────────┘   └──────────────┘   └────┬─────┘   └────┬─────┘  │
│                                        │               │        │
│  NO INTERNET NEEDED ON THIS DEVICE     │               │        │
└────────────────────────────────────────┼───────────────┼────────┘
                                         │   Air gap     │
┌────────────────────────────────────────┼───────────────┼────────┐
│                     RELAY'S PHONE      │               │        │
│  ┌───────────┐   ┌─────────┐          │               │        │
│  │ RelayPage │──→│ Camera  │ ◄────────┘               │        │
│  │           │   │ jsQR    │                           │        │
│  │           │   ├─────────┤ ◄─────────────────────────┘        │
│  │           │   │ BLE Rx  │                                    │
│  │           │   ├─────────┤                                    │
│  │           │   │ Paste   │                                    │
│  └─────┬─────┘   └─────────┘                                   │
│        │                                                        │
│        │  HTTPS POST /payment/relay { packet, relayedBy }       │
│        │  HAS INTERNET                                          │
└────────┼────────────────────────────────────────────────────────┘
         │
┌────────┼────────────────────────────────────────────────────────┐
│        ▼              EXPRESS SERVER                             │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  ┌────────────┐  │
│  │ SHA-256   │→ │ Idempoten │→ │ RSA-OAEP   │→ │ Freshness  │  │
│  │ fingerprint│ │ cy check  │  │ + AES-GCM  │  │ check 24h  │  │
│  └───────────┘  └───────────┘  │ decrypt    │  └──────┬─────┘  │
│                                └────────────┘         │         │
│  ┌────────────────────────────────────────────────────┘         │
│  │                                                              │
│  ▼  ┌─────────────────────────────────────────────────────┐     │
│     │  ATOMIC SETTLEMENT (MongoDB session)                │     │
│     │  sender.balance   -= amount                         │     │
│     │  receiver.balance += amount                         │     │
│     │  Payment.create({ hash, sender, receiver, amount }) │     │
│     └─────────────────────────────────────────────────────┘     │
│                          MONGODB ATLAS                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Cryptographic Design

### Hybrid Encryption: RSA-OAEP + AES-256-GCM

The client encrypts payment instructions using a **two-layer hybrid scheme**:

```
Step 1:  Generate random AES-256 key (32 bytes)
Step 2:  Generate random IV/nonce (12 bytes)
Step 3:  AES-GCM encrypt the JSON instruction → ciphertext + auth tag
Step 4:  RSA-OAEP wrap the AES key with server's public key → 256 bytes
Step 5:  Concatenate into binary packet → base64 encode
```

### Binary Packet Layout (client/src/utils/clientCrypto.js)

```
Offset      Size        Content
──────      ────        ───────
0           256 bytes   RSA-OAEP encrypted AES key
256          12 bytes   AES-GCM nonce (IV)
268          16 bytes   AES-GCM authentication tag
284          N  bytes   AES-GCM encrypted payment instruction
```

### Encrypted Payload (inside the packet)

```json
{
  "nonce": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sender": "ritam@okicici",
  "receiver": "shopkeeper@oksbi",
  "amount": 500,
  "note": "Groceries",
  "signedAt": 1714600000000
}
```

### Why This Is Secure

| Attack | Mitigation |
|---|---|
| **Relay reads the payment** | RSA-OAEP — only the server's 2048-bit private key can unwrap the AES key |
| **Relay changes the amount** | AES-GCM auth tag — any byte modification causes `TAMPERED` rejection |
| **Replay the same packet** | SHA-256 hash dedup + `packetHash` unique index in MongoDB |
| **Replay after 24 hours** | `signedAt` timestamp checked — rejected if age > 24h |
| **Brute force UPI PIN** | bcryptjs with cost factor 10 — ~100ms per comparison |
| **Steal the QR code photo** | Encrypted blob — photo is useless without server's private key |

---

## 📡 API Reference

### Auth Routes (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/pubkey` | ❌ | Returns RSA-2048 public key (PEM) for client-side encryption |
| `POST` | `/auth/register` | ❌ | Create account: `{ name, phone, upiId, pin }` → JWT + user |
| `POST` | `/auth/login` | ❌ | Login: `{ phone, pin }` → JWT + user |
| `GET` | `/auth/me` | ✅ | Returns current user profile from JWT |

### Payment Routes (`/payment`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/payment/relay` | ❌ | Upload encrypted packet: `{ packet, relayedBy }` → outcome |
| `GET` | `/payment/status/:hash` | ❌ | Poll settlement status by packet hash |
| `GET` | `/payment/history` | ✅ | Last 30 transactions for logged-in user |
| `GET` | `/payment/all` | ❌ | Last 50 payments (admin/debug) |

### Account Routes (`/account`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/account/balance` | ✅ | Current user's UPI ID and balance |
| `GET` | `/account/users` | ✅ | All registered users (for receiver dropdown) |

### Relay Outcomes

The `/payment/relay` endpoint returns one of these outcomes:

| Outcome | HTTP | Meaning |
|---|---|---|
| `SETTLED` | 200 | Payment debited + credited successfully |
| `DUPLICATE_DROPPED` | 200 | Same packet already settled (idempotent) |
| `TAMPERED` | 422 | Decryption failed — packet was modified |
| `EXPIRED` | 422 | `signedAt` is more than 24 hours ago |
| `FAILED` | 422 | Insufficient funds or user not found |

---

## 🗄 Database Schema

### User Collection

```javascript
{
  name:      String,          // "Ritam"
  phone:     String (unique), // "9876543210"
  upiId:     String (unique), // "ritam@okicici"
  pinHash:   String,          // bcrypt hash of 4-digit PIN
  balance:   Number,          // 5000 (default starting balance)
  createdAt: Date,
  updatedAt: Date
}
```

### Payment Collection

```javascript
{
  packetHash: String (unique), // SHA-256 of base64 packet (idempotency key)
  nonce:      String,          // UUID from payment instruction
  sender:     String,          // "ritam@okicici"
  receiver:   String,          // "shopkeeper@oksbi"
  amount:     Number,          // 500
  note:       String,          // "Groceries"
  signedAt:   Number,          // Unix timestamp from payer's device
  status:     String,          // "SETTLED" | "FAILED" | "DUPLICATE"
  failReason: String,          // null or error message
  relayedBy:  String,          // "stranger@okupi" or "anonymous"
  settledAt:  Date,
  createdAt:  Date,
  updatedAt:  Date
}
```

---

## 📱 Client Pages & Routing

| Route | Component | Auth Required | Purpose |
|---|---|---|---|
| `/auth` | `AuthPage` | ❌ | Login / Register with 4-digit UPI PIN (show/hide toggle) |
| `/` | `HomePage` | ✅ | Balance card + transaction history + Pay/Relay action cards |
| `/pay` | `PaymentPage` | ✅ | Select receiver → enter amount → generate encrypted QR + Bluetooth share |
| `/relay` | `RelayPage` | ✅ | Scan QR / receive via BLE / paste packet → preview → upload to server |

### Auth Flow

```
Register/Login → JWT stored in localStorage → Axios interceptor attaches
Bearer token → requireAuth middleware verifies on protected routes
```

---

## 📲 Packet Transfer Methods

The relay can receive the payer's encrypted packet through **3 methods**:

### 1. QR Code Scan (Primary)

```
Payer shows QR ──camera──→ Relay scans with jsQR / BarcodeDetector
```

- Works on all mobile browsers over HTTPS or localhost
- Uses `jsQR` (canvas-based, universal) with `BarcodeDetector` fast-path on Chrome Android
- Scans every frame via `requestAnimationFrame` for instant detection

### 2. Bluetooth / Web Share

```
Payer taps "Share via Bluetooth" ──Web Share API──→ Relay receives text
```

- Uses `navigator.share()` on mobile to send `upi-mesh:{base64}` text
- Relay pastes the received text into the manual input
- Works on all mobile browsers that support Web Share API

### 3. Manual Paste

```
Payer copies packet text ──any channel──→ Relay pastes into textarea
```

- Last-resort fallback — works everywhere
- Accepts raw base64 or `upi-mesh:` prefixed text

---

## ⚙️ Server-Side Ingest Pipeline

Every uploaded packet passes through 5 sequential checks in `services/Ingest.js`:

```
                    packet (base64 string)
                           │
                ┌──────────┴──────────┐
           1.   │   SHA-256 FINGERPRINT │
                │   hash = sha256(pkt)  │
                └──────────┬──────────┘
                           │
                ┌──────────┴──────────┐
           2.   │   IDEMPOTENCY CLAIM   │     ← In-memory Map with 24h TTL
                │   if seen → DUPLICATE │        Prevents double-spend before
                │   else claim(hash)    │        any expensive crypto work
                └──────────┬──────────┘
                           │
                ┌──────────┴──────────┐
           3.   │   DECRYPT PACKET      │     ← RSA-OAEP unwrap AES key
                │   RSA-OAEP + AES-GCM  │        AES-GCM decrypt + tag verify
                │   → payment instruction│       Rejects TAMPERED packets
                └──────────┬──────────┘
                           │
                ┌──────────┴──────────┐
           4.   │   FRESHNESS CHECK     │     ← signedAt must be within 24h
                │   age = now - signedAt│        Rejects stale/replayed packets
                │   if age > 24h → EXPIRED│
                └──────────┬──────────┘
                           │
                ┌──────────┴──────────┐
           5.   │   ATOMIC SETTLEMENT   │     ← MongoDB session (if replica set)
                │   sender.balance  -= N│        Falls back to non-session for
                │   receiver.balance+= N│        standalone instances
                │   Payment.create()    │
                └───────────────────────┘
```

---

## 📁 Project Structure

```
MERN-UPI-OFFLINE/
│
├── server/                          # Express.js backend
│   ├── index.js                     # Entry point — Express + MongoDB connect
│   ├── crypto/
│   │   ├── HybridCrypto.js          # encrypt() / decrypt() / fingerprint()
│   │   └── ServerKeyHolder.js       # RSA-2048 keypair (lazy-generated, in-memory)
│   ├── models/
│   │   ├── user.js                  # Mongoose schema — bcrypt PIN, ₹5000 default
│   │   └── payment.js               # Mongoose schema — packetHash unique index
│   ├── routes/
│   │   ├── auth.js                  # POST /register, /login, GET /pubkey, /me
│   │   ├── payment.js               # POST /relay, GET /status/:hash, /history
│   │   ├── account.js               # GET /balance, /users
│   │   └── requireAuth.js           # JWT verify middleware
│   └── services/
│       ├── Ingest.js                # 5-step pipeline: hash → dedup → decrypt → freshness → settle
│       ├── Settlement.js            # Atomic debit + credit with MongoDB sessions
│       └── Idempotency.js           # In-memory Map with 24h TTL cleanup
│
├── client/                          # React + Vite frontend
│   └── src/
│       ├── App.jsx                  # Router — /auth, /, /pay, /relay
│       ├── pages/
│       │   ├── AuthPage.jsx         # Login / Register — PIN with show/hide toggle
│       │   ├── HomePage.jsx         # Balance card + 30 recent transactions
│       │   ├── PaymentPage.jsx      # Form → encrypt → QR + Bluetooth share
│       │   └── RelayPage.jsx        # Camera scan / BLE / paste → preview → upload
│       ├── context/
│       │   └── AuthContext.jsx      # JWT persistence + login/register/logout/refresh
│       └── utils/
│           ├── api.js               # Axios instance + Bearer token interceptor
│           ├── clientCrypto.js      # Web Crypto API — RSA-OAEP + AES-256-GCM
│           ├── qr.js               # QR generation (qrcode) + parsing (upi-mesh: prefix)
│           ├── ble.js              # BLE Central — scan + connect + read GATT characteristic
│           └── blePeripheral.js    # BLE Peripheral — Web Share / clipboard fallback
│
├── .gitignore
└── README.md
```

---

## ⚙️ Setup Guide

### Prerequisites

- **Node.js 18+** and npm
- **MongoDB Atlas** free cluster (M0 tier) or local MongoDB
- **Chrome** browser (for Web Bluetooth support)
- Two devices on the same Wi-Fi network

### 1. Clone & configure

```bash
git clone https://github.com/r1tamdev/upi-offline-mesh.git
cd upi-offline-mesh
```

Create `server/.env`:

```env
PORT=8080
MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/upi_mesh?retryWrites=true&w=majority
JWT_SECRET=replace_with_a_long_random_string
```

### 2. Install & run

```bash
# Terminal 1 — Backend
cd server
npm install
npm run dev          # nodemon on port 8080

# Terminal 2 — Frontend
cd client
npm install
npm run dev -- --host   # Vite on port 5173, exposed to LAN
```

### 3. Access

| Device | URL |
|---|---|
| Same machine | `http://localhost:5173` |
| Phone on LAN | `http://<your-ip>:5173` |

Find your IP: `ipconfig` (Windows) or `hostname -I` (Linux/Mac).

> **Note:** Camera and Bluetooth require HTTPS or `localhost`. On LAN over HTTP, use the manual paste method or a tool like `mkcert` for local HTTPS.

---

## 🧪 Testing the Full Flow

### Two-device test (phone + laptop)

| # | Payer (Phone A — no internet) | Relay (Phone B — has internet) |
|---|---|---|
| 1 | Open app → **Register** | Open app → **Register** |
| 2 | Tap **Pay** → select receiver | Tap **Relay** |
| 3 | Enter ₹500 → **Create Payment QR** | — |
| 4 | QR code appears on screen | Tap **📷 Scan QR code** |
| 5 | Hold phone steady | Point camera at payer's QR |
| 6 | — | QR detected → packet preview shown |
| 7 | — | Tap **📡 Upload to bank server** |
| 8 | Screen auto-updates → ✅ **Payment sent!** | ✅ **Payment relayed!** |
| 9 | Balance: ₹5000 → ₹4500 | — |

### Same-device test

1. Open two browser tabs
2. Register two different users
3. Tab 1: Create payment QR → copy the packet from the QR (right-click → inspect → copy base64)
4. Tab 2: Relay → paste into manual input → upload

---

## 🔬 Security Analysis

### What the stranger sees

```
eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ...
```

A base64 blob. That's it. No amount, no UPI IDs, no PIN, nothing.

### What happens if the stranger modifies a single byte

```json
{ "outcome": "TAMPERED", "message": "Decryption failed" }
```

AES-GCM's authentication tag detects any modification. The packet is rejected.

### What happens if the stranger replays the packet

```json
{ "outcome": "DUPLICATE_DROPPED", "message": "Already settled at 2026-05-02T18:30:00Z" }
```

SHA-256 fingerprint is checked against an in-memory Map and MongoDB's unique index.

### What happens if someone replays after 24 hours

```json
{ "outcome": "EXPIRED", "message": "Packet expired" }
```

The `signedAt` timestamp inside the encrypted payload is compared against the server's clock.

---

## 🚧 Limitations & Roadmap

| Current Limitation | Planned Solution |
|---|---|
| RSA keypair regenerated on every server restart | Persist to `server/keys/` directory or use HSM |
| Browser cannot act as BLE peripheral (GATT server) | React Native app with `react-native-ble-plx` |
| Internal MongoDB ledger, not real bank | RBI Account Aggregator framework integration |
| Single Express server | Distributed settlement nodes with consensus |
| No push notification to payer on settlement | WebSocket or Server-Sent Events |
| HTTP on LAN (no camera/BLE) | `mkcert` for local HTTPS or deploy with TLS |
| Each user starts with ₹5000 demo balance | Bank-linked KYC onboarding |

---

## 🌐 Browser Support

| Feature | Chrome Android | Chrome Desktop | Firefox | Safari iOS |
|---|---|---|---|---|
| QR scan (jsQR canvas) | ✅ | ✅ | ✅ | ✅ |
| QR scan (BarcodeDetector) | ✅ | ✅ | ❌ | ❌ |
| Web Crypto API | ✅ | ✅ | ✅ | ✅ |
| Web Bluetooth (Central) | ✅ | ✅ | ❌ | ❌ |
| Web Share API | ✅ | ❌ | ❌ | ✅ |
| Camera (getUserMedia) | ✅ HTTPS | ✅ localhost | ✅ HTTPS | ✅ HTTPS |

---

## 🔬 Research Inspiration

This project implements concepts from **DTN — Delay Tolerant Networking**:

> *Store → Carry → Forward*

Originally developed for NASA deep-space communication where signals take minutes to travel. The same principle lets a payment instruction travel through an untrusted human relay when no direct network path exists.

**Academic references:**
- Fall, K. (2003). "A Delay-Tolerant Network Architecture for Challenged Internets" — ACM SIGCOMM
- RBI Working Paper on Digital Financial Inclusion in Rural India (2023)
- NPCI Offline Payment Framework — UPI Lite specification

---

## 👨‍💻 Author

**Ritam Chowdhury** — [@r1tamdev](https://github.com/r1tamdev)

## 📄 License

MIT License — free to use, modify, and distribute.

---

<p align="center">
  <strong>⭐ Star this repo if the idea clicked.</strong>
</p>

```bash
git clone https://github.com/r1tamdev/upi-offline-mesh.git
```
