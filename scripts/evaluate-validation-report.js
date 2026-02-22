#!/usr/bin/env node
const fs = require("fs")
const path = require("path")

const NFR_THRESHOLDS = {
  ttffMsMax: 4000,
  rebufferRatioPctMax: 3,
  driftP95SecMax: 1.0,
}

function usage() {
  console.log("Usage:")
  console.log("  node scripts/evaluate-validation-report.js <report1.json> [report2.json ...]")
  console.log("")
  console.log("Checks:")
  console.log(`  - ttffMs <= ${NFR_THRESHOLDS.ttffMsMax}`)
  console.log(`  - rebufferRatioPct <= ${NFR_THRESHOLDS.rebufferRatioPctMax}`)
  console.log(`  - driftP95Sec <= ${NFR_THRESHOLDS.driftP95SecMax}`)
}

function passFail(value, predicate) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A"
  return predicate(value) ? "PASS" : "FAIL"
}

function evaluateReport(reportPath) {
  const raw = fs.readFileSync(reportPath, "utf8")
  const parsed = JSON.parse(raw)
  const metrics = parsed.metrics || {}

  const ttffMs = Number(metrics.ttffMs)
  const rebufferRatioPct = Number(metrics.rebufferRatioPct)
  const driftP95Sec = Number(metrics.driftP95Sec)

  const ttffStatus = passFail(ttffMs, (v) => v <= NFR_THRESHOLDS.ttffMsMax)
  const rebufferStatus = passFail(rebufferRatioPct, (v) => v <= NFR_THRESHOLDS.rebufferRatioPctMax)
  const driftStatus = passFail(driftP95Sec, (v) => v <= NFR_THRESHOLDS.driftP95SecMax)
  const overall =
    ttffStatus === "PASS" && rebufferStatus === "PASS" && driftStatus === "PASS" ? "PASS" : "FAIL"

  return {
    file: path.basename(reportPath),
    role: parsed.role || "unknown",
    roomId: parsed.roomId || "unknown",
    ttffMs,
    ttffStatus,
    rebufferRatioPct,
    rebufferStatus,
    driftP95Sec,
    driftStatus,
    overall,
  }
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a"
  return `${value}`
}

function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    usage()
    process.exit(1)
  }

  const results = files.map((file) => evaluateReport(file))

  console.log("Validation Summary")
  console.log("--------------------------------------------------------------------------")
  console.log("File | Role | TTFF | Rebuffer | DriftP95 | Overall")
  console.log("--------------------------------------------------------------------------")
  results.forEach((r) => {
    console.log(
      `${r.file} | ${r.role} | ${fmt(r.ttffMs)}ms (${r.ttffStatus}) | ${fmt(r.rebufferRatioPct)}% (${r.rebufferStatus}) | ${fmt(r.driftP95Sec)}s (${r.driftStatus}) | ${r.overall}`,
    )
  })
  console.log("--------------------------------------------------------------------------")

  const failed = results.filter((r) => r.overall === "FAIL")
  if (failed.length > 0) {
    console.log(`NFR check failed for ${failed.length}/${results.length} report(s).`)
    process.exit(2)
  }

  console.log("All reports passed current NFR checks.")
}

main()
