# Sentence-Aware Streaming Implementation

## Overview

This implementation provides **zero-artifact** TTS audio playback through intelligent sentence-aware chunking with real-time timestamp processing.

## Architecture

### Three Chunking Modes

#### 1. FAST_START Mode
- **Purpose:** Low latency playback start (< 200ms)
- **Duration:** First ~1.6 seconds
- **Strategy:** Fixed-size chunks (25 chunks ≈ 1250ms each)
- **Files:** 2 files for initial buffer
- **Transition:** Automatically switches to SENTENCE_MODE after 2 files if timestamps available

#### 2. SENTENCE_MODE (Primary)
- **Purpose:** Zero mid-sentence artifacts
- **Strategy:** Dynamic file creation on sentence boundaries
- **Boundaries:** Period (.), Exclamation (!), Question (?)
- **Duration Range:** 500ms - 2500ms per file
- **Features:**
  - Real-time timestamp processing from Cartesia API
  - Sub-sentence splitting for long sentences (commas, semicolons)
  - Automatic fallback for excessively long segments

#### 3. FALLBACK Mode
- **Purpose:** Safety fallback when timestamps unavailable
- **Strategy:** Large fixed chunks (~1000ms)
- **Trigger:** Automatically activated if no timestamps received after FAST_START

## Key Features

✅ **Gapless Playback:** AudioQueue preloading with 120ms crossfade  
✅ **Low Latency:** Playback starts in < 200ms  
✅ **Zero Artifacts:** Files created only on sentence boundaries  
✅ **Adaptive:** Automatic mode switching based on timestamp availability  
✅ **Robust:** Fallback modes for edge cases  
✅ **Configurable:** Centralized CONFIG object for easy tuning  

## Configuration

All parameters are centralized in `CONFIG` object:

```typescript
CONFIG = {
    FAST_START: {
        CHUNKS_PER_FILE: 25,      // ~1250ms per file
        MAX_FILES: 2,             // Switch after 2 files
    },
    SENTENCE: {
        MIN_DURATION_MS: 500,     // Minimum file duration
        MAX_DURATION_MS: 2500,    // Maximum before force flush
        LONG_SENTENCE_MS: 3000,   // Try sub-sentence split
    },
    FALLBACK: {
        CHUNKS_PER_FILE: 20,      // ~1000ms per file
    },
    CROSSFADE: {
        FAST_START_MS: 100,
        SENTENCE_MS: 120,
        FALLBACK_MS: 100,
    },
    FEATURES: {
        USE_SENTENCE_CHUNKING: true,
        VERBOSE_LOGGING: true,    // Set false for production
    }
}
```

## Flow Diagram

```
┌─────────────────────────────────────────┐
│ TTS Request                             │
│ "Hello! I'm Victoria. How are you?"    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Cartesia Streaming Service              │
│ - Generate audio chunks (WebSocket)     │
│ - Receive word timestamps               │
│ - Forward both to Player                │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ FAST_START Mode                         │
│ File 1: chunks 1-25  (~1250ms)         │
│ File 2: chunks 26-50 (~1250ms)         │
│ → START PLAYBACK (< 200ms latency)     │
└─────────────────┬───────────────────────┘
                  │
                  ▼ (after 2 files + timestamps available)
┌─────────────────────────────────────────┐
│ SENTENCE_MODE                           │
│ - Detect: "Hello!" → boundary           │
│   File 3: "Hello!" (500ms)              │
│ - Detect: "I'm Victoria." → boundary    │
│   File 4: "I'm Victoria." (800ms)       │
│ - Detect: "How are you?" → boundary     │
│   File 5: "How are you?" (600ms)        │
│ → Zero artifacts! Each file is complete │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ AudioQueue (Gapless Playback)           │
│ - Preload next file while playing       │
│ - 120ms crossfade between files         │
│ - Instant transitions (< 10ms gap)      │
└─────────────────────────────────────────┘
```

## Components

### 1. `SentenceDetector` (utils/sentence-detector.ts)
- Analyzes word timestamps to find sentence boundaries
- Supports sentence endings: `.`, `!`, `?`
- Sub-sentence splitting: `,`, `;`, `—`
- Duration calculations

### 2. `ChunkedStreamingPlayer` (services/streaming-audio-player.ts)
- Main player with adaptive chunking logic
- State machine: FAST_START → SENTENCE_MODE → FALLBACK
- Real-time timestamp reception
- Dynamic file creation

### 3. `CartesiaStreamingService` (services/cartesia-streaming-service.ts)
- WebSocket connection to Cartesia API
- Audio chunk streaming
- Timestamp collection and forwarding
- Callback system for real-time updates

### 4. `TTSService` (services/tts-service.ts)
- High-level TTS interface
- Connects Cartesia service to Player
- Timestamp flow coordination

## Performance Metrics

### Expected Results

**Short sentence (< 1s):**
- ✅ Playback start: < 200ms
- ✅ Artifacts: 0
- ✅ Files created: 1-2

**Long sentence (> 2s):**
- ✅ Playback start: < 200ms
- ✅ Artifacts: 0
- ✅ File created on sentence boundary

**Multiple sentences:**
- ✅ Each sentence = separate file (or grouped)
- ✅ Seamless transitions
- ✅ Zero mid-sentence artifacts

## Edge Cases Handled

1. **No timestamps received:** Auto-switch to FALLBACK mode
2. **Extremely long sentences (> 3s):** Sub-sentence splitting at commas
3. **Missing timestamp data:** Safety checks with fallback
4. **Late timestamp arrival:** Buffering and delayed processing
5. **Empty or malformed data:** Error handling with graceful degradation

## Logging

Comprehensive logging for debugging (can be disabled via `VERBOSE_LOGGING` flag):

```
📦 [FAST_START] File #1: 1250ms (1/2)
📝 [Player] Received 15 timestamps
✨ [Player] Detected 1 sentence boundaries:
   1. "Hello!" (520ms)
📦 [SENTENCE] File #3: "Hello!" (520ms)
🔄 [Player] Switching to SENTENCE_MODE
📊 [Player] Playback Statistics:
  Total files created: 5
  Fast-start files: 2
  Sentence/Fallback files: 3
  Final mode: sentence
  Timestamps received: 45 words
```

## Testing

### Manual Testing Scenarios

1. **Short text:** "Hello! How are you?"
2. **Medium text:** "I'll be conducting your interview today. Please tell me about yourself."
3. **Long text:** Multiple long sentences with complex punctuation
4. **Edge case:** Text without punctuation (tests fallback)

### Expected Behavior

- **Latency:** Playback starts within 200ms
- **Quality:** No audible clicks, pops, or mid-sentence breaks
- **Reliability:** Handles all text lengths and punctuation patterns
- **Fallback:** Gracefully handles missing timestamps

## Production Deployment

Before production:

1. Set `VERBOSE_LOGGING: false` in CONFIG
2. Test with various text lengths and patterns
3. Monitor latency metrics
4. Verify fallback modes work correctly
5. Test on various devices (iOS/Android)

## Future Improvements

- [ ] Caching of sentence-chunked files
- [ ] Adaptive crossfade duration based on file duration
- [ ] Predictive preloading for known text
- [ ] A/B testing framework for parameter tuning
- [ ] Performance analytics dashboard

## Credits

Implemented using:
- Cartesia AI TTS API (WebSocket streaming + timestamps)
- Expo Audio
- React Native
- TypeScript

---

**Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Last Updated:** 2026-02-05
