require("dotenv").config()

const http = require("http")
const { randomUUID } = require("crypto")
const express = require("express")
const cors = require("cors")
const { Server } = require("socket.io")
const { addPeer, ensureRoom, getRoom, isHostClient, listPeers, removePeer } = require("./rooms")

const SERVER_PORT = Number(process.env.SERVER_PORT || process.env.PORT || 4000)
const CLIENT_PORT = Number(process.env.CLIENT_PORT || process.env.VITE_DEV_SERVER_PORT || 5173)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || `http://localhost:${CLIENT_PORT}`
const TRACKER_WS_PORT = Number(process.env.TRACKER_WS_PORT || 8000)
const ROOM_ID_MAX = 64
const CLIENT_ID_MAX = 64
const DISPLAY_NAME_MAX = 40
const CHAT_MSG_MAX = 500

function isSafeId(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && /^[a-zA-Z0-9_-]+$/.test(value)
}

function normalizeDisplayName(value, fallback) {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, DISPLAY_NAME_MAX)
}

function validateRoomPayload(roomId, clientId) {
  return isSafeId(roomId, ROOM_ID_MAX) && isSafeId(clientId, CLIENT_ID_MAX)
}

function validatePlaybackPayload(payload) {
  return (
    payload &&
    isSafeId(payload.roomId, ROOM_ID_MAX) &&
    Number.isFinite(payload.mediaTimeSec) &&
    payload.mediaTimeSec >= 0
  )
}

function validateChatPayload(payload) {
  return (
    payload &&
    isSafeId(payload.roomId, ROOM_ID_MAX) &&
    typeof payload.text === "string" &&
    payload.text.trim().length > 0 &&
    payload.text.trim().length <= CHAT_MSG_MAX
  )
}

function checkRateLimit(socket, key, limit, windowMs) {
  if (!socket.data.rateLimits) socket.data.rateLimits = {}
  const now = Date.now()
  const bucket = socket.data.rateLimits[key] || { count: 0, resetAt: now + windowMs }

  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + windowMs
  }

  bucket.count += 1
  socket.data.rateLimits[key] = bucket
  return bucket.count <= limit
}

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN }))
app.use(express.json())

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "signaling-server", ts: Date.now() })
})

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
})

let trackerServer = null

async function startWebTorrentTracker() {
  try {
    const { Server: TrackerServer } = await import("bittorrent-tracker")
    trackerServer = new TrackerServer({
      udp: false,
      http: false,
      ws: true,
      stats: false,
    })

    trackerServer.on("warning", (err) => {
      console.warn(`Tracker warning: ${err.message}`)
    })
    trackerServer.on("error", (err) => {
      console.error(`Tracker error: ${err.message}`)
    })
    trackerServer.on("listening", () => {
      console.log(`WebTorrent tracker listening on ws://localhost:${TRACKER_WS_PORT}/announce`)
    })

    trackerServer.listen(TRACKER_WS_PORT)
  } catch (err) {
    console.error(`Failed to start WebTorrent tracker: ${err.message}`)
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ roomId, hostClientId, displayName }, ack) => {
    if (!checkRateLimit(socket, "room:create", 10, 60_000)) {
      ack?.({ ok: false, errorCode: "RATE_LIMITED" })
      return
    }

    if (!validateRoomPayload(roomId, hostClientId)) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      return
    }

    ensureRoom(roomId, hostClientId)
    addPeer(roomId, { clientId: hostClientId, displayName: normalizeDisplayName(displayName, "Host") })
    socket.data = { ...socket.data, roomId, clientId: hostClientId }
    socket.join(roomId)

    ack?.({ ok: true, roomId, createdAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
  })

  socket.on("room:join", ({ roomId, guestClientId, displayName }, ack) => {
    if (!checkRateLimit(socket, "room:join", 20, 60_000)) {
      ack?.({ ok: false, errorCode: "RATE_LIMITED" })
      return
    }

    if (!validateRoomPayload(roomId, guestClientId)) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      return
    }

    const room = getRoom(roomId)
    if (!room) {
      ack?.({ ok: false, errorCode: "ROOM_NOT_FOUND" })
      return
    }

    addPeer(roomId, { clientId: guestClientId, displayName: normalizeDisplayName(displayName, "Guest") })
    socket.data = { ...socket.data, roomId, clientId: guestClientId }
    socket.join(roomId)

    io.to(roomId).emit("room:peer-joined", {
      roomId,
      clientId: guestClientId,
      displayName: normalizeDisplayName(displayName, "Guest"),
      joinedAt: Date.now(),
    })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
    ack?.({ ok: true, roomId })
  })

  socket.on("playback:state", (payload) => {
    if (!checkRateLimit(socket, "playback:state", 60, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:state" })
      return
    }
    if (!validatePlaybackPayload(payload) || !["play", "pause"].includes(payload.state)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:state" })
      return
    }

    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:state" })
      return
    }
    socket.to(payload.roomId).emit("playback:state", payload)
  })

  socket.on("playback:seek", (payload) => {
    if (!checkRateLimit(socket, "playback:seek", 120, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:seek" })
      return
    }
    if (!validatePlaybackPayload(payload)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:seek" })
      return
    }

    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:seek" })
      return
    }
    socket.to(payload.roomId).emit("playback:seek", payload)
  })

  socket.on("playback:sync", (payload) => {
    if (!checkRateLimit(socket, "playback:sync", 180, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:sync" })
      return
    }
    if (
      !validatePlaybackPayload(payload) ||
      (payload.hostNowMs !== undefined && !Number.isFinite(payload.hostNowMs))
    ) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:sync" })
      return
    }

    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:sync" })
      return
    }
    socket.to(payload.roomId).emit("playback:sync", payload)
  })

  socket.on("chat:send", (payload) => {
    if (!checkRateLimit(socket, "chat:send", 30, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "chat:send" })
      return
    }
    if (!validateChatPayload(payload)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "chat:send" })
      return
    }

    const text = payload.text.trim()
    io.to(payload.roomId).emit("chat:message", {
      roomId: payload.roomId,
      messageId: payload.messageId || randomUUID(),
      senderId: payload.senderId,
      text,
      sentAtMs: payload.sentAtMs || Date.now(),
    })
  })

  socket.on("room:leave", ({ roomId, clientId }) => {
    if (!validateRoomPayload(roomId, clientId)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "room:leave" })
      return
    }
    socket.leave(roomId)
    removePeer(roomId, clientId)
    io.to(roomId).emit("room:peer-left", { roomId, clientId, leftAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
  })

  socket.on("disconnect", () => {
    const { roomId, clientId } = socket.data || {}
    if (!roomId || !clientId) return
    removePeer(roomId, clientId)
    io.to(roomId).emit("room:peer-left", { roomId, clientId, leftAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
  })
})

server.listen(SERVER_PORT, () => {
  console.log(`Signaling server listening on http://localhost:${SERVER_PORT}`)
  console.log(`Allowed client origin: ${CLIENT_ORIGIN}`)
})

startWebTorrentTracker()

function shutdown() {
  if (trackerServer) {
    try {
      trackerServer.close()
    } catch {
      // no-op
    }
  }
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
