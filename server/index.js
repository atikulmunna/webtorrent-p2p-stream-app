require("dotenv").config()

const http = require("http")
const { randomUUID } = require("crypto")
const express = require("express")
const cors = require("cors")
const { Server } = require("socket.io")
const {
  addPeer,
  ensureRoom,
  getRoom,
  getRoomCount,
  isHostClient,
  isRoomMember,
  listPeers,
  removePeer,
} = require("./rooms")

const SERVER_PORT = Number(process.env.SERVER_PORT || process.env.PORT || 4000)
const CLIENT_PORT = Number(process.env.CLIENT_PORT || process.env.VITE_DEV_SERVER_PORT || 5173)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || `http://localhost:${CLIENT_PORT}`
const TRACKER_WS_PORT = Number(process.env.TRACKER_WS_PORT || 8000)
const ROOM_ID_MAX = 64
const CLIENT_ID_MAX = 64
const DISPLAY_NAME_MAX = 40
const CHAT_MSG_MAX = 500
const LATENCY_SAMPLE_LIMIT = 2000
const LOG_RETENTION_MS = Number(process.env.LOG_RETENTION_MS || 15 * 60 * 1000)
const LOG_BUFFER_MAX = Number(process.env.LOG_BUFFER_MAX || 2000)
const LOG_PRUNE_INTERVAL_MS = Number(process.env.LOG_PRUNE_INTERVAL_MS || 30 * 1000)

const metrics = {
  counters: {
    roomCreateSuccess: 0,
    roomCreateFailure: 0,
    roomJoinSuccess: 0,
    roomJoinFailure: 0,
    roomLeave: 0,
    peerDisconnected: 0,
    playbackStateForwarded: 0,
    playbackSeekForwarded: 0,
    playbackSyncForwarded: 0,
    chatMessagesForwarded: 0,
  },
  errorsByCode: {},
  latenciesMs: {},
  logsDropped: 0,
}
const eventLogs = []

function pruneLogs() {
  const cutoff = Date.now() - LOG_RETENTION_MS
  while (eventLogs.length > 0 && eventLogs[0].ts < cutoff) {
    eventLogs.shift()
  }
}

function appendLog(level, event, context = {}) {
  pruneLogs()
  if (eventLogs.length >= LOG_BUFFER_MAX) {
    eventLogs.shift()
    metrics.logsDropped += 1
  }
  eventLogs.push({
    ts: Date.now(),
    level,
    event,
    context,
  })
}

function incCounter(name) {
  if (!Object.prototype.hasOwnProperty.call(metrics.counters, name)) {
    metrics.counters[name] = 0
  }
  metrics.counters[name] += 1
}

function incError(code) {
  metrics.errorsByCode[code] = (metrics.errorsByCode[code] || 0) + 1
  appendLog("warn", "errorCode", { code })
}

function recordLatency(eventName, startedAt) {
  const elapsed = Date.now() - startedAt
  if (!metrics.latenciesMs[eventName]) metrics.latenciesMs[eventName] = []
  const arr = metrics.latenciesMs[eventName]
  arr.push(elapsed)
  if (arr.length > LATENCY_SAMPLE_LIMIT) arr.shift()
}

function p95(values) {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.95)
  return sorted[Math.min(idx, sorted.length - 1)]
}

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

function isSocketIdentityConflict(socket, roomId, clientId) {
  const boundRoomId = socket.data?.roomId
  const boundClientId = socket.data?.clientId
  if (boundRoomId && boundRoomId !== roomId) return true
  if (boundClientId && boundClientId !== clientId) return true
  return false
}

function isAuthorizedRoomMember(socket, roomId) {
  const socketRoomId = socket.data?.roomId
  const socketClientId = socket.data?.clientId
  if (!socketRoomId || !socketClientId) return false
  if (socketRoomId !== roomId) return false
  return isRoomMember(roomId, socketClientId)
}

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN }))
app.use(express.json())

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "signaling-server", ts: Date.now() })
})

app.get("/metrics", (_req, res) => {
  pruneLogs()
  const latencyP95 = Object.fromEntries(
    Object.entries(metrics.latenciesMs).map(([eventName, samples]) => [eventName, p95(samples)]),
  )

  res.json({
    ok: true,
    ts: Date.now(),
    activeRooms: getRoomCount(),
    activeSockets: io.engine?.clientsCount || 0,
    counters: metrics.counters,
    errorsByCode: metrics.errorsByCode,
    latencyP95Ms: latencyP95,
    logs: {
      buffered: eventLogs.length,
      dropped: metrics.logsDropped,
      retentionMs: LOG_RETENTION_MS,
      maxEntries: LOG_BUFFER_MAX,
    },
  })
})

