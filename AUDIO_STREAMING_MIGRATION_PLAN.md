# Audio Streaming Migration Plan
## react-native-audio-api + Jitter Buffer Architecture

---

## 📋 Общая стратегия

- **Phase 1**: Research & Setup (тестовая страница)
- **Phase 2**: Core Components (изолированная разработка)
- **Phase 3**: Integration Testing (проверка качества)
- **Phase 4**: Main Project Migration (поэтапная замена)

---

## 🔍 Phase 1: Research & Architecture Setup

### ✅ Промт 1.1: Анализ react-native-audio-api (COMPLETED)

**Найденные факты:**

| Вопрос | Ответ | Влияние на архитектуру |
|--------|-------|------------------------|
| AudioWorklet | ❌ Не доступен (в roadmap) | Используем multi-buffer scheduling |
| createBufferSource динамический | ❌ Фиксированный буфер | Создаём множество AudioBufferSourceNode |
| Sample Rate 16kHz | ❌ Нужен resampling | Реземплинг к 44.1/48kHz или AudioContext({sampleRate}) |
| GainNode | ✅ Доступен | Используем для crossfade |
| Scheduling | ✅ Sub-millisecond precision | Low-latency достижим |

**Архитектурные решения:**

1. **Multi-Buffer Scheduling** - вместо одного большого буфера создаём множество маленьких AudioBufferSourceNode и планируем их последовательно

2. **Resampling** - 16kHz → device rate (или используем `AudioContext({ sampleRate: 16000 })` если поддерживается)

3. **Pre-buffer Strategy**:
   - Накапливаем 100-200ms перед стартом
   - Планируем воспроизведение на 500ms вперёд

4. **Crossfade через GainNode**:
   ```typescript
   gainNode.gain.linearRampToValueAtTime(0, currentTime + crossfadeDuration);
   ```

**Пример базовых операций:**
```typescript
// Создание контекста
const audioContext = new AudioContext({ sampleRate: 16000 });

// Создание буфера из PCM16
const buffer = audioContext.createBuffer(1, pcmData.length, 16000);
const channelData = buffer.getChannelData(0);
for (let i = 0; i < pcmData.length; i++) {
  channelData[i] = pcmData[i] / 32768; // Int16 → Float32
}

// Создание источника
const source = audioContext.createBufferSource();
source.buffer = buffer;
source.connect(audioContext.destination);
source.start(audioContext.currentTime);
```

---

### Промт 1.2: Создание тестовой страницы

Создай новую тестовую страницу `TestAudioStreamPage.tsx` в проекте AskME-Mobile.

**Требования:**
1. Отдельный route `/test-audio-stream`
2. UI с кнопками:
   - Connect WebSocket
   - Start Streaming
   - Stop Streaming
   - Clear Buffer
3. Метрики в реальном времени:
   - Buffer duration (ms)
   - Latency (ms)
   - Samples queued
   - Playback state
4. Визуализация waveform (опционально)
5. Логи событий (WebSocket, buffer, playback)

**Стек:**
- React Native
- react-native-audio-api
- WebSocket (встроенный)
- TypeScript

Пока без бизнес-логики - только UI каркас.

---

## ✅ Промт 1.3: Cartesia "Hello World" Test (COMPLETED)

**Цель:** Создать минимальный тест для воспроизведения Victoria's voice через новый audio API.

**Реализовано:**
- ✅ Создан `CartesiaAudioAdapter.ts` - минимальный адаптер для воспроизведения
- ✅ Добавлена кнопка "Test Victoria Hello" на тестовую страницу
- ✅ Интеграция с `cartesiaStreamingService` (существующий WebSocket сервис)
- ✅ Конвертация PCM16 -> Float32 через `Int16ToFloat32Converter`
- ✅ Воспроизведение через `AudioContextManager`

**Файлы:**
- `src/services/audio/CartesiaAudioAdapter.ts` (новый)
- `src/screens/TestAudioStreamPage.tsx` (обновлён)

**Тестовый текст:**
```
"Hello world, it is me Victoria - I am here, and you can speak with me, isn't it magic?"
```

