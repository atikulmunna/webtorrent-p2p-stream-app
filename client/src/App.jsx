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
  const [isHostRole, setIsHostRole] = useState(false)
  const socketRef = useRef(null)
  const webTorrentClientRef = useRef(null)
  const seedTorrentRef = useRef(null)
  const streamTorrentRef = useRef(null)
  const videoRef = useRef(null)
  const applyingRemotePlaybackRef = useRef(false)
  const lastSyncEmitAtRef = useRef(0)

  const addEvent = (text) => {
    setEvents((prev) => [text, ...prev].slice(0, 10))
  }

  const isLikelySupportedMvpVideo = (file) => {
    const lower = file.name.toLowerCase()
    return lower.endsWith(".mp4")
  }

  const clearVideoElement = () => {
    const el = videoRef.current
    if (!el) return
    try {
      el.pause()
      el.removeAttribute("src")
      el.load()
    } catch {
      // best-effort cleanup
    }
  }

  const destroyTorrentSafely = (torrentRef) => {
    const torrent = torrentRef.current
    if (!torrent) return
    try {
      torrent.destroy()
    } catch {
      // ignore cleanup failures
    } finally {
      torrentRef.current = null
    }
  }

  const resetStreamingSession = () => {
    destroyTorrentSafely(streamTorrentRef)
    clearVideoElement()
    setCurrentTorrentName("")
    setStreamStatus("Idle")
  }

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
          addEvent(`! Failed: ${ack?.errorCode || "UNKNOWN"}`)
          return
        }
        setActiveRoom(ack.roomId)
        setIsHostRole(true)
        addEvent(`Room ${ack.roomId} created`)
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
          addEvent(`! Failed: ${ack?.errorCode || "UNKNOWN"}`)
          return
        }
        setActiveRoom(ack.roomId)
        setIsHostRole(false)
        addEvent(`Joined ${ack.roomId}`)
      },
    )
  }

  const leaveRoom = () => {
    if (!activeRoom) return
    socketRef.current?.emit("room:leave", { roomId: activeRoom, clientId })
    setActiveRoom("")
    setPeers([])
    setIsHostRole(false)
    addEvent("Left room")
  }

  const createTorrentFromFile = () => {
    if (!selectedFile || !webTorrentClientRef.current) return

    if (!isLikelySupportedMvpVideo(selectedFile)) {
      setStreamStatus("Error")
      addEvent("! Unsupported file. MVP supports .mp4 (H.264/AAC recommended).")
      return
    }

    destroyTorrentSafely(seedTorrentRef)
    setStreamStatus("Creating torrent")
    webTorrentClientRef.current.seed(
      selectedFile,
      { announce: trackers, private: false },
      (torrent) => {
        seedTorrentRef.current = torrent
        setMagnetUri(torrent.magnetURI)
        setJoinMagnetUri(torrent.magnetURI)
        setCurrentTorrentName(torrent.name || selectedFile.name)
        addEvent(`Seeded: ${torrent.name} (${torrent.numPeers} peers)`)
        setStreamStatus("Seeding")
      },
    )
  }

  const startStreamingFromMagnet = () => {
    if (!joinMagnetUri.trim() || !webTorrentClientRef.current) return
    resetStreamingSession()
    setStreamStatus("Joining swarm")

    const torrent = webTorrentClientRef.current.add(joinMagnetUri.trim(), {
      announce: trackers,
    })
    streamTorrentRef.current = torrent

    torrent.on("ready", () => {
      const videoFile =
        torrent.files.find((file) => file.name.toLowerCase().endsWith(".mp4")) ||
        torrent.files.find((file) => file.name.toLowerCase().endsWith(".webm")) ||
        null

      if (!videoFile) {
        addEvent("! No supported file found. MVP supports .mp4 or .webm stream inputs.")
        setStreamStatus("Error")
        return
      }

      setCurrentTorrentName(videoFile.name)
      addEvent(`Streaming: ${videoFile.name}`)
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
    addEvent("Magnet copied to clipboard")
  }

  const stopStreaming = () => {
    resetStreamingSession()
    addEvent("Stopped active stream session")
  }

  useEffect(() => {
    const s = socketRef.current
    if (!s) return

    const onPlaybackState = (payload) => {
      if (!videoRef.current || isHostRole || payload?.roomId !== activeRoom) return
      applyingRemotePlaybackRef.current = true
      if (typeof payload.mediaTimeSec === "number") {
        videoRef.current.currentTime = payload.mediaTimeSec
      }
      if (payload.state === "play") {
        videoRef.current.play().catch(() => {})
      } else if (payload.state === "pause") {
        videoRef.current.pause()
      }
      addEvent(`Sync state: ${payload.state} @ ${Number(payload.mediaTimeSec || 0).toFixed(1)}s`)
      setTimeout(() => {
        applyingRemotePlaybackRef.current = false
      }, 80)
    }

    const onPlaybackSeek = (payload) => {
      if (!videoRef.current || isHostRole || payload?.roomId !== activeRoom) return
      applyingRemotePlaybackRef.current = true
      if (typeof payload.mediaTimeSec === "number") {
        videoRef.current.currentTime = payload.mediaTimeSec
        addEvent(`Sync seek: ${Number(payload.mediaTimeSec).toFixed(1)}s`)
      }
      setTimeout(() => {
        applyingRemotePlaybackRef.current = false
      }, 80)
    }

    s.on("playback:state", onPlaybackState)
    s.on("playback:seek", onPlaybackSeek)
    return () => {
      s.off("playback:state", onPlaybackState)
      s.off("playback:seek", onPlaybackSeek)
    }
  }, [activeRoom, isHostRole])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const emitPlaybackState = (state) => {
      if (!isHostRole || !activeRoom || applyingRemotePlaybackRef.current) return
      socketRef.current?.emit("playback:state", {
        roomId: activeRoom,
        state,
        mediaTimeSec: el.currentTime,
        sentAtMs: Date.now(),
      })
    }

    const onPlay = () => emitPlaybackState("play")
    const onPause = () => emitPlaybackState("pause")
    const onSeeked = () => {
      if (!isHostRole || !activeRoom || applyingRemotePlaybackRef.current) return
      socketRef.current?.emit("playback:seek", {
        roomId: activeRoom,
        mediaTimeSec: el.currentTime,
        sentAtMs: Date.now(),
      })
    }

    const onTimeUpdate = () => {
      const now = Date.now()
      if (now - lastSyncEmitAtRef.current < 3000) return
      if (!isHostRole || !activeRoom || applyingRemotePlaybackRef.current) return
      lastSyncEmitAtRef.current = now
      socketRef.current?.emit("playback:sync", {
        roomId: activeRoom,
        mediaTimeSec: el.currentTime,
        hostNowMs: now,
      })
    }

    el.addEventListener("play", onPlay)
    el.addEventListener("pause", onPause)
    el.addEventListener("seeked", onSeeked)
    el.addEventListener("timeupdate", onTimeUpdate)

    return () => {
      el.removeEventListener("play", onPlay)
      el.removeEventListener("pause", onPause)
      el.removeEventListener("seeked", onSeeked)
      el.removeEventListener("timeupdate", onTimeUpdate)
    }
  }, [activeRoom, isHostRole])

  useEffect(() => {
    return () => {
      destroyTorrentSafely(seedTorrentRef)
      resetStreamingSession()
    }
  }, [])

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
        <p>
          Role: <strong>{isHostRole ? "Host" : "Guest"}</strong>
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
          <button onClick={stopStreaming}>Stop Streaming</button>
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
