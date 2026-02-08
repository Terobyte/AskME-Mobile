# CartesiaStreamingPlayer.ts - Bug Fixes Patch
## Critical Fix: Player Stuck on BUFFERING

### 🔧 Changes to Apply

---

## Fix #1: Aggressive FIFO Draining During Buffering

**Location:** `fifoToJitterBuffer()` method (around line 413-441)

**Replace:**
```typescript
private fifoToJitterBuffer(): void {
  const maxBufferMs = 1000; // 1 second max - healthy level

  while (!this.fifoQueue.isEmpty()) {
    const currentDuration = this.jitterBuffer.getBufferHealth().currentDuration;

    if (currentDuration > maxBufferMs) {
      break;
    }

    const entry = this.fifoQueue.dequeue();
    if (!entry) break;

    try {
      const result = this.converter.convert(entry.data.data);

      if (this.chunksReceived % 10 === 0) {
        console.log(`[CartesiaStreamingPlayer] Buffer: ${currentDuration.toFixed(0)}ms → adding ${result.data.length} samples`);
      }

      this.jitterBuffer.addChunk(result.data);
    } catch (error) {
      console.error('[CartesiaStreamingPlayer] Conversion error:', error);
    }
  }
}
```

**With:**
```typescript
private fifoToJitterBuffer(): void {
  // Adaptive flow control based on state
  const isBuffering = !this.isPlaying && !this.isPaused;
  const currentDuration = this.jitterBuffer.getBufferHealth().currentDuration;
  const threshold = this.config.preBufferThreshold;

  // During buffering: aggressive draining to reach threshold ASAP
  // During playback: conservative draining to maintain stable buffer
  let maxBufferMs: number;
  if (isBuffering && currentDuration < threshold) {
    // AGGRESSIVE: Fill to threshold + safety margin
    maxBufferMs = threshold + 200; // e.g., 500ms
    console.log(`[fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to ${maxBufferMs}ms`);
  } else {
    // CONSERVATIVE: Maintain healthy buffer during playback
    maxBufferMs = 1000;
  }

  let drained = 0;
  while (!this.fifoQueue.isEmpty()) {
    const health = this.jitterBuffer.getBufferHealth();

    // Stop if buffer would exceed limit
    if (health.currentDuration > maxBufferMs) {
      if (drained > 0) {
        console.log(`[fifoToJitterBuffer] Buffer limit reached at ${health.currentDuration.toFixed(0)}ms`);
      }
      break;
    }

    const entry = this.fifoQueue.dequeue();
    if (!entry) break;

    try {
      const result = this.converter.convert(entry.data.data);
      const success = this.jitterBuffer.addChunk(result.data);

      if (!success) {
        console.warn('[fifoToJitterBuffer] JitterBuffer rejected chunk (full?)');
        break;
      }

      drained++;
    } catch (error) {
      console.error('[fifoToJitterBuffer] Conversion error:', error);
    }
  }

  // Log progress during buffering
  if (isBuffering && drained > 0) {
    const health = this.jitterBuffer.getBufferHealth();
    const progress = (health.currentDuration / threshold) * 100;
    console.log(
      `[fifoToJitterBuffer] Drained ${drained} chunks → ` +
      `${health.currentDuration.toFixed(0)}ms / ${threshold}ms (${progress.toFixed(0)}%)`
    );
  }
}
```

---

## Fix #2: Enhanced processCycle() with Better Logging

**Location:** `processCycle()` method (around line 369-408)

**Replace:**
```typescript
private processCycle(): void {
  this.fifoToJitterBuffer();

  if (!this.isPlaying && !this.isPaused && this.jitterBuffer.canStartPlayback()) {
    this.startPlayback();
  }

  if (this.isPlaying && !this.isPaused) {
    const hasData = this.jitterBuffer.getBufferHealth().availableSamples > 0;
    if (this.isStreaming || hasData) {
      this.scheduleNextChunk();
    } else {
      this.isPlaying = false;
      if (this.processingTimer) {
        clearInterval(this.processingTimer);
        this.processingTimer = null;
      }
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer);
        this.metricsTimer = null;
      }
      console.log('[CartesiaStreamingPlayer] Playback complete, timers stopped');
    }
  }

  if (this.isPlaying && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
    this.emit('underrun', this.getMetrics());
    console.warn('[CartesiaStreamingPlayer] Buffer underrun!');
  }
}
```

**With:**
```typescript
private processCycle(): void {
  // Snapshot state before processing
  const beforeFifo = this.fifoQueue.size();
  const beforeHealth = this.jitterBuffer.getBufferHealth();

  // Phase 1: Move chunks from FIFO to JitterBuffer
  this.fifoToJitterBuffer();

  // Snapshot state after processing
  const afterFifo = this.fifoQueue.size();
  const afterHealth = this.jitterBuffer.getBufferHealth();

  // Log state changes (only during buffering for clarity)
  if (this.state === PlayerState.BUFFERING) {
    if (beforeFifo !== afterFifo || beforeHealth.currentDuration !== afterHealth.currentDuration) {
      const canStart = this.jitterBuffer.canStartPlayback();
      console.log(
        `[ProcessCycle] FIFO: ${beforeFifo} → ${afterFifo}, ` +
        `Buffer: ${beforeHealth.currentDuration.toFixed(0)}ms → ${afterHealth.currentDuration.toFixed(0)}ms, ` +
        `Threshold: ${canStart ? '✅ READY' : `❌ ${afterHealth.currentDuration.toFixed(0)}/${this.config.preBufferThreshold}`}`
      );
    }
  }

  // Phase 2: Check if we can start playback
  if (!this.isPlaying && !this.isPaused && this.jitterBuffer.canStartPlayback()) {
    console.log('[ProcessCycle] ✅ Threshold reached - starting playback!');
    this.startPlayback();
  }

  // Phase 3: Schedule next chunk if playing
  if (this.isPlaying && !this.isPaused) {
    const hasData = afterHealth.availableSamples > 0;

    if (this.isStreaming || hasData) {
      this.scheduleNextChunk();
    } else {
      // No more data and stream ended - stop playback
      this.isPlaying = false;
      if (this.processingTimer) {
        clearInterval(this.processingTimer);
        this.processingTimer = null;
      }
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer);
        this.metricsTimer = null;
      }
      console.log('[ProcessCycle] ⏹️ No more data - stopping timers');
    }
  }

  // Phase 4: Check for underrun (only during active playback with active stream)
  if (this.isPlaying && this.isStreaming && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
    this.emit('underrun', this.getMetrics());
    console.warn('[ProcessCycle] ⚠️ Buffer underrun!');
  }
}
```

---

## Fix #3: Remove Duplicate scheduleNextChunk() from startPlayback()

**Location:** `startPlayback()` method (around line 460-482)

**Replace:**
```typescript
private async startPlayback(): Promise<void> {
  console.log('[CartesiaStreamingPlayer] Starting playback');

  this.isPlaying = true;
  this.isPaused = false;

  if (this.firstSoundTime === 0) {
    this.firstSoundTime = Date.now();
    const latency = this.firstSoundTime - this.startTime;
    console.log(`[CartesiaStreamingPlayer] First sound latency: ${latency}ms`);
  }

  this.jitterBuffer.setState(BufferState.PLAYING);
  this.setState(PlayerState.PLAYING);
  this.emit('playing', this.getMetrics());

  // Schedule first chunk immediately
  this.scheduleNextChunk();
}
```

**With:**
```typescript
private async startPlayback(): Promise<void> {
  console.log('[CartesiaStreamingPlayer] 🎵 Starting playback');

  // Update flags
  this.isPlaying = true;
  this.isPaused = false;

  // Track first sound latency
  if (this.firstSoundTime === 0) {
    this.firstSoundTime = Date.now();
    const latency = this.firstSoundTime - this.startTime;
    console.log(`[CartesiaStreamingPlayer] ⏱️ First sound latency: ${latency}ms`);
  }

  // Update buffer state
  this.jitterBuffer.setState(BufferState.PLAYING);
  
  // Update player state
  this.setState(PlayerState.PLAYING);
  this.emit('playing', this.getMetrics());

  // ✅ DON'T schedule here - let processCycle() handle it in next tick
  // This prevents double-scheduling bug
}
```

---

## Fix #4: Add Buffering Timeout Protection

**Location:** `startProcessing()` method (around line 348-367)

**Add after line 354 (after `this.processingTimer = setInterval(...)`):**

```typescript
private startProcessing(): void {
  if (this.processingTimer) {
    return;
  }

  console.log('[CartesiaStreamingPlayer] Starting processing loop');

  this.processingTimer = setInterval(() => {
    this.processCycle();
  }, this.config.processingInterval);

  // ✨ NEW: Add buffering timeout protection (3 seconds)
  const bufferingTimeout = setTimeout(() => {
    if (this.state === PlayerState.BUFFERING) {
      console.error('[CartesiaStreamingPlayer] ⚠️ BUFFERING TIMEOUT (3s)!');
      
      const health = this.jitterBuffer.getBufferHealth();
      console.error('[CartesiaStreamingPlayer] Debug info:', {
        fifoSize: this.fifoQueue.size(),
        bufferDuration: health.currentDuration,
        threshold: this.config.preBufferThreshold,
        samplesAvailable: health.availableSamples,
        chunksReceived: this.chunksReceived,
        isStreaming: this.isStreaming,
      });

      // Try to force start if we have ANY data
      if (health.availableSamples > 0) {
        console.warn('[CartesiaStreamingPlayer] 🚨 Force starting with partial buffer');
        this.startPlayback();
      } else {
        // No data at all - something is wrong
        this.setState(PlayerState.ERROR);
        this.emit('error', { 
          error: 'Buffering timeout - no data received',
          debug: {
            fifoSize: this.fifoQueue.size(),
            chunksReceived: this.chunksReceived,
            isStreaming: this.isStreaming,
          }
        });
      }
    }
  }, 3000); // 3 second timeout

  // Clear timeout when playback starts successfully
  const clearBufferingTimeout = () => {
    clearTimeout(bufferingTimeout);
    this.off('playing', clearBufferingTimeout);
  };
  this.on('playing', clearBufferingTimeout);

  // Start metrics timer (every 100ms)
  this.metricsTimer = setInterval(() => {
    this.emit('metrics', this.getMetrics());

    // Calculate chunks per second
    const now = Date.now();
    if (now - this.lastChunksPerSecondCheck >= 1000) {
      this.lastChunksPerSecondCheck = now;
      this.chunksReceivedLastSecond = this.chunksReceived;
    }
  }, 100);
}
```

---

## Fix #5: Add Debug Helper Method

**Location:** Add as new PUBLIC method (after `getState()` around line 732)

```typescript
/**
 * Debug helper - print current player state
 * @internal Use only for debugging
 */
public debugState(): void {
  const metrics = this.getMetrics();
  const health = this.jitterBuffer.getBufferHealth();

  console.log('╔════════════════════════════════════════╗');
  console.log('║     CARTESIA PLAYER DEBUG STATE        ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ State:           ${this.state.padEnd(20)} ║`);
  console.log(`║ Is Playing:      ${String(this.isPlaying).padEnd(20)} ║`);
  console.log(`║ Is Paused:       ${String(this.isPaused).padEnd(20)} ║`);
  console.log(`║ Is Streaming:    ${String(this.isStreaming).padEnd(20)} ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ FIFO Queue:      ${String(this.fifoQueue.size()).padEnd(20)} ║`);
  console.log(`║ Buffer Duration: ${health.currentDuration.toFixed(0).padEnd(20)} ms ║`);
  console.log(`║ Threshold:       ${String(this.config.preBufferThreshold).padEnd(20)} ms ║`);
  console.log(`║ Can Start?:      ${String(this.jitterBuffer.canStartPlayback()).padEnd(20)} ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Chunks Received: ${String(this.chunksReceived).padEnd(20)} ║`);
  console.log(`║ Chunks Played:   ${String(this.chunksPlayed).padEnd(20)} ║`);
  console.log(`║ Underruns:       ${String(health.underrunCount).padEnd(20)} ║`);
  console.log(`║ Dropped:         ${String(health.droppedChunks).padEnd(20)} ║`);
  console.log('╚════════════════════════════════════════╝');
}
```

---

## 🧪 Testing the Fixes

### Step 1: Apply All Patches

Copy the code above into `CartesiaStreamingPlayer.ts`

### Step 2: Add Debug Button to UI

In `TestAudioStreamPage.tsx`, add:

```typescript
<TouchableOpacity
  style={styles.debugButton}
  onPress={() => {
    if (playerRef.current) {
      playerRef.current.debugState();
    }
  }}