**Voice конфигурация:**
- `voiceId`: из `.env` (`EXPO_PUBLIC_CARTESIA_VOICE_ID`)
- `emotion`: `["positivity:high"]` - дружелюбный тон
- `speed`: `"normal"`

**Состояния адаптера:**
- IDLE → CONNECTING → BUFFERING → PLAYING → DONE / ERROR

**Метрики:**
- `chunksReceived` - количество полученных чанков
- `chunksPlayed` - количество воспроизведённых чанков
- `totalDurationMs` - общая длительность аудио
- `latencyMs` - задержка от старта до первого чанка

**Ограничения Version 1 (известные):**
- Нет jitter buffering - возможны gaps при медленном соединении
- Нет zero-crossing alignment - возможны clicks между чанками
- Простое накопление всех чанков перед воспроизведением (не streaming в реальном времени)

**План для Version 2 (Production):**
- Добавить JitterBuffer для smooth playback
- Zero-crossing alignment для устранения clicks
- Потоковое воспроизведение по мере поступления чанков

---

## 🧩 Phase 2: Core Components Development

### Промт 2.1: Int16 to Float32 Converter

Создай утилиту для конвертации PCM16 (Int16) в Float32.

**Требования:**
1. Входной формат: ArrayBuffer (Int16, mono, 16kHz)
2. Выходной формат: Float32Array (normalized to [-1, 1])
3. Обработка edge cases:
   - Пустые буферы
   - Нечетное количество байт
   - Validation входных данных
4. Performance: оптимизация для мобильных устройств
5. TypeScript типизация

**Файл:** `src/utils/audio/Int16ToFloat32Converter.ts`

Добавь unit-тесты с примерами данных.

---

### Промт 2.2: Circular Buffer (Ring Buffer)

Создай `CircularBuffer` для jitter buffering.

**Входные данные:** Float32Array chunks
**Выходные данные:** Float32Array по запросу

**Функционал:**
1. `write(data: Float32Array)` - добавить чанк
2. `read(numSamples: number)` - прочитать N samples
3. `availableSamples()` - сколько доступно
4. `clear()` - очистить буфер
5. `getBufferDuration()` - в миллисекундах

**Параметры:**
- bufferSizeSeconds: 3-5 секунд
- sampleRate: 16000 Hz
- Автоматический wrap-around (circular)

**Edge cases:**
- Buffer overflow (если пишем быстрее чем читаем)
- Buffer underrun (если читаем быстрее чем пишем)
- Partial reads (если запросили больше чем есть)

**Performance:**
- O(1) write/read операции
- Минимум копирований памяти
- Typed Arrays для speed

**Файл:** `src/utils/audio/CircularBuffer.ts`

---

### Промт 2.3: FIFO Queue

Создай `FIFOQueue` для упорядочивания WebSocket chunks.

**Входные данные:** `{ data: ArrayBuffer, timestamp: number }`
**Выходные данные:** ArrayBuffer в порядке поступления

**Функционал:**
1. `enqueue(chunk)` - добавить
2. `dequeue()` - извлечь первый
3. `peek()` - посмотреть без удаления
4. `size()` - количество чанков
5. `clear()` - очистить

**Edge cases:**
- Пустая очередь (dequeue returns null)
- Memory management (ограничение на макс размер)
- Timestamp ordering (если нужно)

**Performance:**
- O(1) enqueue/dequeue
- Memory efficient

**Файл:** `src/utils/audio/FIFOQueue.ts`

---

### Промт 2.4: Jitter Buffer Manager

Создай `JitterBuffer` для pre-buffering и smooth playback.

**Принимает:**
- Float32Array chunks (через CircularBuffer)
- Threshold в миллисекундах

**Функционал:**
1. `addChunk(data: Float32Array)` - добавить данные
2. `canStartPlayback()` - проверка threshold
3. `getNextChunk(size: number)` - получить для playback
4. `getBufferHealth()` - метрики состояния
5. `reset()` - сброс состояния

**Параметры:**
- preBufferThreshold: 200-500ms
- maxBufferSize: 5 секунд
- underrunStrategy: 'pause' | 'silence' | 'repeat'

**Состояния:**
- BUFFERING (накопление)
- READY (можно играть)
- PLAYING (идет воспроизведение)
- UNDERRUN (нехватка данных)