app.get("/logs", (req, res) => {
  pruneLogs()
  const sinceMs = Number(req.query.sinceMs || 0)
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000)
  const filtered = sinceMs > 0 ? eventLogs.filter((entry) => entry.ts >= sinceMs) : eventLogs
  const items = filtered.slice(-limit)
  res.json({
    ok: true,
    ts: Date.now(),
    count: items.length,
    totalBuffered: eventLogs.length,
    dropped: metrics.logsDropped,
    retentionMs: LOG_RETENTION_MS,
    maxEntries: LOG_BUFFER_MAX,
    items,
  })
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
      appendLog("warn", "tracker:warning", { message: err.message })
    })
    trackerServer.on("error", (err) => {
      console.error(`Tracker error: ${err.message}`)
      appendLog("error", "tracker:error", { message: err.message })
    })
    trackerServer.on("listening", () => {
      console.log(`WebTorrent tracker listening on ws://localhost:${TRACKER_WS_PORT}/announce`)
      appendLog("info", "tracker:listening", { port: TRACKER_WS_PORT })
    })

    trackerServer.listen(TRACKER_WS_PORT)
  } catch (err) {
    console.error(`Failed to start WebTorrent tracker: ${err.message}`)
    appendLog("error", "tracker:start_failed", { message: err.message })
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ roomId, hostClientId, displayName }, ack) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "room:create", 10, 60_000)) {
      ack?.({ ok: false, errorCode: "RATE_LIMITED" })
      incCounter("roomCreateFailure")
      incError("RATE_LIMITED")
      recordLatency("room:create", startedAt)
      return
    }

    if (!validateRoomPayload(roomId, hostClientId)) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      incCounter("roomCreateFailure")
      incError("INVALID_PAYLOAD")
      recordLatency("room:create", startedAt)
      return
    }
    if (isSocketIdentityConflict(socket, roomId, hostClientId)) {
      ack?.({ ok: false, errorCode: "UNAUTHORIZED" })
      incCounter("roomCreateFailure")
      incError("UNAUTHORIZED")
      recordLatency("room:create", startedAt)
      return
    }
    if (getRoom(roomId)) {
      ack?.({ ok: false, errorCode: "ROOM_ALREADY_EXISTS" })
      incCounter("roomCreateFailure")
      incError("ROOM_ALREADY_EXISTS")
      recordLatency("room:create", startedAt)
      return
    }

    ensureRoom(roomId, hostClientId)
    addPeer(roomId, { clientId: hostClientId, displayName: normalizeDisplayName(displayName, "Host") })
    socket.data = { ...socket.data, roomId, clientId: hostClientId }
    socket.join(roomId)

    ack?.({ ok: true, roomId, createdAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
    appendLog("info", "room:create", { roomId, clientId: hostClientId })
    incCounter("roomCreateSuccess")
    recordLatency("room:create", startedAt)
  })

  socket.on("room:join", ({ roomId, guestClientId, displayName }, ack) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "room:join", 20, 60_000)) {
      ack?.({ ok: false, errorCode: "RATE_LIMITED" })
      incCounter("roomJoinFailure")
      incError("RATE_LIMITED")
      recordLatency("room:join", startedAt)
      return
    }

    if (!validateRoomPayload(roomId, guestClientId)) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      incCounter("roomJoinFailure")
      incError("INVALID_PAYLOAD")
      recordLatency("room:join", startedAt)
      return
    }
    if (isSocketIdentityConflict(socket, roomId, guestClientId)) {
      ack?.({ ok: false, errorCode: "UNAUTHORIZED" })
      incCounter("roomJoinFailure")
      incError("UNAUTHORIZED")
      recordLatency("room:join", startedAt)
      return
    }

    const room = getRoom(roomId)
    if (!room) {
      ack?.({ ok: false, errorCode: "ROOM_NOT_FOUND" })
      incCounter("roomJoinFailure")
      incError("ROOM_NOT_FOUND")
      recordLatency("room:join", startedAt)
      return
    }
    if (room.hostClientId === guestClientId) {
      ack?.({ ok: false, errorCode: "UNAUTHORIZED" })
      incCounter("roomJoinFailure")
      incError("UNAUTHORIZED")
      recordLatency("room:join", startedAt)
      return
    }
    if (isRoomMember(roomId, guestClientId)) {
      ack?.({ ok: false, errorCode: "CLIENT_ID_IN_USE" })
      incCounter("roomJoinFailure")
      incError("CLIENT_ID_IN_USE")
      recordLatency("room:join", startedAt)
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
    appendLog("info", "room:join", { roomId, clientId: guestClientId })
    incCounter("roomJoinSuccess")
    recordLatency("room:join", startedAt)
  })

  socket.on("playback:state", (payload) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "playback:state", 60, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:state" })
      incError("RATE_LIMITED")
      recordLatency("playback:state", startedAt)
      return
    }
    if (!validatePlaybackPayload(payload) || !["play", "pause"].includes(payload.state)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:state" })
      incError("INVALID_PAYLOAD")
      recordLatency("playback:state", startedAt)
      return
    }

    const senderId = socket.data?.clientId
    if (!isAuthorizedRoomMember(socket, payload.roomId) || !senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:state" })
      incError("UNAUTHORIZED")
      recordLatency("playback:state", startedAt)
      return
    }
    socket.to(payload.roomId).emit("playback:state", payload)
    appendLog("info", "playback:state", { roomId: payload.roomId, state: payload.state })
    incCounter("playbackStateForwarded")
    recordLatency("playback:state", startedAt)
  })

  socket.on("playback:seek", (payload) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "playback:seek", 120, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:seek" })
      incError("RATE_LIMITED")
      recordLatency("playback:seek", startedAt)
      return
    }
    if (!validatePlaybackPayload(payload)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:seek" })
      incError("INVALID_PAYLOAD")
      recordLatency("playback:seek", startedAt)
      return
    }

    const senderId = socket.data?.clientId
    if (!isAuthorizedRoomMember(socket, payload.roomId) || !senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:seek" })
      incError("UNAUTHORIZED")
      recordLatency("playback:seek", startedAt)
      return
    }
    socket.to(payload.roomId).emit("playback:seek", payload)
    appendLog("info", "playback:seek", { roomId: payload.roomId, mediaTimeSec: payload.mediaTimeSec })
    incCounter("playbackSeekForwarded")
    recordLatency("playback:seek", startedAt)
  })

  socket.on("playback:sync", (payload) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "playback:sync", 180, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "playback:sync" })
      incError("RATE_LIMITED")
      recordLatency("playback:sync", startedAt)
      return
    }
    if (
      !validatePlaybackPayload(payload) ||
      (payload.hostNowMs !== undefined && !Number.isFinite(payload.hostNowMs))
    ) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "playback:sync" })
      incError("INVALID_PAYLOAD")
      recordLatency("playback:sync", startedAt)
      return
    }

    const senderId = socket.data?.clientId
    if (!isAuthorizedRoomMember(socket, payload.roomId) || !senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:sync" })
      incError("UNAUTHORIZED")
      recordLatency("playback:sync", startedAt)
      return
    }
    socket.to(payload.roomId).emit("playback:sync", payload)
    appendLog("info", "playback:sync", { roomId: payload.roomId, mediaTimeSec: payload.mediaTimeSec })
    incCounter("playbackSyncForwarded")
    recordLatency("playback:sync", startedAt)
  })

  socket.on("chat:send", (payload) => {
    const startedAt = Date.now()
    if (!checkRateLimit(socket, "chat:send", 30, 60_000)) {
      socket.emit("room:error", { errorCode: "RATE_LIMITED", context: "chat:send" })
      incError("RATE_LIMITED")
      recordLatency("chat:send", startedAt)
      return
    }
    if (!validateChatPayload(payload)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "chat:send" })
      incError("INVALID_PAYLOAD")
      recordLatency("chat:send", startedAt)
      return
    }
    if (!isAuthorizedRoomMember(socket, payload.roomId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "chat:send" })
      incError("UNAUTHORIZED")
      recordLatency("chat:send", startedAt)
      return
    }

    const text = payload.text.trim()
    const senderId = socket.data.clientId
    io.to(payload.roomId).emit("chat:message", {
      roomId: payload.roomId,
      messageId: payload.messageId || randomUUID(),
      senderId,
      text,
      sentAtMs: Number.isFinite(payload.sentAtMs) ? payload.sentAtMs : Date.now(),
    })
    appendLog("info", "chat:message", { roomId: payload.roomId, senderId })
    incCounter("chatMessagesForwarded")
    recordLatency("chat:send", startedAt)
  })

  socket.on("room:leave", ({ roomId, clientId }) => {
    const startedAt = Date.now()
    if (!validateRoomPayload(roomId, clientId)) {
      socket.emit("room:error", { errorCode: "INVALID_PAYLOAD", context: "room:leave" })
      incError("INVALID_PAYLOAD")
      recordLatency("room:leave", startedAt)
      return
    }
    if (!isAuthorizedRoomMember(socket, roomId) || socket.data.clientId !== clientId) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "room:leave" })
      incError("UNAUTHORIZED")
      recordLatency("room:leave", startedAt)
      return
    }
    socket.leave(roomId)
    removePeer(roomId, clientId)
    io.to(roomId).emit("room:peer-left", { roomId, clientId, leftAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
    appendLog("info", "room:leave", { roomId, clientId })
    incCounter("roomLeave")
    recordLatency("room:leave", startedAt)
  })

  socket.on("disconnect", () => {
    const startedAt = Date.now()
    const { roomId, clientId } = socket.data || {}
    if (!roomId || !clientId) {
      recordLatency("disconnect", startedAt)
      return
    }
    removePeer(roomId, clientId)
    io.to(roomId).emit("room:peer-left", { roomId, clientId, leftAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
    appendLog("info", "disconnect", { roomId, clientId })
    incCounter("peerDisconnected")
    recordLatency("disconnect", startedAt)
  })
})

server.listen(SERVER_PORT, () => {
  console.log(`Signaling server listening on http://localhost:${SERVER_PORT}`)
  console.log(`Allowed client origin: ${CLIENT_ORIGIN}`)
  appendLog("info", "server:listening", { port: SERVER_PORT, clientOrigin: CLIENT_ORIGIN })
})

startWebTorrentTracker()
const logPruneTimer = setInterval(pruneLogs, LOG_PRUNE_INTERVAL_MS)
logPruneTimer.unref()

function shutdown() {
  clearInterval(logPruneTimer)
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
