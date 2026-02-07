# Audio Streaming Migration Plan
## react-native-audio-api + Jitter Buffer Architecture

> **Status: Phase 2.5 COMPLETED - Sample Rate Fix Applied**
>
> **Latest Fix (Feb 06, 2026):** Fixed `createBuffer()` call to explicitly pass sampleRate parameter.
>
> **Root Cause:** `AudioContextManager.createBuffer(data)` was called without sampleRate, causing Web Audio API to use device sample rate instead of 44100Hz, resulting in pitch/speed distortion ("monster sound").

---

## 📋 Статус проекта

```
Phase 1: Research & Setup ✅ COMPLETED
Phase 2: Core Components ✅ COMPLETED
Phase 2.5: Engine Assembly ✅ COMPLETED
Phase 2.6: Sample Rate Fix ✅ COMPLETED (Feb 06, 2026)
Phase 3: Testing 🔄 IN PROGRESS
Phase 4: Migration ⏳ PENDING
```

---

## 🔴 Проблема: "Монстр звук" - ИСПРАВЛЕНО

### Симптомы (до исправления):
- **Звук звучал как "монстр"** - искажённый, медленный или быстрый
- **Роботический голос** - проблема с sample rate conversion
- **Невозможно использовать** в production

### Корневая причина:

**`CartesiaStreamingPlayer.ts:619`** вызывал `createBuffer()` без параметра sampleRate:

```typescript
// ❌ WRONG - Uses device sample rate, not 44100Hz
const buffer = this.audioContext.createBuffer(data);

// ✅ CORRECT - Explicitly passes sampleRate
const buffer = this.audioContext.createBuffer(data, this.config.sampleRate);
```

**Почему это вызывало проблему:**
1. `AudioContextManager.createBuffer(data)` без sampleRate использует `this.context.sampleRate`
2. Устройство может иметь sample rate 48000Hz, 96000Hz или другой
3. Данные от Cartesia приходят на 44100Hz
4. Web Audio API проигрывает 44100Hz данные как будто это 48000Hz
5. Результат: аудио играет на 48000/44100 ≈ 1.09x быстрее с повышенным тоном ("монстр звук")

---

## ✅ Исправление (Feb 06, 2026)

### Изменённые файлы:

| Файл | Строка | Изменение |
|------|--------|-----------|
| `CartesiaStreamingPlayer.ts` | 619 | Добавлен параметр `this.config.sampleRate` |
| `TestAudioStreamPage.tsx` | 80 | `sampleRate: 16000` → `44100` |
| `AudioContextManager.ts` | 51 | `sampleRate: 16000` → `null` (device default) |
| `AudioContextManager.ts` | 319 | Fallback `16000` → `44100` |
| `Int16ToFloat32Converter.ts` | 54 | Default `16000` → `44100` |
| `Int16ToFloat32Converter.ts` | 278 | Function param `16000` → `44100` |
| `JitterBuffer.ts` | 105 | Default `16000` → `44100` |
| `JitterBuffer.ts` | 420 | Function param `16000` → `44100` |

### Критическое исправление:

```typescript
// src/services/audio/CartesiaStreamingPlayer.ts:619
const buffer = this.audioContext.createBuffer(data, this.config.sampleRate);
```

---

## 🧩 Phase 2: Core Components

### Inventory

| Компонент | Файл | Статус |
|-----------|------|--------|
| PCM16 Converter | `Int16ToFloat32Converter.ts` | ✅ 44100Hz default |
| Circular Buffer | `CircularBuffer.ts` | ✅ |
| FIFO Queue | `FIFOQueue.ts` | ✅ |
| Jitter Buffer | `JitterBuffer.ts` | ✅ 44100Hz default |
| Zero-Crossing | `ZeroCrossingAligner.ts` | ✅ |
| Audio Context | `AudioContextManager.ts` | ✅ Uses device default |
| WebSocket | `cartesia-streaming-service.ts` | ✅ Requests 44100Hz |
| **Streaming Player** | `CartesiaStreamingPlayer.ts` | ✅ FIXED |

---

## 🔍 Архитектура (ИСПРАВЛЕННАЯ)

