const rooms = new Map()

function ensureRoom(roomId, hostClientId = null) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      hostClientId,
      peers: new Map(),
      playbackSnapshot: null,
      createdAt: Date.now(),
    })
  }

  const room = rooms.get(roomId)
  if (hostClientId && !room.hostClientId) {
    room.hostClientId = hostClientId
  }

  return room
}

function addPeer(roomId, peer) {
  const room = ensureRoom(roomId)
  room.peers.set(peer.clientId, {
    clientId: peer.clientId,
    displayName: peer.displayName || "Guest",
    joinedAt: Date.now(),
  })
  return room
}

function removePeer(roomId, clientId) {
  const room = rooms.get(roomId)
  if (!room) return null

  room.peers.delete(clientId)
  if (room.peers.size === 0) {
    rooms.delete(roomId)
    return null
  }

  if (room.hostClientId === clientId) {
    const firstPeer = room.peers.values().next().value
    room.hostClientId = firstPeer ? firstPeer.clientId : null
  }

  return room
}

function getRoom(roomId) {
  return rooms.get(roomId) || null
}

function listPeers(roomId) {
  const room = rooms.get(roomId)
  if (!room) return []
  return Array.from(room.peers.values())
}

function isHostClient(roomId, clientId) {
  const room = rooms.get(roomId)
  if (!room) return false
  return room.hostClientId === clientId
}

function isRoomMember(roomId, clientId) {
  const room = rooms.get(roomId)
  if (!room) return false
  return room.peers.has(clientId)
}

function setPlaybackSnapshot(roomId, snapshot) {
  const room = rooms.get(roomId)
  if (!room) return null
  room.playbackSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
  }
  return room.playbackSnapshot
}

function getPlaybackSnapshot(roomId) {
  const room = rooms.get(roomId)
  if (!room) return null
  return room.playbackSnapshot || null
}

function getRoomCount() {
  return rooms.size
}

module.exports = {
  addPeer,
  ensureRoom,
  getRoom,
  getRoomCount,
  getPlaybackSnapshot,
  isHostClient,
  isRoomMember,
  listPeers,
  removePeer,
  setPlaybackSnapshot,
}
