# 🔥 CRITICAL BUG FIX: Audio Scheduling

## Проблема
Все audio chunks планируются на одно и то же время (currentTime), вместо того чтобы планироваться **последовательно**.

Результат: все chunks играют ОДНОВРЕМЕННО → каша звуков → роботический голос

---

## Fix #1: Добавить накопительное scheduling время

### В `CartesiaStreamingPlayer.ts`

**Добавь новое поле в класс:**

```typescript
export class CartesiaStreamingPlayer {
  // ... existing fields
  
  // ✨ NEW: Track scheduled time
  private nextScheduledTime: number = 0;
  
  // ... rest of class
}
```

**В методе `startPlayback()` инициализируй время:**

```typescript
private async startPlayback(): Promise<void> {
  console.log('[CartesiaStreamingPlayer] 🎵 Starting playback');

  this.isPlaying = true;
  this.isPaused = false;

  if (this.firstSoundTime === 0) {
    this.firstSoundTime = Date.now();
    const latency = this.firstSoundTime - this.startTime;
    console.log(`[CartesiaStreamingPlayer] ⏱️ First sound latency: ${latency}ms`);
  }

  // ✨ NEW: Initialize scheduled time
  const now = this.audioContext.getPlaybackTime();
  this.nextScheduledTime = now + 0.05; // Start 50ms in future for buffer
  console.log(`[CartesiaStreamingPlayer] Initial schedule time: ${this.nextScheduledTime.toFixed(3)}s`);

  this.jitterBuffer.setState(BufferState.PLAYING);
  this.setState(PlayerState.PLAYING);
  this.emit('playing', this.getMetrics());
}
```

**В методе `scheduleNextChunk()` используй накопительное время:**

