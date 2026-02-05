# Audio Artifacts Fix - Word Boundary Aware Chunking

**Date**: February 5, 2026  
**Status**: ✅ FIXED

## Problem Description

Audio artifacts were heard on specific words during Victoria's speech:
- **"have"** - end of sentence
- **"know"** - end of sentence  
- **"Native"** - in "React Native"
- **"software"** - in "software development"
- **"Performance", "mmkv"** - in long sentence

These artifacts manifested as:
- Stuttering/repeating syllables
- Clicks/pops between words
- Unnatural pauses mid-phrase

---

## Root Cause Analysis

### Problem 1: FAST_START Mode Ignored Word Boundaries

**Before**: FAST_START mode created audio files every 25 chunks (~1.25 seconds) **regardless of word boundaries**.

```
File 1: "...React"   ← Ends mid-phrase!
File 2: "Native..."  ← Starts mid-phrase!
```

This caused "React" and "Native" to be in **separate audio files** with a transition in between.

### Problem 2: Micro-Pause Added to ALL Non-Crossfade Transitions

**Before**: When crossfade was skipped (no punctuation), a 20ms micro-pause was added between files.

```typescript
// OLD CODE (line 283-285):
if (!usedCrossfade && next) {
    console.log(`⏸️ Adding 20ms micro-pause (no crossfade)`);
    await new Promise(resolve => setTimeout(resolve, this.MICRO_PAUSE_MS));
}
```

For mid-word transitions like "React|Native", this 20ms pause created audible artifacts!

---

## Solution

### Fix 1: Word-Boundary Aware FAST_START (streaming-audio-player.ts)

FAST_START now uses timestamps to find word boundaries:

```typescript
// NEW CODE: Smart FAST_START with word boundary detection
if (minChunksReached) {
    if (this.hasReceivedTimestamps && this.incomingTimestamps.length > 0) {
        // Find last complete word based on accumulated audio duration
        const currentAudioTimeSeconds = this.totalAudioDurationMs / 1000;
        
        for (let i = 0; i < this.incomingTimestamps.length; i++) {
            if (this.incomingTimestamps[i].end <= currentAudioTimeSeconds + 0.1) {
                lastCompleteWordIndex = i;
            }
        }
        
        if (lastCompleteWordIndex >= 0) {
            const lastWord = this.incomingTimestamps[lastCompleteWordIndex];
            lastWordBoundary = lastWord.word;
            shouldCreateFile = true;
            
            console.log(`🎯 [FAST_START] Word boundary: "${lastWord.word}"`);
        }
    }
}
```

### Fix 2: Pseudo-Sentence Metadata for FAST_START Files

FAST_START files now include sentence metadata with the last word:

```typescript
// NEW: Create pseudo-sentence metadata for crossfade decisions
let sentenceChunk: SentenceChunk | undefined = undefined;
if (lastWordBoundary) {
    sentenceChunk = {
        sentence: `...${lastWordBoundary}`, // Mark as partial with last word
        durationMs: duration,
        wordCount: 1
    };
}

await this.audioQueue.enqueue(filepath, sentenceChunk, duration);
```

### Fix 3: Gapless Transition for Mid-Word Boundaries

Removed 20ms micro-pause for word boundaries without punctuation:

```typescript
// NEW: Gapless transition logic
if (!usedCrossfade && next) {
    if (!currentChunk?.sentenceChunk) {
        // Force flush case - add micro-pause for safety
        console.log(`⏸️ Adding 20ms micro-pause (force flush)`);
        await new Promise(resolve => setTimeout(resolve, this.MICRO_PAUSE_MS));
    } else {
        // Word boundary without punctuation - GAPLESS transition
        console.log(`🔗 Gapless transition (no punctuation, no pause)`);
    }
}
```

---

## Expected Behavior After Fix

### Before:
```
📦 [FAST_START] File #1: 3474ms (1/2)
📦 [FAST_START] File #2: 3483ms (2/2)
⏸️ [AudioQueue] Adding 20ms micro-pause (no crossfade)
```
**Result**: Artifact on "React|Native"

### After:
```
🎯 [FAST_START] Word boundary: "Native." at 3.50s (punctuation: true)
📦 [FAST_START] File #1: 3500ms (1/2) [→"Native."]
✅ [Crossfade] Natural pause detected ("Native."), using crossfade

OR

🎯 [FAST_START] Word boundary: "Native" at 3.50s (punctuation: false)
📦 [FAST_START] File #1: 3500ms (1/2) [→"Native"]
🔗 [AudioQueue] Gapless transition (no punctuation, no pause)
```
**Result**: Clean transition

---

## Files Modified

1. **src/services/streaming-audio-player.ts**
   - Lines 690-784: FAST_START now uses word boundaries from timestamps
   - Lines 281-295: Micro-pause only for force-flush, gapless for word boundaries

---

## Testing Checklist

- [ ] Start interview, listen to Victoria's intro
- [ ] Check for artifacts on "React Native" phrase
- [ ] Check for artifacts on "software development" phrase
- [ ] Check for artifacts on sentence endings ("know", "have")
- [ ] Check console for new logs:
  - `🎯 [FAST_START] Word boundary: "..."` 
  - `🔗 [AudioQueue] Gapless transition`
- [ ] Verify no new latency issues (first audio within ~1s)

---

## Transition Logic Summary

| Scenario | Crossfade | Micro-Pause | Transition Type |
|----------|-----------|-------------|-----------------|
| Sentence end (. ! ?) | ✅ 40-120ms | ❌ | Smooth fade |
| Comma/semicolon (,;) | ✅ 40ms | ❌ | Quick fade |
| Word without punctuation | ❌ | ❌ | Gapless |
| Force flush (no metadata) | ❌ | ✅ 20ms | Safety pause |
