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
  const [syncDriftSec, setSyncDriftSec] = useState(0)
  const [downloadKbps, setDownloadKbps] = useState(0)
  const [torrentProgressPct, setTorrentProgressPct] = useState(0)
  const [validationReport, setValidationReport] = useState(null)
  const socketRef = useRef(null)
  const webTorrentClientRef = useRef(null)
  const seedTorrentRef = useRef(null)
  const streamTorrentRef = useRef(null)
  const videoRef = useRef(null)
  const applyingRemotePlaybackRef = useRef(false)
  const lastSyncEmitAtRef = useRef(0)
  const playbackRateResetTimerRef = useRef(null)
  const metricsRef = useRef({
    streamStartRequestedAt: 0,
    firstFrameAt: 0,
    waitingSince: 0,
    rebufferCount: 0,
    rebufferTotalMs: 0,
    driftSamples: [],
  })

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
    if (playbackRateResetTimerRef.current) {
      clearTimeout(playbackRateResetTimerRef.current)
      playbackRateResetTimerRef.current = null
    }
    clearVideoElement()
    setCurrentTorrentName("")
    setStreamStatus("Idle")
    setSyncDriftSec(0)
    setDownloadKbps(0)
    setTorrentProgressPct(0)
  }

  const resetMetrics = () => {
    metricsRef.current = {
      streamStartRequestedAt: 0,
      firstFrameAt: 0,
      waitingSince: 0,
      rebufferCount: 0,
      rebufferTotalMs: 0,
      driftSamples: [],
    }
    setValidationReport(null)
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
    s.on("room:error", (payload) => {
      setEvents((prev) => [`! ${payload.errorCode} (${payload.context})`, ...prev].slice(0, 8))
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
    resetMetrics()
    metricsRef.current.streamStartRequestedAt = Date.now()
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

    let lastTickAt = Date.now()
    torrent.on("download", (bytes) => {
      const now = Date.now()
      const dtSec = Math.max((now - lastTickAt) / 1000, 0.001)
      lastTickAt = now
      setDownloadKbps(Math.round((bytes * 8) / 1000 / dtSec))
      if (torrent.progress > 0) {
        const pct = Math.round(torrent.progress * 100)
        setTorrentProgressPct(pct)
        setStreamStatus(`Streaming (${pct}%)`)
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

    const onPlaybackSync = (payload) => {
      if (!videoRef.current || isHostRole || payload?.roomId !== activeRoom) return
      if (typeof payload.mediaTimeSec !== "number") return

      const nowMs = Date.now()
      const networkOffsetSec =
        typeof payload.hostNowMs === "number" ? Math.max(0, (nowMs - payload.hostNowMs) / 1000) : 0
      const targetTimeSec = payload.mediaTimeSec + networkOffsetSec
      const localTimeSec = videoRef.current.currentTime || 0
      const driftSec = targetTimeSec - localTimeSec
      setSyncDriftSec(driftSec)
      metricsRef.current.driftSamples.push(driftSec)
      if (metricsRef.current.driftSamples.length > 600) {
        metricsRef.current.driftSamples.shift()
      }

      const absDrift = Math.abs(driftSec)
      if (absDrift > 1.0) {
        applyingRemotePlaybackRef.current = true
        videoRef.current.currentTime = targetTimeSec
        videoRef.current.playbackRate = 1.0
        addEvent(`Hard sync: ${driftSec.toFixed(2)}s`)
        setTimeout(() => {
          applyingRemotePlaybackRef.current = false
        }, 80)
        return
      }

      if (absDrift > 0.2) {
        const tunedRate = Math.min(1.05, Math.max(0.95, 1 + driftSec * 0.08))
        videoRef.current.playbackRate = tunedRate
        if (playbackRateResetTimerRef.current) {
          clearTimeout(playbackRateResetTimerRef.current)
        }
        playbackRateResetTimerRef.current = setTimeout(() => {
          if (videoRef.current) videoRef.current.playbackRate = 1.0
          playbackRateResetTimerRef.current = null
        }, 1200)
        return
      }

      videoRef.current.playbackRate = 1.0
    }

    s.on("playback:state", onPlaybackState)
    s.on("playback:seek", onPlaybackSeek)
    s.on("playback:sync", onPlaybackSync)
    return () => {
      s.off("playback:state", onPlaybackState)
      s.off("playback:seek", onPlaybackSeek)
      s.off("playback:sync", onPlaybackSync)
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

    const onPlaying = () => {
      const now = Date.now()
      if (!metricsRef.current.firstFrameAt && metricsRef.current.streamStartRequestedAt) {
        metricsRef.current.firstFrameAt = now
      }
      if (metricsRef.current.waitingSince) {
        metricsRef.current.rebufferTotalMs += now - metricsRef.current.waitingSince
        metricsRef.current.waitingSince = 0
      }
    }

    const onWaiting = () => {
      if (el.currentTime <= 0.2) return
      if (!metricsRef.current.waitingSince) {
        metricsRef.current.waitingSince = Date.now()
        metricsRef.current.rebufferCount += 1
      }
    }

    el.addEventListener("play", onPlay)
    el.addEventListener("playing", onPlaying)
    el.addEventListener("waiting", onWaiting)
    el.addEventListener("pause", onPause)
    el.addEventListener("seeked", onSeeked)
    el.addEventListener("timeupdate", onTimeUpdate)

    return () => {
      el.removeEventListener("play", onPlay)
      el.removeEventListener("playing", onPlaying)
      el.removeEventListener("waiting", onWaiting)
      el.removeEventListener("pause", onPause)
      el.removeEventListener("seeked", onSeeked)
      el.removeEventListener("timeupdate", onTimeUpdate)
    }
  }, [activeRoom, isHostRole])

  const buildValidationReport = () => {
    const now = Date.now()
    const el = videoRef.current
    const ttffMs =
      metricsRef.current.streamStartRequestedAt && metricsRef.current.firstFrameAt
        ? metricsRef.current.firstFrameAt - metricsRef.current.streamStartRequestedAt
        : null
    const sessionPlaybackSec = el ? Number(el.currentTime.toFixed(2)) : 0
    const rebufferRatioPct =
      sessionPlaybackSec > 0
        ? Number(((metricsRef.current.rebufferTotalMs / 1000 / sessionPlaybackSec) * 100).toFixed(2))
        : 0
    const driftAbs = metricsRef.current.driftSamples.map((x) => Math.abs(x)).sort((a, b) => a - b)
    const driftP95 = driftAbs.length ? driftAbs[Math.floor(driftAbs.length * 0.95)] : 0

    const report = {
      generatedAtIso: new Date(now).toISOString(),
      roomId: activeRoom || null,
      role: isHostRole ? "host" : "guest",
      mediaName: currentTorrentName || null,
      metrics: {
        ttffMs,
        sessionPlaybackSec,
        rebufferCount: metricsRef.current.rebufferCount,
        rebufferTotalMs: metricsRef.current.rebufferTotalMs,
        rebufferRatioPct,
        driftP95Sec: Number(driftP95.toFixed(3)),
        latestDriftSec: Number(syncDriftSec.toFixed(3)),
        torrentProgressPct,
        downloadKbps,
        peerCount: peers.length,
      },
    }

    setValidationReport(report)
    addEvent("Validation report generated")
    return report
  }

  const exportValidationReport = () => {
    const report = validationReport || buildValidationReport()
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `validation-report-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    return () => {
      destroyTorrentSafely(seedTorrentRef)
      resetStreamingSession()
      if (playbackRateResetTimerRef.current) {
        clearTimeout(playbackRateResetTimerRef.current)
        playbackRateResetTimerRef.current = null
      }
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
        <p>
          Drift vs host:{" "}
          <strong className={Math.abs(syncDriftSec) > 1 ? "drift-bad" : "drift-ok"}>
            {syncDriftSec.toFixed(2)}s
          </strong>
        </p>
        <p>
          Download: <strong>{downloadKbps} kbps</strong> | Torrent progress:{" "}
          <strong>{torrentProgressPct}%</strong>
        </p>
        <video ref={videoRef} controls playsInline className="video" />
        <div className="actions">
          <button onClick={buildValidationReport}>Generate Validation Report</button>
          <button onClick={exportValidationReport}>Export Report JSON</button>
        </div>
        {validationReport ? (
          <pre className="report">{JSON.stringify(validationReport, null, 2)}</pre>
        ) : null}
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