```typescript
private scheduleNextChunk(): void {
  if (!this.isPlaying || this.isPaused) {
    return;
  }

  // Read from jitter buffer
  const result = this.jitterBuffer.getNextChunk(this.config.chunkSize);

  if (result.samplesRead === 0) {
    return;
  }

  let data = result.data;

  // Apply zero-crossing alignment (only first chunk)
  if (this.config.useZeroCrossing && this.chunksPlayed === 0) {
    const aligned = this.zeroCrossingAligner.align(data, AlignmentMode.START);
    data = aligned.data;
    console.log(`[CartesiaStreamingPlayer] Applied zero-crossing alignment: trimmed ${aligned.totalTrimmed} samples`);
  }

  // Create buffer
  try {
    const buffer = this.audioContext.createBuffer(data);
    
    // ✨ NEW: Schedule at next cumulative time
    const source = this.audioContext.scheduleBuffer(buffer, this.nextScheduledTime);

    // ✨ NEW: Calculate when this chunk ends
    const chunkDuration = data.length / this.config.sampleRate;
    const previousTime = this.nextScheduledTime;
    this.nextScheduledTime += chunkDuration;

    console.log(
      `[scheduleNextChunk] Chunk #${this.chunksPlayed + 1}: ` +
      `${data.length} samples (${(chunkDuration * 1000).toFixed(1)}ms) ` +
      `scheduled at ${previousTime.toFixed(3)}s → ${this.nextScheduledTime.toFixed(3)}s`
    );

    // Track source
    this.scheduledSources.add(source);

    if (source && typeof source.onEnded === 'function') {
      source.onEnded = () => {
        this.scheduledSources.delete(source);
      };
    }

    this.chunksPlayed++;
  } catch (error) {
    console.error('[CartesiaStreamingPlayer] Schedule error:', error);
  }
}
```

**В методе `stop()` сбрасывай время:**

```typescript
stop(): void {
  console.log('[CartesiaStreamingPlayer] Stopping');

  this.abortController?.abort();
  this.currentGenerator = null;

  if (this.processingTimer) {
    clearInterval(this.processingTimer);
    this.processingTimer = null;
  }

  if (this.metricsTimer) {
    clearInterval(this.metricsTimer);
    this.metricsTimer = null;
  }

  this.isPlaying = false;
  this.isPaused = false;
  this.isStreaming = false;
  this.audioContext.stopAll();
  this.scheduledSources.clear();

  // ✨ NEW: Reset scheduled time
  this.nextScheduledTime = 0;

  this.fifoQueue.clear();
  this.jitterBuffer.reset();

  this.setState(PlayerState.STOPPED);
  this.emit('stopped', this.getMetrics());
}
```

---

## Fix #2: Увеличить chunkSize

**В конфигурации:**

```typescript
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 44100,
  preBufferThreshold: 300,
  maxBufferSize: 5,
  chunkSize: 2048,  // ✅ CHANGE: 320 → 2048 (46.4ms at 44.1kHz)
  fifoMaxSize: 500,
  processingInterval: 50,
  underrunStrategy: UnderrunStrategy.SILENCE,
  initialGain: 1.0,
  useZeroCrossing: true,
};
```

**Почему 2048?**
- 2048 samples / 44100 Hz = 46.4ms chunks
- 1000ms / 46.4ms = ~21 chunks per second (разумно)
- Меньше overhead на создание AudioBufferSourceNode
- Меньше вероятность gaps

---

## Fix #3: Проверка scheduling в AudioContextManager

**В `AudioContextManager.ts` в методе `scheduleBuffer()`:**

```typescript
scheduleBuffer(
  buffer: AudioBuffer,
  startTime?: number,
  offset: number = 0
): AudioBufferSourceNode {
  const source = this.createBufferSource(buffer);

  // ✅ CHANGE: Use provided startTime or calculate
  const now = this.context?.currentTime ?? 0;
  const start = startTime ?? now;
  
  // ✨ NEW: Add debug log
  console.log(
    `[AudioContextManager] scheduleBuffer: ` +
    `now=${now.toFixed(3)}s, ` +
    `start=${start.toFixed(3)}s, ` +
    `latency=${(start - now).toFixed(3)}s, ` +
    `offset=${offset}`
  );

  source.start(start, offset);

  return source;
}
```

---

## Ожидаемые логи после фикса:

```
[CartesiaStreamingPlayer] 🎵 Starting playback
[CartesiaStreamingPlayer] Initial schedule time: 0.050s
[scheduleNextChunk] Chunk #1: 2048 samples (46.4ms) scheduled at 0.050s → 0.096s
[AudioContextManager] scheduleBuffer: now=0.045s, start=0.050s, latency=0.005s, offset=0
[scheduleNextChunk] Chunk #2: 2048 samples (46.4ms) scheduled at 0.096s → 0.143s
[AudioContextManager] scheduleBuffer: now=0.080s, start=0.096s, latency=0.016s, offset=0
[scheduleNextChunk] Chunk #3: 2048 samples (46.4ms) scheduled at 0.143s → 0.189s
[AudioContextManager] scheduleBuffer: now=0.130s, start=0.143s, latency=0.013s, offset=0
...
```

**Заметь:**
- ✅ Каждый chunk планируется на **РАЗНОЕ время**
- ✅ `start` время **увеличивается** с каждым чанком
- ✅ `latency` показывает на сколько вперёд планируем (5-20ms - нормально)

---

## Тестирование

После применения фикса:

1. **Rebuild app**
2. **Test "Hello World"**
3. **Check console** - должны видеть:
   - Schedule times увеличиваются (0.050s → 0.096s → 0.143s...)
   - Latency стабильная (5-20ms)
   - Chunks планируются последовательно

4. **Listen to audio** - должен быть:
   - ✅ Нормальный голос (не робот!)
   - ✅ Плавное воспроизведение
   - ✅ Правильная скорость речи

---

## Summary

**Root Cause:** 
- Все chunks планировались на `currentTime` вместо накопительного времени
- ChunkSize был слишком мелким (320 samples = 7.3ms)

**Solution:**
1. Накопительное `nextScheduledTime` в player
2. Увеличение `chunkSize` до 2048 samples
3. Debug логи для проверки scheduling

**Expected Result:**
- Нормальный голос без искажений! 🎉

---

*Created: Feb 06, 2026*
*Priority: 🔥 CRITICAL - Фикс основной проблемы*
