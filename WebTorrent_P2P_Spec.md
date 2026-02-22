# Project Specification Document
## WebTorrent P2P Streaming Application
*Version 1.3 | February 2026*

---

## 1. Project Overview

This document defines the full specification for a browser-based, peer-to-peer (P2P) video streaming application built using the WebTorrent protocol. The application allows users to stream video files directly from one browser to another without any centralized media-origin server, leveraging WebRTC data channels and the BitTorrent protocol.

This project is designed as a portfolio piece demonstrating proficiency in distributed networking, real-time communication, full-stack development, and modern frontend engineering.

---

## 2. Goals & Objectives

### 2.1 Primary Goals

- Build a fully functional P2P video streaming app that works in the browser
- Implement magnet link sharing so any user can join an active stream
- Enable synchronized watch-party playback across multiple peers
- Visualize real-time peer connections and bandwidth data

### 2.2 Secondary Goals

- Add group chat alongside the video player
- Support subtitle (.srt / .vtt) file uploads
- Make the app mobile-responsive
- Deploy a live demo accessible via a public URL

---

## 3. How the Application Works

### 3.1 Core Concept

Traditional streaming delivers video from a single server to all viewers. This application inverts that model: the more viewers join, the more bandwidth is available because each viewer simultaneously uploads to others. This is the fundamental property of BitTorrent swarms.

WebTorrent extends the BitTorrent protocol to work inside browsers using WebRTC instead of raw TCP/UDP sockets. This means no browser plugins or desktop clients are needed.

### 3.2 Step-by-Step Workflow

1. The host selects a video file in their browser. The app creates a torrent from the file in memory and generates a magnet link.
2. The magnet link is displayed and can be shared with others via a room link or QR code.
3. Guests open the app, enter the magnet link or room URL, and their browser connects to the host via WebRTC.
4. The video is streamed in chunks. Playback begins as soon as the first pieces arrive — the full file is never required upfront.
5. WebTorrent pipes the stream directly into an HTML5 `<video>` element using a Blob URL or MediaSource API.
6. As more peers join, they each download and re-upload chunks, distributing the load away from the host.
7. A Node.js signaling server facilitates initial peer discovery, room presence, and sync events. Media payloads flow peer-to-peer; control-plane services remain centralized.

### 3.3 Architecture Diagram

```
  [Host Browser]  ──── WebRTC ────  [Guest A Browser]
        |                                    |
        └──── WebRTC ──── [Guest B Browser] ┘
                  ↑
      [Signaling Server - Node.js + Socket.io]
      (only for initial handshake, not media data)
```

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| P2P Protocol | WebTorrent.js | Core BitTorrent + WebRTC engine for in-browser torrenting |
| Frontend Framework | React.js | Component-based UI: player, chat, peer stats |
| Styling | Tailwind CSS | Utility-first styling for fast responsive design |
| Signaling Server | Node.js + Socket.io | WebRTC peer discovery and room management |
| Video Playback | HTML5 `<video>` + MediaSource API | Native browser video rendering from torrent stream |
| Real-time Chat | Socket.io | Low-latency room-based messaging |
| Charts / Stats | Chart.js or Recharts | Live peer count and bandwidth visualization |
| Deployment | Vercel (frontend) + Railway (backend) | Free-tier hosting for live demo |
| Version Control | Git + GitHub | Source control and project showcase |

---

## 4.1 Explicit Runtime Dependencies

To avoid ambiguity, the architecture uses centralized control-plane services but no centralized media storage/transcoding/CDN:

- **Signaling Server (required):** Socket.io server for room join/leave, presence, and playback sync messages
- **WebTorrent Trackers (required):** WebSocket tracker(s) for peer discovery in browser-compatible swarms
- **STUN/TURN Infrastructure (required in practice):** STUN for NAT discovery; TURN relay fallback when direct P2P fails

---

## 5. Feature Specification

