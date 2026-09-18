<div align="center">
<img src="web/assets/icon.png" alt="AirRelay Logo" width="80">
<h1 align="center">AirRelay</h1>

**Ultra-fast, zero-install peer-to-peer file sharing across any device — private, encrypted, and direct.**

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <img alt="PWA Ready" src="https://img.shields.io/badge/PWA-Ready-10b981.svg">
  <img alt="WebRTC DataChannels" src="https://img.shields.io/badge/WebRTC-Encrypted%20P2P-3b82f6.svg">
  <img alt="Zero Install" src="https://img.shields.io/badge/Zero-Install-orange.svg">
</p>

</div>

---

## Overview

**AirRelay** is a modern, production-ready, peer-to-peer file-sharing web application built for seamless data distribution between Mac, Windows, Linux, iOS, and Android devices.

Featuring a Raycast and Linear-inspired glassmorphism interface, AirRelay streams files of any size directly through browser-to-browser WebRTC DataChannels with strict backpressure flow control, zero cloud storage, and end-to-end encryption.

---

## Key Features

- **Private & Direct**: Files transfer point-to-point via encrypted WebRTC DataChannels (DTLS). Data never touches intermediate servers or cloud storage.
- **Strict Backpressure Control**: Capped at 64 KB high-water buffer threshold (`HIGH_WATER`) to eliminate socket queue bufferbloat, memory leaks, and tab crashes during high-speed transfers.
- **Real-Time Speed & ETA**: Dynamic rolling-window throughput calculation displaying real-time transfer speeds (`KB/s`, `MB/s`, `GB/s`) and remaining estimated time.
- **Zero-Install Cross-Device**: No native apps or accounts required. Works across desktop and mobile browsers.
- **Device OS & File Categorization**: Automatic peer OS detection (macOS, iOS, Windows, Android, Linux) and visual file badges (`IMG`, `VID`, `AUD`, `PDF`, `CODE`, `DOC`, `ZIP`, `FILE`).
- **Progressive Web App (PWA)**: Installable as a standalone app with offline shell caching and native **Web Share Target API** integration (`POST /share-target`) to receive shared files directly from mobile OS share sheets.
- **Instant Pairing**: Share rooms instantly via native Web Share API or high-contrast QR code camera scanning.
- **Memory-Safe Streaming**: Uses File System Access API and Service Worker pipelines to stream multi-gigabyte transfers directly to disk without browser memory bloat.
- **Resumable Transfers**: Gracefully handles network interruptions and ICE renegotiations, allowing paused transfers to continue from the last durably written byte offset.
- **Password Protection**: Optional room-level passwords for restricted access.

---

## Architecture

```
                                    +--------------------------------+
                                    |    AirRelay Signaling Server    |
                                    |    (FastAPI / WebSockets /ws)  |
                                    +--------------------------------+
                                              ^            ^
                             SDP & ICE Only   |            |   SDP & ICE Only
                                              v            v
           +--------------------+                                       +--------------------+
           |    Sender Peer     | <======= Direct Encrypted WebRTC ===> |   Receiver Peer    |
           |   (Mac/Win/Linux)  |          DataChannel (<64KB Queue)    |   (iOS/Android/PC) |
           +--------------------+                                       +--------------------+
                     |                                                             |
            [Disk Slice Stream]                                           [Direct Disk Sink]
                     v                                                             v
             Local File Read                                                FileSystem API / SW
```

1. **Signaling**: Initial SDP offers/answers and ICE candidate exchange are coordinated over lightweight WebSockets.
2. **Transfer**: File chunks stream point-to-point across WebRTC DataChannels using 16 KB chunks with backpressure throttling at 64 KB.
3. **Receiving**: Chunks are durably written using the File System Access API (Chromium) or Service Worker streaming responses.

---

## Self-Hosting with Docker

### Option A: Quick Local Test (HTTP)

```bash
docker compose -f deploy/docker-compose.yml up -d
```
Open `http://localhost` in your browser.

### Option B: Production Setup (HTTPS with Caddy & Coturn)

1. Open `deploy/Caddyfile` and replace `yourdomain.com` with your domain.
2. Start the stack:
```bash
docker compose -f deploy/docker-compose-ssl.yml up -d
```
3. Open `https://yourdomain.com`.

### Firewall & Ports

| Port | Protocol | Purpose |
|---|---|---|
| `80` (HTTP) / `443` (HTTPS) | TCP | Web Interface & Caddy ACME SSL |
| `3478` | TCP + UDP | Coturn STUN/TURN Signaling |
| `50000–50100` | UDP | Coturn TURN Media Relay (NAT Traversal) |

---

## Development & Testing

### Running Tests

Automated regression and protocol tests run with Node.js built-in test runner:

```bash
npm test
```

### Linting

```bash
npm run lint
```

---

## License

Released under the [MIT License](LICENSE).
