# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AskME-Mobile** is a React Native (Expo) voice interview simulator that conducts technical job interviews using AI. The app features "Victoria" - an AI interviewer with dynamic emotional states that adapts her responses based on candidate performance.

**Tech Stack:**
- React Native 0.81.5 with Expo ~54.0
- TypeScript
- React Navigation (Stack Navigator)
- Google Gemini 2.5 Flash/Pro (interview planning, answer evaluation, voice generation)
- Cartesia Sonic (streaming TTS with emotional voices)
- OpenAI TTS (gpt-4o-mini-tts with 13 voices + instructions)
- Deepgram TTS (streaming with Aura voices)
- **react-native-audio-api** (streaming audio engine)
- Expo Audio (legacy streaming audio player - being phased out)

## Development Commands

```bash
# Start development server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android

# Run on web
npm run web
```

**Important:** This app uses React Native New Architecture enabled by default in app.json.

## Environment Variables

Required in `.env`:
- `EXPO_PUBLIC_GEMINI_API_KEY` - Google Gemini API key
- `EXPO_PUBLIC_CARTESIA_API_KEY` - Cartesia TTS API key

## Core Architecture

### Interview Flow

The interview follows this sequence:
1. **Planning** (`interview-planner.ts`) - Gemini analyzes resume + JD, generates question queue
2. **Interview Loop** (`VoiceInterviewScreen.tsx`) - Victoria asks questions, user answers
3. **Analysis** (`gemini-agent.ts`) - User's answer is evaluated for quality
4. **Voice Generation** (`tts-service.ts`) - Victoria's response is converted to speech
5. **Audio Playback** (`streaming-audio-player.ts`) - Real-time streaming with smart cross-fade

### Key Services

**`src/services/`:**

- **`gemini-agent.ts`** - The brain of the interview
  - `generateUserSimulator()` - Simulates user answers for testing
  - `evaluateAnswer()` - Scores user answers 0-10 with detailed metrics
  - `generateVictoriaVoice()` - Creates Victoria's spoken responses
  - Uses `gemini-2.5-flash` (DO NOT change to 1.5, will break)

- **`interview-planner.ts`** - Creates interview plan from resume/JD
  - Calls Gemini 2.5 Pro for resume analysis
  - Generates categorized questions (matches, gaps, soft skills, cool skills)
  - Supports PDF resumes via `inlineData` API

- **`tts-service.ts`** - Text-to-speech orchestration
  - Primary: Cartesia streaming WebSocket with emotions
  - Secondary: OpenAI TTS (gpt-4o-mini-tts with 13 voices, default: 'marin' + Professional instructions)
  - Tertiary: Deepgram TTS (Aura voices, default: 'thalia-energetic')
  - Voice UI: Minimal (no voice/style selection displayed - matches Cartesia)

- **`streaming-audio-player.ts`** - Custom audio playback engine (Expo Audio - LEGACY)
  - Handles Cartesia WebSocket streaming (PCM16 chunks)
  - Smart cross-fade: only at sentence boundaries (punctuation detection)
  - Adaptive cross-fade duration: 40ms (short files) vs 120ms (long files)
  - Micro-pause (20ms) when no cross-fade to prevent words "sticking"
  - **NOTE**: Being replaced by react-native-audio-api engine

- **`audio/CartesiaStreamingPlayer.ts`** - Streaming audio engine (react-native-audio-api)
  - TRUE streaming: plays chunks as they arrive (no accumulation)
  - Architecture: WebSocket → Int16ToFloat32Converter → FIFOQueue → JitterBuffer → ZeroCrossingAligner → AudioContextManager
  - Pre-buffering: 300ms threshold before playback starts
  - Comprehensive metrics: latency, underruns, buffer health, chunks/sec
  - State machine: IDLE → CONNECTING → BUFFERING → PLAYING → DONE/ERROR
  - Event-driven: 'connecting', 'connected', 'playing', 'done', 'underrun', 'error', 'metrics'

- **`audio/OpenAIStreamingPlayer.ts`** - OpenAI TTS streaming player
  - Fake streaming: downloads entire file then chunks (not true WebSocket)
  - Same pipeline architecture as CartesiaStreamingPlayer
  - Uses 'marin' voice with Professional instructions by default

- **`audio/DeepgramStreamingPlayer.ts`** - Deepgram TTS streaming player
  - WebSocket streaming similar to Cartesia
  - Uses 'thalia-energetic' voice by default
  - Same pipeline architecture for consistency