**Метрики:**
- currentDuration (ms)
- playbackPosition
- droppedChunks

**Файл:** `src/utils/audio/JitterBuffer.ts`

---

### Промт 2.5: Zero-Crossing Aligner

Создай `ZeroCrossingAligner` для устранения clicks.

**Входные данные:** Float32Array chunk
**Выходные данные:** Float32Array (aligned на zero-crossing)

**Функционал:**
1. `align(chunk: Float32Array, mode: 'start' | 'end')` - выровнять
2. `findZeroCrossing(data, startIndex)` - найти ближайший переход
3. `trimToZeroCrossing(data)` - обрезать до zero-crossing

**Алгоритм:**
1. Ищем точку где sign меняется (+ → - или - → +)
2. Используем linear interpolation если нужно
3. Trim chunk до этой точки

**Edge cases:**
- Нет zero-crossing в разумном окне (fallback)
- Очень короткие chunks
- Тишина (все значения ~0)

**Performance:**
- Поиск только в первых/последних N samples
- Configurable window size

**Файл:** `src/utils/audio/ZeroCrossingAligner.ts`

---

### Промт 2.6: Audio Context Manager

Создай `AudioContextManager` для управления react-native-audio-api.

**Функционал:**
1. `initialize(sampleRate: number)` - создать AudioContext
2. `createBufferSource(buffer: Float32Array)` - создать source
3. `createGainNode(initialGain: number)` - для volume/crossfade
4. `scheduleBuffer(buffer, startTime?)` - запланировать воспроизведение
5. `getPlaybackTime()` - текущее время
6. `dispose()` - cleanup

**Особенности:**
- Singleton pattern (один контекст)
- Автоматический resume если suspended
- Graceful degradation если API недоступно

**Поддержка:**
- Sample rate: 16000 Hz (или resampling к 48000)
- Mono channel
- Scheduling с точностью до sample

**Файл:** `src/utils/audio/AudioContextManager.ts`

---

## 🎼 Phase 3: Main Orchestrator

### Промт 3.1: Streaming Audio Player

Создай `StreamingAudioPlayer` - главный класс который связывает все компоненты.

**Архитектура:**
```
┌─────────────────────────────────────────────┐
│         StreamingAudioPlayer                │
├─────────────────────────────────────────────┤
│  - wsConnection: WebSocket                  │
│  - converter: Int16ToFloat32Converter       │
│  - fifoQueue: FIFOQueue                     │
│  - jitterBuffer: JitterBuffer               │
│  - audioContext: AudioContextManager        │
│  - aligner: ZeroCrossingAligner             │
└─────────────────────────────────────────────┘
```

**Публичное API:**
1. `connect(wsUrl: string)` - подключение к Cartesia
2. `start()` - начать воспроизведение
3. `stop()` - остановить
4. `pause()` - пауза
5. `resume()` - возобновить
6. `setVolume(level: number)` - громкость
7. `getMetrics()` - текущие метрики

**Внутренний поток:**
1. WebSocket.onmessage → ArrayBuffer (PCM16)
2. converter.convert() → Float32Array
3. fifoQueue.enqueue() → упорядочивание
4. jitterBuffer.addChunk() → накопление
5. Когда canStartPlayback() → schedulePlayback()
6. aligner.align() → smooth transitions
7. audioContext.scheduleBuffer() → speakers

**События:**
- onBuffering
- onPlaying
- onPaused
- onUnderrun
- onError
- onMetricsUpdate

**Файл:** `src/services/audio/StreamingAudioPlayer.ts`

---

### Промт 3.2: React Hook для Player

Создай `useStreamingAudioPlayer` hook для интеграции в React Native.

**Возвращает:**
```typescript
{
  connect: (url: string) => Promise<void>,
  start: () => void,
  stop: () => void,
  pause: () => void,
  resume: () => void,
  setVolume: (level: number) => void,

  state: 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'error',
  metrics: {
    bufferDuration: number,
    latency: number,
    samplesQueued: number,
    playbackPosition: number
  },
  error: Error | null
}
```

**Особенности:**
- Automatic cleanup on unmount
- State management с useState/useReducer
- Metrics update с useEffect + interval
- Error handling

