# 🎯 Sentence-Aware Streaming Implementation Plan

**Цель:** Устранить артефакты при воспроизведении длинных предложений путем создания аудио файлов на границах предложений в real-time.

**Текущая проблема:** Длинные предложения разрываются посередине → слышны артефакты склейки.

**Решение:** Hybrid chunking strategy - быстрый старт + sentence-based файлы.

---

## 📊 АРХИТЕКТУРА РЕШЕНИЯ

### Два режима работы:

```
┌─────────────────────────────────────────────────────┐
│ РЕЖИМ 1: FAST_START (первые ~600-800ms)            │
│ • Цель: минимальная латентность < 200ms             │
│ • Файлы: 2-3 файла по 15-18 chunks (~750-900ms)    │
│ • Логика: Fixed size, как сейчас                    │
│ • Start playback: Сразу после 1го файла             │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ РЕЖИМ 2: SENTENCE_MODE (весь остальной текст)      │
│ • Цель: Zero артефактов                             │
│ • Файлы: ДИНАМИЧЕСКИЙ размер на sentence boundaries │
│ • Размер: 500ms - 2500ms (adaptive)                 │
│ • Логика: Real-time timestamp analysis             │
└─────────────────────────────────────────────────────┘
```

---

## 🔧 ПАРАМЕТРЫ КОНФИГУРАЦИИ

```yaml
FAST_START_MODE:
  chunks_per_file: 18           # Увеличено с 12 до 18 (~900ms)
  max_files: 2                  # Только 2 файла в fast-start
  total_duration_target: 1600ms # ~1.6 сек буфера
  crossfade_ms: 100

SENTENCE_MODE:
  min_file_duration_ms: 500     # Минимум 500ms
  max_file_duration_ms: 2500    # Максимум 2.5s
  force_flush_timeout_ms: 3000  # Принудительный flush
  crossfade_ms: 120             # Увеличенный crossfade
  
  sentence_endings: ['.', '!', '?']
  fallback_if_no_timestamps_ms: 1000

TRANSITION:
  preload_buffer_ms: 200
  seamless_threshold_ms: 50
```

---

## 📋 ПОШАГОВЫЙ ПЛАН РЕАЛИЗАЦИИ

### ✅ **CHECKPOINT 0: Подготовка** (10 мин)

**Цель:** Увеличить размер чанков для текущей версии как временное улучшение.

**Действия:**
- [ ] Увеличить `CHUNKS_PER_FILE` с 12 до 18 в `streaming-audio-player.ts`
- [ ] Увеличить `CROSSFADE_MS` до 120ms
- [ ] Тестировать: проверить что артефакты стали реже
- [ ] Git commit: "temp: increase chunk size to 18 for better sentence coverage"

**Файлы:**
- `src/services/streaming-audio-player.ts`

---

### ✅ **PHASE 1: State Machine & Mode Tracking** (30 мин)

**Цель:** Добавить систему режимов работы плеера.

**Действия:**

#### 1.1 Добавить enum для режимов
```typescript
// В streaming-audio-player.ts

enum ChunkingMode {
  FAST_START = 'fast_start',    // Первые 2 файла
  SENTENCE_MODE = 'sentence',    // Sentence-based chunking
  FALLBACK = 'fallback'          // Если timestamps не пришли
}
```

#### 1.2 Добавить поля в ChunkedStreamingPlayer
```typescript
// State tracking
private chunkingMode: ChunkingMode = ChunkingMode.FAST_START
private fastStartFilesCreated: number = 0
private hasReceivedTimestamps: boolean = false

// Timestamp accumulation
private incomingTimestamps: WordTimestamp[] = []
private lastProcessedTimestampIndex: number = 0

// Audio offset tracking
private totalAudioDurationMs: number = 0
```

#### 1.3 Создать метод для переключения режима
```typescript
private switchToSentenceMode(): void {
  console.log('🔄 [Player] Switching to SENTENCE_MODE')
  this.chunkingMode = ChunkingMode.SENTENCE_MODE
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`

**Тесты:**
- Запустить app
- Проверить логи: должен стартовать в FAST_START

**Git commit:** "feat: add chunking mode state machine"

---

### ✅ **PHASE 2: Real-time Timestamp Reception** (45 мин)

**Цель:** Передавать timestamps от Cartesia сервиса в плеер в real-time.

**Действия:**

