# webtorrent-p2p-stream-app

Browser-based P2P video streaming app spec and execution plan using WebTorrent + WebRTC.

## Current Status

- GitHub repo, milestones, labels, and `M1-M16` issues are initialized.
- Monorepo baseline is scaffolded:
  - `client`: React + Vite control panel for signaling room flow
  - `server`: Express + Socket.io signaling server with room lifecycle events
- Implemented baseline features:
  - `M1` in progress: host file upload and magnet generation via WebTorrent
  - `M2` in progress: room create/join/leave with live peer presence
  - `M3` in progress: guest join by magnet and in-browser video render
  - `M5` in progress: host playback events (`play/pause/seek`) relay to guests
  - `M6` in progress: guest drift correction from periodic sync events
  - `M7` in progress: peer counter and peer list UI
  - `M13` in progress: MVP file compatibility guardrails and user errors
  - `M14` in progress: server-side host authorization for playback events
- Project specification and execution matrix live in `WebTorrent_P2P_Spec.md`.

## Implementation Changelog

- `ab9a35f`: docs: add webtorrent spec v1.3 and issue backlog
- `ef6223b`: scaffold client/server baseline and signaling flow
- `fe50283`: add WebTorrent magnet creation and basic browser streaming
- `6add712`: harden torrent session handling and add host playback sync baseline
- `0a15a19`: enforce host-only playback events and surface auth errors
- `c2fb18a`: add guest drift correction using playback sync events

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

1. Complete `M1/M3` DoD validation (repeatable 10-minute stream tests, failure handling).
2. Implement `M4` TURN relay fallback wiring and forced-relay verification.
3. Implement `M8` chat reliability + rate limiting and `M14` remaining abuse controls.

## Validation Workflow (M1/M3)

1. Start app with `npm run dev`.
2. In browser tab A (host), create room, select `.mp4`, click `Create Magnet`.
3. In browser tab B (guest), join same room, paste magnet, click `Start Streaming`.
4. Run for at least 10 minutes.
5. Click `Generate Validation Report`, then `Export Report JSON`.

The report includes:
- `ttffMs` (time to first frame)
- `rebufferCount`, `rebufferTotalMs`, `rebufferRatioPct`
- `driftP95Sec`, `latestDriftSec`
- `torrentProgressPct`, `downloadKbps`, `peerCount`
