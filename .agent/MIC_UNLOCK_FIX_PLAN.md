# Microphone Unlock Fix Plan
## Problem: Microphone stays locked after Victoria finishes speaking

---

## Root Cause Analysis

The microphone button stays disabled because the **`done` event is not emitted** in two critical scenarios:

### Bug #1: drainBuffers() timeout doesn't emit 'done'
**Location:** All three streaming players
- `src/services/audio/OpenAIStreamingPlayer.ts:764-772`
- `src/services/audio/CartesiaStreamingPlayer.ts:756-764`
- `src/services/audio/DeepgramStreamingPlayer.ts:732-740`

**Current Code:**
```typescript
const drainTimeout = setTimeout(() => {
  if (!resolved) {
    clearInterval(drainInterval);
    this.stopTimers();
    this.isPlaying = false;
    console.log('[Player] Drain timeout, timers stopped');
    resolve();  // ❌ NO emit('done')!
  }
}, 5000);
```

**Impact:** If buffer draining takes >5 seconds, the 'done' event never fires → microphone locked forever.

### Bug #2: stop() doesn't emit 'done'
**Location:** All three streaming players
- `src/services/audio/OpenAIStreamingPlayer.ts:789-812`
- `src/services/audio/CartesiaStreamingPlayer.ts:781-820`
- `src/services/audio/DeepgramStreamingPlayer.ts:757-796`

**Current Code:**
```typescript
stop(): void {
  // ... cleanup ...
  this.setState(PlayerState.STOPPED);
  this.emit('stopped', this.getMetrics());  // ❌ Only 'stopped', not 'done'!
}
```

**Impact:** The `doneListener` in tts-service.ts expects 'done' event, not 'stopped'.

---

## Why the finally block doesn't save us

The `finally` block in `useInterviewLogic.ts:289-292` DOES call `setIsProcessing(false)` and `onAIEnd()`, BUT:

**Problem:** The Promise in `playSynchronizedResponse` waits for:
```typescript
player.setOnPlaybackStatusUpdate((status) => {
  if (status.isLoaded && status.didJustFinish) {
    resolve();  // ← This NEVER happens without 'done' event
  }
});
```

If 'done' event doesn't fire → `didJustFinish` never becomes true → Promise never resolves → `finally` block never executes.

---

## Fix Implementation

### Fix #1: Emit 'done' on drain timeout

**Files to modify:**
1. `src/services/audio/OpenAIStreamingPlayer.ts` (line ~764)
2. `src/services/audio/CartesiaStreamingPlayer.ts` (line ~756)
3. `src/services/audio/DeepgramStreamingPlayer.ts` (line ~732)

**Change:**
```typescript
const drainTimeout = setTimeout(() => {
  if (!resolved) {
    clearInterval(drainInterval);
    this.stopTimers();
    this.isPlaying = false;

    // ✅ FIX: Emit 'done' event even on timeout
    if (!this.doneEmitted) {
      this.doneEmitted = true;
      this.setState(PlayerState.DONE);
      this.emit('done', this.getMetrics());
    }

    console.log('[Player] Drain timeout, emitted done event');
    resolve();
  }
}, 5000);
```

### Fix #2: Emit 'done' on stop() (when playing)

**Files to modify:**
1. `src/services/audio/OpenAIStreamingPlayer.ts` (line ~789)
2. `src/services/audio/CartesiaStreamingPlayer.ts` (line ~781)
3. `src/services/audio/DeepgramStreamingPlayer.ts` (line ~757)

**Change:**
```typescript
stop(): void {
  console.log('[Player] Stopping');

  // ✅ FIX: Emit 'done' if we were playing (to unlock mic)
  const wasPlaying = this.isPlaying;
  const hadNotEmittedDone = !this.doneEmitted;

  // ... existing cleanup code ...

  this.setState(PlayerState.STOPPED);
  this.emit('stopped', this.getMetrics());

  // ✅ FIX: Also emit 'done' if playback was in progress
  if (wasPlaying && hadNotEmittedDone) {
    this.doneEmitted = true;
    this.emit('done', this.getMetrics());
    console.log('[Player] Emitted done event on stop');
  }
}
```

### Fix #3: Add defensive logging

**File:** `src/services/tts-service.ts` (line ~970)

**Change:**
```typescript
const doneListener = () => {
  console.log('📢 [TTS Streaming Mock] Player done - triggering callback');
  isPlaybackComplete = true;

  if (statusCallback) {
    console.log('✅ [TTS Streaming Mock] Calling statusCallback with didJustFinish=true');
    statusCallback({
      isLoaded: true,
      didJustFinish: true,
      durationMillis: 0,
      positionMillis: 0
    });
  } else {
    console.warn('⚠️ [TTS Streaming Mock] statusCallback is NULL - callback not registered yet!');
  }
};
```

---

## Testing Plan

### Manual Test 1: Normal playback completion
1. Start interview with OpenAI provider
2. Victoria speaks
3. Verify microphone button becomes enabled after speech
4. Check console for: `[Player] Stream complete - emitted done event`

### Manual Test 2: Long text (drain timeout scenario)
1. Test with very long text (>30 seconds)
2. Verify microphone still unlocks
3. Check console for: `[Player] Drain timeout, emitted done event`

### Manual Test 3: Manual stop
1. Start playback
2. Stop manually before completion
3. Verify microphone unlocks
4. Check console for: `[Player] Emitted done event on stop`

### Manual Test 4: Provider switching
1. Test with Cartesia
2. Switch to Deepgram
3. Switch to OpenAI
4. Verify all providers unlock mic correctly

---

## Critical Files Summary

| File | Lines | Change |
|------|-------|--------|
| `OpenAIStreamingPlayer.ts` | ~764, ~789 | Fix drain timeout + stop |
| `CartesiaStreamingPlayer.ts` | ~756, ~781 | Fix drain timeout + stop |
| `DeepgramStreamingPlayer.ts` | ~732, ~757 | Fix drain timeout + stop |
| `tts-service.ts` | ~970 | Add defensive logging (optional) |

---

## Success Criteria

- ✅ Microphone unlocks after normal playback completion
- ✅ Microphone unlocks even if drain timeout occurs
- ✅ Microphone unlocks when manually stopped
- ✅ All three providers (Cartesia, Deepgram, OpenAI) work correctly
- ✅ No console errors
