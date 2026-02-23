#!/usr/bin/env node
const { spawn } = require("child_process")
const path = require("path")
const { io } = require("socket.io-client")

const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT || 4102)
const TRACKER_WS_PORT = Number(process.env.SMOKE_TRACKER_PORT || 8102)
const BASE_URL = `http://localhost:${SERVER_PORT}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
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

async function expectNoEvent(socket, event, timeoutMs = 1200) {
  let fired = false
  const onEvent = () => {
    fired = true
  }
  socket.once(event, onEvent)
  await sleep(timeoutMs)
  socket.off(event, onEvent)
  if (fired) throw new Error(`Unexpected event received: ${event}`)
}

async function stopProcess(child) {
  if (!child || child.killed) return
  await new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    child.once("exit", finish)
    child.kill("SIGTERM")
    setTimeout(() => {
      if (!done) child.kill("SIGKILL")
    }, 1500)
    setTimeout(finish, 4000)
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
  let attacker
  try {
    await waitForServer()
    host = io(BASE_URL, { transports: ["websocket"], timeout: 5000, reconnection: false })
    guest = io(BASE_URL, { transports: ["websocket"], timeout: 5000, reconnection: false })
    attacker = io(BASE_URL, { transports: ["websocket"], timeout: 5000, reconnection: false })
    await Promise.all([
      onceWithTimeout(host, "connect"),
      onceWithTimeout(guest, "connect"),
      onceWithTimeout(attacker, "connect"),
    ])

    const roomId = `secure-${Date.now()}`
    const hostClientId = "host-secure"
    const guestClientId = "guest-secure"

    await new Promise((resolve, reject) => {
      host.emit(
        "room:create",
        { roomId, hostClientId, displayName: "HostSecure" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:create failed: ${ack?.errorCode}`))),
      )
    })

    await new Promise((resolve, reject) => {
      guest.emit(
        "room:join",
        { roomId, guestClientId, displayName: "GuestSecure" },
        (ack) => (ack?.ok ? resolve() : reject(new Error(`room:join failed: ${ack?.errorCode}`))),
      )
    })

    const unauthorizedPlaybackErr = onceWithTimeout(guest, "room:error")
    guest.emit("playback:state", { roomId, state: "play", mediaTimeSec: 1 })
    const playbackErr = await unauthorizedPlaybackErr
    if (playbackErr?.errorCode !== "UNAUTHORIZED" || playbackErr?.context !== "playback:state") {
      throw new Error("Expected UNAUTHORIZED room:error for guest playback:state")
    }
    await expectNoEvent(host, "playback:state")

    const impersonationAck = await new Promise((resolve) => {
      attacker.emit(
        "room:join",
        { roomId, guestClientId: hostClientId, displayName: "SpoofHost" },
        (ack) => resolve(ack),
      )
    })
    if (impersonationAck?.ok || impersonationAck?.errorCode !== "UNAUTHORIZED") {
      throw new Error("Expected UNAUTHORIZED when attacker joins with host client id")
    }

    const chatHostMsg = onceWithTimeout(host, "chat:message")
    const chatGuestMsg = onceWithTimeout(guest, "chat:message")
    guest.emit("chat:send", {
      roomId,
      senderId: "spoofed-sender-id",
      text: "secure-chat",
      sentAtMs: Date.now(),
    })
    const [hostMsg, guestMsg] = await Promise.all([chatHostMsg, chatGuestMsg])
    if (hostMsg.senderId !== guestClientId || guestMsg.senderId !== guestClientId) {
      throw new Error("Server did not enforce chat sender identity from socket context")
    }

    host.disconnect()
    guest.disconnect()
    attacker.disconnect()
    console.log("Smoke PASS: M14 host auth and abuse controls validated.")
  } finally {
    if (host) host.disconnect()
    if (guest) guest.disconnect()
    if (attacker) attacker.disconnect()
    await stopProcess(serverProcess)
  }
}

run().catch((err) => {
  console.error(`Smoke FAIL: ${err.message}`)
  process.exit(1)
})
