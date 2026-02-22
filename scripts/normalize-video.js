#!/usr/bin/env node
const { existsSync } = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

function usage() {
  console.log("Usage:")
  console.log("  npm run video:normalize -- <input-file> [output-file]")
  console.log("")
  console.log("Output defaults to: <input-basename>_h264_safe_720p30.mp4")
}

function findFfmpeg() {
  const explicit = process.env.FFMPEG_BIN
  if (explicit && existsSync(explicit)) return explicit

  // First, try ffmpeg from PATH.
  const pathCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" })
  if (pathCheck.status === 0) return "ffmpeg"

  // Fallback for WinGet install location.
  const wingetPath = path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Packages",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "ffmpeg-8.0.1-full_build",
    "bin",
    "ffmpeg.exe",
  )
  if (existsSync(wingetPath)) {
    return wingetPath
  }
  return null
}

function main() {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    usage()
    process.exit(1)
  }

  const inputFile = path.resolve(args[0])
  if (!existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`)
    process.exit(1)
  }

  const ext = path.extname(inputFile)
  const base = inputFile.slice(0, Math.max(0, inputFile.length - ext.length))
  const outputFile = path.resolve(args[1] || `${base}_h264_safe_720p30.mp4`)

  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    console.error("ffmpeg not found. Install FFmpeg or set FFMPEG_BIN to ffmpeg executable path.")
    process.exit(1)
  }

  const ffArgs = [
    "-y",
    "-i",
    inputFile,
    "-vf",
    "scale=-2:720,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-b:a",
    "128k",
    outputFile,
  ]

  console.log(`Normalizing video:\n  in:  ${inputFile}\n  out: ${outputFile}`)
  const result = spawnSync(ffmpeg, ffArgs, { stdio: "inherit" })
  if (result.error) {
    console.error(`Failed to run ffmpeg: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  console.log("Video normalization complete.")
}

main()
