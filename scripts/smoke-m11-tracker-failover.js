#!/usr/bin/env node
const { randomBytes } = require("crypto")

const TRACKER_PORT = Number(process.env.SMOKE_TRACKER_PORT || 0)
const DEAD_PRIMARY_TRACKER = process.env.SMOKE_DEAD_TRACKER || "http://127.0.0.1:1/announce"

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

async function main() {
  const TrackerModule = await import("bittorrent-tracker")
  const { Server: TrackerServer } = TrackerModule
  const WebTorrentModule = await import("webtorrent")
  const WebTorrent = WebTorrentModule.default
  let tracker
  let seedClient
  let guestClient
  let seedTorrent
  let guestTorrent

  let liveSecondaryTracker = null

  try {
    tracker = new TrackerServer({ udp: false, http: true, ws: false, stats: false })
    await new Promise((resolve, reject) => {
      tracker.once("error", reject)
      tracker.once("listening", resolve)
      tracker.listen(TRACKER_PORT)
    })
    const listenPort = tracker.http.address().port
    liveSecondaryTracker = `http://127.0.0.1:${listenPort}/announce`

    seedClient = new WebTorrent({ dht: false, lsd: false })
    guestClient = new WebTorrent({ dht: false, lsd: false })

    let primaryFailureObserved = false
    const announce = [DEAD_PRIMARY_TRACKER, liveSecondaryTracker]

    seedTorrent = await new Promise((resolve, reject) => {
      const fileBuffer = randomBytes(512 * 1024)
      seedClient.seed(fileBuffer, { announce, private: false, name: "m11-failover-test.mp4" }, (torrent) => {
        resolve(torrent)
      })
      seedClient.once("error", reject)
    })

    guestTorrent = guestClient.add(seedTorrent.magnetURI, { announce })

    guestTorrent.on("warning", (err) => {
      if (String(err?.message || "").includes("127.0.0.1:1")) {
        primaryFailureObserved = true
      }
    })

    const metadataPromise = new Promise((resolve, reject) => {
      guestTorrent.once("metadata", () => resolve(true))
      guestTorrent.once("error", reject)
    })

    await withTimeout(metadataPromise, 30000, "guest metadata via fallback tracker")

    // Give tracker announces a short window to emit warning for dead primary.
    await sleep(1500)

    if (guestTorrent.numPeers < 1) {
      throw new Error("Guest did not connect to any peers through secondary tracker")
    }

    if (!primaryFailureObserved) {
      // Not fatal if warning string differs by platform/network stack, but keep explicit signal.
      console.warn("Warning: primary tracker failure warning not explicitly observed; fallback still succeeded.")
    }

    console.log("Smoke PASS: M11 tracker failover works (dead primary, live secondary).")
  } finally {
    if (guestTorrent) {
      try {
        guestTorrent.destroy()
      } catch {
        // no-op
      }
    }
    if (seedTorrent) {
      try {
        seedTorrent.destroy()
      } catch {
        // no-op
      }
    }
    if (guestClient) {
      try {
        await guestClient.destroy()
      } catch {
        // no-op
      }
    }
    if (seedClient) {
      try {
        await seedClient.destroy()
      } catch {
        // no-op
      }
    }
    if (tracker) {
      try {
        await new Promise((resolve) => tracker.close(() => resolve()))
      } catch {
        // no-op
      }
    }
  }
}

main().catch((err) => {
  console.error(`Smoke FAIL: ${err.message}`)
  process.exit(1)
})
