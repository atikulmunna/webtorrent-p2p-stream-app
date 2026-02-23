function stripBom(text) {
  if (!text) return ""
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function toVttTimestamp(value) {
  const trimmed = String(value || "").trim().replace(",", ".")
  const match = trimmed.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})$/)
  if (!match) return trimmed
  const [, hh, mm, ss, msRaw] = match
  const ms = msRaw.padEnd(3, "0").slice(0, 3)
  return `${hh}:${mm}:${ss}.${ms}`
}

export function convertSrtToVtt(input) {
  const normalized = normalizeNewlines(stripBom(String(input || ""))).trim()
  if (!normalized) return "WEBVTT\n\n"

  const blocks = normalized.split(/\n{2,}/)
  const cues = []

  blocks.forEach((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean)
    if (lines.length < 2) return

    let cursor = 0
    if (/^\d+$/.test(lines[0])) cursor = 1
    const timeLine = lines[cursor]
    if (!timeLine || !timeLine.includes("-->")) return

    const [startRaw, endRaw] = timeLine.split("-->").map((part) => part.trim())
    const start = toVttTimestamp(startRaw)
    const end = toVttTimestamp(endRaw)
    const textLines = lines.slice(cursor + 1)
    if (textLines.length === 0) return

    cues.push(`${start} --> ${end}\n${textLines.join("\n")}`)
  })

  return `WEBVTT\n\n${cues.join("\n\n")}\n`
}

export async function prepareSubtitleTrack(file) {
  if (!file || typeof file.text !== "function") {
    throw new Error("Invalid subtitle file input")
  }

  const fileName = String(file.name || "subtitle").trim() || "subtitle"
  const lower = fileName.toLowerCase()
  const rawText = await file.text()

  if (lower.endsWith(".vtt")) {
    const normalized = normalizeNewlines(stripBom(String(rawText || ""))).trim()
    const vttText = normalized.startsWith("WEBVTT") ? `${normalized}\n` : `WEBVTT\n\n${normalized}\n`
    return { vttText, label: fileName }
  }

  if (lower.endsWith(".srt")) {
    return { vttText: convertSrtToVtt(rawText), label: fileName }
  }

  throw new Error("Unsupported subtitle format. Use .vtt or .srt")
}
