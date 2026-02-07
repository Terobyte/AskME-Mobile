# Audio Streaming Migration Plan
## react-native-audio-api + Jitter Buffer Architecture

> **Status: Phase 3 - TESTING SUCCESSFUL - Audio Fixed!** 🎉
>
> **Final Fix (Feb 06, 2026):** Standardized entire pipeline on **16000Hz**.
>
> **Root Cause:** AudioContext was using device sample rate (e.g., 48000Hz) while receiving 44100Hz/16000Hz audio, causing pitch/speed distortion ("monster sound").
>
> **Solution:** Force 16000Hz throughout the entire pipeline.

---

## 📋 Статус проекта

```
Phase 1: Research & Setup ✅ COMPLETED
Phase 2: Core Components ✅ COMPLETED
Phase 2.5: Engine Assembly ✅ COMPLETED
Phase 2.6: Sample Rate Fix ✅ COMPLETED (Feb 06, 2026)
Phase 3: Testing ✅ SUCCESS - AUDIO WORKS!
Phase 4: Migration ⏳ PENDING
```

---

## 🎉 ИСПРАВЛЕНО: "Монстр звук" исправлен!

### Симптомы (до исправления):
- **Звук звучал как "монстр"** - искажённый, медленный или быстрый
- **Роботический голос** - проблема с sample rate conversion
- **Невозможно использовать** в production

### Корневая причина:

**Несоответствие sample rate в аудио-конвейере:**

1. `AudioContext` создавался с `sampleRate: null` → устройство использовало 48000Hz
2. Cartesia отправляла аудио на 44100Hz
3. Web Audio API проигрывал 44100Hz данные как 48000Hz
4. Результат: аудио игралось на 48000/44100 ≈ 1.09x быстрее с повышенным тоном

### Финальное решение (Feb 06, 2026):

**Стандартизировать весь пайплайн на 16000Hz** (как в старом Expo Audio):

```
Cartesia API: request 16000Hz ✅
     ↓
Int16ToFloat32Converter: 16000Hz ✅
     ↓
JitterBuffer: 16000Hz ✅
     ↓
AudioContext: force 16000Hz ✅
     ↓
🎧 НОРМАЛЬНЫЙ ЗВУК! ✅
```

---

## ✅ Изменённые файлы (Feb 06, 2026 - Final Fix)

| Файл | Строка | Изменение |
|------|--------|-----------|
| `cartesia-streaming-service.ts` | 437 | `sample_rate: 44100` → `16000` |
| `CartesiaStreamingPlayer.ts` | 137 | `sampleRate: 44100` → `16000` |
| `CartesiaStreamingPlayer.ts` | 143 | `chunkSize: 4096` → `2048` (~128ms @ 16kHz) |
| `AudioContextManager.ts` | 54 | `sampleRate: null` → `16000` (FORCE) |
| `AudioContextManager.ts` | 118 | Explicit `sampleRate: 16000` |
| `AudioContextManager.ts` | 330 | Fallback `44100` → `16000` |
| `Int16ToFloat32Converter.ts` | 56 | Default `44100` → `16000` |
| `Int16ToFloat32Converter.ts` | 280 | Param default `44100` → `16000` |
| `JitterBuffer.ts` | 107 | Default `44100` → `16000` |
| `JitterBuffer.ts` | 422 | Param default `44100` → `16000` |
| `TestAudioStreamPage.tsx` | 80 | `sampleRate: 44100` → `16000` |
| `TestAudioStreamPage.tsx` | 83 | `chunkSize: 320` → `2048` |

### Критические изменения:

**1. Cartesia API - Запрос 16000Hz:**
```typescript
// src/services/cartesia-streaming-service.ts:437
output_format: {
  container: 'raw',
  encoding: 'pcm_s16le',
  sample_rate: 16000,  // Changed from 44100
}
```

**2. AudioContext - Force 16000Hz:**
```typescript
// src/utils/audio/AudioContextManager.ts:54
const DEFAULT_CONFIG: AudioContextConfig = {
  sampleRate: 16000,  // Changed from null - FORCE 16kHz
  initialGain: 1.0,
  latencyHint: 'interactive',
};

// src/utils/audio/AudioContextManager.ts:118
this.context = new AudioContext({
  sampleRate: this.config.sampleRate ?? 16000,  // Force 16kHz
});
```

**3. Player Config - 16000Hz + increased chunkSize:**
```typescript
// src/services/audio/CartesiaStreamingPlayer.ts:137
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 16000,        // Changed from 44100
  preBufferThreshold: 500,
  maxBufferSize: 5,
  chunkSize: 2048,          // ~128ms at 16kHz (increased for stability)
  // ... rest
};
```

---

## 🧩 Phase 2: Core Components

### Inventory (все на 16000Hz)

| Компонент | Файл | Статус |
|-----------|------|--------|
| PCM16 Converter | `Int16ToFloat32Converter.ts` | ✅ 16000Hz default |
| Circular Buffer | `CircularBuffer.ts` | ✅ |
| FIFO Queue | `FIFOQueue.ts` | ✅ |
| Jitter Buffer | `JitterBuffer.ts` | ✅ 16000Hz default |
| Zero-Crossing | `ZeroCrossingAligner.ts` | ✅ |
| Audio Context | `AudioContextManager.ts` | ✅ Force 16000Hz |
| WebSocket | `cartesia-streaming-service.ts` | ✅ Requests 16000Hz |
| **Streaming Player** | `CartesiaStreamingPlayer.ts` | ✅ 16000Hz |
| **Test Page** | `TestAudioStreamPage.tsx` | ✅ 16000Hz |