>
  <Text>🐛 Debug State</Text>
</TouchableOpacity>
```

### Step 3: Test with Hello World

```typescript
player.speak("Hello world, it is me Victoria");
```

**Watch console for:**
```
✅ [fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to 500ms
✅ [fifoToJitterBuffer] Drained X chunks → 300ms / 300ms (100%)
✅ [ProcessCycle] ✅ Threshold reached - starting playback!
✅ [CartesiaStreamingPlayer] 🎵 Starting playback
✅ Audio plays!
```

### Step 4: If Still Stuck

Press "🐛 Debug State" button and check:
- FIFO Queue size - should drain to 0
- Buffer Duration - should reach 300ms+
- Can Start? - should be TRUE before playback

---

## 📊 Expected Console Output (Success)

```
[CartesiaStreamingPlayer] Initialized with config: {...}
[CartesiaStreamingPlayer] Starting processing loop
[CartesiaStreamingPlayer] First chunk received
[fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to 500ms
[fifoToJitterBuffer] Drained 3 chunks → 60ms / 300ms (20%)
[ProcessCycle] FIFO: 3 → 0, Buffer: 0ms → 60ms, Threshold: ❌ 60/300
[fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to 500ms
[fifoToJitterBuffer] Drained 5 chunks → 160ms / 300ms (53%)
[ProcessCycle] FIFO: 5 → 0, Buffer: 60ms → 160ms, Threshold: ❌ 160/300
[fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to 500ms
[fifoToJitterBuffer] Drained 8 chunks → 320ms / 300ms (106%)
[ProcessCycle] FIFO: 8 → 0, Buffer: 160ms → 320ms, Threshold: ✅ READY
[ProcessCycle] ✅ Threshold reached - starting playback!
[CartesiaStreamingPlayer] 🎵 Starting playback
[CartesiaStreamingPlayer] ⏱️ First sound latency: 450ms
🎵 AUDIO PLAYS! 🎉
```

---

## 🚨 If Still Not Working

### Diagnostic Steps

1. **Check WebSocket Connection**
   ```typescript
   // В streamingLoop(), verify chunks arriving:
   console.log('[WS] Chunk arrived:', chunk.sizeBytes);
   ```

2. **Check FIFO Enqueue**
   ```typescript
   // После fifoQueue.enqueue():
   console.log('[WS] FIFO size after enqueue:', this.fifoQueue.size());
   ```

3. **Check Converter**
   ```typescript
   // В fifoToJitterBuffer():
   const result = this.converter.convert(entry.data.data);
   console.log('[Converter] Converted:', result.data.length, 'samples');
   ```

4. **Check JitterBuffer Add**
   ```typescript
   const success = this.jitterBuffer.addChunk(result.data);
   console.log('[JitterBuffer] Added chunk:', success);
   ```

5. **Check canStartPlayback()**
   ```typescript
   // В processCycle() перед проверкой:
   const health = this.jitterBuffer.getBufferHealth();
   const canStart = this.jitterBuffer.canStartPlayback();
   console.log('[ProcessCycle] Health:', {
     duration: health.currentDuration,
     threshold: this.config.preBufferThreshold,
     canStart,
   });
   ```

---

## ✅ Success Indicators

После применения фиксов вы должны увидеть:

1. ✅ FIFO queue активно дренится (размер уменьшается)
2. ✅ Buffer duration растет каждый цикл
3. ✅ Достигает 300ms threshold
4. ✅ Логи показывают "✅ Threshold reached"
5. ✅ State переходит BUFFERING → PLAYING
6. ✅ Audio играет!

**Если всё это работает - BUG FIXED! 🎉**

---

*Created: Feb 06, 2026*
*Patch Version: 1.0*
