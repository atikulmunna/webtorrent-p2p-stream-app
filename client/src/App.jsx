import { useEffect, useMemo, useRef, useState } from "react"
import { io } from "socket.io-client"
import "./App.css"

function App() {
  const signalingUrl = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000"
  const clientId = useMemo(() => crypto.randomUUID(), [])
  const trackers = useMemo(
    () => [
      "wss://tracker.openwebtorrent.com",
      "wss://tracker.btorrent.xyz",
      "wss://tracker.webtorrent.dev",
    ],
    [],
  )
  const [displayName, setDisplayName] = useState("Host")
  const [roomId, setRoomId] = useState("")
  const [activeRoom, setActiveRoom] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [peers, setPeers] = useState([])
  const [events, setEvents] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [magnetUri, setMagnetUri] = useState("")
  const [joinMagnetUri, setJoinMagnetUri] = useState("")
  const [webTorrentReady, setWebTorrentReady] = useState(false)
  const [streamStatus, setStreamStatus] = useState("Idle")
  const [currentTorrentName, setCurrentTorrentName] = useState("")
  const socketRef = useRef(null)
  const webTorrentClientRef = useRef(null)
  const videoRef = useRef(null)

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

  useEffect(() => {
    if (!window.WebTorrent) {
      setEvents((prev) =>
        ["! WebTorrent browser bundle not found. Check index.html script include.", ...prev].slice(
          0,
          8,
        ),
      )
      return
    }

    const client = new window.WebTorrent()
    webTorrentClientRef.current = client
    setWebTorrentReady(true)

    client.on("error", (err) => {
      setEvents((prev) => [`! WebTorrent error: ${err.message}`, ...prev].slice(0, 8))
      setStreamStatus("Error")
    })

    return () => {
      try {
        client.destroy()
      } catch {
        // no-op cleanup
      } finally {
        webTorrentClientRef.current = null
      }
    }
  }, [])

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

  const createTorrentFromFile = () => {
    if (!selectedFile || !webTorrentClientRef.current) return

    setStreamStatus("Creating torrent")
    webTorrentClientRef.current.seed(
      selectedFile,
      { announce: trackers, private: false },
      (torrent) => {
        setMagnetUri(torrent.magnetURI)
        setJoinMagnetUri(torrent.magnetURI)
        setCurrentTorrentName(torrent.name || selectedFile.name)
        setEvents((prev) => [`Seeded: ${torrent.name} (${torrent.numPeers} peers)`, ...prev].slice(0, 8))
        setStreamStatus("Seeding")
      },
    )
  }

  const startStreamingFromMagnet = () => {
    if (!joinMagnetUri.trim() || !webTorrentClientRef.current) return
    setStreamStatus("Joining swarm")

    const torrent = webTorrentClientRef.current.add(joinMagnetUri.trim(), {
      announce: trackers,
    })

    torrent.on("ready", () => {
      const videoFile =
        torrent.files.find((file) => file.name.toLowerCase().endsWith(".mp4")) ||
        torrent.files.find((file) => file.name.toLowerCase().endsWith(".webm")) ||
        torrent.files.find((file) => file.name.toLowerCase().endsWith(".mkv")) ||
        torrent.files[0]

      if (!videoFile) {
        setEvents((prev) => ["! No playable file found in torrent.", ...prev].slice(0, 8))
        setStreamStatus("Error")
        return
      }

      setCurrentTorrentName(videoFile.name)
      setEvents((prev) => [`Streaming: ${videoFile.name}`, ...prev].slice(0, 8))
      setStreamStatus("Streaming")
      videoFile.renderTo(videoRef.current)
    })

    torrent.on("download", () => {
      if (torrent.progress > 0) {
        setStreamStatus(`Streaming (${Math.round(torrent.progress * 100)}%)`)
      }
    })
  }

  const copyMagnet = async () => {
    if (!magnetUri) return
    await navigator.clipboard.writeText(magnetUri)
    setEvents((prev) => ["Magnet copied to clipboard", ...prev].slice(0, 8))
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
          <h2>M1: Create Torrent (Host)</h2>
          <p>WebTorrent: {webTorrentReady ? "Ready" : "Not Ready"}</p>
          <div className="row">
            <label htmlFor="fileInput">Video file</label>
            <input
              id="fileInput"
              type="file"
              accept="video/mp4,video/webm,video/*"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="actions">
            <button onClick={createTorrentFromFile} disabled={!selectedFile || !webTorrentReady}>
              Create Magnet
            </button>
            <button onClick={copyMagnet} disabled={!magnetUri}>
              Copy Magnet
            </button>
          </div>
          {magnetUri ? (
            <textarea readOnly value={magnetUri} rows={4} />
          ) : (
            <p>No magnet generated yet.</p>
          )}
        </div>

        <div className="card">
          <h2>M3: Join and Stream (Guest)</h2>
          <p>Stream status: {streamStatus}</p>
          <div className="row">
            <label htmlFor="magnetInput">Magnet URI</label>
            <textarea
              id="magnetInput"
              value={joinMagnetUri}
              onChange={(e) => setJoinMagnetUri(e.target.value)}
              rows={4}
              placeholder="Paste magnet URI"
            />
          </div>
          <button onClick={startStreamingFromMagnet} disabled={!joinMagnetUri || !webTorrentReady}>
            Start Streaming
          </button>
          <p>Current media: {currentTorrentName || "None"}</p>
        </div>
      </section>

      <section className="card">
        <h2>Video Player</h2>
        <video ref={videoRef} controls playsInline className="video" />
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
