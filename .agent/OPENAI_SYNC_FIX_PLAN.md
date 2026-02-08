# OpenAI TTS Synchronization Fix Plan
## Two critical issues with OpenAI provider

---

## Problem 1: Typewriter and Audio Not Synchronized

### Root Cause
**File:** `src/hooks/interview/useInterviewLogic.ts`

**Line 241:** Typewriter starts when message added to state
```typescript
setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: text, sender: 'ai' }]);
// ← Typewriter starts IMMEDIATELY
```

**Line 263:** Audio starts later
```typescript
player.playAsync()  // ← Audio starts AFTER
```

**Delay between them:** ~300-500ms (audio mode switch + buffering)

### Solution
Move typewriter start to happen AFTER audio begins playing:

```typescript
// Don't add message to state yet (no typewriter)
const message = { id: Date.now().toString() + '_ai', text: text, sender: 'ai' };

// Start audio first
await player.playAsync();

// THEN start typewriter
setMessages(prev => [...prev, message]);
```

---

## Problem 2: 60-Second Timeout with OpenAI

### Root Cause Analysis

**File:** `src/services/audio/OpenAIStreamingPlayer.ts`

**The Issue:** `drainBuffers()` resolves when FIFO/JitterBuffer are EMPTY, but AudioContext is STILL PLAYING!

**Timeline:**
```
T=0ms:    OpenAI fetches entire audio file (~200ms for 10 seconds of audio)
T=200ms:  Chunking loop completes rapidly
T=250ms:  drainBuffers() starts
T=300ms:  FIFO/JitterBuffer empty → drainBuffers() resolves
T=301ms:  'done' event emitted
T=302ms:  doneListener calls statusCallback(didJustFinish: true)
          BUT setOnPlaybackStatusUpdate not called yet!

T=303ms:  setOnPlaybackStatusUpdate(callback) called
          Race condition fix checks isPlaybackComplete (true)
          Calls statusCallback again

T=304ms-10,000ms: AudioContext STILL PLAYING scheduled sources!

T=60,000ms: Timeout fires because Promise never resolved properly
```

### Why Cartesia/Deepgram Work

They use **true WebSocket streaming**:
- Stream takes real-time to complete (5-10 seconds)
- drainBuffers() waits for real-time chunks
- Audio finishes shortly after stream completes
- Timing is natural

### Why OpenAI Breaks

It uses **fake streaming** (download all at once):
- Stream completes in ~200ms (downloaded full file)
- drainBuffers() completes quickly
- But AudioContext plays for 5-10 seconds!
- 'done' fired way before audio actually finishes

---

## Fix Implementation

### Fix #1: Make drainBuffers() wait for ACTUAL audio completion

**File:** `src/services/audio/OpenAIStreamingPlayer.ts`

**Current drainBuffers() (lines 739-784):**
```typescript
private async drainBuffers(): Promise<void> {
  return new Promise<void>((resolve) => {
    // ... only checks FIFO and JitterBuffer ...
    if (fifoEmpty && jitterEmpty) {
      resolve();  // ❌ Audio still playing!
    }
  });
}
```

**Fixed version:**
```typescript
private async drainBuffers(): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const drainInterval = setInterval(() => {
      this.fifoToJitterBuffer();

      const fifoEmpty = this.fifoQueue.isEmpty();
      const jitterEmpty = this.jitterBuffer.getBufferHealth().availableSamples === 0;

      // ✅ NEW: Track when last audio will finish playing
      const currentTime = this.audioContext.getContext().currentTime;
      const audioFinished = this.nextScheduledTime > 0 && currentTime >= this.nextScheduledTime;

      if (fifoEmpty && jitterEmpty) {
        // ✅ FIX: Wait for audio to actually finish playing
        if (audioFinished) {
          clearInterval(drainInterval);
          this.stopTimers();
          this.isPlaying = false;
          console.log('[OpenAIStreamingPlayer] Buffers drained, audio finished');
          resolved = true;
          resolve();
        } else {
          console.log('[OpenAIStreamingPlayer] Buffers empty, waiting for audio to finish...');
          // Keep calling scheduleNextChunk to maintain playback
          if (this.isPlaying) {
            this.scheduleNextChunk();
          }
        }
      }

      if (this.isPlaying) {
        this.scheduleNextChunk();
      }
    }, 50);

    // Increase timeout to 60 seconds (for long audio)
    const drainTimeout = setTimeout(() => {
      if (!resolved) {
        clearInterval(drainInterval);
        this.stopTimers();
        this.isPlaying = false;
        if (!this.doneEmitted) {
          this.doneEmitted = true;
          this.setState(PlayerState.DONE);
          this.emit('done', this.getMetrics());
        }
        console.log('[OpenAIStreamingPlayer] Drain timeout, emitted done event');
        resolve();
      }
    }, 60000); // ← Increased from 5000 to 60000
  });
}
```