#### 2.1 Добавить callback в playStream options
```typescript
// В streaming-audio-player.ts

playStream(
  generator: AsyncGenerator<AudioChunk>,
  options?: {
    originalText?: string
    contextId?: string
    enableSentenceChunking?: boolean
    onTimestampsReceived?: (timestamps: WordTimestamp[]) => void  // NEW
  }
)
```

#### 2.2 Модифицировать cartesia service
```typescript
// В cartesia-streaming-service.ts

// При получении timestamp message:
if (message.type === 'timestamps') {
  // Convert to WordTimestamp[]
  const timestamps = ...
  
  // Store locally
  this.timestampsStorage.set(contextId, timestamps)
  
  // NEW: Call callback immediately
  if (options.onTimestampsReceived) {
    options.onTimestampsReceived(timestamps)
  }
}
```

#### 2.3 Подключить в tts-service
```typescript
// В tts-service.ts

await chunkedStreamingPlayer.playStream(generator, {
  originalText: text,
  enableSentenceChunking: true,
  onTimestampsReceived: (timestamps) => {
    // Player получит timestamps в real-time
  }
})
```

#### 2.4 Обработка в плеере
```typescript
// В streaming-audio-player.ts

// В playStream:
const onTimestamps = (timestamps: WordTimestamp[]) => {
  console.log(`📝 [Player] Received ${timestamps.length} timestamps`)
  this.incomingTimestamps.push(...timestamps)
  this.hasReceivedTimestamps = true
  
  // Trigger sentence detection if in waiting state
  if (this.chunkingMode === ChunkingMode.FAST_START && 
      this.fastStartFilesCreated >= 2) {
    this.switchToSentenceMode()
  }
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`
- `src/services/cartesia-streaming-service.ts`
- `src/services/tts-service.ts`
- `src/types.ts` (добавить onTimestampsReceived в типы)

**Тесты:**
- Запустить TTS
- Проверить логи: timestamps должны приходить в real-time
- Должен переключиться в SENTENCE_MODE после 2 файлов

**Git commit:** "feat: add real-time timestamp reception to player"

---

### ✅ **PHASE 3: Sentence Boundary Detection** (60 мин)

**Цель:** Определять границы предложений из timestamps в real-time.

**Действия:**

#### 3.1 Создать утилиту для sentence detection
```typescript
// В streaming-audio-player.ts (или новый файл utils/sentence-detector.ts)

interface SentenceBoundary {
  wordIndex: number        // Индекс последнего слова предложения
  endTimeSeconds: number   // Конец предложения в секундах
  sentence: string         // Текст предложения (для логов)
}

class SentenceDetector {
  private static SENTENCE_ENDINGS = ['.', '!', '?']
  
  // Найти все завершенные предложения в timestamps
  static findCompletedSentences(
    timestamps: WordTimestamp[],
    fromIndex: number = 0
  ): SentenceBoundary[] {
    const boundaries: SentenceBoundary[] = []
    
    for (let i = fromIndex; i < timestamps.length; i++) {
      const word = timestamps[i].word
      const lastChar = word[word.length - 1]
      
      if (this.SENTENCE_ENDINGS.includes(lastChar)) {
        boundaries.push({
          wordIndex: i,
          endTimeSeconds: timestamps[i].end,
          sentence: this.extractSentence(timestamps, fromIndex, i)
        })
        fromIndex = i + 1
      }
    }
    
    return boundaries
  }
  
  private static extractSentence(
    timestamps: WordTimestamp[],
    start: number,
    end: number
  ): string {
    return timestamps
      .slice(start, end + 1)
      .map(t => t.word)
      .join(' ')
  }
}
```

#### 3.2 Интегрировать в chunk accumulation loop
```typescript
// В playStream():

// После накопления chunks:
if (this.chunkingMode === ChunkingMode.SENTENCE_MODE) {
  // Проверить: есть ли завершенные предложения?
  const boundaries = SentenceDetector.findCompletedSentences(
    this.incomingTimestamps,
    this.lastProcessedTimestampIndex
  )
  
  if (boundaries.length > 0) {
    console.log(`✨ [Player] Found ${boundaries.length} sentence boundaries`)
    
    // Создать файл до последней найденной границы
    await this.createSentenceBasedFile(
      accumulatedChunks,
      boundaries[boundaries.length - 1]
    )
  }
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`
- `src/utils/sentence-detector.ts` (новый, опционально)

