import test from "node:test"
import assert from "node:assert/strict"
import {
  computeTrackerFailover,
  extractTrackerUrl,
  getCompatibilityHint,
  getNormalizeCommandHint,
  isLikelySupportedMvpVideo,
  selectPlayableTorrentFile,
} from "../src/lib/stream-policy.js"

test("isLikelySupportedMvpVideo accepts mp4 by extension or MIME", () => {
  assert.equal(isLikelySupportedMvpVideo({ name: "clip.mp4", type: "" }), true)
  assert.equal(isLikelySupportedMvpVideo({ name: "clip.unknown", type: "video/mp4" }), true)
  assert.equal(isLikelySupportedMvpVideo({ name: "clip.webm", type: "video/webm" }), false)
})

test("getCompatibilityHint warns non-mp4 and guidance for mp4", () => {
  assert.match(getCompatibilityHint({ name: "clip.webm" }), /Best compatibility/i)
  assert.match(getCompatibilityHint({ name: "clip.mp4" }), /normalize to H\.264\/AAC/i)
})

test("getNormalizeCommandHint returns actionable normalize command", () => {
  assert.equal(
    getNormalizeCommandHint("clip.mp4"),
    'Try: npm run video:normalize -- "clip.mp4"',
  )
})

test("extractTrackerUrl parses ws/wss URLs from tracker errors", () => {
  assert.equal(
    extractTrackerUrl("Error connecting to wss://tracker.webtorrent.dev"),
    "wss://tracker.webtorrent.dev",
  )
  assert.equal(extractTrackerUrl("Error connecting to ws://localhost:8001/announce"), "ws://localhost:8001/announce")
  assert.equal(extractTrackerUrl("random error"), null)
})

test("computeTrackerFailover increments failure count and quarantines at threshold", () => {
  const trackerUrls = ["ws://local", "wss://primary", "wss://backup"]
  const activeTrackerUrls = [...trackerUrls]

  const first = computeTrackerFailover({
    trackerUrls,
    activeTrackerUrls,
    failureMap: new Map(),
    failedUrl: "wss://primary",
    threshold: 2,
  })
  assert.equal(first.quarantined, false)
  assert.equal(first.nextTrackers, null)
  assert.equal(first.nextFailureMap.get("wss://primary"), 1)

  const second = computeTrackerFailover({
    trackerUrls,
    activeTrackerUrls,
    failureMap: first.nextFailureMap,
    failedUrl: "wss://primary",
    threshold: 2,
  })
  assert.equal(second.quarantined, true)
  assert.deepEqual(second.nextTrackers, ["ws://local", "wss://backup"])
  assert.equal(second.nextFailureMap.get("wss://primary"), 2)
})

test("selectPlayableTorrentFile accepts mp4 and blocks unsupported containers", () => {
  const ok = selectPlayableTorrentFile([{ name: "movie.webm" }, { name: "movie.mp4" }])
  assert.equal(ok.file?.name, "movie.mp4")
  assert.equal(ok.errorCode, null)

  const blocked = selectPlayableTorrentFile([{ name: "movie.webm" }, { name: "movie.mkv" }])
  assert.equal(blocked.file, null)
  assert.equal(blocked.errorCode, "UNSUPPORTED_CONTAINER")
  assert.match(blocked.errorMessage, /Required format/i)
})