- **`audio/CartesiaAudioAdapter.ts`** - V1 adapter (DEPRECATED - fake streaming)
  - Accumulated all chunks before playing (not true streaming)
  - Use `CartesiaStreamingPlayer` instead

- **`cartesia-streaming-service.ts`** - WebSocket connection management
  - Real-time streaming with word timestamps
  - Automatic retry logic (3 attempts)

- **`vibe-calculator.ts`** - Victoria's emotional state machine
  - Maps anger (0-100) + engagement (0-100) → 15 emotional states
  - Each state has: Cartesia emotion, speech speed, voice prompt modifier

- **`sentence-chunker.ts`** - Splits PCM audio at sentence boundaries
  - Uses word timestamps from Cartesia API
  - Critical for natural cross-fade on long responses

- **`history-storage.ts`** - Persistent interview history
- **`favorites-storage.ts`** - Bookmarked questions/answers

### Type System

**`src/types.ts`** - Central type definitions:

**Core Interview Types:**
- `InterviewMode`: 'short' | 'medium' | 'long' | 'freestyle'
- `InterviewTopic`: Single interview question with context
- `InterviewPlan`: Queue of topics with metadata
- `QuestionResult`: User's answer with score/feedback

**Enhanced Evaluation Types:**
- `QualityLevel`: 'excellent' | 'good' | 'mediocre' | 'poor' | 'fail'
- `UserIntent`: 'STRONG_ATTEMPT' | 'WEAK_ATTEMPT' | 'CLARIFICATION' | 'GIVE_UP' | 'SHOW_ANSWER_STAY' | 'SHOW_ANSWER_PREVIOUS' | 'NONSENSE' | 'READY_CONFIRM'
- `AnalysisResponse`: Multi-dimensional evaluation with composite score (0-10)

**Emotion System Types:**
- `VibeLabel`: 15 emotional states (Impressed, Encouraging, Professional, Neutral, Curious, Concerned, Disappointed, Skeptical, Amused, Irritated, Frustrated, Hostile, Dismissive, Furious)
- `CartesiaEmotion`: Emotions supported by Cartesia API
- `VibeConfig`: Maps vibe to TTS parameters

**Audio Types:**
- `AudioChunk`: Single PCM chunk from WebSocket stream
- `SentenceChunk`: PCM data for one sentence with metadata
- `StreamingPlayerState`: Player state machine
- `CartesiaStreamingOptions`: WebSocket generation options
- `PlayerState`: CartesiaStreamingPlayer state (IDLE, CONNECTING, BUFFERING, PLAYING, PAUSED, STOPPED, DONE, ERROR)
- `PlayerMetrics`: Comprehensive metrics for streaming player

## Audio Architecture Migration

### Current State (Phase 2.5 - Engine Assembly)

The project is transitioning from Expo Audio to **react-native-audio-api** for streaming:

```
OLD: streaming-audio-player.ts (Expo Audio)
NEW: CartesiaStreamingPlayer.ts (react-native-audio-api)
```

### Streaming Audio Engine Architecture

The new engine uses a pipeline approach:

```
Cartesia WebSocket (PCM16)
         ↓
Int16ToFloat32Converter (PCM16 → Float32)
         ↓
FIFOQueue (chunk ordering)
         ↓
JitterBuffer (pre-buffer 300ms threshold)
         ↓
ZeroCrossingAligner (artifact-free boundaries)
         ↓
AudioContextManager (Web Audio API playout)
```

### Low-Level Audio Utilities (`src/utils/audio/`)

All components are complete and ready for integration:

| Component | Status | Purpose |
|-----------|--------|---------|
| `Int16ToFloat32Converter.ts` | ✅ COMPLETE | PCM16 → Float32 conversion |
| `CircularBuffer.ts` | ✅ COMPLETE | O(1) ring buffer |
| `FIFOQueue.ts` | ✅ COMPLETE | Chunk ordering for WebSocket |
| `JitterBuffer.ts` | ✅ COMPLETE | Pre-buffering, underrun handling |
| `ZeroCrossingAligner.ts` | ✅ COMPLETE | Click/pop prevention |
| `AudioContextManager.ts` | ✅ COMPLETE | Web Audio API wrapper |

### Testing

Use **`TestAudioStreamPage.tsx`** to test the new engine:
- Real-time metrics (Buffer %, Latency, Underruns, Chunks/sec)
- Short/Medium/Long text tests
- Event logs with color coding
- Buffer health visualization

## Important Implementation Details

### Audio Cross-Fade System (Expo Audio - Legacy)

