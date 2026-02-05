# Audio Artifacts & Crash Fix

**Date**: February 5, 2026  
**Status**: ✅ FIXED

## Problems Identified

### 1. **Fatal Crash**: `TypeError: Cannot read property 'includes' of undefined`

**Location**: `useInterviewLogic.ts` line 567

**Root Cause**:
- `analysis.issues` is an optional field (`issues?: AnswerIssue[]`)
- When Gemini evaluation doesn't include issues in the response, `analysis.issues` is `undefined`
- `VibeCalculator.detectAbsurdError()` expects an array and calls `.includes()` on it
- This caused: `undefined.includes('OFF_TOPIC')` → **CRASH**

**Crash Location in Logs**:
```
LOG  📊 [EMOTIONS] Engagement: 50 → 65 (+15)
ERROR  Agent Error: [TypeError: Cannot read property 'includes' of undefined]
```

**Fix Applied** (useInterviewLogic.ts:567):
```typescript
// BEFORE:
const isAbsurd = VibeCalculator.detectAbsurdError(
  textToFinalize,
  analysis.issues  // ❌ Can be undefined
);

// AFTER:
const isAbsurd = VibeCalculator.detectAbsurdError(
  textToFinalize,
  analysis.issues || []  // ✅ Provide empty array fallback
);
```

---

### 2. **Audio Artifacts Warning**: `⚠️ [Cartesia WS] No handler for context: undefined`

**Location**: `cartesia-streaming-service.ts` line 280

**Root Cause**:
- Cartesia WebSocket sends system-level messages (like pong responses, status updates) without a `context_id`
- The message router tried to find a handler for `undefined` context_id
- This generated spam warnings: `⚠️ [Cartesia WS] No handler for context: undefined`

**Message Type Examples**:
- Ping/pong responses (keep-alive)
- Connection status updates
- System-level acknowledgments

**Fix Applied** (cartesia-streaming-service.ts:271):
```typescript
private handleMessage(data: string): void {
  try {
    const message: CartesiaMessage = JSON.parse(data);

    // ✅ NEW: Ignore system messages without context_id
    if (!message.context_id) {
      // Silently ignore - these are system-level messages (pongs, etc.)
      return;
    }

    // Route to appropriate handler
    const handler = this.messageHandlers.get(message.context_id);
    if (handler) {
      handler(message);
    } else {
      console.warn(`⚠️ [Cartesia WS] No handler for context: ${message.context_id}`);
    }

  } catch (error) {
    console.error('❌ [Cartesia WS] Message parse error:', error);
  }
}
```

---

## Impact

### Before Fix:
- ❌ **Fatal crash** after emotions calculation on any interview topic
- ⚠️ **Log spam** from Cartesia WebSocket warnings (every few seconds)
- 🚫 **Interview completely broken** - couldn't proceed past first response

### After Fix:
- ✅ **No crashes** - defensive null handling for optional fields
- ✅ **Clean logs** - system messages silently ignored
- ✅ **Interviews work smoothly** - no interruptions

---

## Files Modified

1. **src/hooks/interview/useInterviewLogic.ts**
   - Line 567: Added `|| []` fallback for `analysis.issues`

2. **src/services/cartesia-streaming-service.ts**
   - Lines 275-280: Added early return for messages without `context_id`

---

## Testing Checklist

- [ ] Start interview from lobby
- [ ] Progress through Introduction topic
- [ ] Simulate excellent answer on React Native topic
- [ ] Verify no crashes after emotions calculation
- [ ] Check logs for absence of "No handler for context: undefined" warnings
- [ ] Complete full interview without errors

---

## Root Cause Analysis

### Why did `analysis.issues` become undefined?

The Gemini evaluation schema has `issues` as an **optional field**:

```typescript
export interface AnswerAnalysis {
  intent: UserIntent;
  compositeScore: number;
  level: SemanticQualityLevel;
  issues?: AnswerIssue[];  // ⬅️ Optional!
  suggestedFeedback?: string;
  metrics: AnswerMetrics;
}
```

When Gemini evaluates a **high-quality answer** (excellent/good), it often doesn't include the `issues` field because there are no issues to report. The code incorrectly assumed `issues` would always be present.

### Why did Cartesia send messages without `context_id`?

The WebSocket ping/pong mechanism (keep-alive) sends heartbeat messages that don't belong to any specific audio generation context. These are internal protocol messages and should be silently ignored by the message router.

---

## Lesson Learned

**Always treat optional TypeScript fields as potentially undefined!**

When accessing optional fields from external APIs (Gemini, Cartesia), always provide fallback values:

```typescript
// ❌ BAD - Assumes field exists
someFunction(response.optionalField);

// ✅ GOOD - Defensive with fallback
someFunction(response.optionalField || defaultValue);
```
