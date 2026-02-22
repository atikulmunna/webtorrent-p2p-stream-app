import { useEffect, useMemo, useRef, useState } from "react"
import { io } from "socket.io-client"
import "./App.css"

function App() {
  const signalingUrl = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000"
  const clientId = useMemo(() => crypto.randomUUID(), [])
  const [displayName, setDisplayName] = useState("Host")
  const [roomId, setRoomId] = useState("")
  const [activeRoom, setActiveRoom] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [peers, setPeers] = useState([])
  const [events, setEvents] = useState([])
  const socketRef = useRef(null)

  useEffect(() => {
    const s = io(signalingUrl, { autoConnect: true })
    s.on("connect", () => setStatus("Connected"))
    s.on("disconnect", () => setStatus("Disconnected"))
    s.on("room:peers", (payload) => {
      setPeers(payload.peers || [])
    })
    s.on("room:peer-joined", (payload) => {
      setEvents((prev) => [`+ ${payload.displayName} joined`, ...prev].slice(0, 8))
    })
    s.on("room:peer-left", (payload) => {
      setEvents((prev) => [`- ${payload.clientId} left`, ...prev].slice(0, 8))
    })
    socketRef.current = s

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [signalingUrl])

  const createRoom = () => {
    if (!roomId.trim()) return
    socketRef.current?.emit(
      "room:create",
      {
        roomId: roomId.trim(),
        hostClientId: clientId,
        displayName,
      },
      (ack) => {
        if (!ack?.ok) {
          setEvents((prev) => [`! Failed: ${ack?.errorCode || "UNKNOWN"}`, ...prev].slice(0, 8))
          return
        }
        setActiveRoom(ack.roomId)
        setEvents((prev) => [`Room ${ack.roomId} created`, ...prev].slice(0, 8))
      },
    )
  }

  const joinRoom = () => {
    if (!roomId.trim()) return
    socketRef.current?.emit(
      "room:join",
      {
        roomId: roomId.trim(),
        guestClientId: clientId,
        displayName,
      },
      (ack) => {
        if (!ack?.ok) {
          setEvents((prev) => [`! Failed: ${ack?.errorCode || "UNKNOWN"}`, ...prev].slice(0, 8))
          return
        }
        setActiveRoom(ack.roomId)
        setEvents((prev) => [`Joined ${ack.roomId}`, ...prev].slice(0, 8))
      },
    )
  }

  const leaveRoom = () => {
    if (!activeRoom) return
    socketRef.current?.emit("room:leave", { roomId: activeRoom, clientId })
    setActiveRoom("")
    setPeers([])
    setEvents((prev) => ["Left room", ...prev].slice(0, 8))
  }

  return (
    <main className="app">
      <header>
        <h1>WebTorrent P2P Stream App</h1>
        <p>Signaling URL: {signalingUrl}</p>
        <p>
          Status: <strong>{status}</strong>
        </p>
      </header>

      <section className="card">
        <div className="row">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Host"
          />
        </div>
        <div className="row">
          <label htmlFor="roomId">Room ID</label>
          <input
            id="roomId"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="room-123"
          />
        </div>
        <div className="actions">
          <button onClick={createRoom}>Create Room</button>
          <button onClick={joinRoom}>Join Room</button>
          <button onClick={leaveRoom} disabled={!activeRoom}>
            Leave
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Room</h2>
        <p>
          Active room: <strong>{activeRoom || "None"}</strong>
        </p>
        <p>Client ID: {clientId}</p>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Peers ({peers.length})</h2>
          {peers.length === 0 ? (
            <p>No peers connected yet.</p>
          ) : (
            <ul>
              {peers.map((peer) => (
                <li key={peer.clientId}>
                  {peer.displayName} <code>{peer.clientId}</code>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Recent Events</h2>
          {events.length === 0 ? (
            <p>No events yet.</p>
          ) : (
            <ul>
              {events.map((event, idx) => (
                <li key={`${event}-${idx}`}>{event}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
