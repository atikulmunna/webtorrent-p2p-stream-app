import test from "node:test"
import assert from "node:assert/strict"
import { convertSrtToVtt, prepareSubtitleTrack } from "../src/lib/subtitles.js"

test("convertSrtToVtt converts basic SRT cues to WEBVTT", () => {
  const srt = `1
00:00:01,200 --> 00:00:03,400
Hello world

2
00:00:05,000 --> 00:00:06,050
Second line`

  const vtt = convertSrtToVtt(srt)
  assert.match(vtt, /^WEBVTT/)
  assert.match(vtt, /00:00:01.200 --> 00:00:03.400/)
  assert.match(vtt, /Hello world/)
  assert.match(vtt, /00:00:05.000 --> 00:00:06.050/)
})

test("prepareSubtitleTrack keeps WEBVTT for .vtt input", async () => {
  const file = {
    name: "sample.vtt",
    text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n",
  }
  const result = await prepareSubtitleTrack(file)
  assert.equal(result.label, "sample.vtt")
  assert.match(result.vttText, /^WEBVTT/)
  assert.match(result.vttText, /Hi/)
})

test("prepareSubtitleTrack converts .srt input", async () => {
  const file = {
    name: "sample.srt",
    text: async () => "1\n00:00:00,000 --> 00:00:01,000\nHi\n",
  }
  const result = await prepareSubtitleTrack(file)
  assert.equal(result.label, "sample.srt")
  assert.match(result.vttText, /^WEBVTT/)
  assert.match(result.vttText, /00:00:00.000 --> 00:00:01.000/)
})

test("prepareSubtitleTrack rejects unsupported extension", async () => {
  const file = {
    name: "sample.txt",
    text: async () => "hello",
  }
  await assert.rejects(() => prepareSubtitleTrack(file), /Unsupported subtitle format/)
})
