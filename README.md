# webtorrent-p2p-stream-app

Browser-based P2P video streaming app spec and execution plan using WebTorrent + WebRTC.

## Current Status

- GitHub repo, milestones, labels, and `M1-M16` issues are initialized.
- Monorepo baseline is scaffolded:
  - `client`: React + Vite control panel for signaling room flow
  - `server`: Express + Socket.io signaling server with room lifecycle events
- Project specification lives in `WebTorrent_P2P_Spec.md`.

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
cd client && npm install
cd ../server && npm install
```

### Run (client + server)

```bash
npm run dev
```

- Client: `http://localhost:5173`
- Server health: `http://localhost:4000/health`

## Environment

- Client env template: `client/.env.example`
- Server env template: `server/.env.example`

## Next Build Target

Implement `M1` and `M3` in `WebTorrent_P2P_Spec.md` Section 15:
- host file upload and torrent creation
- end-to-end WebTorrent streaming in browser
