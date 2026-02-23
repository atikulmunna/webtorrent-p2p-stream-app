# webtorrent-p2p-stream-app

Browser-based P2P video streaming app spec and execution plan using WebTorrent + WebRTC.

## Current Status

- GitHub repo, milestones, labels, and `M1-M16` issues are initialized.
- Monorepo baseline is scaffolded:
  - `client`: React + Vite control panel for signaling room flow
  - `server`: Express + Socket.io signaling server with room lifecycle events
- Implemented baseline features:
  - `M1` done: host file upload and magnet generation via WebTorrent
  - `M2` in progress: room create/join/leave with live peer presence
  - `M3` done: guest join by magnet and in-browser video render
  - `M5` in progress: host playback events (`play/pause/seek`) relay to guests
  - `M6` in progress: guest drift correction from periodic sync events
  - `M7` in progress: peer counter and peer list UI
  - `M8` done: chat send/receive with server-side validation and rate limiting
  - `M9` done: live client/server metrics panel for throughput, drift, and RTC mode
  - `M15` done: server observability includes `/metrics` + retained structured `/logs`
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
- Server metrics: `http://localhost:4000/metrics`
- Server logs: `http://localhost:4000/logs?limit=100`
- Local WebSocket tracker: `ws://localhost:8000/announce` (started by server)

## Environment

- Client env template: `client/.env.example`
- Server env template: `server/.env.example`
- TURN/STUN client vars:
  - `VITE_DEV_SERVER_PORT` to pick preferred client dev port (fallback auto if busy)
  - `VITE_SIGNALING_URL` should match server port (for example `http://localhost:4000`)
  - `VITE_TRACKER_URLS` (comma-separated tracker announce URLs; local tracker first is recommended)
  - `VITE_STUN_URLS` (comma-separated STUN URLs)
  - `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`
  - `VITE_FORCE_TURN=1` to force relay-only mode during fallback tests
- Server vars:
  - `SERVER_PORT` for signaling server port
  - `TRACKER_WS_PORT` for built-in WebSocket tracker port
  - `CLIENT_PORT` for default allowed client origin (`http://localhost:<CLIENT_PORT>`)
  - `LOG_RETENTION_MS` retention window for in-memory structured logs
  - `LOG_BUFFER_MAX` max retained structured log entries
  - `LOG_PRUNE_INTERVAL_MS` background prune cadence for old logs
  - optional `CLIENT_ORIGIN` to override full origin explicitly

## Next Build Target

1. Complete `M1/M3` DoD validation (repeatable 10-minute stream tests, failure handling).
2. Complete `M4` forced-relay verification with stable tracker/peer discovery runs.
3. Close `M14` abuse controls and continue reliability milestones (`M11`, `M12`).

## Validation Workflow (M1/M3)

1. Start app with `npm run dev`.
2. In browser tab A (host), create room, select `.mp4`, click `Create Magnet`.
3. In browser tab B (guest), join same room, paste magnet, click `Start Streaming`.
4. Run for at least 10 minutes.
5. Click `Generate Validation Report`, then `Export Report JSON`.
6. For TURN fallback verification, set `VITE_FORCE_TURN=1`, restart client, and repeat.

The report includes:
- `ttffMs` (time to first frame)
- `rebufferCount`, `rebufferTotalMs`, `rebufferRatioPct`
- `driftP95Sec`, `latestDriftSec`
- `torrentProgressPct`, `downloadKbps`, `peerCount`

### Evaluate NFR Pass/Fail

Use the built-in validator to compare exported reports against Section 10 NFR thresholds.

```bash
npm run validate:report -- path\\to\\validation-report-1.json
```

Multiple reports:

```bash
npm run validate:report -- path\\to\\report-host.json path\\to\\report-guest.json
```

Forced-relay validation (`M4`) requiring TURN relay mode:

```bash
npm run validate:relay -- path\\to\\report-host.json path\\to\\report-guest.json
```

Smoke test for M8/M15 wiring (chat + `/metrics` counters):

```bash
npm run smoke:m8m15
```

Current checks:
- `ttffMs <= 6000` (baseline), with `<= 4000` as stretch goal
- `rebufferRatioPct <= 3`
- `driftP95Sec <= 1.0`

## Media Compatibility Workflow

If a file streams audio-only, black frames, or delayed startup, normalize it before upload.

```bash
npm run video:normalize -- "C:\\path\\to\\input.mp4"
```

Optional custom output path:

```bash
npm run video:normalize -- "C:\\path\\to\\input.mp4" "C:\\path\\to\\output_safe.mp4"
```

Normalization profile:
- MP4 + H.264 (`yuv420p`)
- 720p at 30fps
- AAC stereo (`128k`)

This profile is used as the known-good test input for reproducible M1/M3 validation runs.
