#!/usr/bin/env node
const fs = require("fs")
const path = require("path")

function usage() {
  console.log("Usage:")
  console.log("  node scripts/validate-production-smoke.js <host-report.json> <guest-report.json>")
}

function readReport(filePath) {
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) throw new Error(`Report not found: ${filePath}`)
  return JSON.parse(fs.readFileSync(abs, "utf8"))
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function ensure(condition, message) {
  if (!condition) fail(message)
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2) {
    usage()
    process.exit(1)
  }

  const r1 = readReport(args[0])
  const r2 = readReport(args[1])
  const host = r1.role === "host" ? r1 : r2.role === "host" ? r2 : null
  const guest = r1.role === "guest" ? r1 : r2.role === "guest" ? r2 : null

  ensure(host && guest, "Expected one host report and one guest report.")
  ensure(host.roomId && guest.roomId && host.roomId === guest.roomId, "Room IDs must match across host/guest.")

  const m = guest.metrics || {}
  ensure(Number.isFinite(m.ttffMs), "Guest ttffMs must be present.")
  ensure(m.ttffMs <= 6000, `Guest ttffMs too high: ${m.ttffMs}ms`)
  ensure(Number.isFinite(m.rebufferRatioPct), "Guest rebufferRatioPct missing.")
  ensure(m.rebufferRatioPct <= 3, `Guest rebuffer ratio too high: ${m.rebufferRatioPct}%`)
  ensure(Number.isFinite(m.driftP95Sec), "Guest driftP95Sec missing.")
  ensure(m.driftP95Sec <= 1.0, `Guest drift p95 too high: ${m.driftP95Sec}s`)
  ensure(Number.isFinite(m.sessionPlaybackSec), "Guest sessionPlaybackSec missing.")
  ensure(m.sessionPlaybackSec >= 300, `Guest playback too short for prod smoke: ${m.sessionPlaybackSec}s`)
  ensure(Number.isFinite(m.peerCount), "Guest peerCount missing.")
  ensure(m.peerCount >= 2, `Guest peerCount too low: ${m.peerCount}`)

  console.log("Production smoke validation PASS")
  console.log(`roomId=${guest.roomId} ttffMs=${m.ttffMs} rebufferRatioPct=${m.rebufferRatioPct} driftP95Sec=${m.driftP95Sec}`)
}

main()
