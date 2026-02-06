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
- Expo Audio (custom streaming audio player)

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
  - Fallback: OpenAI TTS (alloy, echo, onyx, nova, shimmer)

- **`streaming-audio-player.ts`** - Custom audio playback engine
  - Handles Cartesia WebSocket streaming (PCM16 chunks)
  - Smart cross-fade: only at sentence boundaries (punctuation detection)
  - Adaptive cross-fade duration: 40ms (short files) vs 120ms (long files)
  - Micro-pause (20ms) when no cross-fade to prevent words "sticking"

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

## Important Implementation Details

### Audio Cross-Fade System

The app uses intelligent cross-fade to eliminate audio artifacts:
- **Cross-fade only at punctuation** (., !, ?, ;, :) - prevents cutting off mid-word
- **Adaptive duration**: 40ms for files <1s, 120ms for files >2s
- **Micro-pause**: 20ms pause when no cross-fade (prevents words from "sticking")
- **Force flush**: Files without sentence metadata skip cross-fade (safer)

See: `AUDIO_CROSSFADE_FIX.md` for full implementation details.

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

Documented in markdown files in root:
- `AUDIO_CROSSFADE_FIX.md` - Cross-fade implementation details
- `CHUNK_SIZE_INCREASE_FIX.md` - Chunk size optimization
- `FORCE_FLUSH_ARTIFACTS_FIX.md` - Force flush audio issues
- `HISTORY_FIX.md` - History storage fixes
- `HISTORY_MICROPHONE_FIX.md` - Microphone permission issues

## File Structure Highlights

```
src/
├── screens/
│   └── VoiceInterviewScreen.tsx    # Main interview UI (41KB)
├── services/
│   ├── gemini-agent.ts              # AI interview logic (70KB)
│   ├── streaming-audio-player.ts    # Audio playback engine (53KB)
│   ├── tts-service.ts               # TTS orchestration (25KB)
│   ├── cartesia-streaming-service.ts # WebSocket client (18KB)
│   ├── vibe-calculator.ts           # Emotion calculator (12KB)
│   ├── interview-planner.ts         # Interview planning (12KB) [root level]
│   └── history-storage.ts           # Interview persistence (15KB)
├── utils/
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
- Fallback TTS: OpenAI (voice selection)
- Speed ranges: 0.5 (slow) to 1.5 (fast)

### Adjusting Cross-Fade Behavior

Edit `streaming-audio-player.ts`:
- `CROSSFADE_LONG` (default: 120ms)
- `CROSSFADE_SHORT` (default: 40ms)
- `MICRO_PAUSE_MS` (default: 20ms)
- `shouldUseCrossfade()` logic for punctuation detection
