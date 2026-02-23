#!/usr/bin/env node
const { spawn } = require("child_process")
const path = require("path")
const { io } = require("socket.io-client")

const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT || 4101)
const TRACKER_WS_PORT = Number(process.env.SMOKE_TRACKER_PORT || 8101)
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

  try {
    await waitForServer()

    const host = io(BASE_URL, { transports: ["websocket"], timeout: 5000 })
    const guest = io(BASE_URL, { transports: ["websocket"], timeout: 5000 })
    await Promise.all([onceWithTimeout(host, "connect"), onceWithTimeout(guest, "connect")])

    const roomId = `smoke-${Date.now()}`
    const hostClientId = "host-smoke"
    const guestClientId = "guest-smoke"

    await new Promise((resolve, reject) => {
      host.emit(
        "room:create",
        { roomId, hostClientId, displayName: "HostSmoke" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:create failed: ${ack?.errorCode}`))),
      )
    })

    await new Promise((resolve, reject) => {
      guest.emit(
        "room:join",
        { roomId, guestClientId, displayName: "GuestSmoke" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:join failed: ${ack?.errorCode}`))),
      )
    })

    const chatPromiseHost = onceWithTimeout(host, "chat:message")
    const chatPromiseGuest = onceWithTimeout(guest, "chat:message")
    guest.emit("chat:send", {
      roomId,
      messageId: `msg-${Date.now()}`,
      senderId: guestClientId,
      text: "smoke-chat-message",
      sentAtMs: Date.now(),
    })

    const [hostMsg, guestMsg] = await Promise.all([chatPromiseHost, chatPromiseGuest])
    if (hostMsg.text !== "smoke-chat-message" || guestMsg.text !== "smoke-chat-message") {
      throw new Error("Chat message payload mismatch")
    }

    const metricsRes = await fetch(`${BASE_URL}/metrics`)
    if (!metricsRes.ok) throw new Error("Failed to fetch /metrics")
    const metrics = await metricsRes.json()

    const joinSuccess = metrics?.counters?.roomJoinSuccess || 0
    const createSuccess = metrics?.counters?.roomCreateSuccess || 0
    const chatForwarded = metrics?.counters?.chatMessagesForwarded || 0
    const p95Join = metrics?.latencyP95Ms?.["room:join"]
    if (createSuccess < 1 || joinSuccess < 1 || chatForwarded < 1) {
      throw new Error("Metrics counters missing expected increments")
    }
    if (typeof p95Join !== "number") {
      throw new Error("Expected numeric p95 room:join latency in metrics")
    }
    if (!metrics?.logs || typeof metrics.logs.buffered !== "number" || typeof metrics.logs.retentionMs !== "number") {
      throw new Error("Expected logs retention metadata in /metrics response")
    }

    const logsRes = await fetch(`${BASE_URL}/logs?limit=200`)
    if (!logsRes.ok) throw new Error("Failed to fetch /logs")
    const logsPayload = await logsRes.json()
    const hasChatLog = Array.isArray(logsPayload.items) && logsPayload.items.some((e) => e.event === "chat:message")
    if (!hasChatLog) {
      throw new Error("Expected chat:message event in /logs output")
    }

    host.disconnect()
    guest.disconnect()
    console.log("Smoke PASS: M8 chat flow and M15 metrics/log lifecycle endpoints validated.")
  } finally {
    serverProcess.kill("SIGTERM")
  }
}

run().catch((err) => {
  console.error(`Smoke FAIL: ${err.message}`)
  process.exit(1)
})