**Файл:** `src/hooks/useStreamingAudioPlayer.ts`

---

## 🧪 Phase 4: Testing & Validation

### Промт 4.1: Интеграция с тестовой страницей

Интегрируй `StreamingAudioPlayer` в `TestAudioStreamPage`.

**Функционал:**
1. Подключение к WebSocket (введите URL)
2. Автоматический pre-buffering с прогресс-баром
3. Кнопки управления (play/pause/stop)
4. Реальные метрики:
   ```
   Buffer: [███████___] 70% (350ms / 500ms)
   Latency: 180ms
   State: PLAYING
   Samples: 5600
   ```
5. Логи событий с timestamp
6. Volume slider (0-100%)

**WebSocket тест:**
- Используй реальный Cartesia endpoint или mock server
- Визуализируй incoming chunks

**Файл:** `src/screens/TestAudioStreamPage.tsx`

---

### Промт 4.2: Mock WebSocket Server

Создай mock WebSocket server для локального тестирования.

**Функционал:**
1. Генерирует синусоидальный PCM16 audio
2. Отправляет chunks с configurable интервалами
3. Симулирует jitter (случайные задержки)
4. Симулирует packet loss (опционально)

**Параметры:**
- frequency: 440 Hz (A4 note)
- sampleRate: 16000 Hz
- chunkSize: 320-640 bytes
- sendInterval: 20-40ms (configurable)

Используй: Node.js + ws library

**Файл:** `test-utils/mock-audio-server.js`

---

### Промт 4.3: Quality Testing Plan

Создай чек-лист для тестирования качества audio streaming:

**1. Latency тесты:**
- Измерить время от WebSocket.onmessage до speakers
- Target: < 300ms end-to-end

**2. Jitter тесты:**
- Симулировать нестабильный network
- Проверить smooth playback без gaps

**3. Buffer underrun:**
- Что происходит при медленном connection?
- Graceful degradation?

**4. Memory leaks:**
- Длительный playback (5+ минут)
- Профилирование памяти

**5. Audio quality:**
- Нет clicks/pops
- Нет distortion
- Volume consistency

**6. Edge cases:**
- Disconnect во время playback
- Resume после паузы
- Multiple start/stop cycles

Формат: Markdown таблица с checkboxes

---

## 🔄 Phase 5: Main Project Integration

### Промт 5.1: Анализ текущей реализации

Проанализируй текущую audio streaming логику в AskME-Mobile.

**Найди:**
1. Где происходит WebSocket подключение к Cartesia?
2. Как сейчас обрабатываются audio chunks?
3. Какой audio player используется?
4. Где находится state management для audio?
5. Какие компоненты зависят от audio playback?

**Создай:**
- Диаграмму текущей архитектуры
- Список файлов которые нужно изменить
- Migration plan (шаг за шагом)
- Риски и mitigation strategies

**Файл:** `docs/MIGRATION_PLAN.md`

---

### Промт 5.2: Поэтапная миграция (Step 1)

Шаг 1: Замени WebSocket audio handling в [CURRENT_FILE].

**План:**
1. Импортируй новый StreamingAudioPlayer
2. Создай feature flag: `USE_NEW_AUDIO_PLAYER`
3. Добавь A/B testing:
   - if (USE_NEW_AUDIO_PLAYER) → новый плеер
   - else → старый плеер
4. Сохрани обратную совместимость

**Не трогай:**
- UI компоненты
- State management
- API calls (кроме audio)

**Измени только:**
- Audio chunk processing
- Playback logic

**Тестирование:**
- Side-by-side сравнение старого и нового
- Metrics dashboard

---

### Промт 5.3: Финальная интеграция

После успешного A/B теста удали старый код.

**Checklist:**
1. ✅ Новый плеер стабилен 7+ дней
2. ✅ Metrics показывают улучшение
3. ✅ Нет critical bugs
4. ✅ Code review passed

**Действия:**
1. Удали старую реализацию
2. Удали feature flag
3. Обнови документацию
4. Обнови CHANGELOG.md
5. Create release notes

**Финальная проверка:**
- Production build test
- Release candidate на TestFlight/Internal Testing

---

## 📊 Дополнительные промпты

### Performance Optimization

