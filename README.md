# WebTorrent P2P Stream App

Browser-based peer-to-peer video streaming and watch-party app using WebTorrent + WebRTC + Socket.io.

This document is intentionally detailed so someone new to P2P/WebRTC can understand:
- what this project does,
- how the pieces work together,
- how to run and test it,
- what problems were hit during implementation,
- and how those problems were solved.

## 1. What This Project Is

This app lets one browser act as a host (seed) and another browser act as a guest (leech/playback), with:
- room-based signaling,
- torrent-based media transfer,
- playback sync,
- chat,
- metrics and validation reports,
- reconnect recovery,
- tracker failover,
- subtitle upload/render (`.vtt` and `.srt` conversion).

No central media server is used for video payload transfer. Media is transferred peer-to-peer through WebTorrent/WebRTC channels.

## 2. Current Milestone Status

Completed:
- `M1` File upload + torrent creation
- `M2` Room lifecycle (create/join/leave + peer presence)
- `M3` End-to-end browser streaming
- `M4` TURN relay fallback validation
- `M5` Host-authoritative playback controls
- `M6` Drift correction loop validation
- `M7` Peer list/count correctness
- `M8` Group chat + validation/rate limiting
- `M9` Metrics visualization
- `M10` Subtitle upload/render (`.vtt`, `.srt -> .vtt`)
- `M11` Tracker failover resilience
- `M12` Reconnect + room resume
- `M13` Compatibility guardrails
- `M14` Security controls (auth/abuse)
- `M15` Observability/log retention

Open:
- `M16` Public deployment + production external smoke validation

## 3. High-Level Architecture

### Client (`client/`)
- React + Vite UI.
- WebTorrent browser client for seed/join.
- HTML5 `<video>` playback.
- Socket.io client for room events, chat, sync, and resume.
- Local metrics and validation report export.

### Server (`server/`)
- Express + Socket.io signaling.
- In-memory room and peer state.
- Host authorization checks for playback events.
- Rate limiting + payload validation.
- Built-in WebSocket tracker process for local testing.
- Metrics and log endpoints:
  - `GET /health`
  - `GET /metrics`
  - `GET /logs`

## 4. Data Flow (Beginner View)

1. Host creates room.
2. Host selects MP4 and clicks `Create Magnet`.
3. WebTorrent seeds file and generates magnet URI.
4. Guest joins room and starts from magnet URI.
5. Guest discovers peer(s) via tracker(s), gets metadata, then streams file.
6. Host playback actions (`play/pause/seek/sync`) are broadcast via Socket.io.
7. Guest drift loop adjusts playback to stay in sync.
8. Optional subtitles are loaded locally into video `<track>`.

## 5. Repository Layout

```text
.
├─ client/                        # React UI
│  ├─ src/
│  │  ├─ App.jsx                  # Main app logic and UI
│  │  └─ lib/
│  │     ├─ stream-policy.js      # Compatibility + tracker policy helpers
│  │     └─ subtitles.js          # Subtitle conversion/prep helpers
│  └─ test/                       # Node test runner unit tests
├─ server/
│  ├─ index.js                    # Signaling + tracker + metrics/logs
│  └─ rooms.js                    # Room/peer/playback snapshot state
├─ scripts/
│  ├─ evaluate-validation-report.js
│  ├─ validate-milestone-evidence.js
│  ├─ normalize-video.js
│  ├─ smoke-m2-m5-m6-m7.js
│  ├─ smoke-m8-m15.js
│  ├─ smoke-m11-tracker-failover.js
│  ├─ smoke-m12-reconnect.js
│  └─ smoke-m14-security.js
└─ WebTorrent_P2P_Spec.md         # Detailed project specification
```

## 6. Prerequisites

- Node.js 20+
- npm 10+
- FFmpeg installed (for `video:normalize`)

## 7. Install

```bash
npm install
npm install --prefix client
npm install --prefix server
```

## 8. Local Run

Recommended (separate terminals):

Terminal A:
```bash
npm run dev:server
```

Terminal B:
```bash
npm run dev:client
```

URLs:
- Client: `http://localhost:5173` (or fallback `5174` if busy)
- Server health: `http://localhost:4000/health` (or your configured port)
- Server metrics: `http://localhost:4000/metrics`

## 9. Environment Configuration

### Server (`server/.env`)

Common local config:

```env
SERVER_PORT=4001
TRACKER_WS_PORT=8001
CLIENT_PORT=5173
CLIENT_ORIGIN=http://localhost:5173,http://localhost:5174
LOG_RETENTION_MS=900000
LOG_BUFFER_MAX=2000
LOG_PRUNE_INTERVAL_MS=30000
```

