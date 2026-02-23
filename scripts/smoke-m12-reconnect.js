#!/usr/bin/env node
const { spawn } = require("child_process")
const path = require("path")
const { io } = require("socket.io-client")

const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT || 4103)
const TRACKER_WS_PORT = Number(process.env.SMOKE_TRACKER_PORT || 8103)
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

    const roomId = `reconnect-${Date.now()}`
    const hostClientId = "host-reconnect"
    const guestClientId = "guest-reconnect"

    await new Promise((resolve, reject) => {
      host.emit(
        "room:create",
        { roomId, hostClientId, displayName: "HostReconnect" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:create failed: ${ack?.errorCode}`))),
      )
    })
    await new Promise((resolve, reject) => {
      guest.emit(
        "room:join",
        { roomId, guestClientId, displayName: "GuestReconnect" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:join failed: ${ack?.errorCode}`))),
      )
    })

    host.emit("playback:sync", {
      roomId,
      mediaTimeSec: 42.25,
      hostNowMs: Date.now(),
    })
    await sleep(200)

    guest.disconnect()
    await sleep(200)

    const guestReconnected = io(BASE_URL, { transports: ["websocket"], timeout: 5000 })
    await onceWithTimeout(guestReconnected, "connect")

    const resumeAck = await new Promise((resolve) => {
      guestReconnected.emit(
        "room:resume",
        { roomId, clientId: guestClientId, displayName: "GuestReconnect", role: "guest" },
        (ack) => resolve(ack),
      )
    })

    if (!resumeAck?.ok) {
      throw new Error(`room:resume failed: ${resumeAck?.errorCode}`)
    }
    if (!resumeAck?.playbackSnapshot || Math.abs((resumeAck.playbackSnapshot.mediaTimeSec || 0) - 42.25) > 0.2) {
      throw new Error("Expected playback snapshot in room:resume ack")
    }

    const metricsRes = await fetch(`${BASE_URL}/metrics`)
    if (!metricsRes.ok) throw new Error("Failed to fetch /metrics")
    const metrics = await metricsRes.json()
    if ((metrics?.counters?.roomResumeSuccess || 0) < 1) {
      throw new Error("Expected roomResumeSuccess counter increment")
    }

    host.disconnect()
    guestReconnected.disconnect()
    console.log("Smoke PASS: M12 room resume and playback snapshot replay validated.")
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