Оптимизируй `StreamingAudioPlayer` для production.

**Профилируй:**
1. Memory allocations в hot paths
2. CPU usage во время playback
3. Battery drain на real device

**Оптимизации:**
1. Object pooling для buffers
2. Lazy initialization
3. Debounce metrics updates
4. Web Workers (если доступно)

**Target metrics:**
- CPU: < 5% во время playback
- Memory: < 10MB overhead
- Battery: минимальное влияние

---

### Error Handling

Добавь comprehensive error handling.

**Категории ошибок:**
1. WebSocket errors (connection, timeout, close)
2. Audio API errors (не поддерживается, suspended)
3. Buffer errors (overflow, underrun)
4. Format errors (invalid PCM data)

**Стратегии:**
1. Retry logic с exponential backoff
2. Graceful degradation
3. User-friendly error messages
4. Telemetry/logging

**Создай:** `src/utils/audio/ErrorHandler.ts`

---

### Documentation

Создай полную документацию:

**1. README.md:**
- Architecture overview
- Quick start guide
- API reference

**2. ARCHITECTURE.md:**
- Detailed flow diagrams
- Component interactions
- Performance characteristics

**3. API.md:**
- Все публичные методы
- Типы
- Примеры использования

**4. TROUBLESHOOTING.md:**
- Частые проблемы
- Debug checklist
- Performance tuning

Используй: Mermaid diagrams, code examples, tables

---

## ✅ Финальный чек-лист

### Phase 1: Setup
- [x] Изучена документация react-native-audio-api
- [x] Создана тестовая страница (TestAudioStreamPage.tsx)
- [x] Cartesia "Hello World" тест работает
- [ ] Настроен WebSocket mock server

### Phase 2: Components
- [x] Int16ToFloat32Converter + tests
- [x] CircularBuffer + tests
- [x] FIFOQueue + tests
- [x] JitterBuffer + tests
- [x] ZeroCrossingAligner + tests
- [x] AudioContextManager + tests

### Phase 3: Integration
- [x] CartesiaAudioAdapter (minimal V1)
- [ ] StreamingAudioPlayer (full V2)
- [ ] useStreamingAudioPlayer hook
- [x] Интеграция с тестовой страницей

### Phase 4: Testing
- [ ] Unit tests (80%+ coverage)
- [ ] Integration tests
- [ ] Quality checklist выполнен
- [ ] Performance benchmarks

### Phase 5: Production
- [ ] Migration plan утвержден
- [ ] A/B testing настроен
- [ ] Поэтапная миграция завершена
- [ ] Старый код удален
- [ ] Документация обновлена

### Release
- [ ] CHANGELOG.md
- [ ] Release notes
- [ ] Version bump
- [ ] Production deploy

---

## 🎯 Tech Stack Summary

| Компонент | Технология |
|-----------|------------|
| WebSocket | Cartesia Sonic API |
| Audio Format | PCM16 (Int16), 16kHz, Mono |
| Audio Engine | react-native-audio-api |
| Buffer Structure | Circular Buffer (Ring Buffer) |
| Jitter Strategy | Pre-buffering (200-500ms threshold) |
| Queue | FIFO |
| Click Prevention | Zero-Crossing Alignment |
| Volume/Crossfade | Gain Node |
| Processing | AudioWorklet (если доступно) |
| Resampling | 16kHz → native sample rate |

---

## 📁 Структура файлов

```
src/
├── utils/
│   └── audio/
│       ├── Int16ToFloat32Converter.ts
│       ├── CircularBuffer.ts
│       ├── FIFOQueue.ts
│       ├── JitterBuffer.ts
│       ├── ZeroCrossingAligner.ts
│       ├── AudioContextManager.ts
│       └── ErrorHandler.ts
├── services/
│   └── audio/
│       └── StreamingAudioPlayer.ts
├── hooks/
│   └── useStreamingAudioPlayer.ts
└── screens/
    └── TestAudioStreamPage.tsx

test-utils/
└── mock-audio-server.js

docs/
├── MIGRATION_PLAN.md
├── ARCHITECTURE.md
├── API.md
└── TROUBLESHOOTING.md
```

---

*Создано: 2025*
*Версия: 1.0*
