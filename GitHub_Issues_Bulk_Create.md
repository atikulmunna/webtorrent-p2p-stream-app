# GitHub Issues Bulk Create Guide

This file provides copy-paste issue blocks for `M1-M16` from `WebTorrent_P2P_Spec.md`.

## Usage

1. Create milestones:
- `Milestone A - Core P2P (M1-M3)`
- `Milestone B - Control + Sync (M4-M6)`
- `Milestone C - UX Features (M7-M10)`
- `Milestone D - Reliability + Safety (M11-M15)`
- `Milestone E - Demo Release (M16)`
2. Ensure labels exist from Section 16.2 in the spec.
3. For each block below, create one GitHub issue with the exact title and body.

---

## [M1] File upload and torrent creation (MP4 -> magnet)

Suggested milestone: `Milestone A - Core P2P (M1-M3)`
Suggested labels: `priority:P0`, `type:feature`, `area:client`

```md
## Scope
Implement work item: **[M1] File upload and torrent creation (MP4 -> magnet)**

## Spec References
- Matrix row: Section 15, ID `M1`
- Event contract: Section 11 (if applicable)
- Test plan anchors: Section 12.1 #1
- NFR targets: Section 10 (if applicable)

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M1` is fully satisfied
- [ ] Relevant tests from Section 12 are executed and pass
- [ ] Errors follow Section 11.4 error code conventions (if applicable)
- [ ] Metrics/logging updates added when behavior changes (Section 13)

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior or setup changed
- [ ] Matrix `Status` updated in Section 15
```

---

## [M2] Room lifecycle: create/join/leave + presence consistency

Suggested milestone: `Milestone A - Core P2P (M1-M3)`
Suggested labels: `priority:P0`, `type:feature`, `area:server`, `area:client`

```md
## Scope
Implement work item: **[M2] Room lifecycle: create/join/leave + presence consistency**

## Spec References
- Matrix row: Section 15, ID `M2`
- Event contract: Section 11.1
- Test plan anchors: Section 12.1 #2, Section 12.2

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M2` is fully satisfied
- [ ] Relevant tests from Section 12 are executed and pass
- [ ] Errors follow Section 11.4 error code conventions
- [ ] Metrics/logging updates added when behavior changes (Section 13)

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior or setup changed
- [ ] Matrix `Status` updated in Section 15
```

---

## [M3] End-to-end P2P streaming in browser

Suggested milestone: `Milestone A - Core P2P (M1-M3)`
Suggested labels: `priority:P0`, `type:feature`, `area:client`

```md
## Scope
Implement work item: **[M3] End-to-end P2P streaming in browser**

## Spec References
- Matrix row: Section 15, ID `M3`
- Event contract: Section 11 (peer presence interactions)
- Test plan anchors: Section 12.1 #2, Section 12.2
- NFR targets: Section 10.1

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M3` is fully satisfied
- [ ] Relevant tests from Section 12 are executed and pass
- [ ] Metrics/logging updates added when behavior changes (Section 13)

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior or setup changed
- [ ] Matrix `Status` updated in Section 15
```

---

## [M4] TURN relay fallback for blocked direct WebRTC paths

Suggested milestone: `Milestone B - Control + Sync (M4-M6)`
Suggested labels: `priority:P1`, `type:reliability`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M4] TURN relay fallback for blocked direct WebRTC paths**

## Spec References
- Matrix row: Section 15, ID `M4`
- Event contract: Section 11 (connection telemetry where applicable)
- Test plan anchors: Section 12.2 TURN-only test
- NFR targets: Section 10.1 reconnect/join resilience

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M4` is fully satisfied
- [ ] TURN-only fallback scenario passes
- [ ] Metrics expose connection mode (`direct`/`turn-relay`) per Section 13.1