### 5.1 Core Features (MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| File Upload & Torrent Creation | Host selects a video; app creates in-memory torrent and generates magnet link | P0 - Critical |
| Magnet Link Sharing | Auto-generated shareable link / room URL for guests to join | P0 - Critical |
| P2P Video Streaming | Video streams directly peer-to-peer via WebRTC chunks into HTML5 video | P0 - Critical |
| WebRTC Signaling | Node.js + Socket.io server brokers the initial WebRTC handshake | P0 - Critical |
| Playback Controls | Standard play, pause, seek, volume, fullscreen | P1 - High |
| Peer Counter | Live display of how many peers are connected | P1 - High |
| Connection Fallback | Automatic TURN fallback when direct WebRTC path is unavailable | P1 - High |

### 5.2 Enhanced Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Synchronized Playback | Host controls playback; all peers stay in sync within ~1 second | P1 - High |
| Group Chat | Real-time text chat panel beside the video player | P2 - Medium |
| Bandwidth Visualizer | Live chart of upload/download speeds per peer | P2 - Medium |
| Subtitle Support | Upload .srt or .vtt file; renders as overlay via `<track>` element | P2 - Medium |
| Mobile Responsive UI | Works on phones and tablets with touch controls | P2 - Medium |
| QR Code Share | QR code generated for the room URL for easy mobile sharing | P3 - Nice to Have |

---

## 6. Development Tasks & Milestones

### Phase 1 — Setup & Scaffolding (Week 1)

- Initialize React app (Vite or CRA) with Tailwind CSS
- Set up Node.js + Express + Socket.io signaling server
- Install and configure webtorrent in the browser bundle
- Create basic project folder structure and Git repo
- Deploy placeholder frontend and backend to Vercel / Railway

### Phase 2 — Core P2P Engine (Week 2)

- Implement file picker and in-browser torrent creation using WebTorrent
- Generate and display magnet link after torrent creation
- Implement peer join flow: accept magnet link → connect to swarm
- Wire torrent stream to HTML5 `<video>` element using one primary MVP path (`renderTo()`), with MediaSource reserved for v2 optimization
- Test basic streaming between two browser tabs locally

### Phase 3 — Signaling & Room System (Week 3)

- Build Socket.io room logic: create room, join room, broadcast events
- Connect WebTorrent peer discovery to Socket.io signaling
- Implement peer list state in React (who is connected)
- Add synchronized play/pause: host emits events, guests respond
- Test multi-peer scenario with 3+ browsers

### Phase 4 — UI & Enhanced Features (Week 4)

- Design and build the main player layout with chat panel
- Add real-time bandwidth/peer chart using Chart.js
- Implement group chat via Socket.io
- Add subtitle upload and rendering via `<track>` element
- Mobile responsive pass with Tailwind breakpoints

### Phase 5 — Polish & Deployment (Week 5)

- Error handling: disconnections, unsupported formats, slow peers
- Loading states, progress bars, and user feedback throughout
- Write README with architecture overview, setup instructions, live demo link
- Record a demo video / GIF for GitHub and portfolio
- Final deployment and smoke testing on production URLs

---

## 7. Recommended Project Structure

```
/webtorrent-stream-app
  /client                    ← React frontend
    /src
      /components
        VideoPlayer.jsx       ← HTML5 video + controls
        ChatPanel.jsx         ← Real-time chat UI
        PeerStats.jsx         ← Bandwidth visualizer
        RoomShare.jsx         ← Magnet link / QR share
      /hooks
        useTorrent.js         ← WebTorrent logic hook
        useSocket.js          ← Socket.io logic hook
      App.jsx
  /server                    ← Node.js signaling server
    index.js                 ← Express + Socket.io
    rooms.js                 ← Room state management
  README.md
  package.json
```

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Browser codec support limits playable formats | Medium | Restrict to MP4/H.264 for widest compatibility; show clear error for unsupported files |
| WebRTC blocked by corporate firewalls / NAT | High | Use a TURN server (Twilio TURN free tier) as relay fallback |
| Large files cause memory issues in browser | Medium | Stream and discard played chunks; never buffer full file in RAM |
| Sync drift between peers | Medium | Use host as time authority; emit timestamp corrections every few seconds |
| WebTorrent not available as ES module | Low | Use CDN script tag or webpack alias to resolve bundling issues |
| Tracker outage or rate limits reduce peer discovery | High | Configure multiple WebSocket trackers and implement health checks/fallback list |
| Abuse / unauthorized room joins | High | Add room token option, join validation, and rate limits on signaling endpoints |