The app uses intelligent cross-fade to eliminate audio artifacts:
- **Cross-fade only at punctuation** (., !, ?, ;, :) - prevents cutting off mid-word
- **Adaptive duration**: 40ms for files <1s, 120ms for files >2s
- **Micro-pause**: 20ms pause when no cross-fade (prevents words from "sticking")
- **Force flush**: Files without sentence metadata skip cross-fade (safer)

See: `AUDIO_CROSSFADE_FIX.md` for full implementation details.

### TTS Provider Configuration

The app supports three TTS providers with different capabilities:

| Provider | Streaming | Voices | Default Voice | Instructions | Emotion |
|----------|-----------|--------|---------------|--------------|---------|
| Cartesia | ✅ True WebSocket | 6 emotional | depends on vibe | ✅ Prompt modifier | ✅ Full emotion control |
| OpenAI | ❌ Fake (download all) | 13 total | marin | Professional tone | ❌ No emotion support |
| Deepgram | ✅ True WebSocket | Aura series | thalia-energetic | ❌ No instructions | ⚠️ Limited emotion |

**OpenAI Voices:** alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin (default, highest quality)

**Deepgram Aura Voices:** aura-asteria-en, aura-athena-en, aura-hera-en, aura-orion-en, aura-perseus-en, aura-stella-en, aura-zeus-en, thalia-energetic (default), thalia-neutral, thalia-positive

### Gemini Model Versions

**CRITICAL:** Two different Gemini models are used:
- **gemini-2.5-flash**: Used in `gemini-agent.ts` for real-time operations (evaluation, voice generation)
- **gemini-2.5-pro**: Used in `interview-planner.ts` for resume analysis

DO NOT change these models. Version 1.5 will break the app.

### PDF Resume Support

Resumes can be provided as:
1. Plain text string (legacy)
2. `ResumeData` object with PDF:
   - `pdfUri`: Local file path
   - `pdfBase64`: Base64-encoded PDF for inlineData API
   - `usePdfDirectly`: true to use PDF upload

The system automatically chooses inlineData upload for PDFs under Gemini's size limit.

### Interview State Management

The main screen (`VoiceInterviewScreen.tsx`) manages:
- Interview queue (current topic, previous topics)
- Victoria's emotional state (anger, engagement, vibe)
- Audio playback state (playing, paused, buffering)
- User input (recording, transcribing)

Key states:
- `interviewPlan`: The full interview queue
- `queueIndex`: Current position in queue
- `angerLevel`: 0-100 (increases with nonsense/weak answers)
- `patienceLevel`: 0-100 (decreases with repeated weak attempts)
- `engagementLevel`: 0-100 (dynamic based on answer quality)

### Voice Generation Context

Victoria's voice adapts based on:
- Current topic (technical vs soft skill vs intro)
- User's last answer quality (strong vs weak attempt)
- Emotional state (anger, engagement)
- Transition mode (stay on topic, next pass, next fail, explain, finish)

Example transitions:
- `NEXT_PASS`: Strong answer → move to next topic
- `STAY`: Weak attempt but trying → stay on topic, rephrase
- `NEXT_EXPLAIN`: User shows answer → educational moment
- `TERMINATE_ANGER`: Anger reaches 100 → end interview

## Testing Guidelines

### Manual Testing Checklist

When testing audio features:
1. Verify cross-fade at sentence boundaries (should be smooth)
2. Verify micro-pause between words (no "sticking")
3. Test force flush scenarios (no artifacts)
4. Check emotional voice changes (anger, engagement)

See: `.agent/smart_crossfade_testing_checklist.md` for detailed testing scenarios.

### Debugging

The app has extensive console logging:
- `[Crossfade]` - Cross-fade decisions
- `[AudioQueue]` - Queue management and scheduling
- `[StreamingPlayer]` - Streaming state and metrics
- `[CartesiaStreaming]` - WebSocket events
- `[Victoria]` - Voice generation context

## Known Issues & Fixes

Documented in markdown files in `.agent/` folder:
- `AUDIO_CROSSFADE_FIX.md` - Cross-fade implementation details
- `CHUNK_SIZE_INCREASE_FIX.md` - Chunk size optimization
- `FORCE_FLUSH_ARTIFACTS_FIX.md` - Force flush audio issues
- `HISTORY_FIX.md` - History storage fixes
- `HISTORY_MICROPHONE_FIX.md` - Microphone permission issues
- `CARTESIA_PLAYER_BUG_FIX_PATCH.md` - Cartesia player fixes

## File Structure Highlights

