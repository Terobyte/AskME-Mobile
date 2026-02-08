# OpenAI TTS Streaming Bug Analysis

## Related Documentation

- [OpenAI TTS Streaming Integration Plan](./OPENAI_TTS_STREAMING_INTEGRATION.md) - Original integration plan with 13 voices and instructions support
- [OpenAI TTS Guide](./OPENAI_TTS_GUIDE.md) - Complete API documentation and usage examples

---

## Problem Summary

The OpenAI TTS streaming player receives chunks but the audio never plays. The buffer duration remains at 0ms despite receiving 40+ chunks, causing a **BUFFERING TIMEOUT** error.

### Error Logs
```
WARN  [OpenAI fifoToJitterBuffer] JitterBuffer rejected chunk (full?)
LOG  [OpenAI ProcessCycle] FIFO: 26 → 25, Buffer: 0ms → 0ms, Threshold: 0/500
ERROR [OpenAIStreamingPlayer] BUFFERING TIMEOUT (3s)!
ERROR [OpenAIStreamingPlayer] Debug info: {
  "bufferDuration": 0,
  "chunksReceived": 40,
  "fifoSize": 28,
  "isStreaming": true,
  "samplesAvailable": 0,
  "threshold": 500
}
LOG  [PCM16Resampler] 24kHz → 16kHz: 0 samples → 0 samples (33.3% reduction)
```

---

## Root Cause

### Bug #1: ArrayBuffer Reference Issue

**Location:** `src/services/openai-streaming-service.ts` lines 169-177

```typescript
const chunkData = fullPcmData.slice(offset, end);  // Int16Array with offset

// Problem: This creates an ArrayBuffer that references the FULL original buffer
const chunkBuffer = new ArrayBuffer(chunkData.byteLength);
const chunkView = new Uint8Array(chunkBuffer);
chunkView.set(new Uint8Array(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength));
```

When `Int16Array` is created from this `ArrayBuffer` in the player:
```typescript
const inputSamples = new Int16Array(entry.data);
// Uses full buffer byteLength, not just the chunk!
// Results in wrong data from wrong memory positions
```

### Bug #2: Type Mismatch (Secondary)

**Location:** `src/services/audio/OpenAIStreamingPlayer.ts` line 552

```typescript
const resampled = PCM16Resampler.openaiToPipeline(inputSamples); // Returns Int16Array
const success = this.jitterBuffer.addChunk(resampled); // Expects Float32Array!
```

JitterBuffer is designed for `Float32Array` but receives `Int16Array`, causing silent data corruption.

---

## The Fix

### Fix #1: Proper Buffer Slice

```typescript
// Instead of manual copy, use buffer.slice()
const chunkBuffer = chunkData.buffer.slice(
  chunkData.byteOffset,
  chunkData.byteOffset + chunkData.byteLength
);
```

### Fix #2: Int16 → Float32 Conversion

```typescript
const resampled = PCM16Resampler.openaiToPipeline(inputSamples);

// Convert to Float32 for JitterBuffer
const float32Data = new Float32Array(resampled.length);
for (let i = 0; i < resampled.length; i++) {
  float32Data[i] = resampled[i] / 32768.0;
}

const success = this.jitterBuffer.addChunk(float32Data);
```

---

## Files to Modify

| File | Lines | Description |
|------|-------|-------------|
| `src/services/openai-streaming-service.ts` | 169-177 | Fix ArrayBuffer copy |
| `src/services/audio/OpenAIStreamingPlayer.ts` | 546-562 | Add Int16→Float32 conversion |

---

## Platform Limitation Note

React Native doesn't support true streaming of `fetch` response bodies. The current implementation downloads the full audio file, then yields chunks to simulate streaming. This is a platform limitation, not a bug.

---

## Expected Behavior After Fix

```
[PCM16Resampler] 24kHz → 16kHz: 2400 samples → 1600 samples (33.3% reduction)
[OpenAI fifoToJitterBuffer] First chunk conversion:
  Input: 2400 samples @ 24kHz
  Output: 1600 samples @ 16kHz
  Duration: 100.0ms
[OpenAI ProcessCycle] Buffer: 0ms → 100ms → 200ms → ... → 500ms
[OpenAI ProcessCycle] Threshold reached - starting playback!
✅ Audio plays successfully
```
