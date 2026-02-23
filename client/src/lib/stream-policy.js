export function isLikelySupportedMvpVideo(file) {
  const lower = String(file?.name || "").toLowerCase()
  const type = String(file?.type || "").toLowerCase()
  const isMp4 = lower.endsWith(".mp4")
  const isTypeMp4 = type.includes("mp4")
  return isMp4 || isTypeMp4
}

export function getCompatibilityHint(file) {
  const lower = String(file?.name || "").toLowerCase()
  if (!lower.endsWith(".mp4")) {
    return "Best compatibility: MP4 container with H.264 video + AAC audio."
  }
  return "If playback is black/stuck, normalize to H.264/AAC using the convert command in README."
}

export function getNormalizeCommandHint(fileName = "input.mp4") {
  const safeName = String(fileName || "input.mp4")
  return `Try: npm run video:normalize -- "${safeName}"`
}

export function extractTrackerUrl(text) {
  if (typeof text !== "string") return null
  const match = text.match(/wss?:\/\/[^\s)]+/i)
  return match?.[0] || null
}

export function computeTrackerFailover({
  trackerUrls,
  activeTrackerUrls,
  failureMap,
  failedUrl,
  threshold,
}) {
  if (!failedUrl || !Array.isArray(trackerUrls) || !Array.isArray(activeTrackerUrls)) {
    return null
  }
  if (!trackerUrls.includes(failedUrl)) return null

  const nextMap = new Map(failureMap || [])
  const current = nextMap.get(failedUrl) || 0
  const nextCount = current + 1
  nextMap.set(failedUrl, nextCount)
  if (nextCount < threshold) {
    return { nextFailureMap: nextMap, nextTrackers: null, quarantined: false }
  }

  const nextTrackers = activeTrackerUrls.filter((item) => item !== failedUrl)
  if (nextTrackers.length === 0) {
    return { nextFailureMap: nextMap, nextTrackers: null, quarantined: false }
  }

  return { nextFailureMap: nextMap, nextTrackers, quarantined: true }
}
