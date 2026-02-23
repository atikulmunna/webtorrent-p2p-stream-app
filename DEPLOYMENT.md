# Deployment Guide (M16)

## Goal
Publish a public demo URL and run a 2-peer production smoke test.

## Included Setup Artifacts
- `render.yaml`: Render Blueprint for signaling server.
- `client/vercel.json`: SPA rewrite config for Vercel.
- `server/.env.production.example`: production server env template.
- `client/.env.production.example`: production client env template.

## Recommended Topology
- `server` deployed as Node service with WebSocket support.
- `client` deployed as static site with `VITE_SIGNALING_URL` pointing to deployed server.
- TURN credentials configured in client env for real-world NAT traversal.

## Option A: Fastest Path (Render + Vercel)

### 1) Deploy Server on Render
1. In Render, choose `New +` -> `Blueprint`.
2. Point to this repo and select branch.
3. Render will detect `render.yaml` and create `webtorrent-p2p-signaling`.
4. In service env vars, set `CLIENT_ORIGIN` to your Vercel URL(s):
   - `https://<prod>.vercel.app,https://<preview>.vercel.app`
5. Deploy and verify:
   - `https://<server-domain>/health`
   - `https://<server-domain>/metrics`

### 2) Deploy Client on Vercel
1. Import this repo in Vercel.
2. Set Root Directory = `client`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add env vars from `client/.env.production.example`:
   - `VITE_SIGNALING_URL=https://<server-domain>`
   - TURN/STUN/tracker values
6. Deploy and verify the app loads.

## Required Environment

### Server
- `SERVER_PORT` (platform-provided port is preferred)
- `CLIENT_ORIGIN` (comma-separated allowed origins)
- `TRACKER_WS_PORT` (only if running embedded tracker publicly)
- `LOG_RETENTION_MS`
- `LOG_BUFFER_MAX`
- `LOG_PRUNE_INTERVAL_MS`

### Client
- `VITE_SIGNALING_URL` (public server URL)
- `VITE_TRACKER_URLS` (publicly reachable tracker list)
- `VITE_STUN_URLS`
- `VITE_TURN_URLS`
- `VITE_TURN_USERNAME`
- `VITE_TURN_CREDENTIAL`
- `VITE_FORCE_TURN=0` for default production
- `VITE_STREAM_STRATEGY=sequential`

## Verify CORS/Socket
- Open client and confirm status shows `Connected`.
- Server logs should print allowed origins list on boot.
- If disconnected, check that `CLIENT_ORIGIN` exactly matches Vercel origin (scheme + hostname).

## Pre-Deploy Gate
Run locally before every deploy:

```bash
npm run verify:all
```

## Production Smoke Procedure
1. Open host and guest from two different networks/devices.
2. Create room and stream known-good normalized MP4.
3. Run for at least 5 minutes.
4. Export host and guest validation reports.
5. Validate:

```bash
npm run validate:report -- <host-report.json> <guest-report.json>
npm run validate:prod-smoke -- <host-report.json> <guest-report.json>
```

## Exit Criteria for M16
- Public URL accessible for client and signaling service.
- 2-peer stream works end-to-end on different networks.
- `validate:report` passes.
- `validate:prod-smoke` passes (>= 300s guest playback with QoE thresholds).
