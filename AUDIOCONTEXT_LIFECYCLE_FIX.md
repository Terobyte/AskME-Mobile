# AudioContextManager Lifecycle Bug Fix

## Problem Summary

**Error:** `AudioContextManager has been destroyed`

**When it happens:**
- Switching between TTS providers (Cartesia ↔ OpenAI ↔ Deepgram)
- Rapid stop/play cycles
- Provider switching in TestAudioStreamPage

**Root Cause:**
All three streaming players share ONE global AudioContextManager singleton. When any player disposes, it destroys the AudioContext for ALL players. The singleton is never reset to `null` after destruction, so subsequent `getInstance()` calls return the same destroyed instance.

---

## Error Pattern

```
[OpenAIStreamingPlayer] Stopping
[OpenAI TTS] Stop called
[OpenAIStreamingPlayer] State: idle → stopped
[OpenAIStreamingPlayer] State: stopped → connecting
ERROR [OpenAIStreamingPlayer] Error: AudioContextManager has been destroyed
```

---

## Solution: Multi-Layer Defense

### Layer 1: AudioContextManager Auto-Recovery
- Reset singleton to `null` when destroyed
- Check `isDestroyed` flag in `getInstance()` and recreate if needed
- Add `isValid()` method for external validation

### Layer 2: Player Defensive Validation
- Add `ensureAudioContextValid()` method to all players
- Validate AudioContext before/after stop()
- Add try-catch with auto-recovery in speak()

### Layer 3: Smart Disposal
- Players don't dispose shared AudioContext
- Singleton getter checks validity before reusing player
- TestAudioStreamPage adds debouncing (50ms) between provider switches

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/audio/AudioContextManager.ts` | Fix getInstance(), add isValid(), fix dispose() |
| `src/services/audio/OpenAIStreamingPlayer.ts` | Add ensureAudioContextValid(), update speak/dispose/singleton |
| `src/services/audio/CartesiaStreamingPlayer.ts` | Same as OpenAI |
| `src/services/audio/DeepgramStreamingPlayer.ts` | Same as OpenAI |
| `src/screens/TestAudioStreamPage.tsx` | Add 50ms debouncing to provider switch |

---

## Quick Implementation Guide

### 1. AudioContextManager.ts

**Fix getInstance() (line 81):**
```typescript
static getInstance(config?: Partial<AudioContextConfig>): AudioContextManager {
  // Reset if destroyed
  if (AudioContextManager.instance?.isDestroyed) {
    console.log('[AudioContextManager] Resetting destroyed singleton');
    AudioContextManager.instance = null;
  }

  if (!AudioContextManager.instance) {
    AudioContextManager.instance = new AudioContextManager(config);
  }

  return AudioContextManager.instance;
}
```

**Add isValid() (after line 372):**
```typescript
isValid(): boolean {
  return !this.isDestroyed;
}
```

**Fix dispose() (line 379):**
```typescript
async dispose(): Promise<void> {
  if (this.isDestroyed) return;

  this.stopAll();
  if (this.context) {
    await this.context.close();
    this.context = null;
  }

  this.gainNode = null;
  this.isInitialized = false;
  this.isDestroyed = true;

  // Reset singleton
  if (AudioContextManager.instance === this) {
    AudioContextManager.instance = null;
  }
}
```

---

### 2. OpenAIStreamingPlayer.ts (Apply to all players)

**Add method (after line 245):**
```typescript
private ensureAudioContextValid(): void {
  if (!this.audioContext.isValid()) {
    console.log('[OpenAIStreamingPlayer] Recreating AudioContext');
    this.audioContext = AudioContextManager.getInstance({
      sampleRate: this.config.sampleRate,
      initialGain: this.config.initialGain,
    });
  }
}
```

**Update speak() (line 269):**
```typescript
// Before stop()
this.ensureAudioContextValid();

this.stop();

// After setState(CONNECTING)
this.ensureAudioContextValid();

// Wrap initialize in try-catch
try {
  if (!this.audioContext.isReady()) {
    await this.audioContext.initialize();
  }
} catch (error) {
  if (error.message.includes('destroyed')) {
    this.ensureAudioContextValid();
    await this.audioContext.initialize();
  } else {
    throw error;
  }
}
```

**Update dispose() (line 902):**
```typescript
async dispose(): Promise<void> {
  this.stop();
  // Don't dispose shared AudioContext
  this.eventListeners.clear();
  this.scheduledSources.clear();
}
```

**Update singleton getter (line 917):**
```typescript
export function getOpenAIStreamingPlayer(...): OpenAIStreamingPlayer {
  const needsRecreation = singletonInstance &&
    !singletonInstance['audioContext'].isValid();

  if (needsRecreation) {
    singletonInstance = null;
  }

  if (!singletonInstance) {
    singletonInstance = new OpenAIStreamingPlayer(apiKey, config);
  }

  return singletonInstance;
}
```

---

### 3. TestAudioStreamPage.tsx

**Add debouncing (line 121):**
```typescript
useEffect(() => {
  if (playerRef.current) {
    playerRef.current.stop();
  }

  // 50ms delay for cleanup
  const switchTimeout = setTimeout(() => {
    try {
      let player = /* create player based on provider */;
      playerRef.current = player;
      // ... event listeners ...
    } catch (error) {
      console.error('Error creating player:', error);
    }
  }, 50);

  return () => clearTimeout(switchTimeout);
}, [ttsProvider, ...]);
```

---

## Testing Checklist

- [ ] Rapid provider switching (5-10 times)
- [ ] Play during provider switch
- [ ] Rapid stop/play (10 times)
- [ ] Multiple consecutive plays (5 times)
- [ ] Check console for auto-recovery logs
- [ ] No "AudioContextManager has been destroyed" errors

---

## Expected Console Output (Success)

```
[AudioContextManager] getInstance: Detected destroyed instance, resetting singleton
[AudioContextManager] getInstance: Creating new instance
[OpenAIStreamingPlayer] AudioContext destroyed, recreating...
✅ No errors
```

---

## Implementation Order

1. Fix AudioContextManager (30 min) - **CRITICAL**
2. Fix OpenAIStreamingPlayer (20 min)
3. Fix Cartesia & Deepgram (30 min)
4. Add TestAudioStreamPage debouncing (10 min)
5. Final testing (20 min)

**Total:** ~2 hours

---

## Related Issues

This fix is separate from the 0-sample bug in `OPENAI_TTS_0_SAMPLE_BUG_FIX.md`.

**Both fixes are needed** for OpenAI TTS to work correctly:
- **This fix:** Provider switching crashes
- **0-sample fix:** Buffer chunking issues

---

## Status

**Created:** 2026-02-07
**Status:** Ready for implementation
**Priority:** HIGH (blocks provider switching in TestAudioStreamPage)
