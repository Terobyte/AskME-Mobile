# 🎙️ AskME-Mobile

> AI-Powered Voice Interview Simulator with Emotional Intelligence

[![React Native](https://img.shields.io/badge/React%20Native-0.81-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-54-black.svg)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Private-red.svg)]()

**AskME-Mobile** is an intelligent voice interview simulator that helps job seekers practice technical and behavioral interviews with Victoria, an AI interviewer with emotional intelligence and adaptive questioning.

---

## ✨ Features

### 🎭 **Emotional AI Interviewer**
- **15 Emotional States** - Victoria adapts her tone from "Impressed" to "Furious" based on your performance
- **Natural Voice** - Powered by Cartesia TTS with emotional controls (not robotic!)
- **Real-time Adaptation** - Interview difficulty adjusts based on your answers

### 🎯 **Smart Interview Generation**
- **Resume Analysis** - Upload your resume, and AI extracts your skills
- **Job Matching** - Compares your profile against job descriptions
- **Personalized Questions** - Generates role-specific scenarios (technical + soft skills)
- **4 Interview Modes** - Short (15 min), Medium (30 min), Long (45 min), Freestyle (infinite)

### 📊 **Multi-Dimensional Evaluation**
- **Accuracy** (0-10) - Technical correctness
- **Depth** (0-10) - Level of experience demonstrated
- **Structure** (0-10) - Answer organization and clarity
- **Quality Levels** - Excellent, Good, Mediocre, Poor, Fail
- **Specific Feedback** - Identifies issues: NO_EXAMPLE, TOO_VAGUE, WRONG_CONCEPT, etc.

### 🔊 **Voice-First Experience**
- **Speech Recognition** - Speak naturally, no typing
- **Audio Transcription** - Powered by Deepgram/Whisper
- **Playback** - Review your answers and Victoria's feedback
- **Haptic Feedback** - Tactile responses for better UX

### 📈 **Comprehensive Analytics**
- **Interview History** - Track your progress over time
- **Score Trends** - See improvement across categories
- **Detailed Reports** - 4-6 sentence feedback per question
- **Performance Insights** - Strengths, weaknesses, and recommendations

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Expo CLI** (`npm install -g expo-cli`)
- **iOS Simulator** (Mac) or **Android Studio** (any OS)

### Installation

```bash
# Clone the repository
git clone https://github.com/Terobyte/AskME-Mobile.git
cd AskME-Mobile

# Install dependencies
npm install

# Create .env file with your API keys
cp .env.example .env
# Edit .env and add your keys:
# EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_key
# EXPO_PUBLIC_CARTESIA_API_KEY=your_cartesia_key
# EXPO_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_key

# Start the development server
npm start
```

### Running on Device

```bash
# iOS Simulator (Mac only)
npm run ios

# Android Emulator
npm run android

# Web Browser
npm run web
```

---

## 📱 Screenshots

> **TODO:** Add screenshots of:
> - Settings screen (upload resume, select mode)
> - Voice interview screen (Victoria avatar, waveform, status)
> - Score reveal animation
> - Results modal with analytics

---

## 🏗️ Architecture

```
src/
├── screens/
│   └── VoiceInterviewScreen.tsx    # Main UI
├── services/
│   ├── gemini-agent.ts             # LLM evaluation & planning
│   ├── tts-service.ts              # Cartesia Text-to-Speech
│   ├── transcription-service.ts    # Deepgram Speech-to-Text
│   └── vibe-calculator.ts          # Emotion state management
├── hooks/interview/
│   ├── useInterviewLogic.ts        # Interview flow & state
│   └── useInterviewAudio.ts        # Recording & playback
├── components/interview/
│   ├── ScoreReveal.tsx             # Animated score UI
│   ├── ResultsModal.tsx            # Interview summary
│   └── DebugOverlay.tsx            # Dev tools
├── interview-planner.ts            # Question generation
├── soft-skills-db.ts               # 50+ soft skill scenarios
└── types.ts                        # TypeScript definitions
```

### Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | React Native 0.81 + Expo 54 |
| **Language** | TypeScript 5.9 |
| **Navigation** | React Navigation (Stack) |
| **AI Models** | Google Gemini 2.5 Flash/Pro |
| **Text-to-Speech** | Cartesia Sonic (emotional TTS) |
| **Speech-to-Text** | Deepgram Nova 2 |
| **State Management** | React Hooks + Context |
| **Animation** | React Native Reanimated |
| **Storage** | AsyncStorage (local) |

---

## 🎨 Emotional Intelligence System

Victoria's personality is driven by two metrics:

### Anger Level (0-100)
- Increases with poor answers, clarification requests, off-topic responses
- Decreases with excellent answers

### Engagement Level (0-100)
- Increases with specific examples, depth, structured answers
- Decreases with vague, shallow, rambling responses

### 15 Emotional Vibes

| Vibe | Anger | Engagement | Cartesia Emotion | Speed |
|------|-------|------------|------------------|-------|
| **Impressed** | 0-10 | 80-100 | positivity:highest | 1.0 |
| **Encouraging** | 0-10 | 50-79 | positivity:high | 1.0 |
| **Professional** | 11-25 | 60-100 | neutral | 0.95 |
| **Neutral** | 11-25 | 30-59 | neutral | 0.95 |
| **Curious** | 26-40 | 60-100 | curiosity:high | 0.9 |
| **Concerned** | 26-40 | 30-59 | curiosity:low | 0.85 |
| **Disappointed** | 26-40 | 0-29 | sadness:low | 0.8 |
| **Skeptical** | 41-60 | 40-100 | curiosity:lowest | 0.8 |
| **Amused** | 41-60 | - | surprise:high | 1.1 |
| **Irritated** | 41-60 | 0-39 | anger:low | 0.75 |
| **Frustrated** | 61-70 | - | anger:high | 0.7 |
| **Hostile** | 71-85 | - | anger:highest | 0.65 |
| **Dismissive** | 86-90 | - | anger:highest | 0.6 |
| **Furious** | 91-100 | - | anger:highest | 0.55 |

---

## 🧪 Development

### Debug Tools
- **Shake Device** - Toggle debug overlay
- **Debug HUD** - Real-time metrics (anger, engagement, vibe)
- **Mute TTS** - Disable voice for faster testing
- **Simulate Answer** - Auto-generate test answers

### Environment Variables

```bash
# Required API Keys
EXPO_PUBLIC_GEMINI_API_KEY=         # Google AI Studio
EXPO_PUBLIC_CARTESIA_API_KEY=       # Cartesia (TTS)
EXPO_PUBLIC_DEEPGRAM_API_KEY=       # Deepgram (STT)

# Optional
EXPO_PUBLIC_OPENAI_API_KEY=         # Fallback LLM
EXPO_PUBLIC_GROQ_API_KEY=           # Alternative inference
```

### Testing

```bash
# Run type checks
npm run tsc

# Lint code
npm run lint

# Format code
npm run format
```

---

## 📊 Interview Flow

1. **Lobby Phase**
   - User uploads resume (PDF/TXT) or pastes text
   - Provides job description
   - Selects interview mode (short/medium/long/freestyle)

2. **Planning Phase**
   - Gemini analyzes resume vs job description
   - Extracts: Matches, Gaps, Cool Skills, Soft Skills
   - Generates deep scenario questions for each skill

3. **Intro Phase**
   - Victoria greets user
   - Asks for self-introduction
   - Evaluates communication style

4. **Technical Questions**
   - **Matches** (your strong points) - 5-7 questions
   - **Gaps** (areas to improve) - 3-4 questions
   - **Cool Skills** (unique experiences) - 1-2 questions

5. **Soft Skills**
   - Leadership, teamwork, conflict resolution
   - Scenario-based behavioral questions

6. **Results Phase**
   - Comprehensive report with scores
   - Strengths and areas for improvement
   - Actionable recommendations

---

## 🔮 Roadmap

### ✅ MVP (Completed)
- [x] Voice interview with emotional AI
- [x] Resume analysis and question generation
- [x] Multi-dimensional answer evaluation
- [x] Interview history (local storage)
- [x] 4 interview modes

### 🚧 In Progress
- [ ] User authentication (Firebase/Supabase)
- [ ] Cloud sync for interview history
- [ ] Payment system (Stripe/RevenueCat)
- [ ] Analytics dashboard

### 🔜 Upcoming
- [ ] Social features (share results, leaderboard)
- [ ] Referral system
- [ ] More interview types (system design, behavioral)
- [ ] Internationalization (Spanish, Hindi, Chinese)
- [ ] Web version
- [ ] B2B features (for bootcamps/universities)

---

## 💰 Pricing (Future)

### Free Tier
- 5 practice interviews/month
- Basic feedback
- No history sync

### Pro ($14.99/month or $99/year)
- Unlimited interviews
- Advanced analytics
- Cloud sync
- Priority support
- Custom scenarios

### Enterprise (Custom Pricing)
- For bootcamps, universities, corporations
- Team management
- Custom branding
- API access

---

## 🤝 Contributing

This is currently a private project. If you'd like to contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is private and proprietary. All rights reserved.

---

## 🙏 Acknowledgments

- **Google Gemini** - Interview planning and evaluation
- **Cartesia AI** - Expressive text-to-speech
- **Deepgram** - Fast speech recognition
- **Expo** - React Native development platform

---

## 📞 Contact

**Author:** Terobyte  
**Repository:** [github.com/Terobyte/AskME-Mobile](https://github.com/Terobyte/AskME-Mobile)

---

## 📚 Documentation

- [Project Evaluation](./PROJECT_EVALUATION.md) - Realistic assessment and roadmap
- [Оценка Проекта (RU)](./ОЦЕНКА_ПРОЕКТА.md) - Russian version
- [API Documentation](#) - Coming soon
- [Architecture Guide](#) - Coming soon

---

**Built with ❤️ by Terobyte**

*Last Updated: February 2026*