Notes:
- `CLIENT_ORIGIN` supports comma-separated origins.
- If Vite starts on `5174`, add it, or sockets may reconnect repeatedly.

### Client (`client/.env`)

Common local config:

```env
VITE_SIGNALING_URL=http://localhost:4001
VITE_TRACKER_URLS=ws://localhost:8001/announce,wss://tracker.btorrent.xyz,wss://tracker.openwebtorrent.com
VITE_TRACKER_FAIL_THRESHOLD=2
VITE_STREAM_STRATEGY=sequential

VITE_STUN_URLS=stun:stun.relay.metered.ca:80
VITE_TURN_URLS=turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:80?transport=tcp,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...

VITE_FORCE_TURN=0
```

For M4 relay validation only:
- set `VITE_FORCE_TURN=1`
- restart client process

## 10. Core Commands

### Build
```bash
npm run build --prefix client
```

### Full Verification Gate
```bash
npm run verify:all
```

This runs:
- policy/unit tests,
- client production build,
- all smoke tests.

### Smoke Tests
```bash
npm run smoke:m2m5m6m7
npm run smoke:m11
npm run smoke:m8m15
npm run smoke:m14
npm run smoke:m12
```

### Validation Reports
```bash
npm run validate:report -- host.json guest.json
npm run validate:relay -- host.json guest.json
npm run validate:m4 -- host.json guest.json
npm run validate:m6 -- host.json guest.json
```

### Video Normalization
```bash
npm run video:normalize -- "C:\path\to\input.mp4"
```

## 11. How Validation Works

The app can export JSON validation reports from host and guest.

Metrics include:
- `ttffMs`
- `sessionPlaybackSec`
- `rebufferRatioPct`
- `driftP95Sec`
- `rtcMode`
- peer and download telemetry

### Milestone evidence validators

`validate:m4` requires:
- relay mode (`rtcMode=relay-only`),
- baseline NFR checks,
- guest playback >= 60s.

`validate:m6` requires:
- baseline NFR checks,
- guest playback >= 600s,
- guest drift p95 <= 1.0s.

## 12. M10 (Subtitles) Usage

In the Video Player section:
- upload `.vtt` directly, or
- upload `.srt` and it is converted to VTT in-browser.

Controls:
- subtitle upload field,
- active subtitle label display,
- clear subtitles button.

## 13. Real Setbacks and How They Were Solved

These are issues actually encountered during implementation/testing.

### 1) `EADDRINUSE` on server/tracker/client ports
Problem:
- Existing process held `4000/4001`, `8000/8001`, or Vite port.

Fix:
- run server/client in separate terminals.
- support configurable env ports.
- kill stale node processes when needed.

### 2) `.env` changes seemed ignored
Problem:
- env vars were edited but runtime behavior didn’t change.

Fix:
- restart processes after env edits.
- verify UI event logs for mode (`relay-only` vs `auto`).

### 3) Host socket disconnect/rejoin loop
Problem:
- host repeatedly left/joined room.

Cause:
- CORS origin mismatch (`5174` not allowed while client actually ran there).

Fix:
- allow multiple origins via `CLIENT_ORIGIN` comma list.

### 4) Black screen / stall even at 100%
Problem:
- media downloaded but didn’t render.

Cause:
- codec/profile/container incompatibility.

Fix:
- stricter compatibility guardrails.
- `.mp4` selection enforcement for stream path.
- explicit normalize guidance.
- blob fallback attempt before terminal error.

### 5) Tracker discovery failures (`No peers`, metadata timeout)
Problem:
- guest could not discover host peer.

Fix:
- multiple tracker URLs.
- failover/quarantine logic.
- M11 smoke ensures dead primary + live secondary fallback path.

### 6) Reconnect behavior and auto-start confusion
Problem:
- resume logic could trigger unintended stream restarts.

Fix:
- gate auto-resume stream restart behind explicit prior user start action.

### 7) Forced TURN mode high startup latency
Observation:
- relay mode may pass functional criteria but degrade TTFF.

Approach:
- use known-good normalized media for relay tests.
- dedicated M4 evidence validator.

## 14. Security and Abuse Controls

Implemented:
- room payload validation,
- rate limiting by socket/action,
- host-only authorization for playback commands,
- room membership checks,
- anti-impersonation checks,
- server-derived chat sender identity.

Validated via:
```bash
npm run smoke:m14
```

## 15. Observability

Server endpoints:
- `/metrics` for counters and latency summaries
- `/logs` for retained structured in-memory logs

Validated via:
```bash
npm run smoke:m8m15
```

## 16. What Is Left

Only `M16` remains open:
- public deployment
- external (different networks) production smoke evidence

Everything else is implemented and validated in local/integration test gates.