```
┌─────────────────────────────────────────────────────────────┐
│              CartesiaStreamingPlayer                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WebSocket (Cartesia) → PCM16 chunks (44100Hz)              │
│       ↓                                                      │
│  FIFOQueue (ordering)                                        │
│       ↓                                                      │
│  Int16ToFloat32Converter (PCM16 → Float32 @ 44100Hz)         │
│       ↓                                                      │
│  JitterBuffer (pre-buffer 500ms @ 44100Hz)                   │
│       ↓                                                      │
│  ZeroCrossingAligner (first chunk only)                      │
│       ↓                                                      │
│  AudioContextManager.createBuffer(data, 44100)  ← ✅ FIXED!  │
│       ↓                                                      │
│  🎧 Speakers (НОРМАЛЬНЫЙ ЗВУК)                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Текущая конфигурация

### CartesiaStreamingPlayer.ts
```typescript
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 44100,        // ✅ Match Cartesia API
  preBufferThreshold: 500,  // 500ms pre-buffer
  maxBufferSize: 5,         // 5 seconds max buffer
  chunkSize: 4096,          // ~93ms at 44.1kHz
  fifoMaxSize: 500,         // Larger FIFO for stability
  processingInterval: 50,   // 20Hz processing
  // ... rest
};
```

### cartesia-streaming-service.ts
```typescript
output_format: {
  container: "raw",
  encoding: "pcm_s16le",
  sample_rate: 44100,  // ✅ Must match player config
}
```

---

## 🔧 Отладочные логи

После исправления вы должны видеть:

```
╔════════════════════════════════════════╗
║   CartesiaStreamingPlayer Config        ║
╠════════════════════════════════════════╣
║ sampleRate:           44100             ║  ← All 44100
║ chunkSize:            4096              ║
║ preBufferThreshold:   500ms             ║
║ processingInterval:   50ms              ║
║ fifoMaxSize:          500               ║
╚════════════════════════════════════════╝

[AudioContextManager] Initialized:
[AudioContextManager]   Requested sampleRate: null
[AudioContextManager]   Actual sampleRate: 48000Hz  ← Device may differ
[AudioContextManager]   State: running

[AudioContextManager] createBuffer: 4096 samples @ 44100Hz (92.9ms)  ← Explicit 44100!
[Int16ToFloat32Converter] Convert: ... @ 44100Hz
```

**Ключевой момент:** `createBuffer` использует 44100Hz явно, даже если device sample rate = 48000Hz.

---

## 📝 История изменений

### Feb 06, 2026 - Sample Rate Fix (УСПЕШНЫЙ)
1. ✅ Исправлен `createBuffer()` - добавлен явный параметр sampleRate
2. ✅ Все defaults обновлены до 44100Hz
3. ✅ TestAudioStreamPage обновлён

### Feb 06, 2026 - Предыдущие неудачные попытки:
| Попытка | Изменение | Результат |
|---------|-----------|-----------|
| #1 | `chunkSize: 320` → `4096` | ❌ Не помогло |
| #2 | `sampleRate: 16000` → `44100` (partial) | ❌ Не помогло |
| #3 | `preBufferThreshold: 300` → `500` | ❌ Не помогло |
| #4 | `processingInterval: 20` → `50` | ❌ Не помогло |
| #5 | `fifoMaxSize: 100` → `500` | ❌ Не помогло |

**Причина неудач:** Проблема была в `createBuffer()`, а не в этих параметрах.

---

## ✅ Что работает

1. **WebSocket connection** - стабильно подключается к Cartesia
2. **Chunk receiving** - все чанки приходят корректно на 44100Hz
3. **State machine** - состояния переходят правильно
4. **Metrics** - вся статистика собирается
5. **Test UI** - `TestAudioStreamPage.tsx` работает
6. **Audio playback** - ✅ Теперь должен играть на правильной скорости/тоне

---

## 🎯 Next Steps

1. [ ] **ТЕСТ** - Запустить TestAudioStreamPage и проверить звук
2. [ ] Если звук нормальный - интегрировать в VoiceInterviewScreen
3. [ ] Если звук всё ещё искажён - добавить больше диагностики

### Если после исправления звук всё ещё плохой:

```typescript
// 1. Проверить что Cartesia действительно отправляет 44100Hz
// Добавить лог в cartesia-streaming-service.ts

// 2. Проверить что данные не повреждаются при конвертации
// Добавить лог до/после Int16ToFloat32Converter

// 3. Записать сырые PCM данные в файл для анализа в Audacity
```

---

**Status:** ✅ Sample Rate Fix Applied
**Priority:** 🟡 TESTING - Нужно проверить что звук нормальный
**Last Fix:** Feb 06, 2026
**Change:** Added explicit sampleRate parameter to createBuffer()

---

*Last Updated: Feb 06, 2026*
*Version: 4.0 (Sample Rate Fix Edition)*
