#!/usr/bin/env node
const { spawn } = require("child_process")
const path = require("path")
const { io } = require("socket.io-client")

const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT || 4104)
const TRACKER_WS_PORT = Number(process.env.SMOKE_TRACKER_PORT || 8104)
const BASE_URL = `http://localhost:${SERVER_PORT}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) return
    } catch {
      // retry
    }
    await sleep(200)
  }
  throw new Error("Server did not become healthy in time")
}

function onceWithTimeout(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      reject(new Error(`Timed out waiting for event: ${event}`))
    }, timeoutMs)
    function onEvent(payload) {
      clearTimeout(timer)
      resolve(payload)
    }
    socket.once(event, onEvent)
  })
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.95)
  return sorted[Math.min(idx, sorted.length - 1)]
}

async function run() {
  const serverProcess = spawn("node", ["index.js"], {
    cwd: path.resolve(__dirname, "..", "server"),
    env: {
      ...process.env,
      SERVER_PORT: `${SERVER_PORT}`,
      TRACKER_WS_PORT: `${TRACKER_WS_PORT}`,
      CLIENT_ORIGIN: "http://localhost:5173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  serverProcess.stdout.on("data", () => {})
  serverProcess.stderr.on("data", () => {})

  let host
  let guest
  try {
    await waitForServer()

    host = io(BASE_URL, { transports: ["websocket"], timeout: 5000 })
    guest = io(BASE_URL, { transports: ["websocket"], timeout: 5000 })
    await Promise.all([onceWithTimeout(host, "connect"), onceWithTimeout(guest, "connect")])

    const roomId = `core-${Date.now()}`
    const hostClientId = "host-core"
    const guestClientId = "guest-core"

    await new Promise((resolve, reject) => {
      host.emit(
        "room:create",
        { roomId, hostClientId, displayName: "HostCore" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:create failed: ${ack?.errorCode}`))),
      )
    })

    const hostPeersAfterCreate = await onceWithTimeout(host, "room:peers")
    if (!Array.isArray(hostPeersAfterCreate.peers) || hostPeersAfterCreate.peers.length !== 1) {
      throw new Error("Expected exactly one peer after room:create")
    }

    const hostPeerJoinedPromise = onceWithTimeout(host, "room:peer-joined")
    const hostPeersAfterJoinPromise = onceWithTimeout(host, "room:peers")
    const guestPeersAfterJoinPromise = onceWithTimeout(guest, "room:peers")

    await new Promise((resolve, reject) => {
      guest.emit(
        "room:join",
        { roomId, guestClientId, displayName: "GuestCore" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:join failed: ${ack?.errorCode}`))),
      )
    })

    const [peerJoined, hostPeersAfterJoin, guestPeersAfterJoin] = await Promise.all([
      hostPeerJoinedPromise,
      hostPeersAfterJoinPromise,
      guestPeersAfterJoinPromise,
    ])
    if (peerJoined?.clientId !== guestClientId) {
      throw new Error("Expected host to receive room:peer-joined for guest")
    }
    if ((hostPeersAfterJoin.peers || []).length !== 2 || (guestPeersAfterJoin.peers || []).length !== 2) {
      throw new Error("Expected both host/guest peer lists to contain two members after join")
    }

    const stateLatencies = []
    for (let i = 0; i < 8; i += 1) {
      const state = i % 2 === 0 ? "play" : "pause"
      const mediaTimeSec = 12.5 + i
      const sendAt = Date.now()
      const playbackStatePromise = onceWithTimeout(guest, "playback:state")
      host.emit("playback:state", { roomId, state, mediaTimeSec, sentAtMs: sendAt })
      const playbackState = await playbackStatePromise
      stateLatencies.push(Date.now() - sendAt)
      if (playbackState.state !== state || Number(playbackState.mediaTimeSec) !== mediaTimeSec) {
        throw new Error("Expected forwarded playback:state payload")
      }
    }

    const seekLatencies = []
    for (let i = 0; i < 12; i += 1) {
      const mediaTimeSec = 18.25 + i
      const sendAt = Date.now()
      const playbackSeekPromise = onceWithTimeout(guest, "playback:seek")
      host.emit("playback:seek", { roomId, mediaTimeSec, sentAtMs: sendAt })
      const playbackSeek = await playbackSeekPromise
      seekLatencies.push(Date.now() - sendAt)
      if (Number(playbackSeek.mediaTimeSec) !== mediaTimeSec) {
        throw new Error("Expected forwarded playback:seek payload")
      }
    }

    if (p95(stateLatencies) > 250) {
      throw new Error(`playback:state p95 latency exceeded target: ${p95(stateLatencies)}ms`)
    }
    if (p95(seekLatencies) > 250) {
      throw new Error(`playback:seek p95 latency exceeded target: ${p95(seekLatencies)}ms`)
    }

    const playbackSyncPromise = onceWithTimeout(guest, "playback:sync")
    host.emit("playback:sync", { roomId, mediaTimeSec: 21.75, hostNowMs: Date.now() })
    const playbackSync = await playbackSyncPromise
    if (Number(playbackSync.mediaTimeSec) !== 21.75) {
      throw new Error("Expected forwarded playback:sync payload")
    }

    const hostPeerLeftPromise = onceWithTimeout(host, "room:peer-left")
    const hostPeersAfterLeavePromise = onceWithTimeout(host, "room:peers")
    guest.emit("room:leave", { roomId, clientId: guestClientId })

    const [peerLeft, hostPeersAfterLeave] = await Promise.all([hostPeerLeftPromise, hostPeersAfterLeavePromise])
    if (peerLeft?.clientId !== guestClientId) {
      throw new Error("Expected host to receive room:peer-left for guest")
    }
    if ((hostPeersAfterLeave.peers || []).length !== 1) {
      throw new Error("Expected host peer list to return to one member after guest leave")
    }

    const metricsRes = await fetch(`${BASE_URL}/metrics`)
    if (!metricsRes.ok) throw new Error("Failed to fetch /metrics")
    const metrics = await metricsRes.json()
    if ((metrics?.counters?.roomCreateSuccess || 0) < 1) throw new Error("Missing roomCreateSuccess increment")
    if ((metrics?.counters?.roomJoinSuccess || 0) < 1) throw new Error("Missing roomJoinSuccess increment")
    if ((metrics?.counters?.roomLeave || 0) < 1) throw new Error("Missing roomLeave increment")
    if ((metrics?.counters?.playbackStateForwarded || 0) < 1) throw new Error("Missing playbackStateForwarded increment")
    if ((metrics?.counters?.playbackSeekForwarded || 0) < 1) throw new Error("Missing playbackSeekForwarded increment")
    if ((metrics?.counters?.playbackSyncForwarded || 0) < 1) throw new Error("Missing playbackSyncForwarded increment")

    host.disconnect()
    guest.disconnect()
    console.log("Smoke PASS: M2/M5/M6/M7 room, playback, and peer-consistency flows validated.")
  } finally {
    if (host?.connected) host.disconnect()
    if (guest?.connected) guest.disconnect()
    serverProcess.kill("SIGTERM")
  }
}

run().catch((err) => {
  console.error(`Smoke FAIL: ${err.message}`)
  process.exit(1)
})