---

## 9. CV & Portfolio Value

This project demonstrates a rare combination of skills that stand out to engineering hiring managers:

- **Distributed Systems** — understanding of P2P topology, DHT, and swarm behavior
- **Networking Fundamentals** — WebRTC, ICE/STUN/TURN, signaling protocols
- **Real-time Systems** — Socket.io event architecture, latency-sensitive sync
- **Frontend Engineering** — React hooks, streaming APIs, MediaSource, responsive design
- **Full-stack Ownership** — end-to-end from protocol to polished UI to deployment

The project is also highly demo-able: a live URL where an interviewer can open two tabs and watch a video stream between them is far more impressive than a CRUD app.

---

## 10. Non-Functional Requirements (NFRs)

### 10.1 Performance Targets

- Time to first frame (TTFF): `<= 4s` on a stable 25 Mbps home connection with 2 peers
- Initial join success rate: `>= 95%` across Chrome/Edge/Firefox latest versions
- Rebuffer ratio: `<= 3%` over a 10-minute playback session under normal network conditions
- Playback synchronization drift: `<= 1.0s` p95 between host and guests
- Recovery from transient disconnect (peer reconnect): `<= 10s` p95

### 10.2 Scalability Targets (Portfolio Scope)

- Verified support for at least `5 concurrent peers` in a single room on commodity laptops
- Signaling server room event latency (emit to receive): `<= 250ms` p95

### 10.3 Compatibility Matrix (MVP)

- Fully supported: latest Chrome, Edge, Firefox (desktop)
- Best-effort: Safari desktop, Safari iOS (codec/autoplay/WebRTC constraints apply)
- Supported media for MVP: `.mp4` container, `H.264 video + AAC audio`
- Unsupported media behavior: block playback start and display explicit compatibility error message

---

## 11. Protocol and Event Contract

All real-time control events are exchanged over Socket.io. Example schema notation is JSON-like and normative for field names.

### 11.1 Room Lifecycle Events

- `room:create`
  - client -> server payload: `{ roomId, hostClientId, displayName }`
  - server -> client ack: `{ ok, roomId, createdAt, errorCode? }`
- `room:join`
  - client -> server payload: `{ roomId, guestClientId, displayName, roomToken? }`
  - server -> room broadcast: `room:peer-joined { roomId, clientId, displayName, joinedAt }`
- `room:leave`
  - client -> server payload: `{ roomId, clientId }`
  - server -> room broadcast: `room:peer-left { roomId, clientId, leftAt }`

### 11.2 Playback Sync Events

- `playback:state`
  - host -> room payload: `{ roomId, state: "play" | "pause", mediaTimeSec, sentAtMs }`
- `playback:seek`
  - host -> room payload: `{ roomId, mediaTimeSec, sentAtMs }`
- `playback:sync`
  - host -> room payload every 2-3s: `{ roomId, mediaTimeSec, hostNowMs }`
  - guest correction rule:
    - if drift `> 1.0s`, hard seek to host time
    - if drift `<= 1.0s`, gradual correction via slight playbackRate adjustment

### 11.3 Chat Events

- `chat:send`
  - client -> server payload: `{ roomId, messageId, senderId, text, sentAtMs }`
- `chat:message`
  - server -> room payload: `{ roomId, messageId, senderId, text, sentAtMs }`

### 11.4 Error Codes (Minimum Set)

- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `UNAUTHORIZED`
- `RATE_LIMITED`
- `INVALID_PAYLOAD`
- `INTERNAL_ERROR`

---

## 12. Test Plan

### 12.1 Functional Scenarios

- Host uploads valid MP4 and receives magnet link
- Guest joins via shared room URL and starts playback
- Host play/pause/seek events propagate to all guests
- Chat message broadcast reaches all connected clients in order
- Subtitle upload renders correctly using `<track>`

### 12.2 Networking Scenarios

- 2-peer same-LAN test
- 3-5 peer mixed network test
- TURN-only fallback test (force relay path)
- Tracker failover test (primary tracker unavailable)
- Reconnect test after temporary network drop (10-20s interruption)

### 12.3 Browser Compatibility Scenarios