## Deliverables
- [ ] Code merged
- [ ] README/docs updated (TURN/STUN setup)
- [ ] Matrix `Status` updated in Section 15
```

---

## [M5] Host-authoritative playback controls

Suggested milestone: `Milestone B - Control + Sync (M4-M6)`
Suggested labels: `priority:P1`, `type:feature`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M5] Host-authoritative playback controls**

## Spec References
- Matrix row: Section 15, ID `M5`
- Event contract: Section 11.2 (`playback:state`, `playback:seek`)
- Test plan anchors: Section 12.1 #3

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M5` is fully satisfied
- [ ] Host play/pause/seek propagates to guests within target latency
- [ ] Host-only command checks enforced server-side

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior or setup changed
- [ ] Matrix `Status` updated in Section 15
```

---

## [M6] Playback drift correction loop (<= 1.0s p95)

Suggested milestone: `Milestone B - Control + Sync (M4-M6)`
Suggested labels: `priority:P1`, `type:reliability`, `area:client`

```md
## Scope
Implement work item: **[M6] Playback drift correction loop (<= 1.0s p95)**

## Spec References
- Matrix row: Section 15, ID `M6`
- Event contract: Section 11.2 (`playback:sync`)
- Test plan anchors: Section 12.1 #3
- NFR targets: Section 10.1 sync drift

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M6` is fully satisfied
- [ ] Drift remains <= 1.0s p95 over 10-minute run
- [ ] Hard seek vs gradual correction rules are implemented

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if behavior changed
- [ ] Matrix `Status` updated in Section 15
```

---

## [M7] Live peer counter and peer list accuracy

Suggested milestone: `Milestone C - UX Features (M7-M10)`
Suggested labels: `priority:P1`, `type:feature`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M7] Live peer counter and peer list accuracy**

## Spec References
- Matrix row: Section 15, ID `M7`
- Event contract: Section 11.1 presence events
- Test plan anchors: Section 12.1 #2

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M7` is fully satisfied
- [ ] UI count matches server room membership in smoke tests

## Deliverables
- [ ] Code merged
- [ ] Matrix `Status` updated in Section 15
```

---

## [M8] Real-time group chat with validation/rate limiting

Suggested milestone: `Milestone C - UX Features (M7-M10)`
Suggested labels: `priority:P2`, `type:feature`, `type:security`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M8] Real-time group chat with validation/rate limiting**

## Spec References
- Matrix row: Section 15, ID `M8`
- Event contract: Section 11.3
- Test plan anchors: Section 12.1 #4
- Security references: Section 14.1

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M8` is fully satisfied
- [ ] Chat delivery is in-order and validated
- [ ] Rate limiting is enforced on chat events

## Deliverables
- [ ] Code merged
- [ ] README/docs updated if moderation/rate limits are user-visible
- [ ] Matrix `Status` updated in Section 15
```

---

## [M9] Bandwidth/buffer/sync debug visualization

Suggested milestone: `Milestone C - UX Features (M7-M10)`
Suggested labels: `priority:P2`, `type:ops`, `area:client`

```md
## Scope
Implement work item: **[M9] Bandwidth/buffer/sync debug visualization**

## Spec References
- Matrix row: Section 15, ID `M9`
- Observability references: Section 13.1
- Test plan anchors: Section 12 (functional smoke)

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M9` is fully satisfied
- [ ] Required client metrics are visible and updating in near real time

## Deliverables
- [ ] Code merged
- [ ] Matrix `Status` updated in Section 15
```

---

## [M10] Subtitle upload and rendering (.vtt/.srt)

Suggested milestone: `Milestone C - UX Features (M7-M10)`
Suggested labels: `priority:P2`, `type:feature`, `area:client`

```md
## Scope
Implement work item: **[M10] Subtitle upload and rendering (.vtt/.srt)**

## Spec References
- Matrix row: Section 15, ID `M10`
- Test plan anchors: Section 12.1 #5

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M10` is fully satisfied
- [ ] `.vtt` and `.srt` render correctly on supported browsers

## Deliverables
- [ ] Code merged
- [ ] Matrix `Status` updated in Section 15
```

---

## [M11] Tracker failover resilience

Suggested milestone: `Milestone D - Reliability + Safety (M11-M15)`
Suggested labels: `priority:P1`, `type:reliability`, `area:client`