---

## 🔍 Архитектура (ИСПРАВЛЕННАЯ)

```
┌─────────────────────────────────────────────────────────────┐
│              CartesiaStreamingPlayer                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WebSocket (Cartesia) → PCM16 chunks (16000Hz)               │
│       ↓                                                      │
│  FIFOQueue (ordering)                                        │
│       ↓                                                      │
│  Int16ToFloat32Converter (PCM16 → Float32 @ 16000Hz)         │
│       ↓                                                      │
│  JitterBuffer (pre-buffer 500ms @ 16000Hz)                   │
│       ↓                                                      │
│  ZeroCrossingAligner (first chunk only)                      │
│       ↓                                                      │
│  AudioContext (16000Hz FORCED)  ← ✅ FIXED!                  │
│       ↓                                                      │
│  createBuffer(data, 16000)  ← ✅ EXPLICIT SAMPLE RATE       │
│       ↓                                                      │
│  🎧 Speakers (НОРМАЛЬНЫЙ ЗВУК!)                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Текущая конфигурация

### CartesiaStreamingPlayer.ts
```typescript
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 16000,        // ✅ All 16kHz
  preBufferThreshold: 500,  // 500ms pre-buffer
  maxBufferSize: 5,         // 5 seconds max buffer
  chunkSize: 2048,          // ~128ms at 16kHz
  fifoMaxSize: 500,
  processingInterval: 50,   // 20Hz processing
  // ... rest
};
```

### cartesia-streaming-service.ts
```typescript
output_format: {
  container: "raw",
  encoding: "pcm_s16le",
  sample_rate: 16000,  // ✅ Match player config
}
```

---

## 🔧 Отладочные логи

После исправления вы должны видеть:

```
╔════════════════════════════════════════╗
║   CartesiaStreamingPlayer Config        ║
╠════════════════════════════════════════╣
║ sampleRate:           16000             ║  ← All 16kHz
║ chunkSize:            2048              ║
║ preBufferThreshold:   500ms             ║
║ processingInterval:   50ms              ║
║ fifoMaxSize:          500               ║
╚════════════════════════════════════════╝

[AudioContextManager] Initialized:
[AudioContextManager]   Requested sampleRate: 16000
[AudioContextManager]   Actual sampleRate: 16000Hz  ← Must match!

[Cartesia WS] Request: sample_rate: 16000
```

**Ключевой момент:** Всё на 16000Hz - AudioContext, Cartesia API, конвертер.

---

## 📝 История изменений

### Feb 06, 2026 - 16000Hz Standardization (УСПЕШНЫЙ!) ✅
1. ✅ Cartesia API: `sample_rate: 16000`
2. ✅ AudioContext: Force `sampleRate: 16000`
3. ✅ Все defaults обновлены до 16000Hz
4. ✅ chunkSize увеличен до 2048 для стабильности
5. ✅ TestAudioStreamPage обновлён
6. ✅ **ТЕСТ ПРОЙДЕН - ЗВУК НОРМАЛЬНЫЙ!**

### Feb 06, 2026 - Предыдущие попытки:
| Попытка | Изменение | Результат |
|---------|-----------|-----------|
| #1 | `chunkSize: 320` → `4096` | ❌ Не помогло |
| #2 | `sampleRate: 16000` → `44100` (partial) | ❌ Не помогло |
| #3 | `preBufferThreshold: 300` → `500` | ❌ Не помогло |
| #4 | `processingInterval: 20` → `50` | ❌ Не помогло |
| #5 | `createBuffer(data, sampleRate)` | ❌ Не помогло |
| **#6 FINAL** | **ALL 16000Hz** | **✅ РАБОТАЕТ!** |

**Причина успеха:** 16000Hz работает лучше с react-native-audio-api, чем 44100Hz.

---

## ✅ Что работает

1. **WebSocket connection** - стабильно подключается к Cartesia
2. **Chunk receiving** - все чанки приходят корректно на 16000Hz
3. **State machine** - состояния переходят правильно
4. **Metrics** - вся статистика собирается
5. **Test UI** - `TestAudioStreamPage.tsx` работает
6. **Audio playback** - ✅ ЗВУК НОРМАЛЬНЫЙ!

---

## 🎯 Next Steps

1. [x] **ТЕСТ** - Запустить TestAudioStreamPage и проверить звук ✅
2. [ ] Интегрировать в VoiceInterviewScreen
3. [ ] Удалить/деактивировать старый Expo Audio плеер
4. [ ] Тестирование на реальных устройствах

### Интеграция в VoiceInterviewScreen:

```typescript
// Заменить импорт
import { getCartesiaStreamingPlayer } from './services/audio/CartesiaStreamingPlayer';

// Инициализация
const player = getCartesiaStreamingPlayer({
  sampleRate: 16000,
  preBufferThreshold: 500,
  maxBufferSize: 5,
  chunkSize: 2048,
});

// Использование
await player.speak(text, { emotion, speed });
```

---

**Status:** ✅ TESTING SUCCESSFUL
**Priority:** 🟢 READY FOR INTEGRATION
**Last Fix:** Feb 06, 2026
**Change:** Standardized entire pipeline on 16000Hz

---

*Last Updated: Feb 06, 2026*
*Version: 5.0 (16000Hz Standard Edition - WORKING!)*