**Key changes:**
1. Check `audioFinished` by comparing `nextScheduledTime` with `currentTime`
2. Only resolve when buffers empty AND audio finished playing
3. Increase timeout to 60 seconds for long audio files

### Fix #2: Synchronize typewriter with audio start

**File:** `src/hooks/interview/useInterviewLogic.ts`

**Current code (lines 236-268):**
```typescript
const player = await TTSService.prepareAudio(text, options);

// Line 241: Typewriter starts here
setMessages(prev => [...prev, { ... }]);

if (player) {
  await new Promise<void>((resolve, reject) => {
    // ...
    player.playAsync()  // Audio starts later
  });
}
```

**Fixed version:**
```typescript
const player = await TTSService.prepareAudio(text, options);

const aiMessage = { id: Date.now().toString() + '_ai', text: text, sender: 'ai' };

if (player) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('⏰ [Sync] Playback timeout (60s) - forcing resolve');
      player.setOnPlaybackStatusUpdate(null);
      reject(new Error('Playback timeout'));
    }, 60000);

    player.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        clearTimeout(timeout);
        player.setOnPlaybackStatusUpdate(null);
        resolve();
      }
    });

    // ✅ FIX: Start audio first
    player.playAsync().catch((error) => {
      clearTimeout(timeout);
      console.error('❌ [Sync] playAsync error:', error);
      reject(error);
    });

    // ✅ FIX: THEN start typewriter (slight delay for audio to begin)
    setTimeout(() => {
      setMessages(prev => [...prev, aiMessage]);
    }, 100);  // Small delay to let audio start first
  });
} else {
  // Fallback if no player
  setMessages(prev => [...prev, aiMessage]);
}
```

### Fix #3: Same fixes for Cartesia and Deepgram

**Files:**
- `src/services/audio/CartesiaStreamingPlayer.ts`
- `src/services/audio/DeepgramStreamingPlayer.ts`

Apply the same drainBuffers() fix (though less critical for true streaming).

---

## Testing Plan

### Test 1: Short text (2-3 seconds)
1. Select OpenAI provider
2. Start interview with short response
3. Verify typewriter starts ~100ms AFTER audio begins
4. Verify microphone unlocks after audio completes

### Test 2: Long text (10+ seconds)
1. Test with long Victoria response
2. Verify no 60-second timeout
3. Verify microphone unlocks at actual audio end
4. Check console for "Buffers drained, audio finished"

### Test 3: All providers
1. Test Cartesia (should still work)
2. Test Deepgram (should still work)
3. Test OpenAI (should now work correctly)

---

## Critical Files

| File | Lines | Change |
|------|-------|--------|
| `OpenAIStreamingPlayer.ts` | 739-784 | Fix drainBuffers to wait for audio |
| `CartesiaStreamingPlayer.ts` | 708-776 | Same drainBuffers fix |
| `DeepgramStreamingPlayer.ts` | 680-741 | Same drainBuffers fix |
| `useInterviewLogic.ts` | 236-268 | Sync typewriter with audio start |

---

## Success Criteria

- ✅ Typewriter starts slightly AFTER audio (not before)
- ✅ OpenAI microphone unlocks when audio actually finishes
- ✅ No 60-second timeout errors
- ✅ All three providers work correctly