```md
## Scope
Implement work item: **[M11] Tracker failover resilience**

## Spec References
- Matrix row: Section 15, ID `M11`
- Risk references: Section 8 tracker outage risk
- Test plan anchors: Section 12.2 tracker failover

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M11` is fully satisfied
- [ ] Secondary tracker takeover works when primary is unavailable

## Deliverables
- [ ] Code merged
- [ ] README/docs updated with tracker configuration
- [ ] Matrix `Status` updated in Section 15
```

---

## [M12] Reconnect flow after transient network loss

Suggested milestone: `Milestone D - Reliability + Safety (M11-M15)`
Suggested labels: `priority:P1`, `type:reliability`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M12] Reconnect flow after transient network loss**

## Spec References
- Matrix row: Section 15, ID `M12`
- Event contract: Section 11 (room lifecycle + playback sync replay)
- Test plan anchors: Section 12.2 reconnect
- NFR targets: Section 10.1 reconnect <= 10s p95

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M12` is fully satisfied
- [ ] Rejoin and playback resume succeed within NFR target

## Deliverables
- [ ] Code merged
- [ ] Matrix `Status` updated in Section 15
```

---

## [M13] Compatibility guardrails and codec error UX

Suggested milestone: `Milestone D - Reliability + Safety (M11-M15)`
Suggested labels: `priority:P1`, `type:reliability`, `area:client`

```md
## Scope
Implement work item: **[M13] Compatibility guardrails and codec error UX**

## Spec References
- Matrix row: Section 15, ID `M13`
- Compatibility references: Section 10.3
- Test plan anchors: Section 12.3

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M13` is fully satisfied
- [ ] Unsupported media is blocked and clear guidance is shown

## Deliverables
- [ ] Code merged
- [ ] README/docs updated with supported formats
- [ ] Matrix `Status` updated in Section 15
```

---

## [M14] Security controls for host commands and abuse limits

Suggested milestone: `Milestone D - Reliability + Safety (M11-M15)`
Suggested labels: `priority:P1`, `type:security`, `area:server`

```md
## Scope
Implement work item: **[M14] Security controls for host commands and abuse limits**

## Spec References
- Matrix row: Section 15, ID `M14`
- Security references: Section 14.1
- Event contract: Section 11.4 error handling

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M14` is fully satisfied
- [ ] Host-only commands are enforced server-side
- [ ] Rate limiting and payload validation are active

## Deliverables
- [ ] Code merged
- [ ] Security notes documented in README
- [ ] Matrix `Status` updated in Section 15
```

---

## [M15] Metrics, logging, and retention policy enforcement

Suggested milestone: `Milestone D - Reliability + Safety (M11-M15)`
Suggested labels: `priority:P1`, `type:ops`, `area:server`, `area:client`

```md
## Scope
Implement work item: **[M15] Metrics, logging, and retention policy enforcement**

## Spec References
- Matrix row: Section 15, ID `M15`
- Observability references: Section 13

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M15` is fully satisfied
- [ ] Required metrics are exposed and documented
- [ ] Logging follows retention constraints

## Deliverables
- [ ] Code merged
- [ ] Operations notes added to README/docs
- [ ] Matrix `Status` updated in Section 15
```

---

## [M16] Production deployment and smoke validation

Suggested milestone: `Milestone E - Demo Release (M16)`
Suggested labels: `priority:P0`, `type:feature`, `type:ops`, `area:client`, `area:server`

```md
## Scope
Implement work item: **[M16] Production deployment and smoke validation**

## Spec References
- Matrix row: Section 15, ID `M16`
- Exit criteria: Section 12.4

## Acceptance Criteria
- [ ] Definition of Done in Section 15 for `M16` is fully satisfied
- [ ] Public demo URL supports 2-peer streaming scenario
- [ ] Core failures have clear error UX paths

## Deliverables
- [ ] Code merged
- [ ] README contains live demo + architecture + setup
- [ ] Matrix `Status` updated in Section 15
```
