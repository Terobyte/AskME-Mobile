# AudioContextManager Lifecycle Fix - Testing Guide

## Quick Start

**What to test:** Provider switching and rapid stop/play cycles in TestAudioStreamPage

**Expected outcome:** No "AudioContextManager has been destroyed" errors

**Time required:** ~10 minutes

---

## Setup

1. **Start the app:**
   ```bash
   npm start
   npm run ios  # or npm run android
   ```

2. **Navigate to TestAudioStreamPage** (add navigation if not already in app)

3. **Open console logs** to monitor behavior

---

## Test Suite

### Test 1: Rapid Provider Switching ⭐ (CRITICAL)

**Objective:** Verify no crashes when rapidly switching TTS providers

**Steps:**
1. Open TestAudioStreamPage
2. Rapidly switch providers: Cartesia → OpenAI → Deepgram → Cartesia
3. Repeat 5-10 times quickly
4. Try different patterns (Cartesia ↔ OpenAI, OpenAI ↔ Deepgram)

**Expected Results:**
- ✅ No "AudioContextManager has been destroyed" errors
- ✅ Provider switches complete without crashes
- ✅ Console shows auto-recovery logs:
  ```
  [AudioContextManager] getInstance: Detected destroyed instance, resetting singleton
  [AudioContextManager] getInstance: Creating new instance
  [OpenAI Singleton] Creating new player instance
  ```

**Failure Indicators:**
- ❌ Error: "AudioContextManager has been destroyed"
- ❌ App crashes
- ❌ UI freezes

---

### Test 2: Provider Switch During Playback

**Objective:** Verify graceful handling when switching providers mid-playback

**Steps:**
1. Select Cartesia provider
2. Click "Long Text" to start playback
3. While audio is playing, switch to OpenAI provider
4. Immediately click "Short Text" on OpenAI
5. Switch back to Cartesia mid-playback

**Expected Results:**
- ✅ Previous audio stops immediately
- ✅ New provider starts playing without errors
- ✅ No audio artifacts or glitches
- ✅ Console shows proper state transitions:
  ```
  [CartesiaStreamingPlayer] Stopping
  [TestAudioStreamPage] Stopping previous player
  [OpenAI Singleton] Creating new player instance
  [OpenAIStreamingPlayer] Audio context initialized
  ```

**Failure Indicators:**
- ❌ Audio continues playing after switch
- ❌ Multiple audio streams playing simultaneously
- ❌ AudioContext destroyed errors

---

### Test 3: Rapid Stop/Play Cycles

**Objective:** Verify player handles rapid stop/play without issues

**Steps:**
1. Select any provider (e.g., OpenAI)
2. Click "Short Text" → immediately click Stop
3. Click "Short Text" again → immediately click Stop
4. Repeat 10 times rapidly
5. Try with different text lengths (Short, Medium, Long)

**Expected Results:**
- ✅ No crashes or errors
- ✅ Audio stops immediately on Stop button
- ✅ Audio plays correctly every time
- ✅ Player state transitions correctly (idle → connecting → playing → stopped)

**Failure Indicators:**
- ❌ AudioContext destroyed errors
- ❌ Player gets stuck in connecting/buffering state
- ❌ Stop button doesn't work

---

### Test 4: Multiple Consecutive Plays

**Objective:** Verify repeated playback without provider switching

