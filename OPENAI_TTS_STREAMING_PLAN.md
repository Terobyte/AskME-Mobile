# OpenAI TTS Streaming Integration Plan

## Цель

Заместить старый OpenAI REST метод на новый streaming движок в Control Center (VoiceInterviewScreen).

---

## ✅ Статус реализации - COMPLETE!

**OpenAI TTS streaming теперь используется в production!** 🎉

**Последнее обновление:** 2025-02-07

---

## 📋 Current Architecture Status

### ✅ Phase 1-5: COMPLETE!

```
speak() method
├── 1. Проверка MUTE
├── 2. OpenAI → speakOpenAIStreaming() ✅ (ТОЛЬКО streaming, нет fallback!)
├── 3. Cartesia/Deepgram → streaming → REST fallback (как было)
└── 4. Return boolean

prepareAudio() method
├── 1. Проверка MUTE
├── 2. OpenAI → OpenAIStreamingPlayer ✅ (НОВОЕ!)
├── 3. Cartesia → CartesiaStreamingPlayer ✅
├── 4. Deepgram → DeepgramStreamingPlayer ✅
└── 5. Return mock Sound
```

### ✅ Что изменено:

| Изменение | Статус | Описание |
|-----------|--------|----------|
| `prepareAudio()` - OpenAI streaming | ✅ DONE | OpenAI теперь использует streaming в prepareAudio() |
| Удален `fetchOpenAIAudioFile()` | ✅ DONE | REST метод удалён |
| `fetchAudioFile()` - OpenAI case удалён | ✅ DONE | OpenAI не попадает в REST fallback |
| `speak()` - OpenAI без fallback | ✅ DONE | OpenAI streaming только, fail fast |
| `stop()` - OpenAI cleanup | ✅ DONE | Добавлена остановка OpenAI player |

---

## 🎯 Final Architecture (After Migration)

```
VoiceInterviewScreen (Control Center)
         │
         ▼
TTSService.speak() / prepareAudio()
         │
         ├── cartesia → speakCartesiaStreaming()
         ├── deepgram → speakDeepgramStreaming()
         └── openai → speakOpenAIStreaming() ✅ Streaming ONLY
         │
         ▼
{Provider}StreamingPlayer (react-native-audio-api)
         │
         ├── Cartesia: 16kHz → Pipeline
         ├── Deepgram: 16kHz → Pipeline
         └── OpenAI: 24kHz → Resampler → 16kHz → Pipeline
         │
         ▼
JitterBuffer + AudioContext
         │
         ▼
🎧 Speakers
```

**OpenAI: НЕТ REST fallback!** Всегда streaming.

---

## 📊 Детали изменений

### Phase 1: ✅ Добавить OpenAI streaming в `prepareAudio()`

**Файл:** `src/services/tts-service.ts`

**Строка 913** - изменено условие:
```typescript
// ДО (только Cartesia + Deepgram):
if (STREAMING_CONFIG.enabled && (this.ttsProvider === 'cartesia' || this.ttsProvider === 'deepgram'))

// ПОСЛЕ (включая OpenAI):
if (STREAMING_CONFIG.enabled && (this.ttsProvider === 'cartesia' || this.ttsProvider === 'deepgram' || this.ttsProvider === 'openai'))
```

**Строки 922-923** - добавлен OpenAI player selection:
```typescript
// ДО:
const isCartesia = this.ttsProvider === 'cartesia';
const player = isCartesia ? getCartesiaStreamingPlayer() : getDeepgramStreamingPlayer();

// ПОСЛЕ:
const isCartesia = this.ttsProvider === 'cartesia';
const isOpenAI = this.ttsProvider === 'openai';
const player = isCartesia ? getCartesiaStreamingPlayer() : isOpenAI ? getOpenAIStreamingPlayer(OPENAI_API_KEY!) : getDeepgramStreamingPlayer();
```

**Строки 925-954** - добавлен OpenAI case в `playFunction`:
```typescript
const playFunction = async () => {
  if (isCartesia) {
    // ... существующий код Cartesia ...
  } else if (isOpenAI) {
    // НОВЫЙ: OpenAI streaming
    const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    await (player as any).speak(text, {
      voiceId: this.openaiVoice,
      speed: options?.speed,
    });
  } else {
    // ... существующий код Deepgram ...
  }
};
```

### Phase 2: ✅ Удалить `fetchOpenAIAudioFile()`

**Файл:** `src/services/tts-service.ts`

**Удалены строки 291-354** - весь метод `fetchOpenAIAudioFile()`

### Phase 3: ✅ Удалить OpenAI case из `fetchAudioFile()`

**Файл:** `src/services/tts-service.ts`

**Строки 268-270** - OpenAI case удалён:
```typescript
// ДО:
if (this.ttsProvider === 'openai') {
  console.log(`🎙️ [TTS] Using OpenAI TTS provider`);
  return await this.fetchOpenAIAudioFile(text, options);
} else if (this.ttsProvider === 'deepgram') {
  // ...

// ПОСЛЕ (OpenAI только streaming):
if (this.ttsProvider === 'deepgram') {
  console.log(`🎙️ [TTS] Using Deepgram TTS provider (REST fallback)`);
  return await this.fetchDeepgramAudioFile(text, options);
} else {
  console.log(`🎙️ [TTS] Using Cartesia TTS provider (REST fallback)`);
  return await this.fetchCartesiaAudioFile(text, options);
}
```

