import { useEffect, useMemo, useRef, useState } from "react"
import { io } from "socket.io-client"
import {
  computeTrackerFailover,
  extractTrackerUrl,
  getCompatibilityHint,
  getNormalizeCommand,
  getNormalizeCommandHint,
  isLikelySupportedMvpVideo,
  selectPlayableTorrentFile,
} from "./lib/stream-policy"
import { prepareSubtitleTrack } from "./lib/subtitles"
import "./App.css"

function App() {
  const signalingUrl = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000"
  const trackerUrls = useMemo(
    () =>
      (
        import.meta.env.VITE_TRACKER_URLS ||
        "ws://localhost:8000/announce,wss://tracker.openwebtorrent.com,wss://tracker.webtorrent.dev"
      )
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    [],
  )
  const forceTurnOnly = import.meta.env.VITE_FORCE_TURN === "1"
  const stunUrls = useMemo(
    () =>
      (import.meta.env.VITE_STUN_URLS || "stun:stun.l.google.com:19302")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    [],
  )
  const turnUrls = useMemo(
    () =>
      (import.meta.env.VITE_TURN_URLS || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    [],
  )
  const turnUsername = import.meta.env.VITE_TURN_USERNAME || ""
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || ""
  const streamStrategy = import.meta.env.VITE_STREAM_STRATEGY || "sequential"
  const trackerFailThreshold = Number(import.meta.env.VITE_TRACKER_FAIL_THRESHOLD || 2)
  const seedPieceLength = 256 * 1024
  const clientId = useMemo(() => crypto.randomUUID(), [])
  const [displayName, setDisplayName] = useState("Host")
  const [roomId, setRoomId] = useState("")
  const [activeRoom, setActiveRoom] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [peers, setPeers] = useState([])
  const [events, setEvents] = useState([])
  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [magnetUri, setMagnetUri] = useState("")
  const [magnetCopied, setMagnetCopied] = useState(false)
  const [joinMagnetUri, setJoinMagnetUri] = useState("")
  const [webTorrentReady, setWebTorrentReady] = useState(false)
  const [streamStatus, setStreamStatus] = useState("Idle")
  const [currentTorrentName, setCurrentTorrentName] = useState("")
  const [isHostRole, setIsHostRole] = useState(false)
  const [syncDriftSec, setSyncDriftSec] = useState(0)
  const [downloadKbps, setDownloadKbps] = useState(0)
  const [torrentProgressPct, setTorrentProgressPct] = useState(0)
  const [subtitleLabel, setSubtitleLabel] = useState("")
  const [subtitleError, setSubtitleError] = useState("")
  const [activeTrackerUrls, setActiveTrackerUrls] = useState(trackerUrls)
  const [validationReport, setValidationReport] = useState(null)
  const [serverMetrics, setServerMetrics] = useState(null)
  const socketRef = useRef(null)
  const webTorrentClientRef = useRef(null)
  const seedTorrentRef = useRef(null)
  const streamTorrentRef = useRef(null)
  const currentVideoFileRef = useRef(null)
  const activeBlobUrlRef = useRef(null)
  const activeSubtitleUrlRef = useRef(null)
  const subtitleTrackRef = useRef(null)
  const videoRef = useRef(null)
  const applyingRemotePlaybackRef = useRef(false)
  const lastSyncEmitAtRef = useRef(0)
  const playbackRateResetTimerRef = useRef(null)
  const playbackStartedRef = useRef(false)
  const stallWatchTimerRef = useRef(null)
  const reRenderAttemptsRef = useRef(0)
  const playRetryTimerRef = useRef(null)
  const metadataTimeoutRef = useRef(null)
  const streamSessionIdRef = useRef(0)
  const streamFailoverAttemptsRef = useRef(0)
  const trackerFailureRef = useRef(new Map())
  const allowAutoResumeStreamRef = useRef(false)
  const reconnectPendingRef = useRef(false)
  const pendingPlaybackSnapshotRef = useRef(null)
  const activeRoomRef = useRef("")
  const isHostRoleRef = useRef(false)
  const joinMagnetUriRef = useRef("")
  const displayNameRef = useRef("Host")
  const rtcConfig = useMemo(() => {
    const iceServers = []

    stunUrls.forEach((url) => {
      iceServers.push({ urls: url })
    })
    turnUrls.forEach((url) => {
      const turnServer = { urls: url }
      if (turnUsername) turnServer.username = turnUsername
      if (turnCredential) turnServer.credential = turnCredential
      iceServers.push(turnServer)
    })

    return {
      iceServers,
      iceTransportPolicy: forceTurnOnly ? "relay" : "all",
    }
  }, [forceTurnOnly, stunUrls, turnUrls, turnUsername, turnCredential])
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

  const applyPlaybackSnapshot = (snapshot) => {
    if (!snapshot || !videoRef.current || isHostRole) return false
    const el = videoRef.current
    if (!Number.isFinite(snapshot.mediaTimeSec)) return false
    const nowMs = Date.now()
    const networkOffsetSec =
      typeof snapshot.hostNowMs === "number" ? Math.max(0, (nowMs - snapshot.hostNowMs) / 1000) : 0
    applyingRemotePlaybackRef.current = true
    el.currentTime = snapshot.mediaTimeSec + networkOffsetSec
    if (snapshot.state === "pause") {
      el.pause()
    } else {
      el.play().catch(() => {})
    }
    setTimeout(() => {
      applyingRemotePlaybackRef.current = false
    }, 80)
    return true
  }

  const getAnnounceTrackers = (overrideTrackers = null) => {
    if (Array.isArray(overrideTrackers) && overrideTrackers.length > 0) return overrideTrackers
    if (activeTrackerUrls.length > 0) return activeTrackerUrls
    return trackerUrls
  }

  const markTrackerFailure = (url) => {
    const result = computeTrackerFailover({
      trackerUrls,
      activeTrackerUrls: getAnnounceTrackers(),
      failureMap: trackerFailureRef.current,
      failedUrl: url,
      threshold: trackerFailThreshold,
    })
    if (!result) return null
    trackerFailureRef.current = result.nextFailureMap
    if (!result.quarantined || !result.nextTrackers) return null

    setActiveTrackerUrls(result.nextTrackers)
    addEvent(`Tracker quarantined after repeated errors: ${url}`)
    return result.nextTrackers
  }

  const clearVideoElement = () => {
    const el = videoRef.current
    if (!el) return
    try {
      el.pause()
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current)
        activeBlobUrlRef.current = null
      }
      el.removeAttribute("src")
      el.load()
    } catch {
      // best-effort cleanup
    }
  }

  const clearSubtitleTrack = () => {
    if (activeSubtitleUrlRef.current) {
      URL.revokeObjectURL(activeSubtitleUrlRef.current)
      activeSubtitleUrlRef.current = null
    }
    const trackEl = subtitleTrackRef.current
    if (trackEl) {
      trackEl.removeAttribute("src")
      trackEl.label = ""
      trackEl.default = false
      trackEl.srclang = "en"
    }
    const textTracks = videoRef.current?.textTracks
    if (textTracks) {
      for (let i = 0; i < textTracks.length; i += 1) {
        textTracks[i].mode = "disabled"
      }
    }
    setSubtitleLabel("")
    setSubtitleError("")
  }

  const applySubtitleFile = async (file) => {
    if (!file) return
    try {
      const { vttText, label } = await prepareSubtitleTrack(file)
      clearSubtitleTrack()

      const subtitleBlob = new Blob([vttText], { type: "text/vtt" })
      const subtitleUrl = URL.createObjectURL(subtitleBlob)
      activeSubtitleUrlRef.current = subtitleUrl

      const trackEl = subtitleTrackRef.current
      if (!trackEl) {
        throw new Error("Subtitle track element unavailable")
      }
      trackEl.kind = "subtitles"
      trackEl.label = label
      trackEl.srclang = "en"
      trackEl.default = true
      trackEl.src = subtitleUrl
      trackEl.track.mode = "showing"

      setSubtitleLabel(label)
      setSubtitleError("")
      addEvent(`Subtitle loaded: ${label}`)
    } catch (err) {
      const message = err?.message || "Failed to load subtitle file"
      setSubtitleError(message)
      addEvent(`! Subtitle error: ${message}`)
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
    streamSessionIdRef.current += 1
    destroyTorrentSafely(streamTorrentRef)
    currentVideoFileRef.current = null
    playbackStartedRef.current = false
    reRenderAttemptsRef.current = 0
    if (stallWatchTimerRef.current) {
      clearTimeout(stallWatchTimerRef.current)
      stallWatchTimerRef.current = null
    }
    if (metadataTimeoutRef.current) {
      clearTimeout(metadataTimeoutRef.current)
      metadataTimeoutRef.current = null
    }
    if (playRetryTimerRef.current) {
      clearInterval(playRetryTimerRef.current)
      playRetryTimerRef.current = null
    }
    if (playbackRateResetTimerRef.current) {
      clearTimeout(playbackRateResetTimerRef.current)
      playbackRateResetTimerRef.current = null
    }
    clearVideoElement()
    clearSubtitleTrack()
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

  const renderVideoFile = (videoFile, forceBlobFallback = false) => {
    if (!videoRef.current || !videoFile) return
    currentVideoFileRef.current = videoFile
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current)
      activeBlobUrlRef.current = null
    }
    try {
      if (forceBlobFallback) {
        videoFile.getBlobURL((err, url) => {
          if (err || !url) {
            setStreamStatus("Error")
            addEvent(`! Blob fallback failed: ${err?.message || "unknown error"}`)
            return
          }
          activeBlobUrlRef.current = url
          videoRef.current.src = url
          videoRef.current.preload = "auto"
          videoRef.current.load()
          attemptAutoPlay()
          addEvent("Using Blob URL fallback renderer")
        })
        return
      }

      videoRef.current.preload = "auto"
      videoFile.renderTo(videoRef.current)
      attemptAutoPlay()
    } catch (err) {
      setStreamStatus("Error")
      addEvent(`! Render error: ${err.message}`)
    }
  }

  const attemptAutoPlay = () => {
    const el = videoRef.current
    if (!el) return
    el.play().catch(() => {})
  }

  const startPlayRetryLoop = () => {
    if (playRetryTimerRef.current) {
      clearInterval(playRetryTimerRef.current)
      playRetryTimerRef.current = null
    }
    let attempts = 0
    playRetryTimerRef.current = setInterval(() => {
      if (playbackStartedRef.current || !videoRef.current) {
        clearInterval(playRetryTimerRef.current)
        playRetryTimerRef.current = null
        return
      }
      attempts += 1
      attemptAutoPlay()
      if (attempts >= 8) {
        clearInterval(playRetryTimerRef.current)
        playRetryTimerRef.current = null
      }
    }, 300)
  }

  const armPlaybackStallWatch = () => {
    if (stallWatchTimerRef.current) {
      clearTimeout(stallWatchTimerRef.current)
    }
    stallWatchTimerRef.current = setTimeout(() => {
      const el = videoRef.current
      if (!el || playbackStartedRef.current) return
      const torrent = streamTorrentRef.current
      if (!torrent || torrent.progress < 0.05) {
        armPlaybackStallWatch()
        return
      }
      if (!currentVideoFileRef.current) return

      if (reRenderAttemptsRef.current >= 1) {
        addEvent("! Playback stalled after 100%. Likely codec/profile incompatibility.")
        addEvent(`! ${getNormalizeCommandHint(currentVideoFileRef.current?.name || "input.mp4")}`)
        setStreamStatus("Error")
        return
      }

      reRenderAttemptsRef.current += 1
      addEvent("Playback stalled after metadata/download; trying Blob URL fallback")
      renderVideoFile(currentVideoFileRef.current, true)
      armPlaybackStallWatch()
    }, 3500)
  }

  useEffect(() => {
    activeRoomRef.current = activeRoom
    isHostRoleRef.current = isHostRole
    joinMagnetUriRef.current = joinMagnetUri
    displayNameRef.current = displayName
  }, [activeRoom, isHostRole, joinMagnetUri, displayName])

  useEffect(() => {
    const s = io(signalingUrl, { autoConnect: true })
    s.on("connect", () => {
      setStatus("Connected")
      if (!reconnectPendingRef.current || !activeRoomRef.current) return
      s.emit(
        "room:resume",
        {
          roomId: activeRoomRef.current,
          clientId,
          displayName: displayNameRef.current,
          role: isHostRoleRef.current ? "host" : "guest",
        },
        (ack) => {
          if (!ack?.ok) {
            addEvent(`! Resume failed: ${ack?.errorCode || "UNKNOWN"}`)
            return
          }
          reconnectPendingRef.current = false
          setActiveRoom(ack.roomId)
          addEvent(`Session resumed for room ${ack.roomId}`)
          if (!isHostRoleRef.current && ack.playbackSnapshot) {
            pendingPlaybackSnapshotRef.current = ack.playbackSnapshot
          }
          if (
            !isHostRoleRef.current &&
            allowAutoResumeStreamRef.current &&
            joinMagnetUriRef.current.trim() &&
            !streamTorrentRef.current
          ) {
            startStreamingFromMagnetWithFailover(null, true)
          }
        },
      )
    })
    s.on("disconnect", () => {
      setStatus("Disconnected")
      if (activeRoomRef.current) {
        reconnectPendingRef.current = true
        addEvent("Signaling disconnected; attempting room resume on reconnect")
      }
    })
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
    s.on("chat:message", (payload) => {
      setChatMessages((prev) =>
        [
          ...prev,
          {
            messageId: payload.messageId,
            senderId: payload.senderId || "unknown",
            text: payload.text || "",
            sentAtMs: payload.sentAtMs || Date.now(),
          },
        ].slice(-100),
      )
    })
    socketRef.current = s

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [signalingUrl, clientId])

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

    const client = new window.WebTorrent({
      tracker: {
        rtcConfig,
      },
    })
    webTorrentClientRef.current = client
    setWebTorrentReady(true)
    addEvent(
      `RTC mode: ${forceTurnOnly ? "FORCED TURN relay" : "Auto direct + TURN fallback"} | STUN ${stunUrls.length} | TURN ${turnUrls.length}`,
    )
    addEvent(`Tracker URLs loaded: ${trackerUrls.length}`)

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
  }, [forceTurnOnly, rtcConfig, stunUrls.length, turnUrls.length, trackerUrls.length])

  useEffect(() => {
    addEvent(`Active trackers: ${activeTrackerUrls.length}`)
  }, [activeTrackerUrls.length])

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
        reconnectPendingRef.current = false
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
        reconnectPendingRef.current = false
        if (ack.playbackSnapshot) {
          pendingPlaybackSnapshotRef.current = ack.playbackSnapshot
        }
        addEvent(`Joined ${ack.roomId}`)
      },
    )
  }

  const leaveRoom = () => {
    if (!activeRoom) return
    socketRef.current?.emit("room:leave", { roomId: activeRoom, clientId })
    setActiveRoom("")
    setPeers([])
    setChatMessages([])
    setIsHostRole(false)
    allowAutoResumeStreamRef.current = false
    reconnectPendingRef.current = false
    pendingPlaybackSnapshotRef.current = null
    addEvent("Left room")
  }

  const sendChatMessage = () => {
    const text = chatInput.trim()
    if (!text || !activeRoom) return
    socketRef.current?.emit("chat:send", {
      roomId: activeRoom,
      messageId: crypto.randomUUID(),
      senderId: clientId,
      text,
      sentAtMs: Date.now(),
    })
    setChatInput("")
  }

  const createTorrentFromFile = () => {
    if (!selectedFile || !webTorrentClientRef.current) return

    if (!isLikelySupportedMvpVideo(selectedFile)) {
      setStreamStatus("Error")
      addEvent("! Unsupported file extension/type. Use MP4 with H.264/AAC for reliable playback.")
      addEvent(`! ${getNormalizeCommandHint(selectedFile.name)}`)
      return
    }
    addEvent(getCompatibilityHint(selectedFile))

    const announceTrackers = getAnnounceTrackers()
    destroyTorrentSafely(seedTorrentRef)
    setStreamStatus("Creating torrent")
    webTorrentClientRef.current.seed(
      selectedFile,
      { announce: announceTrackers, private: false, pieceLength: seedPieceLength },
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
    allowAutoResumeStreamRef.current = true
    startStreamingFromMagnetWithFailover(null, false)
  }

  const startStreamingFromMagnetWithFailover = (trackerOverride = null, preserveMetrics = false) => {
    if (!joinMagnetUri.trim() || !webTorrentClientRef.current) return
    resetStreamingSession()
    const sessionId = streamSessionIdRef.current
    if (!preserveMetrics) {
      streamFailoverAttemptsRef.current = 0
      resetMetrics()
      metricsRef.current.streamStartRequestedAt = Date.now()
    }
    const announceTrackers = getAnnounceTrackers(trackerOverride)
    let failoverTriggered = false

    setStreamStatus("Joining swarm")
    addEvent("Torrent join requested")
    addEvent(`Stream strategy: ${streamStrategy}`)
    addEvent(`Attempt ${streamFailoverAttemptsRef.current + 1}: ${announceTrackers.length} tracker(s)`)

    const torrent = webTorrentClientRef.current.add(joinMagnetUri.trim(), {
      announce: announceTrackers,
      strategy: streamStrategy,
    })
    streamTorrentRef.current = torrent

    addEvent(`InfoHash: ${torrent.infoHash || "pending"}`)

    metadataTimeoutRef.current = setTimeout(() => {
      if (sessionId !== streamSessionIdRef.current) return
      if (!torrent.metadata && !playbackStartedRef.current) {
        if (!failoverTriggered && announceTrackers.length > 1 && streamFailoverAttemptsRef.current < 2) {
          failoverTriggered = true
          streamFailoverAttemptsRef.current += 1
          const rotated = [...announceTrackers.slice(1), announceTrackers[0]]
          addEvent("! Metadata timeout; retrying with backup trackers")
          startStreamingFromMagnetWithFailover(rotated, true)
          return
        }
        setStreamStatus("Error")
        addEvent("! Metadata timeout after 25s (tracker/peer discovery issue)")
      }
    }, 25_000)

    torrent.on("warning", (err) => {
      if (sessionId !== streamSessionIdRef.current) return
      addEvent(`! Torrent warning: ${err.message}`)
      if (!failoverTriggered && !torrent.metadata && streamFailoverAttemptsRef.current < 2) {
        const failedTracker = extractTrackerUrl(err.message)
        const fallbackTrackers = markTrackerFailure(failedTracker)
        if (fallbackTrackers && fallbackTrackers.length > 0) {
          failoverTriggered = true
          streamFailoverAttemptsRef.current += 1
          addEvent("Retrying swarm with healthy tracker set")
          startStreamingFromMagnetWithFailover(fallbackTrackers, true)
        }
      }
    })

    torrent.on("error", (err) => {
      if (sessionId !== streamSessionIdRef.current) return
      addEvent(`! Torrent error: ${err.message}`)
      if (!failoverTriggered && !torrent.metadata && streamFailoverAttemptsRef.current < 2) {
        const failedTracker = extractTrackerUrl(err.message)
        const fallbackTrackers = markTrackerFailure(failedTracker)
        if (fallbackTrackers && fallbackTrackers.length > 0) {
          failoverTriggered = true
          streamFailoverAttemptsRef.current += 1
          addEvent("Retrying swarm with healthy tracker set")
          startStreamingFromMagnetWithFailover(fallbackTrackers, true)
          return
        }
      }
      setStreamStatus("Error")
    })

    torrent.on("noPeers", (announceType) => {
      if (sessionId !== streamSessionIdRef.current) return
      addEvent(`! No peers from ${announceType || "announce"} yet`)
    })

    torrent.on("wire", () => {
      if (sessionId !== streamSessionIdRef.current) return
      addEvent(`Wire connected. Swarm peers: ${torrent.numPeers}`)
    })

    torrent.on("ready", () => {
      if (sessionId !== streamSessionIdRef.current) return
      if (metadataTimeoutRef.current) {
        clearTimeout(metadataTimeoutRef.current)
        metadataTimeoutRef.current = null
      }
      if (typeof torrent.select === "function" && torrent.pieces?.length) {
        const end = Math.min(1024, torrent.pieces.length - 1)
        torrent.select(0, end, 10)
      }
      if (typeof torrent.critical === "function" && torrent.pieces?.length) {
        const end = Math.min(64, torrent.pieces.length - 1)
        torrent.critical(0, end)
      }
      const selection = selectPlayableTorrentFile(torrent.files)
      const videoFile = selection.file
      if (!videoFile) {
        addEvent(`! COMPATIBILITY_ERROR: ${selection.errorCode || "UNSUPPORTED_MEDIA"}`)
        addEvent(`! ${selection.errorMessage || "Unsupported media payload."}`)
        addEvent(`! ${getNormalizeCommandHint("input.mp4")}`)
        setStreamStatus("Error")
        return
      }

      setCurrentTorrentName(videoFile.name)
      addEvent(`Streaming: ${videoFile.name}`)
      setStreamStatus("Streaming")
      if (typeof videoFile.select === "function") {
        videoFile.select()
      }
      renderVideoFile(videoFile)
      startPlayRetryLoop()
      armPlaybackStallWatch()
    })

    torrent.on("metadata", () => {
      if (sessionId !== streamSessionIdRef.current) return
      if (metadataTimeoutRef.current) {
        clearTimeout(metadataTimeoutRef.current)
        metadataTimeoutRef.current = null
      }
      addEvent(`Metadata received. Files: ${torrent.files.length}`)
      armPlaybackStallWatch()
    })

    let lastTickAt = Date.now()
    torrent.on("download", (bytes) => {
      if (sessionId !== streamSessionIdRef.current) return
      const now = Date.now()
      const dtSec = Math.max((now - lastTickAt) / 1000, 0.001)
      lastTickAt = now
      setDownloadKbps(Math.round((bytes * 8) / 1000 / dtSec))
      if (torrent.progress > 0) {
        const pct = Math.round(torrent.progress * 100)
        setTorrentProgressPct(pct)
        setStreamStatus(`Streaming (${pct}%)`)
        if (pct >= 5 && !playbackStartedRef.current) {
          armPlaybackStallWatch()
        }
      }
    })
  }

  const copyMagnet = async () => {
    if (!magnetUri) return
    try {
      await navigator.clipboard.writeText(magnetUri)
      setMagnetCopied(true)
      addEvent("Magnet copied to clipboard")
      setTimeout(() => setMagnetCopied(false), 1400)
    } catch {
      addEvent("! Failed to copy magnet")
    }
  }

  const copyNormalizeCommand = async () => {
    if (!selectedFile) return
    try {
      const cmd = getNormalizeCommand(selectedFile.name)
      await navigator.clipboard.writeText(cmd)
      addEvent("Normalize command copied to clipboard")
    } catch {
      addEvent("! Failed to copy normalize command")
    }
  }

  const stopStreaming = () => {
    allowAutoResumeStreamRef.current = false
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
      playbackStartedRef.current = true
      if (stallWatchTimerRef.current) {
        clearTimeout(stallWatchTimerRef.current)
        stallWatchTimerRef.current = null
      }
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

    const onLoadedMeta = () => {
      attemptAutoPlay()
      startPlayRetryLoop()
      if (pendingPlaybackSnapshotRef.current) {
        if (applyPlaybackSnapshot(pendingPlaybackSnapshotRef.current)) {
          pendingPlaybackSnapshotRef.current = null
        }
      }
    }

    const onCanPlay = () => {
      attemptAutoPlay()
      if (pendingPlaybackSnapshotRef.current) {
        if (applyPlaybackSnapshot(pendingPlaybackSnapshotRef.current)) {
          pendingPlaybackSnapshotRef.current = null
        }
      }
    }

    el.addEventListener("play", onPlay)
    el.addEventListener("playing", onPlaying)
    el.addEventListener("loadedmetadata", onLoadedMeta)
    el.addEventListener("canplay", onCanPlay)
    el.addEventListener("waiting", onWaiting)
    el.addEventListener("pause", onPause)
    el.addEventListener("seeked", onSeeked)
    el.addEventListener("timeupdate", onTimeUpdate)

    return () => {
      el.removeEventListener("play", onPlay)
      el.removeEventListener("playing", onPlaying)
      el.removeEventListener("loadedmetadata", onLoadedMeta)
      el.removeEventListener("canplay", onCanPlay)
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
        rtcMode: forceTurnOnly ? "relay-only" : "auto",
        rtcStunServers: stunUrls.length,
        rtcTurnServers: turnUrls.length,
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

  useEffect(() => {
    const pollMetrics = async () => {
      try {
        const response = await fetch(`${signalingUrl}/metrics`)
        if (!response.ok) return
        const data = await response.json()
        setServerMetrics(data)
      } catch {
        // ignore transient poll errors
      }
    }

    pollMetrics()
    const timer = setInterval(pollMetrics, 5000)
    return () => clearInterval(timer)
  }, [signalingUrl])

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
              accept="video/mp4,.mp4"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            {selectedFile ? <p>{getCompatibilityHint(selectedFile)}</p> : null}
          </div>
          <div className="actions">
            <button onClick={createTorrentFromFile} disabled={!selectedFile || !webTorrentReady}>
              Create Magnet
            </button>
            <button onClick={copyNormalizeCommand} disabled={!selectedFile}>
              Copy Normalize Command
            </button>
            <button onClick={copyMagnet} disabled={!magnetUri}>
              {magnetCopied ? "Copied!" : "Copy Magnet"}
            </button>
          </div>
          {magnetUri ? null : <p>No magnet generated yet.</p>}
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
          RTC mode: <strong>{forceTurnOnly ? "FORCED TURN relay" : "Auto direct + TURN fallback"}</strong>
        </p>
        <p>
          Download: <strong>{downloadKbps} kbps</strong> | Torrent progress:{" "}
          <strong>{torrentProgressPct}%</strong>
        </p>
        <video ref={videoRef} controls playsInline className="video">
          <track ref={subtitleTrackRef} kind="subtitles" srcLang="en" />
        </video>
        <div className="row">
          <label htmlFor="subtitleInput">Subtitles (M10: .vtt/.srt)</label>
          <input
            id="subtitleInput"
            type="file"
            accept=".vtt,.srt,text/vtt,application/x-subrip"
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (!file) return
              void applySubtitleFile(file)
            }}
          />
          {subtitleLabel ? <p>Active subtitle: {subtitleLabel}</p> : <p>No subtitle loaded.</p>}
          {subtitleError ? <p className="drift-bad">Subtitle error: {subtitleError}</p> : null}
        </div>
        <div className="actions">
          <button onClick={clearSubtitleTrack}>Clear Subtitles</button>
        </div>
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

      <section className="grid">
        <div className="card">
          <h2>Chat (M8)</h2>
          <div className="chat-list">
            {chatMessages.length === 0 ? (
              <p>No chat messages yet.</p>
            ) : (
              <ul>
                {chatMessages.map((msg) => (
                  <li key={msg.messageId || `${msg.senderId}-${msg.sentAtMs}`}>
                    <strong>{msg.senderId === clientId ? "You" : msg.senderId}</strong>: {msg.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="actions">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={activeRoom ? "Type a message..." : "Join a room to chat"}
              disabled={!activeRoom}
              maxLength={500}
            />
            <button onClick={sendChatMessage} disabled={!activeRoom || !chatInput.trim()}>
              Send
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Live Metrics (M9/M15)</h2>
          <ul>
            <li>Client peers: {peers.length}</li>
            <li>RTC mode: {forceTurnOnly ? "relay-only" : "auto"}</li>
            <li>Trackers active: {activeTrackerUrls.length}</li>
            <li>Download: {downloadKbps} kbps</li>
            <li>Torrent progress: {torrentProgressPct}%</li>
            <li>Sync drift: {syncDriftSec.toFixed(2)}s</li>
            <li>Server active rooms: {serverMetrics?.activeRooms ?? "n/a"}</li>
            <li>Server active sockets: {serverMetrics?.activeSockets ?? "n/a"}</li>
            <li>Join success: {serverMetrics?.counters?.roomJoinSuccess ?? "n/a"}</li>
            <li>Join failure: {serverMetrics?.counters?.roomJoinFailure ?? "n/a"}</li>
            <li>Chat forwarded: {serverMetrics?.counters?.chatMessagesForwarded ?? "n/a"}</li>
            <li>p95 room:join latency: {serverMetrics?.latencyP95Ms?.["room:join"] ?? "n/a"} ms</li>
            <li>p95 chat:send latency: {serverMetrics?.latencyP95Ms?.["chat:send"] ?? "n/a"} ms</li>
          </ul>
        </div>
      </section>
    </main>
  )
}

export default App
