# webtorrent-p2p-stream-app

Browser-based P2P video streaming app spec and execution plan using WebTorrent + WebRTC.

## Current Status

- GitHub repo, milestones, labels, and `M1-M16` issues are initialized.
- Monorepo baseline is scaffolded:
  - `client`: React + Vite control panel for signaling room flow
  - `server`: Express + Socket.io signaling server with room lifecycle events
- Implemented baseline features:
  - `M1` done: host file upload and magnet generation via WebTorrent
  - `M2` done: room create/join/leave with peer presence consistency
  - `M3` done: guest join by magnet and in-browser video render
  - `M4` done: forced relay fallback validated with relay-only evidence reports
  - `M5` done: host playback controls relay to guests within smoke-validated p95 latency target
  - `M6` done: drift correction validated in long-run session with <= 1.0s p95 drift evidence
  - `M7` done: peer list/count consistency validated by integration smoke
  - `M8` done: chat send/receive with server-side validation and rate limiting
  - `M9` done: live client/server metrics panel for throughput, drift, and RTC mode
  - `M10` done: subtitle upload/render supports `.vtt` and `.srt` conversion path
  - `M15` done: server observability includes `/metrics` + retained structured `/logs`
  - `M11` done: tracker failover is validated by dead-primary/live-secondary smoke run
  - `M12` done: reconnect path resumes room membership and replays playback snapshot after drop
  - `M13` done: unsupported container paths are blocked with explicit actionable normalize guidance
  - `M14` done: host authorization + identity/membership abuse controls are enforced server-side
  - `M16` in progress: pending public deployment and external production smoke evidence
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
  - `VITE_TRACKER_FAIL_THRESHOLD` errors before a tracker is quarantined during failover retry
  - `VITE_STREAM_STRATEGY` WebTorrent add strategy (recommended: `sequential` for earlier playback start)
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

1. Execute `M16` public deploy + production smoke evidence.
2. Keep regression gate green (`npm run verify:all`) before milestone/status changes.
3. Keep `M16` open until deploy evidence is available.

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

Milestone evidence gates:

```bash
# M4: relay-only + NFR + guest playback >= 60s
npm run validate:m4 -- path\\to\\report-host.json path\\to\\report-guest.json

# M6: drift p95 <= 1.0s + guest playback >= 600s + NFR
npm run validate:m6 -- path\\to\\report-host.json path\\to\\report-guest.json
```


Smoke test for M8/M15 wiring (chat + `/metrics` counters):

```bash
npm run smoke:m8m15
```

Smoke test for M11 tracker failover (dead primary tracker + healthy secondary):

```bash
npm run smoke:m11
```

Smoke test for M2/M5/M6/M7 core room/playback flows:

```bash
npm run smoke:m2m5m6m7
```

Smoke test for M14 security controls (host authority + anti-spoof checks):

```bash
npm run smoke:m14
```

Smoke test for M12 reconnect flow (`room:resume` + playback snapshot replay):

```bash
npm run smoke:m12
```

Policy/unit tests for M11/M13 helpers:

```bash
npm run test:policy
```

Full local verification gate (required before progressing milestones):

```bash
npm run verify:all
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