- Chrome latest (desktop)
- Edge latest (desktop)
- Firefox latest (desktop)
- Safari desktop (best-effort)
- iOS Safari (best-effort)

### 12.4 Exit Criteria for MVP

- All P0 and P1 features pass manual smoke tests
- NFR targets in Section 10 are met in at least two independent runs
- No high-severity defects remain open

---

## 13. Observability and Operations

### 13.1 Client Metrics (Debug Panel + Console)

- Current peer count
- Download/upload throughput (1s and 10s rolling averages)
- Buffer health (seconds ahead)
- Sync drift from host clock (seconds)
- Connection mode: `direct` or `turn-relay`

### 13.2 Server Metrics

- Active rooms
- Active socket connections
- Room join success/failure counts
- Event error counts by `errorCode`
- p95 event handling latency

### 13.3 Logging and Data Retention (Portfolio-Safe Defaults)

- Log only operational metadata (event types, timestamps, error codes)
- Do not persist chat content by default
- Rotate logs daily and retain for 7 days in demo environment

---

## 14. Security, Abuse, and Legal Guardrails

### 14.1 Access and Abuse Controls

- Optional room token/password for private sessions
- Basic per-IP and per-socket rate limiting on signaling and chat events
- Input validation and max message length constraints for chat payloads
- Server-side authorization checks for host-only playback commands

### 14.2 Privacy and Transparency

- Display clear notice that peers may expose network metadata (typical P2P behavior)
- Publish a short privacy statement in README and app footer

### 14.3 Content Responsibility

- Include clear warning that users must only share content they have rights to distribute
- Reserve right to suspend abusive rooms in hosted demo deployment

---

## 15. Implementation Checklist Matrix

Use this matrix as the single execution tracker during implementation. Keep `Status` current in pull requests.

| ID | Feature / Work Item | Priority | Primary Socket Events | Test Coverage Anchor | Definition of Done (DoD) | Status |
|----|----------------------|----------|------------------------|----------------------|--------------------------|--------|
| M1 | File upload + torrent creation | P0 | N/A (local) | 12.1 #1 | Host can select valid MP4 and magnet is generated in <= 2s for 200MB sample | `IN_PROGRESS` |
| M2 | Room creation/join/leave flow | P0 | `room:create`, `room:join`, `room:leave`, `room:peer-joined`, `room:peer-left` | 12.1 #2, 12.2 | Two clients can create/join/leave room with correct presence updates and no stale peers | `IN_PROGRESS` |
| M3 | P2P media streaming | P0 | WebTorrent tracker/peer flow + room presence | 12.1 #2, 12.2 | Guest begins playback and can continue for 10 minutes with no fatal playback error | `IN_PROGRESS` |
| M4 | WebRTC fallback to TURN | P1 | Connection telemetry eventing (client metrics) | 12.2 TURN-only | Forced relay test succeeds and playback remains functional | `TODO` |
| M5 | Playback controls (host authority) | P1 | `playback:state`, `playback:seek` | 12.1 #3 | Play/pause/seek initiated by host is reflected on guests within p95 latency target | `IN_PROGRESS` |
| M6 | Sync drift correction loop | P1 | `playback:sync` | 12.1 #3, NFR 10.1 | Drift remains <= 1.0s p95 over 10-minute run | `IN_PROGRESS` |
| M7 | Peer counter + basic peer list | P1 | `room:peer-joined`, `room:peer-left` | 12.1 #2 | UI peer count always matches server room membership in smoke tests | `IN_PROGRESS` |
| M8 | Group chat | P2 | `chat:send`, `chat:message` | 12.1 #4 | Messages deliver in-order with validation and rate limiting applied | `TODO` |
| M9 | Bandwidth and health visualization | P2 | Client metric stream (local + server) | 13.1, 13.2 | Throughput, buffer, drift, and mode (`direct`/`turn-relay`) visible in UI debug panel | `TODO` |
| M10 | Subtitle upload/render | P2 | N/A (local) | 12.1 #5 | `.vtt` and `.srt` (converted if needed) display correctly on supported browsers | `TODO` |
| M11 | Tracker failover | P1 | Tracker list fallback logic | 12.2 tracker failover | If primary tracker fails, peer discovery continues via secondary trackers | `TODO` |
| M12 | Reconnect resilience | P1 | Room rejoin + sync replay | 12.2 reconnect | After 10-20s drop, guest rejoins and resumes playback <= 10s p95 | `TODO` |
| M13 | Compatibility guardrails | P1 | Error reporting events | 10.3, 12.3 | Unsupported codec/container is blocked with explicit actionable error | `IN_PROGRESS` |
| M14 | Security controls | P1 | Authorization/rate-limit middleware | 14.1 | Host-only commands enforced server-side; rate limit and payload validation active | `IN_PROGRESS` |
| M15 | Observability and logs | P1 | Metrics + error code aggregation | 13.1, 13.2, 13.3 | Required client/server metrics are visible and logs follow retention policy | `TODO` |
| M16 | Deployment + production smoke test | P0 | End-to-end flow | 12.4 | Public demo URL supports 2-peer streaming scenario successfully | `TODO` |