**Тесты:**
- Mock timestamps с несколькими предложениями
- Проверить что boundaries детектятся правильно
- Логи должны показывать найденные предложения

**Git commit:** "feat: add real-time sentence boundary detection"

---

### ✅ **PHASE 4: Dynamic File Creation on Sentence Boundaries** (90 мин)

**Цель:** Создавать аудио файлы точно на границах предложений.

**Действия:**

#### 4.1 Вычисление PCM offset из timestamps
```typescript
// Новый метод в streaming-audio-player.ts

private calculatePcmOffsetForTimestamp(
  targetTimeSeconds: number,
  accumulatedChunks: AudioChunk[]
): { chunkIndex: number, byteOffset: number } {
  const SAMPLE_RATE = 16000
  const BYTES_PER_SAMPLE = 2
  
  const targetBytes = targetTimeSeconds * SAMPLE_RATE * BYTES_PER_SAMPLE
  
  let cumulativeBytes = 0
  
  for (let i = 0; i < accumulatedChunks.length; i++) {
    const chunkSize = accumulatedChunks[i].sizeBytes
    
    if (cumulativeBytes + chunkSize >= targetBytes) {
      return {
        chunkIndex: i,
        byteOffset: targetBytes - cumulativeBytes
      }
    }
    
    cumulativeBytes += chunkSize
  }
  
  // Fallback: весь накопленный буфер
  return {
    chunkIndex: accumulatedChunks.length - 1,
    byteOffset: accumulatedChunks[accumulatedChunks.length - 1].sizeBytes
  }
}
```

#### 4.2 Создание файла до sentence boundary
```typescript
private async createSentenceBasedFile(
  allChunks: AudioChunk[],
  boundary: SentenceBoundary,
  fileIndex: number
): Promise<string> {
  // Найти PCM offset
  const { chunkIndex, byteOffset } = this.calculatePcmOffsetForTimestamp(
    boundary.endTimeSeconds,
    allChunks
  )
  
  // Extract chunks до границы
  const chunksForFile = allChunks.slice(0, chunkIndex + 1)
  
  // TODO: Точная обрезка последнего чанка по byteOffset
  // (для MVP можно включать chunk целиком)
  
  console.log(`📦 [Player] Creating sentence file: "${boundary.sentence.substring(0, 40)}..."`)
  console.log(`   Duration: ${boundary.endTimeSeconds}s, Chunks: ${chunksForFile.length}`)
  
  // Создать WAV файл
  const filepath = await this.createChunkFile(chunksForFile, fileIndex)
  
  return filepath
}
```

#### 4.3 Модифицировать основной loop
```typescript
// В playStream(), заменить фиксированную логику:

for await (const chunk of chunkGenerator) {
  // ... накопление ...
  
  accumulatedChunks.push(chunk)
  this.totalAudioDurationMs += calculateAudioDuration(chunk.sizeBytes)
  
  // FAST_START MODE
  if (this.chunkingMode === ChunkingMode.FAST_START) {
    if (accumulatedChunks.length >= this.CHUNKS_PER_FILE) {
      const filepath = await this.createChunkFile(accumulatedChunks, fileIndex++)
      await this.audioQueue.enqueue(filepath)
      
      accumulatedChunks = []
      this.fastStartFilesCreated++
      
      // Переключение после 2 файлов
      if (this.fastStartFilesCreated >= 2 && this.hasReceivedTimestamps) {
        this.switchToSentenceMode()
      }
      
      // Start playback после 1го файла
      if (!playbackStarted) {
        this.state = 'playing'
        await this.audioQueue.start()
        playbackStarted = true
      }
    }
  }
  
  // SENTENCE MODE
  else if (this.chunkingMode === ChunkingMode.SENTENCE_MODE) {
    // Проверяем sentence boundaries
    const boundaries = SentenceDetector.findCompletedSentences(
      this.incomingTimestamps,
      this.lastProcessedTimestampIndex
    )
    
    if (boundaries.length > 0) {
      const lastBoundary = boundaries[boundaries.length - 1]
      
      // Check minimum duration (500ms)
      if (this.totalAudioDurationMs >= 500) {
        const filepath = await this.createSentenceBasedFile(
          accumulatedChunks,
          lastBoundary,
          fileIndex++
        )
        
        await this.audioQueue.enqueue(filepath)
        
        // Reset для следующего предложения
        accumulatedChunks = []
        this.totalAudioDurationMs = 0
        this.lastProcessedTimestampIndex = lastBoundary.wordIndex + 1
      }
    }
    
    // Force flush если слишком долго накапливаем
    else if (this.totalAudioDurationMs >= 2500) {
      console.warn('⚠️ [Player] Force flush (max duration reached)')
      const filepath = await this.createChunkFile(accumulatedChunks, fileIndex++)
      await this.audioQueue.enqueue(filepath)
      
      accumulatedChunks = []
      this.totalAudioDurationMs = 0
    }
  }
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`

