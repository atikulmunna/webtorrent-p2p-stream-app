#!/usr/bin/env node
const fs = require("fs")
const path = require("path")

const NFR = {
  ttffMsMax: 6000,
  rebufferRatioPctMax: 3,
  driftP95SecMax: 1.0,
}

function usage() {
  console.log("Usage:")
  console.log("  node scripts/validate-milestone-evidence.js --milestone m4 <host.json> <guest.json>")
  console.log("  node scripts/validate-milestone-evidence.js --milestone m6 <host.json> <guest.json>")
  console.log("")
  console.log("Milestone checks:")
  console.log("  m4: relay-only mode + baseline NFRs + guest playback >= 60s")
  console.log("  m6: drift p95 <= 1.0s + guest playback >= 600s + baseline NFRs")
}

function parseArgs(argv) {
  const args = [...argv]
  const idx = args.indexOf("--milestone")
  if (idx === -1 || !args[idx + 1]) return { milestone: null, files: [] }
  const milestone = String(args[idx + 1]).toLowerCase()
  args.splice(idx, 2)
  return { milestone, files: args }
}

function asNumber(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function readReport(filePath) {
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Report file not found: ${filePath}`)
  }
  const report = JSON.parse(fs.readFileSync(abs, "utf8"))
  return {
    file: path.basename(filePath),
    role: report.role || "unknown",
    roomId: report.roomId || "unknown",
    metrics: report.metrics || {},
  }
}

function findHostGuest(reports) {
  const host = reports.find((r) => r.role === "host")
  const guest = reports.find((r) => r.role === "guest")
  if (!host || !guest) {
    throw new Error("Expected one host report and one guest report.")
  }
  if (host.roomId !== guest.roomId) {
    throw new Error(`Room mismatch: host=${host.roomId}, guest=${guest.roomId}`)
  }
  return { host, guest }
}

function baselineNfrFailures(report) {
  const m = report.metrics
  const failures = []
  const ttff = asNumber(m.ttffMs)
  const rebuffer = asNumber(m.rebufferRatioPct)
  const drift = asNumber(m.driftP95Sec)

  if (ttff !== null && ttff > NFR.ttffMsMax) {
    failures.push(`${report.file}: ttffMs ${ttff} > ${NFR.ttffMsMax}`)
  }
  if (rebuffer !== null && rebuffer > NFR.rebufferRatioPctMax) {
    failures.push(`${report.file}: rebufferRatioPct ${rebuffer} > ${NFR.rebufferRatioPctMax}`)
  }
  if (drift !== null && drift > NFR.driftP95SecMax) {
    failures.push(`${report.file}: driftP95Sec ${drift} > ${NFR.driftP95SecMax}`)
  }
  return failures
}

function validateM4(reports) {
  const { guest } = findHostGuest(reports)
  const failures = []

  reports.forEach((r) => {
    failures.push(...baselineNfrFailures(r))
    const rtcMode = r.metrics.rtcMode || "unknown"
    if (rtcMode !== "relay-only") {
      failures.push(`${r.file}: rtcMode must be relay-only, got ${rtcMode}`)
    }
  })

  const playbackSec = asNumber(guest.metrics.sessionPlaybackSec)
  if (playbackSec === null || playbackSec < 60) {
    failures.push(`${guest.file}: guest sessionPlaybackSec must be >= 60 for relay functional proof`)
  }

  return failures
}

function validateM6(reports) {
  const { guest } = findHostGuest(reports)
  const failures = []

  reports.forEach((r) => {
    failures.push(...baselineNfrFailures(r))
  })

  const playbackSec = asNumber(guest.metrics.sessionPlaybackSec)
  const driftP95 = asNumber(guest.metrics.driftP95Sec)
  if (playbackSec === null || playbackSec < 600) {
    failures.push(`${guest.file}: guest sessionPlaybackSec must be >= 600 for M6 DoD`)
  }
  if (driftP95 === null || driftP95 > NFR.driftP95SecMax) {
    failures.push(`${guest.file}: driftP95Sec must be <= ${NFR.driftP95SecMax}`)
  }

  return failures
}

function main() {
  const { milestone, files } = parseArgs(process.argv.slice(2))
  if (!milestone || files.length < 2 || !["m4", "m6"].includes(milestone)) {
    usage()
    process.exit(1)
  }

  let reports
  try {
    reports = files.map((f) => readReport(f))
  } catch (err) {
    console.error(`Validation error: ${err.message}`)
    process.exit(1)
  }

  let failures
  try {
    failures = milestone === "m4" ? validateM4(reports) : validateM6(reports)
  } catch (err) {
    console.error(`Validation error: ${err.message}`)
    process.exit(1)
  }

  if (failures.length > 0) {
    console.log(`Milestone ${milestone.toUpperCase()} evidence: FAIL`)
    failures.forEach((f) => console.log(`- ${f}`))
    process.exit(2)
  }

  console.log(`Milestone ${milestone.toUpperCase()} evidence: PASS`)
  process.exit(0)
}

main()