### 15.1 Recommended Delivery Order

1. M1 -> M3 -> M2 (core stream path first, then room correctness)
2. M5 -> M6 -> M4 (control + sync + network fallback)
3. M7 -> M8 -> M9 -> M10 (product usability features)
4. M11 -> M12 -> M13 -> M14 -> M15 (reliability and safety hardening)
5. M16 (final deploy validation)

### 15.2 Status Conventions

- `TODO`: not started
- `IN_PROGRESS`: active implementation
- `BLOCKED`: waiting on dependency/infra decision
- `DONE`: merged and validated against listed DoD

---

*Updated to v1.2 by Codex | February 2026*

---

## 16. GitHub Issue Backlog (Mapped to M1-M16)

Use this section to create repository issues without re-writing scope. One issue should map to exactly one matrix ID.

### 16.1 Milestones

- `Milestone A - Core P2P (M1-M3)`
- `Milestone B - Control + Sync (M4-M6)`
- `Milestone C - UX Features (M7-M10)`
- `Milestone D - Reliability + Safety (M11-M15)`
- `Milestone E - Demo Release (M16)`

### 16.2 Label Set

- `priority:P0`
- `priority:P1`
- `priority:P2`
- `type:feature`
- `type:reliability`
- `type:security`
- `type:ops`
- `area:client`
- `area:server`
- `status:blocked`

### 16.3 Issue Titles (Canonical)

- `[M1] File upload and torrent creation (MP4 -> magnet)`
- `[M2] Room lifecycle: create/join/leave + presence consistency`
- `[M3] End-to-end P2P streaming in browser`
- `[M4] TURN relay fallback for blocked direct WebRTC paths`
- `[M5] Host-authoritative playback controls`
- `[M6] Playback drift correction loop (<= 1.0s p95)`
- `[M7] Live peer counter and peer list accuracy`
- `[M8] Real-time group chat with validation/rate limiting`
- `[M9] Bandwidth/buffer/sync debug visualization`
- `[M10] Subtitle upload and rendering (.vtt/.srt)`
- `[M11] Tracker failover resilience`
- `[M12] Reconnect flow after transient network loss`
- `[M13] Compatibility guardrails and codec error UX`
- `[M14] Security controls for host commands and abuse limits`
- `[M15] Metrics, logging, and retention policy enforcement`
- `[M16] Production deployment and smoke validation`

### 16.4 Reusable Issue Body Template

```md
## Scope
Implement work item: **[M#] <title>**

## Spec References
- Matrix row: Section 15, ID `M#`
- Event contract: Section 11 (if applicable)
- Test plan anchors: Section 12
- NFR targets: Section 10 (if applicable)

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M#` is fully satisfied
- [ ] Relevant tests from Section 12 are executed and pass
- [ ] Errors follow Section 11.4 error code conventions (if applicable)
- [ ] Metrics/logging updates added when behavior changes (Section 13)

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior or setup changed
- [ ] Matrix `Status` updated in Section 15
```

### 16.5 Quick Create Checklist

- [ ] Create 16 issues using canonical titles in 16.3
- [ ] Assign milestone by grouping in 16.1
- [ ] Apply priority and area labels from 16.2
- [ ] Link each issue to a PR that updates matrix status
- [ ] Close only when Section 15 DoD is met

---

*Updated to v1.3 by Codex | February 2026*