### Phase 4: ✅ Убрать REST fallback из `speak()` для OpenAI

**Файл:** `src/services/tts-service.ts`

**Строки 191-253** - OpenAI теперь без fallback:
```typescript
// OpenAI: Streaming only, no fallback
if (this.ttsProvider === 'openai') {
  console.log(`🌊 [TTS] OpenAI streaming only (no REST fallback)`);
  try {
    const success = await this.speakOpenAIStreaming(text, options);
    if (success) {
      console.log('✅ [TTS] OpenAI streaming successful');
      return true;
    }
    console.error('❌ [TTS] OpenAI streaming failed - no fallback available');
    return false;
  } catch (error) {
    console.error('❌ [TTS] OpenAI streaming error:', error);
    return false;
  }
}
```

### Phase 5: ✅ Добавить OpenAI cleanup в `stop()`

**Файл:** `src/services/tts-service.ts`

```typescript
// Stop OpenAI streaming player
const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
if (OPENAI_API_KEY) {
  const openaiPlayer = getOpenAIStreamingPlayer(OPENAI_API_KEY);
  if (openaiPlayer.isCurrentlyPlaying() || openaiPlayer.isCurrentlyStreaming()) {
    console.log("🛑 [TTS] Stopping OpenAI streaming player...");
    try {
      openaiPlayer.stop();
    } catch (error) {
      console.error("❌ [TTS] Error stopping OpenAI streaming:", error);
    }
  }
}
```

---

## 🧪 Тестирование

### 1. Запуск
```bash
npm start
```

### 2. В VoiceInterviewScreen:
- Открыть Settings (Control Panel)
- TTS Provider slider → позиция 1 (OpenAI)
- Выбрать voice: `nova` или `alloy`
- Start interview

### 3. Ожидаемые логи:
```
🌊 [TTS] Using NEW streaming engine for prepareAudio (openai)...
╔════════════════════════════════════════╗
║     OpenAIStreamingPlayer Config       ║
╠════════════════════════════════════════╣
║ sampleRate:           16000            ║
║ inputSampleRate:     24000             ║
║ chunkSize:            3200             ║
║ preBufferThreshold:  500ms             ║
╚════════════════════════════════════════╝
...
✅ [TTS] Streaming playback successful
```

### 4. Success Criteria:
- [x] Victoria говорит через OpenAI streaming (быстро!)
- [x] Микрофон разблокируется после речи
- [x] Console показывает streaming логи
- [x] Нет MP3 файлов в cache

---

## 📝 Зависимости

Все компоненты готовы:
- ✅ `OpenAIStreamingPlayer.ts` - полный streaming engine
- ✅ `openai-streaming-service.ts` - WebSocket/fetch сервис
- ✅ `PCM16Resampler.ts` - 24kHz → 16kHz конвертация
- ✅ `TestAudioStreamPage.tsx` - тестовая страница работает

---

## ⚠️ Риски

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Streaming может сломаться | Низкая | Есть тестовая страница для проверки |
| Пользователь хочет REST | Низкая | Streaming быстрее и лучше качества |

---

## 🚀 Статус плана

**✅ MIGRATION COMPLETE!**

**Текущий статус:**
- ✅ Test mode: `TestAudioStreamPage.tsx` работает
- ✅ Production: `VoiceInterviewScreen.tsx` использует streaming
- ✅ REST fallback: Удалён для OpenAI

**Следующие шаги (опционально):**
1. Мониторинг производительности в production
2. Сбор feedback от пользователей

---

## 🐛 История проблем (для контекста)

### ✅ Проблема #1: Deepgram WebSocket 400 Error (ИСПРАВЛЕНО)
Причина: WebSocket не закрывался при быстром restart
Решение: Добавлен `disconnect()` в `stop()`

### ✅ Проблема #2: OpenAI rapid restart ошибки (ИСПРАВЛЕНО)
Причина: Нет задержки между stop и speak
Решение: Добавлен 200ms debounce

### ✅ Проблема #3: Почему OpenAI так быстро работает?
Объяснение: Streaming response + оптимизированный pipeline

---

## 📝 Заметки для продолжения после потери контекста

Если контекст потерян, ключевые моменты:

1. **OpenAI streaming теперь используется везде** - в `speak()` и `prepareAudio()`
2. **OpenAI НЕ имеет REST fallback** - только streaming
3. **Cartesia/Deepgram** - всё ещё могут использовать REST fallback если streaming failed
4. **API key** читается из `Constants.expoConfig?.extra?.openaiApiKey`
5. **Resampling** - 24kHz → 16kHz через `PCM16Resampler.openaiToPipeline()`

**Файлы для работы:**
- `src/services/tts-service.ts` - основной файл (все изменения применены)
- `src/services/audio/OpenAIStreamingPlayer.ts` - streaming engine
- `src/screens/VoiceInterviewScreen.tsx` - уже интегрирован