```
src/
├── screens/
│   ├── VoiceInterviewScreen.tsx    # Main interview UI (41KB)
│   └── TestAudioStreamPage.tsx     # Audio engine test page
├── services/
│   ├── audio/
│   │   ├── CartesiaStreamingPlayer.ts  # Cartesia streaming engine (react-native-audio-api)
│   │   ├── OpenAIStreamingPlayer.ts    # OpenAI streaming player (fake streaming)
│   │   ├── DeepgramStreamingPlayer.ts  # Deepgram streaming player
│   │   ├── StreamingAudioPlayer.ts     # Alternative implementation
│   │   └── CartesiaAudioAdapter.ts     # V1 adapter (DEPRECATED)
│   ├── gemini-agent.ts              # AI interview logic (70KB)
│   ├── streaming-audio-player.ts    # Audio playback engine (Expo Audio - LEGACY)
│   ├── tts-service.ts               # TTS orchestration (25KB)
│   ├── cartesia-streaming-service.ts # WebSocket client (18KB)
│   ├── openai-streaming-service.ts  # OpenAI streaming service
│   ├── deepgram-streaming-service.ts # Deepgram streaming service
│   ├── vibe-calculator.ts           # Emotion calculator (12KB)
│   ├── interview-planner.ts         # Interview planning (12KB) [root level]
│   └── history-storage.ts           # Interview persistence (15KB)
├── utils/
│   ├── audio/                       # Low-level audio utilities (NEW)
│   │   ├── Int16ToFloat32Converter.ts  # PCM16 → Float32
│   │   ├── CircularBuffer.ts            # Ring buffer
│   │   ├── FIFOQueue.ts                 # Chunk ordering
│   │   ├── JitterBuffer.ts              # Pre-buffering
│   │   ├── ZeroCrossingAligner.ts       # Click prevention
│   │   └── AudioContextManager.ts       # Web Audio API wrapper
│   ├── sentence-chunker.ts          # Sentence boundary detection
│   ├── sentence-detector.ts         # Punctuation detection
│   └── audio-conversion.ts          # PCM conversion utilities
├── hooks/
│   ├── interview/                   # Interview-specific hooks
│   └── useTypewriter.ts             # Typewriter animation
├── components/                      # Reusable UI components
└── types.ts                         # ALL type definitions (15KB)
```

## Platform-Specific Notes

### iOS
- Bundle ID: `com.terobyte.AskME-Mobile`
- Microphone usage description configured in app.json
- Supports iPad

### Android
- Package: `com.terobyte.AskMEMobile`
- Permissions: RECORD_AUDIO, MODIFY_AUDIO_SETTINGS
- Edge-to-edge enabled

## Common Tasks

### Adding a New Emotional State

1. Add to `VibeLabel` type in `types.ts`
2. Add mapping logic in `vibe-calculator.ts`
3. Define `VibeConfig` with Cartesia emotion, speed, and prompt modifier

### Modifying Interview Questions

Edit `generateInterviewPlan()` in `interview-planner.ts`:
- Change question generation prompt
- Adjust skill categorization logic
- Modify queue building logic (technical vs soft skill limits)

### Changing Voice Behavior

Edit `tts-service.ts`:
- Primary TTS: Cartesia (emotion, speed)
- Secondary TTS: OpenAI (default: 'marin' voice, Professional instructions)
- Tertiary TTS: Deepgram (default: 'thalia-energetic' voice)
- Speed ranges: 0.5 (slow) to 1.5 (fast)

**Note:** Voice selection UI is intentionally minimal - no voice/style chips are displayed to users (matches Cartesia's clean interface).

### Adjusting Cross-Fade Behavior (Legacy)

Edit `streaming-audio-player.ts`:
- `CROSSFADE_LONG` (default: 120ms)
- `CROSSFADE_SHORT` (default: 40ms)
- `MICRO_PAUSE_MS` (default: 20ms)
- `shouldUseCrossfade()` logic for punctuation detection

### Configuring the New Streaming Engine

Edit `CartesiaStreamingPlayer.ts` config:
- `preBufferThreshold`: 300ms (buffer before playback starts)
- `chunkSize`: 320 samples (~20ms at 16kHz)
- `maxBufferSize`: 5 seconds
- `underrunStrategy`: 'silence' | 'pause' | 'repeat'

```typescript
const player = getCartesiaStreamingPlayer({
  sampleRate: 16000,
  preBufferThreshold: 300,
  chunkSize: 320,
});

await player.speak("Hello world", {
  emotion: ['positivity:high'],
  speed: 'normal'
});
```