**Тесты:**
- Тестировать с разными текстами:
  - Короткие предложения (< 1 сек)
  - Длинные предложения (> 2 сек)
  - Множество коротких предложений
- Проверить логи: файлы должны создаваться по boundaries
- Слушать: артефактов не должно быть

**Git commit:** "feat: implement dynamic sentence-based file creation"

---

### ✅ **PHASE 5: Fallback & Edge Cases** (45 мин)

**Цель:** Обработать случаи когда timestamps не приходят или приходят поздно.

**Действия:**

#### 5.1 Timeout для переключения в fallback
```typescript
// В playStream():

// После fast-start режима
if (this.chunkingMode === ChunkingMode.FAST_START && 
    this.fastStartFilesCreated >= 2) {
  
  // Ждем timestamps максимум 1 секунду
  const waitStart = Date.now()
  const MAX_WAIT_MS = 1000
  
  while (!this.hasReceivedTimestamps && 
         Date.now() - waitStart < MAX_WAIT_MS) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  if (this.hasReceivedTimestamps) {
    this.switchToSentenceMode()
  } else {
    console.warn('⚠️ [Player] No timestamps, using FALLBACK mode')
    this.chunkingMode = ChunkingMode.FALLBACK
  }
}
```

#### 5.2 Fallback chunking logic
```typescript
// FALLBACK MODE (если timestamps не пришли)
else if (this.chunkingMode === ChunkingMode.FALLBACK) {
  // Увеличенные чанки + длинный crossfade
  const FALLBACK_CHUNKS = 20  // ~1 секунда
  
  if (accumulatedChunks.length >= FALLBACK_CHUNKS) {
    const filepath = await this.createChunkFile(accumulatedChunks, fileIndex++)
    await this.audioQueue.enqueue(filepath)
    accumulatedChunks = []
  }
}
```

#### 5.3 Обработка слишком длинных предложений
```typescript
// В SENTENCE_MODE, до force flush:

// Если предложение > 3 секунд, попробовать split по запятым
if (this.totalAudioDurationMs >= 3000 && boundaries.length === 0) {
  // Искать sub-sentence boundaries (запятые, тире)
  const subBoundaries = SentenceDetector.findSubSentenceBoundaries(
    this.incomingTimestamps,
    this.lastProcessedTimestampIndex,
    [',', ';', '—', ' -']
  )
  
  if (subBoundaries.length > 0) {
    console.log('✂️ [Player] Splitting long sentence by comma')
    // Создать файл до последней запятой
  }
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`
- `src/utils/sentence-detector.ts`

**Тесты:**
- Disable timestamps в cartesia service → должен работать fallback
- Тестировать очень длинные предложения (> 3 сек)
- Проверить что не зависает

**Git commit:** "feat: add fallback modes and edge case handling"

---

### ✅ **PHASE 6: Optimization & Fine-tuning** (30 мин)

**Цель:** Оптимизировать параметры для лучшего качества.

**Действия:**

#### 6.1 Adaptive crossfade duration
```typescript
// В AudioQueue:

private getCrossfadeDuration(currentDuration: number): number {
  // Длинные файлы (sentence-based) = больше crossfade
  if (currentDuration > 1500) {
    return 120  // 120ms для sentence files
  }
  
  // Короткие файлы (fast-start) = стандартный crossfade
  return 100
}
```

#### 6.2 Логирование метрик
```typescript
// После завершения playback:

console.log('📊 [Player] Playback Statistics:')
console.log(`  Total files created: ${fileIndex}`)
console.log(`  Fast-start files: ${this.fastStartFilesCreated}`)
console.log(`  Sentence-based files: ${fileIndex - this.fastStartFilesCreated}`)
console.log(`  Mode transitions: FAST_START → ${this.chunkingMode}`)
console.log(`  Timestamps received: ${this.incomingTimestamps.length} words`)
```

