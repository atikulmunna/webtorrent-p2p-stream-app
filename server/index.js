const http = require("http")
const { randomUUID } = require("crypto")
const express = require("express")
const cors = require("cors")
const { Server } = require("socket.io")
const { addPeer, ensureRoom, getRoom, isHostClient, listPeers, removePeer } = require("./rooms")

const PORT = process.env.PORT || 4000
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173"

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

io.on("connection", (socket) => {
  socket.on("room:create", ({ roomId, hostClientId, displayName }, ack) => {
    if (!roomId || !hostClientId) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      return
    }

    ensureRoom(roomId, hostClientId)
    addPeer(roomId, { clientId: hostClientId, displayName: displayName || "Host" })
    socket.data = { roomId, clientId: hostClientId }
    socket.join(roomId)

    ack?.({ ok: true, roomId, createdAt: Date.now() })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
  })

  socket.on("room:join", ({ roomId, guestClientId, displayName }, ack) => {
    if (!roomId || !guestClientId) {
      ack?.({ ok: false, errorCode: "INVALID_PAYLOAD" })
      return
    }

    const room = getRoom(roomId)
    if (!room) {
      ack?.({ ok: false, errorCode: "ROOM_NOT_FOUND" })
      return
    }

    addPeer(roomId, { clientId: guestClientId, displayName: displayName || "Guest" })
    socket.data = { roomId, clientId: guestClientId }
    socket.join(roomId)

    io.to(roomId).emit("room:peer-joined", {
      roomId,
      clientId: guestClientId,
      displayName: displayName || "Guest",
      joinedAt: Date.now(),
    })
    io.to(roomId).emit("room:peers", { roomId, peers: listPeers(roomId) })
    ack?.({ ok: true, roomId })
  })

  socket.on("playback:state", (payload) => {
    if (!payload?.roomId) return
    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:state" })
      return
    }
    socket.to(payload.roomId).emit("playback:state", payload)
  })

  socket.on("playback:seek", (payload) => {
    if (!payload?.roomId) return
    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:seek" })
      return
    }
    socket.to(payload.roomId).emit("playback:seek", payload)
  })

  socket.on("playback:sync", (payload) => {
    if (!payload?.roomId) return
    const senderId = socket.data?.clientId
    if (!senderId || !isHostClient(payload.roomId, senderId)) {
      socket.emit("room:error", { errorCode: "UNAUTHORIZED", context: "playback:sync" })
      return
    }
    socket.to(payload.roomId).emit("playback:sync", payload)
  })

  socket.on("chat:send", (payload) => {
    if (!payload?.roomId || !payload?.text?.trim()) return
    io.to(payload.roomId).emit("chat:message", {
      roomId: payload.roomId,
      messageId: payload.messageId || randomUUID(),
      senderId: payload.senderId,
      text: payload.text,
      sentAtMs: payload.sentAtMs || Date.now(),
    })
  })

  socket.on("room:leave", ({ roomId, clientId }) => {
    if (!roomId || !clientId) return
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

server.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`)
})