**Steps:**
1. Select OpenAI provider
2. Click "Short Text" 5 times in a row (wait for each to complete)
3. Click "Medium Text" 3 times in a row
4. Try rapid clicks (don't wait for completion)

**Expected Results:**
- ✅ All plays complete successfully
- ✅ No degradation in quality or performance
- ✅ Metrics show consistent behavior
- ✅ Buffer health remains stable

**Failure Indicators:**
- ❌ Playback fails after 2-3 attempts
- ❌ Audio quality degrades
- ❌ Memory leaks (check React DevTools)

---

### Test 5: Cross-Provider Verification

**Objective:** Verify fix works for all three providers

**Steps:**
1. **Cartesia Test:**
   - Select Cartesia
   - Play Short/Medium/Long text
   - Verify successful playback

2. **OpenAI Test:**
   - Switch to OpenAI
   - Play Short/Medium/Long text
   - Verify successful playback

3. **Deepgram Test:**
   - Switch to Deepgram
   - Play Short/Medium/Long text
   - Verify successful playback

4. **Round-robin:**
   - Cartesia → OpenAI → Deepgram → Cartesia
   - Play text on each provider
   - No errors

**Expected Results:**
- ✅ All three providers work correctly
- ✅ No provider-specific issues
- ✅ Switching between any pair works seamlessly

---

### Test 6: Console Log Verification

**Objective:** Verify proper logging and auto-recovery behavior

**Steps:**
1. Open browser console (for Expo web) or Metro bundler logs
2. Switch providers while watching logs
3. Look for specific patterns

**Expected Logs (Success):**

```
[TestAudioStreamPage] Stopping previous player
[CartesiaStreamingPlayer] Stopping
[AudioContextManager] getInstance: Detected destroyed instance, resetting singleton
[AudioContextManager] getInstance: Creating new instance
[OpenAI Singleton] Creating new player instance
[OpenAIStreamingPlayer] AudioContext destroyed, recreating...
[AudioContextManager] Initialized:
[AudioContextManager]   Requested sampleRate: 16000
[AudioContextManager]   Actual sampleRate: 16000Hz
[OpenAIStreamingPlayer] Audio context initialized
```

**Failure Logs:**

```
❌ ERROR [OpenAIStreamingPlayer] Error: AudioContextManager has been destroyed
❌ [AudioContextManager] initialize: Cannot initialize destroyed instance
```

---

### Test 7: Memory Leak Check

**Objective:** Verify no memory leaks from singleton resets

**Steps:**
1. Open React DevTools Profiler (if available)
2. Switch providers 20+ times
3. Monitor memory usage
4. Check for accumulating instances

**Expected Results:**
- ✅ Memory usage remains stable
- ✅ No accumulation of AudioContextManager instances
- ✅ Singleton properly resets each time

**Failure Indicators:**
- ❌ Memory usage increases linearly
- ❌ Multiple AudioContext instances exist
- ❌ App becomes sluggish after many switches

---

### Test 8: Edge Cases

**Objective:** Verify robustness in unusual scenarios

**Steps:**

1. **Switch Before First Play:**
   - Open page
   - Switch providers 3-4 times WITHOUT playing
   - Then click play
   - Should work without errors

2. **Switch During Buffering:**
   - Click play
   - Immediately switch provider (before audio starts)
   - Should abort cleanly

3. **Rapid Play Different Texts:**
   - Click "Short Text"
   - Immediately click "Long Text" (before short finishes)
   - Should queue correctly or abort previous

4. **Provider Switch Spam:**
   - Click through all providers as fast as possible
   - Should handle gracefully without crashes

**Expected Results:**
- ✅ All edge cases handled without errors
- ✅ No undefined behavior
- ✅ Proper state cleanup

---

## Success Criteria Summary

### Must Pass (Critical)

- ✅ **Test 1:** Rapid provider switching works
- ✅ **Test 2:** Provider switch during playback works
- ✅ **Test 3:** Rapid stop/play cycles work
- ✅ **Test 6:** Console logs show auto-recovery

### Should Pass (Important)

- ✅ **Test 4:** Multiple consecutive plays work
- ✅ **Test 5:** All three providers work correctly
- ✅ **Test 7:** No memory leaks

### Nice to Have (Optional)

- ✅ **Test 8:** Edge cases handled gracefully

---

## Debugging Failed Tests

### If Test 1 Fails (Rapid Switching)

**Possible causes:**
1. AudioContextManager.getInstance() not resetting destroyed instance
2. Player dispose() still destroying shared context
3. TestAudioStreamPage not debouncing properly

**Debug steps:**
1. Check console for "getInstance: Detected destroyed instance" logs
2. Verify dispose() logs show "Skipping AudioContext disposal"
3. Add more logging to getInstance() to see execution flow

---

### If Test 2 Fails (Switch During Playback)

**Possible causes:**
1. Player.stop() not cleaning up properly
2. Event listeners not being removed
3. AudioContext state not resetting

**Debug steps:**
1. Check for multiple audio streams playing
2. Verify stop() logs show proper cleanup
3. Check AudioContext state transitions

---

### If Test 3 Fails (Rapid Stop/Play)

**Possible causes:**
1. Debounce delay too short (200ms minimum)
2. ensureAudioContextValid() not being called
3. Race condition in speak() method

**Debug steps:**
1. Increase MIN_RESTART_DELAY_MS to 300ms
2. Add logging to ensureAudioContextValid()
3. Verify validation happens before AND after stop()

---

### If Test 6 Fails (Console Logs)

**Possible causes:**
1. Logging statements not added correctly
2. Wrong log level configuration
3. Console filtering too aggressive

**Debug steps:**
1. Verify all logging statements are present
2. Check console filter settings
3. Look in Metro bundler logs instead

---

### If Test 7 Fails (Memory Leaks)

**Possible causes:**
1. Singleton not resetting properly
2. Event listeners not being removed
3. AudioContext instances accumulating

**Debug steps:**
1. Use React DevTools Profiler
2. Check AudioContextManager.instance in console
3. Add logging to track instance creation/destruction

---

## Performance Benchmarks

### Expected Metrics

**First Playback Latency:**
- Cartesia: ~500ms
- OpenAI: ~600ms
- Deepgram: ~550ms

**Provider Switch Time:**
- < 100ms (with 50ms debounce)

**Memory Usage:**
- Stable at ~50-80MB
- No growth after 20+ switches

**Buffer Health:**
- > 80% during normal playback
- No persistent underruns

---

## Reporting Issues

If tests fail, report with:

1. **Test number and name**
2. **Provider(s) involved**
3. **Exact error message**
4. **Console logs (full output)**
5. **Steps to reproduce**
6. **Device/platform (iOS, Android, Web)**

Example:
```
Test 1 Failed: Rapid Provider Switching
Provider: Cartesia → OpenAI
Error: AudioContextManager has been destroyed
Console: [see attached logs]
Steps: Switched providers 3 times rapidly
Platform: iOS Simulator 17.0
```

---

## Next Steps After Testing

### If All Tests Pass ✅

1. Mark fix as verified
2. Update CLAUDE.md with new singleton pattern
3. Document in memory (MEMORY.md)
4. Consider deploying to production

### If Tests Fail ❌

1. Review implementation against plan
2. Check for typos or missing changes
3. Verify all 5 files were modified correctly
4. Consider gradual rollback strategy

---

## Conclusion

This comprehensive test suite validates the AudioContextManager lifecycle fix. Successful completion of all critical tests (1-3, 6) indicates the fix is working correctly and ready for production use.

**Estimated testing time:** 10-15 minutes
**Required tools:** TestAudioStreamPage, console logs
**Success rate needed:** 100% on critical tests