#### 6.3 Параметры для tuning
```typescript
// Легко настраиваемые параметры вверху класса:

private readonly CONFIG = {
  FAST_START: {
    CHUNKS_PER_FILE: 18,
    MAX_FILES: 2,
  },
  SENTENCE: {
    MIN_DURATION_MS: 500,
    MAX_DURATION_MS: 2500,
    FORCE_FLUSH_MS: 3000,
  },
  CROSSFADE: {
    FAST_START_MS: 100,
    SENTENCE_MS: 120,
  },
  FALLBACK: {
    CHUNKS_PER_FILE: 20,
  }
}
```

**Файлы:**
- `src/services/streaming-audio-player.ts`

**Тесты:**
- Проверить логи - должны быть полные метрики
- Попробовать разные значения параметров
- A/B test: с/без sentence chunking

**Git commit:** "feat: add adaptive crossfade and performance metrics"

---

### ✅ **PHASE 7: Integration Testing & Polish** (60 мин)

**Цель:** Полное тестирование и доводка.

**Действия:**

#### 7.1 Feature Flag
```typescript
// В streaming-audio-player.ts:

private readonly USE_SENTENCE_CHUNKING = true  // Уже есть

// Опционально: добавить runtime toggle через playStream options
```

#### 7.2 Тестовые сценарии
```typescript
// Создать тестовые тексты:

const TEST_TEXTS = {
  SHORT: "Hello! How are you?",
  MEDIUM: "I'll be conducting your interview today. Please tell me about yourself.",
  LONG: "In this technical interview, I'll be evaluating your problem-solving skills, coding ability, and understanding of computer science fundamentals through a series of increasingly challenging questions.",
  MULTIPLE_SHORT: "Hi! I'm Victoria. I'm ready. Let's begin. Are you ready?",
  MIXED: "Hello there! I'm going to ask you some questions about your experience. First, tell me about your background."
}
```

#### 7.3 Полировка
- Убрать debug логи (или сделать conditional)
- Проверить все edge cases
- Убедиться что cleanup работает

#### 7.4 Документация
- Обновить комментарии в коде
- Добавить JSDoc для новых методов
- Обновить README если нужно

**Файлы:**
- Все модифицированные файлы
- `README.md` (опционально)

**Тесты:**
- Запустить все тестовые тексты
- Проверить что латентность < 250ms
- Проверить что нет артефактов
- Проверить fallback режим
- Long-running test (10+ предложений)

**Git commit:** "test: comprehensive testing and polish for sentence-aware streaming"

---

## 🎯 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ

### Ожидаемые улучшения:

✅ **Латентность:** < 200ms (как сейчас)  
✅ **Артефакты:** Zero на границах предложений  
✅ **Адаптивность:** Работает с любой длиной предложений  
✅ **Надежность:** Fallback если timestamps не приходят  
✅ **Качество:** Seamless cross-fade между файлами  

### Метрики для проверки:

```
Короткое предложение (< 1s):
  ✅ Playback start: < 200ms
  ✅ Артефакты: 0
  ✅ Файлов создано: 1-2

Длинное предложение (> 2s):
  ✅ Playback start: < 200ms
  ✅ Артефакты: 0
  ✅ Файл создан на sentence boundary
  
Множество предложений:
  ✅ Каждое предложение = отдельный файл (или группа)
  ✅ Seamless transitions
  ✅ Zero артефактов
```

---

## 📌 ПОРЯДОК ВЫПОЛНЕНИЯ

1. ✅ **CHECKPOINT 0** → Быстрое улучшение (10 мин)
2. ✅ **PHASE 1** → State machine (30 мин)
3. ✅ **PHASE 2** → Real-time timestamps (45 мин)
4. ✅ **PHASE 3** → Sentence detection (60 мин)
5. ✅ **PHASE 4** → Dynamic file creation (90 мин)
6. ✅ **PHASE 5** → Fallback & edge cases (45 мин)
7. ✅ **PHASE 6** → Optimization (30 мин)
8. ✅ **PHASE 7** → Testing & polish (60 мин)

**Total time:** ~6-7 часов (с тестированием)

---

## 🚀 НАЧАЛО РАБОТЫ

**Следующий шаг:** CHECKPOINT 0 - увеличить размер чанков.

Готов начать? ✅
