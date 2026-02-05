🚀 План внедрения Streaming TTS (Cartesia) - ВЕРСИЯ 2.0 (ИСПРАВЛЕННАЯ)

📋 Критичные исправления от v1.0

✅ Убран hardcoded API key → использование process.env
✅ Добавлена явная стратегия превышения memory limit
✅ Реалистичные ожидания для Progressive Loading (скорее всего не работает)
✅ Детальный rollback план если PoC провалится
✅ Четкие критерии GO/NO-GO с метриками
✅ Улучшена обработка ошибок WebSocket
✅ Добавлен graceful degradation при сетевых проблемах

---

🎯 Фазы реализации

## ФАЗА 0: PROOF OF CONCEPT ⚡ (4-5 часов) - КРИТИЧНО

**Цель:** Проверить техническую возможность streaming с expo-av ПЕРЕД полной реализацией.

**ВАЖНО:** Если хотя бы один критерий провала выполнится → STOP, не продолжаем.

---

### 0.1 Минимальный WebSocket клиент (1.5 часа)

**Что делаем:**

Создать простой WebSocket подключение к Cartesia  
Отправить один запрос на генерацию короткой фразы ("Hello world")  
Получить audio chunks (base64 encoded PCM)  
Декодировать base64 → ArrayBuffer  
Вывести в консоль размеры чанков и timing

**Реализация:**

```typescript
// src/poc/test-cartesia-websocket.ts

async function testCartesiaWebSocket() {
  const API_KEY = process.env.EXPO_PUBLIC_CARTESIA_API_KEY; // ✅ НЕ HARDCODE
  const VOICE_ID = "e07c00bc-4134-4eae-9ea4-1a55fb45746b";
  const WS_URL = "wss://api.cartesia.ai/tts/websocket";
  
  console.log("🧪 [PoC] Starting WebSocket test...");
  
  const metrics = {
    connectionStart: Date.now(),
    connectionTime: 0,
    firstChunkTime: 0,
    totalChunks: 0,
    chunks: [] as { size: number, timestamp: number, sequence: number }[]
  };
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?api_key=${API_KEY}&cartesia_version=2024-06-10`);
    
    ws.onopen = () => {
      metrics.connectionTime = Date.now() - metrics.connectionStart;
      console.log(`✅ [PoC] Connected in ${metrics.connectionTime}ms`);
      
      // Send generation request
      const request = {
        context_id: "poc-test-001",
        model_id: "sonic-3",
        transcript: "Hello world",
        voice: {
          mode: "id",
          id: VOICE_ID
        },
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000
        }
      };
      
      ws.send(JSON.stringify(request));
      console.log("📤 [PoC] Request sent");
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'chunk') {
          const chunkData = message.data; // base64 encoded PCM
          const arrayBuffer = base64ToArrayBuffer(chunkData);
          
          const chunk = {
            size: arrayBuffer.byteLength,
            timestamp: Date.now(),
            sequence: metrics.totalChunks
          };
          
          metrics.chunks.push(chunk);
          metrics.totalChunks++;
          
          if (metrics.totalChunks === 1) {
            metrics.firstChunkTime = chunk.timestamp - metrics.connectionStart;
            console.log(`🎯 [PoC] First chunk in ${metrics.firstChunkTime}ms`);
          }
          
          console.log(`📦 [PoC] Chunk #${chunk.sequence}: ${chunk.size} bytes at +${chunk.timestamp - metrics.connectionStart}ms`);
        }
        
        if (message.type === 'done') {
          console.log("✅ [PoC] Generation complete");
          ws.close();
          resolve(metrics);
        }
        
      } catch (error) {
        console.error("❌ [PoC] Message parse error:", error);
      }
    };
    
    ws.onerror = (error) => {
      console.error("❌ [PoC] WebSocket error:", error);
      reject(error);
    };
    
    ws.onclose = () => {
      console.log("🔌 [PoC] Connection closed");
    };
    
    // Timeout safety
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        console.error("❌ [PoC] Timeout - closing connection");
        ws.close();
        reject(new Error("Timeout"));
      }
    }, 10000);
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
```

**Критерии успеха:**

- ✅ WebSocket соединение устанавливается < 500ms
- ✅ Первый чанк приходит < 300ms после отправки запроса
- ✅ Чанки приходят последовательно (не batch) - разница между чанками < 100ms
- ✅ Данные декодируются корректно (ArrayBuffer с PCM)
- ✅ Минимум 3 чанка получено (означает настоящий streaming)

**Критерии провала (STOP):**

- ❌ WebSocket не подключается за 500ms
- ❌ Все чанки приходят одним батчем (разница < 10ms)
- ❌ Задержка первого чанка > 1000ms
- ❌ Декодирование падает с ошибкой
- ❌ Получен только 1 чанк (не streaming)

---

### 0.2 PCM → WAV конвертация (1.5 часа)

**Что делаем:**

Написать функцию convertPCMtoWAV(chunks: ArrayBuffer[])  
Создать корректный WAV header (44 bytes)  
Объединить header + все PCM chunks  
Записать результат в файл через FileSystem  
Попробовать воспроизвести через expo-av

**Реализация:**

```typescript
// src/poc/test-wav-conversion.ts

function createWavHeader(
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
  dataSize: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // Byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // Block align
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const buffer of buffers) {
    result.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  
  return result.buffer;
}

async function testWavConversion(pcmChunks: ArrayBuffer[]) {
  console.log("🧪 [PoC] Testing WAV conversion...");
  console.log(`📦 [PoC] Input: ${pcmChunks.length} PCM chunks`);
  
  const pcmData = mergeArrayBuffers(pcmChunks);
  const header = createWavHeader(16000, 1, 16, pcmData.byteLength);
  const wavFile = mergeArrayBuffers([header, pcmData]);
  
  console.log(`📦 [PoC] WAV file created: ${wavFile.byteLength} bytes`);
  
  // Save to file
  const filepath = `${FileSystem.cacheDirectory}poc_test.wav`;
  const base64 = arrayBufferToBase64(wavFile);
  
  await FileSystem.writeAsStringAsync(filepath, base64, {
    encoding: 'base64'
  });
  
  console.log(`💾 [PoC] Saved to: ${filepath}`);
  
  // Try to play
  try {
    const { sound } = await Audio.Sound.createAsync(
      { uri: filepath },
      { shouldPlay: true }
    );
    
    console.log("✅ [PoC] Playback started");
    
    // Wait for playback to finish
    return new Promise((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          console.log("✅ [PoC] Playback finished");
          sound.unloadAsync();
          resolve(true);
        }
      });
    });
    
  } catch (error) {
    console.error("❌ [PoC] Playback error:", error);
    throw error;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

**Критерии успеха:**

- ✅ WAV файл создается без ошибок
- ✅ expo-av воспроизводит файл
- ✅ Звук чистый, без артефактов
- ✅ Длительность соответствует ожидаемой (~1 секунда для "Hello world")
- ✅ Размер файла корректный (~32KB для 1 сек @ 16kHz mono)

**Критерии провала (STOP):**

- ❌ WAV файл не создается
- ❌ expo-av выдает ошибку при загрузке
- ❌ Слышны искажения/шумы/треск
- ❌ Длительность некорректная (в 2+ раза отличается)
- ❌ Файл не воспроизводится вообще

---

### 0.3 Progressive File Writing тест (1.5 часа)

**ВАЖНО:** Скорее всего НЕ СРАБОТАЕТ с expo-av. Это нормально - продолжим с Chunked Files.

**Что делаем:**

Проверить может ли expo-av играть частично записанный WAV файл  
Стратегия: записать header + первые 200ms PCM → начать play → дописывать chunks

**Реализация:**

```typescript
// src/poc/test-progressive-loading.ts

async function testProgressiveLoading(pcmChunks: ArrayBuffer[]) {
  console.log("🧪 [PoC] Testing progressive file loading...");
  
  // Разделим чанки: первые 20% для начала, остальные дописываем
  const initialChunks = pcmChunks.slice(0, Math.ceil(pcmChunks.length * 0.2));
  const remainingChunks = pcmChunks.slice(initialChunks.length);
  
  console.log(`📦 [PoC] Initial: ${initialChunks.length}, Remaining: ${remainingChunks.length}`);
  
  const filepath = `${FileSystem.cacheDirectory}poc_progressive.wav`;
  
  // 1. Создать WAV с placeholder size (большой)
  const totalDataSize = pcmChunks.reduce((sum, c) => sum + c.byteLength, 0);
  const header = createWavHeader(16000, 1, 16, totalDataSize);
  
  // 2. Записать header + initial chunks
  const initialPcm = mergeArrayBuffers(initialChunks);
  const initialWav = mergeArrayBuffers([header, initialPcm]);
  const base64Initial = arrayBufferToBase64(initialWav);
  
  await FileSystem.writeAsStringAsync(filepath, base64Initial, {
    encoding: 'base64'
  });
  
  console.log(`💾 [PoC] Initial file written: ${initialWav.byteLength} bytes`);
  
  // 3. Начать playback
  let sound: Audio.Sound;
  try {
    const result = await Audio.Sound.createAsync(
      { uri: filepath },
      { shouldPlay: true }
    );
    sound = result.sound;
    console.log("✅ [PoC] Playback started");
  } catch (error) {
    console.error("❌ [PoC] Failed to start playback:", error);
    throw error;
  }
  
  // 4. Дописывать chunks во время воспроизведения
  let progressiveWorked = false;
  
  for (let i = 0; i < remainingChunks.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms между чанками
    
    // Читаем текущий файл
    const currentBase64 = await FileSystem.readAsStringAsync(filepath, {
      encoding: 'base64'
    });
    const currentBuffer = base64ToArrayBuffer(currentBase64);
    
    // Добавляем новый чанк
    const newBuffer = mergeArrayBuffers([currentBuffer, remainingChunks[i]]);
    const newBase64 = arrayBufferToBase64(newBuffer);
    
    await FileSystem.writeAsStringAsync(filepath, newBase64, {
      encoding: 'base64'
    });
    
    console.log(`📝 [PoC] Appended chunk ${i + 1}/${remainingChunks.length}`);
    
    // Проверяем статус playback
    const status = await sound.getStatusAsync();
    if (status.isLoaded) {
      const position = status.positionMillis;
      const duration = status.durationMillis || 0;
      console.log(`🎵 [PoC] Position: ${position}ms / Duration: ${duration}ms`);
      
      // Если duration увеличивается - progressive loading работает!
      if (duration > initialChunks.length * 100) {
        progressiveWorked = true;
      }
    }
  }
  
  // 5. Дождаться окончания
  await new Promise((resolve) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        console.log("✅ [PoC] Playback finished");
        sound.unloadAsync();
        resolve(true);
      }
    });
  });
  
  return {
    progressiveWorked,
    recommendation: progressiveWorked ? 'hybrid' : 'chunked'
  };
}
```

**Сценарии:**

**Сценарий A: Progressive loading работает (маловероятно)**

- Sound object автоматически подхватывает новые данные
- Duration увеличивается во время playback
- Воспроизведение непрерывное
- → Можно использовать Hybrid Buffering стратегию

**Сценарий B: Progressive loading НЕ работает (ожидаемо)**

- Sound object играет только то что было при создании
- Duration остается фиксированным
- Новые данные игнорируются
- → Нужно использовать Chunked Files стратегию (несколько мини-файлов)

**Критерии успеха:**

- ✅ Определили работает ли progressive loading
- ✅ Выбрали финальную стратегию (Hybrid или Chunked)
- ✅ Playback не прерывается во время теста

**Критерии провала (НЕ критично):**

- ⚠️ Progressive loading не работает → просто используем Chunked strategy
- ❌ Playback падает с ошибкой → КРИТИЧНО, STOP

---

### 0.4 PoC Decision Point (30 мин)

**Анализ результатов:**

Посмотреть на все метрики из 0.1-0.3  
Сравнить с целевыми показателями

**Решения:**

**Если все тесты успешны (GO):**

- ✅ Продолжаем с ФАЗОЙ 1 (Full Implementation)
- ✅ Используем выбранную стратегию (Hybrid или Chunked)
- ✅ Ожидаемое улучшение: ~2500ms → ~300ms (8x faster!)
- ✅ Создать environment variable: `CARTESIA_STREAMING_ENABLED=true`
- ✅ Создать environment variable: `CARTESIA_STREAMING_STRATEGY=chunked` (или hybrid)

**Если есть критичные проблемы (NO-GO):**

- ⚠️ Рассмотреть альтернативу: react-native-audio-toolkit
- ⚠️ Или рассмотреть другой TTS provider с лучшим SDK
- ⚠️ Или остаться на REST API с другими оптимизациями:
  - HTTP/2 multiplexing
  - Параллельные запросы
  - Кеширование частых фраз
  - Pre-generation при загрузке вопросов
- ⚠️ Документировать причины отказа от streaming

**Deliverables PoC:**

Создать файл: `docs/streaming-tts-poc-report.md`

```markdown
# Streaming TTS PoC Report

Date: YYYY-MM-DD
Duration: X hours

## Results

### WebSocket Test (0.1)
- Connection time: XXXms ✅/❌
- First chunk latency: XXXms ✅/❌
- Chunks received: X ✅/❌
- Streaming mode: true/false ✅/❌

### WAV Conversion Test (0.2)
- Conversion: success/fail ✅/❌
- Playback: success/fail ✅/❌
- Audio quality: good/bad ✅/❌

### Progressive Loading Test (0.3)
- Progressive loading: works/doesn't work ⚠️
- Recommended strategy: hybrid/chunked

## Decision

GO / NO-GO

Rationale: ...

## Next Steps

If GO:
- Proceed to Phase 1
- Use [hybrid/chunked] strategy
- Expected improvement: XXXms → XXXms

If NO-GO:
- Alternative approach: ...
- Reason: ...
```

---

## ФАЗА 1: Инфраструктура и Types (1.5 часа)

**ТОЛЬКО ЕСЛИ PoC = GO**

### 1.1 Обновление типов (30 мин)

**Файл:** `src/types.ts`

```typescript
// ========================
// STREAMING TTS TYPES
// ========================

export interface AudioChunk {
  data: ArrayBuffer;        // PCM audio data
  timestamp: number;        // Когда получен (Date.now())
  sequence: number;         // Порядковый номер (0, 1, 2, ...)
  sizeBytes: number;        // Размер чанка
}

export type StreamingPlayerState = 
  | 'idle'        // Не активен
  | 'connecting'  // Подключение к WebSocket
  | 'buffering'   // Накопление минимального буфера
  | 'playing'     // Воспроизведение
  | 'completed'   // Генерация завершена
  | 'error';      // Ошибка

export interface StreamingPlayerConfig {
  minBufferMs: number;      // Минимум перед началом (200ms)
  targetBufferMs: number;   // Целевой буфер (1000ms)
  chunkSampleRate: number;  // Частота (16000Hz)
  maxRetries: number;       // Попытки переподключения (3)
  strategy: 'hybrid' | 'chunked';  // Из PoC
}

export interface CartesiaStreamingOptions {
  voiceId: string;
  text: string;
  emotion?: string[];
  speed?: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest';
  
  // Callbacks
  onChunk?: (chunk: AudioChunk) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onFirstChunk?: (latency: number) => void;
}

export interface StreamingMetrics {
  generationStart: number;    // Timestamp начала
  firstChunkTime: number | null;  // Timestamp первого чанка
  firstPlayTime: number | null;   // Timestamp начала playback
  totalChunks: number;        // Всего чанков
  totalBytes: number;         // Всего байт
  bufferUnderruns: number;    // Количество underruns
  averageChunkSize: number;   // Средний размер чанка
  
  // Calculated
  get timeToFirstChunk(): number | null;
  get timeToFirstPlay(): number | null;
  get totalLatency(): number | null;
}
```

### 1.2 Environment Variables (15 мин)

**Файл:** `.env`

```bash
# Existing
EXPO_PUBLIC_CARTESIA_API_KEY=your_key_here
EXPO_PUBLIC_OPENAI_API_KEY=your_key_here

# NEW: Streaming TTS Configuration
EXPO_PUBLIC_CARTESIA_WS_URL=wss://api.cartesia.ai/tts/websocket
EXPO_PUBLIC_CARTESIA_STREAMING_ENABLED=true
EXPO_PUBLIC_CARTESIA_STREAMING_MIN_BUFFER_MS=200
EXPO_PUBLIC_CARTESIA_STREAMING_TARGET_BUFFER_MS=1000
EXPO_PUBLIC_CARTESIA_STREAMING_STRATEGY=chunked
EXPO_PUBLIC_CARTESIA_WS_PING_INTERVAL_MS=30000
EXPO_PUBLIC_CARTESIA_WS_RECONNECT_MAX_RETRIES=3
EXPO_PUBLIC_CARTESIA_WS_RECONNECT_BACKOFF_MS=1000
```

**Validation при запуске:**

```typescript
// src/config/streaming-config.ts

export const STREAMING_CONFIG = {
  enabled: process.env.EXPO_PUBLIC_CARTESIA_STREAMING_ENABLED === 'true',
  wsUrl: process.env.EXPO_PUBLIC_CARTESIA_WS_URL || 'wss://api.cartesia.ai/tts/websocket',
  minBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_MIN_BUFFER_MS || '200'),
  targetBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_TARGET_BUFFER_MS || '1000'),
  strategy: (process.env.EXPO_PUBLIC_CARTESIA_STREAMING_STRATEGY || 'chunked') as 'hybrid' | 'chunked',
  pingIntervalMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_PING_INTERVAL_MS || '30000'),
  maxRetries: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_RECONNECT_MAX_RETRIES || '3'),
  reconnectBackoffMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_RECONNECT_BACKOFF_MS || '1000'),
};

// Validation
if (STREAMING_CONFIG.enabled) {
  if (!process.env.EXPO_PUBLIC_CARTESIA_API_KEY) {
    throw new Error('EXPO_PUBLIC_CARTESIA_API_KEY required for streaming');
  }
  if (STREAMING_CONFIG.minBufferMs < 100 || STREAMING_CONFIG.minBufferMs > 2000) {
    console.warn(`⚠️ minBufferMs out of range: ${STREAMING_CONFIG.minBufferMs}ms`);
  }
  console.log('✅ Streaming TTS config loaded:', STREAMING_CONFIG);
}
```

### 1.3 Utilities (45 мин)

**Новый файл:** `src/utils/audio-conversion.ts`

```typescript
/**
 * Audio conversion utilities for streaming TTS
 */

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Create WAV file header
 */
export function createWavHeader(
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
  dataSize: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // Helper to write string
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  writeString(8, 'WAVE');
  
  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // Byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // Block align
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  return buffer;
}

/**
 * Merge multiple ArrayBuffers into one
 */
export function mergePCMChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  
  return result.buffer;
}

/**
 * Create complete WAV file from PCM chunks
 */
export function createWavFile(
  pcmChunks: ArrayBuffer[],
  sampleRate: number = 16000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): ArrayBuffer {
  const pcmData = mergePCMChunks(pcmChunks);
  const header = createWavHeader(sampleRate, numChannels, bitsPerSample, pcmData.byteLength);
  
  return mergePCMChunks([header, pcmData]);
}

/**
 * Calculate audio duration from PCM data size
 */
export function calculateAudioDuration(
  dataSize: number,
  sampleRate: number = 16000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): number {
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataSize / (numChannels * bytesPerSample);
  const durationSeconds = totalSamples / sampleRate;
  return durationSeconds * 1000; // Return in milliseconds
}

/**
 * Update WAV header with correct data size
 * (For progressive file writing)
 */
export function updateWavHeaderSize(
  wavBuffer: ArrayBuffer,
  newDataSize: number
): ArrayBuffer {
  const view = new DataView(wavBuffer);
  
  // Update file size at offset 4
  view.setUint32(4, 36 + newDataSize, true);
  
  // Update data chunk size at offset 40
  view.setUint32(40, newDataSize, true);
  
  return wavBuffer;
}
```

---

## ФАЗА 2: Cartesia WebSocket Service (3 часа)

### 2.1 Основной класс (1.5 часа)

**Новый файл:** `src/services/cartesia-streaming-service.ts`

```typescript
import { STREAMING_CONFIG } from '../config/streaming-config';
import { AudioChunk, CartesiaStreamingOptions } from '../types';
import { base64ToArrayBuffer } from '../utils/audio-conversion';

/**
 * Cartesia WebSocket streaming service
 */
class CartesiaStreamingService {
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;
  private reconnectAttempts: number = 0;
  private currentContextId: string | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private messageHandlers: Map<string, (message: any) => void> = new Map();
  
  private readonly apiKey: string;
  private readonly wsUrl: string;
  private readonly maxRetries: number;
  private readonly reconnectBackoffMs: number;
  private readonly pingIntervalMs: number;
  
  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_CARTESIA_API_KEY || '';
    this.wsUrl = STREAMING_CONFIG.wsUrl;
    this.maxRetries = STREAMING_CONFIG.maxRetries;
    this.reconnectBackoffMs = STREAMING_CONFIG.reconnectBackoffMs;
    this.pingIntervalMs = STREAMING_CONFIG.pingIntervalMs;
    
    if (!this.apiKey) {
      console.error('❌ [Cartesia WS] API key not configured');
    }
  }
  
  // ========================
  // CONNECTION MANAGEMENT
  // ========================
  
  /**
   * Connect to WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      console.log('ℹ️ [Cartesia WS] Already connected');
      return;
    }
    
    return new Promise((resolve, reject) => {
      try {
        console.log('🔌 [Cartesia WS] Connecting...');
        const url = `${this.wsUrl}?api_key=${this.apiKey}&cartesia_version=2024-06-10`;
        
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          console.log('✅ [Cartesia WS] Connected');
          this.isConnectedFlag = true;
          this.reconnectAttempts = 0;
          this.startPingInterval();
          resolve();
        };
        
        this.ws.onerror = (error) => {
          console.error('❌ [Cartesia WS] Error:', error);
          if (!this.isConnectedFlag) {
            reject(error);
          }
        };
        
        this.ws.onclose = (event) => {
          console.log(`🔌 [Cartesia WS] Closed: ${event.code} ${event.reason}`);
          this.isConnectedFlag = false;
          this.stopPingInterval();
          
          // Auto-reconnect if unexpected close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxRetries) {
            this.handleReconnect();
          }
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        // Connection timeout
        setTimeout(() => {
          if (!this.isConnectedFlag) {
            console.error('❌ [Cartesia WS] Connection timeout');
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
        
      } catch (error) {
        console.error('❌ [Cartesia WS] Connect error:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    console.log('🔌 [Cartesia WS] Disconnecting...');
    this.stopPingInterval();
    this.messageHandlers.clear();
    this.currentContextId = null;
    
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    
    this.isConnectedFlag = false;
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.isConnectedFlag && this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Get connection state
   */
  getConnectionState(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'error';
    }
  }
  
  // ========================
  // AUDIO GENERATION
  // ========================
  
  /**
   * Generate audio stream (AsyncGenerator)
   */
  async* generateAudioStream(
    options: CartesiaStreamingOptions
  ): AsyncGenerator<AudioChunk, void, unknown> {
    if (!this.isConnected()) {
      await this.connect();
    }
    
    const contextId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.currentContextId = contextId;
    
    console.log(`🎙️ [Cartesia WS] Starting generation: "${options.text.substring(0, 50)}..."`);
    console.log(`🆔 [Cartesia WS] Context ID: ${contextId}`);
    
    // Create chunk queue
    const chunkQueue: AudioChunk[] = [];
    let isGenerating = true;
    let generationError: Error | null = null;
    let chunkSequence = 0;
    
    // Message handler for this context
    const handler = (message: any) => {
      if (message.context_id !== contextId) return;
      
      if (message.type === 'chunk' && message.data) {
        const arrayBuffer = base64ToArrayBuffer(message.data);
        const chunk: AudioChunk = {
          data: arrayBuffer,
          timestamp: Date.now(),
          sequence: chunkSequence++,
          sizeBytes: arrayBuffer.byteLength
        };
        
        chunkQueue.push(chunk);
        
        if (options.onChunk) {
          options.onChunk(chunk);
        }
        
        if (chunk.sequence === 0 && options.onFirstChunk) {
          const latency = Date.now() - generationStart;
          options.onFirstChunk(latency);
        }
      }
      
      if (message.type === 'done') {
        console.log('✅ [Cartesia WS] Generation complete');
        isGenerating = false;
        
        if (options.onComplete) {
          options.onComplete();
        }
      }
      
      if (message.type === 'error') {
        console.error('❌ [Cartesia WS] Generation error:', message.error);
        generationError = new Error(message.error);
        isGenerating = false;
        
        if (options.onError) {
          options.onError(generationError);
        }
      }
    };
    
    this.messageHandlers.set(contextId, handler);
    
    // Send generation request
    const request = {
      context_id: contextId,
      model_id: 'sonic-3',
      transcript: options.text,
      voice: {
        mode: 'id',
        id: options.voiceId
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 16000
      },
      ...(options.emotion && {
        voice: {
          mode: 'id',
          id: options.voiceId,
          __experimental_controls: {
            emotion: options.emotion
          }
        }
      }),
      ...(options.speed && {
        speed: options.speed
      })
    };
    
    const generationStart = Date.now();
    this.ws?.send(JSON.stringify(request));
    
    // Yield chunks as they arrive
    try {
      while (isGenerating || chunkQueue.length > 0) {
        if (chunkQueue.length > 0) {
          yield chunkQueue.shift()!;
        } else {
          // Wait for next chunk
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        if (generationError) {
          throw generationError;
        }
      }
    } finally {
      // Cleanup
      this.messageHandlers.delete(contextId);
      if (this.currentContextId === contextId) {
        this.currentContextId = null;
      }
    }
  }
  
  /**
   * Cancel ongoing generation
   */
  cancelGeneration(): void {
    if (!this.currentContextId) {
      console.log('ℹ️ [Cartesia WS] No active generation to cancel');
      return;
    }
    
    console.log(`⏹️ [Cartesia WS] Cancelling: ${this.currentContextId}`);
    
    // Send cancel request
    this.ws?.send(JSON.stringify({
      context_id: this.currentContextId,
      cancel: true
    }));
    
    // Cleanup
    this.messageHandlers.delete(this.currentContextId);
    this.currentContextId = null;
  }
  
  // ========================
  // PRIVATE METHODS
  // ========================
  
  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      // Route to appropriate handler
      if (message.context_id && this.messageHandlers.has(message.context_id)) {
        const handler = this.messageHandlers.get(message.context_id)!;
        handler(message);
      }
      
      // Handle global messages
      if (message.type === 'pong') {
        // Pong received, connection alive
      }
      
    } catch (error) {
      console.error('❌ [Cartesia WS] Message parse error:', error);
    }
  }
  
  /**
   * Start ping interval for keepalive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.ping();
      }
    }, this.pingIntervalMs);
  }
  
  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  /**
   * Send ping
   */
  private ping(): void {
    if (!this.isConnected()) return;
    
    this.ws?.send(JSON.stringify({ type: 'ping' }));
    
    // Set pong timeout
    setTimeout(() => {
      if (!this.isConnected()) {
        console.error('❌ [Cartesia WS] Ping timeout - reconnecting');
        this.handleReconnect();
      }
    }, 5000);
  }
  
  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxRetries) {
      console.error('❌ [Cartesia WS] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const backoff = Math.min(
      this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );
    
    console.log(`🔄 [Cartesia WS] Reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`);
    
    await new Promise(resolve => setTimeout(resolve, backoff));
    
    try {
      await this.connect();
      console.log('✅ [Cartesia WS] Reconnected successfully');
    } catch (error) {
      console.error('❌ [Cartesia WS] Reconnect failed:', error);
      this.handleReconnect();
    }
  }
}

export default new CartesiaStreamingService();
```

### 2.2 Memory Management & Backpressure (30 мин)

**Стратегия при превышении лимита:**

```typescript
// Inside CartesiaStreamingService

private readonly MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
private currentBufferSize = 0;

// In generateAudioStream handler:
const handler = (message: any) => {
  if (message.type === 'chunk' && message.data) {
    const arrayBuffer = base64ToArrayBuffer(message.data);
    
    // Check buffer size
    if (this.currentBufferSize + arrayBuffer.byteLength > this.MAX_BUFFER_SIZE_BYTES) {
      console.warn(`⚠️ [Cartesia WS] Buffer limit reached (${this.currentBufferSize} bytes)`);
      
      // Strategy 1: Drop oldest chunks (для real-time priority)
      while (chunkQueue.length > 0 && this.currentBufferSize > this.MAX_BUFFER_SIZE_BYTES / 2) {
        const dropped = chunkQueue.shift()!;
        this.currentBufferSize -= dropped.sizeBytes;
        console.warn(`⚠️ [Cartesia WS] Dropped chunk #${dropped.sequence}`);
      }
      
      // Strategy 2: Pause WebSocket (для качества priority)
      // this.ws?.send(JSON.stringify({ context_id: contextId, pause: true }));
    }
    
    const chunk: AudioChunk = {
      data: arrayBuffer,
      timestamp: Date.now(),
      sequence: chunkSequence++,
      sizeBytes: arrayBuffer.byteLength
    };
    
    chunkQueue.push(chunk);
    this.currentBufferSize += chunk.sizeBytes;
  }
};

// When yielding chunk:
if (chunkQueue.length > 0) {
  const chunk = chunkQueue.shift()!;
  this.currentBufferSize -= chunk.sizeBytes;
  yield chunk;
}
```

---

## ФАЗА 3: Streaming Audio Player (4 часа)

**Используем Chunked Files Strategy** (т.к. Progressive Loading скорее всего не работает)

### 3.1 Chunked Streaming Player (2.5 часа)

**Новый файл:** `src/services/streaming-audio-player-chunked.ts`

```typescript
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { StreamingPlayerState, StreamingPlayerConfig, AudioChunk, StreamingMetrics } from '../types';
import { createWavFile, arrayBufferToBase64, calculateAudioDuration } from '../utils/audio-conversion';
import { STREAMING_CONFIG } from '../config/streaming-config';

/**
 * Chunked Files Strategy Player
 * Creates multiple mini WAV files and plays them sequentially
 */
class ChunkedStreamingPlayer {
  private state: StreamingPlayerState = 'idle';
  private chunkFiles: string[] = [];
  private currentSound: Audio.Sound | null = null;
  private nextSound: Audio.Sound | null = null;
  private playbackQueue: AudioChunk[][] = [];
  private config: StreamingPlayerConfig;
  private metrics: StreamingMetrics;
  
  private readonly CHUNKS_PER_FILE = 5; // ~200-250ms per file at 16kHz
  private readonly PRELOAD_THRESHOLD = 0.8; // Start preloading at 80% of current file
  
  constructor(config?: Partial<StreamingPlayerConfig>) {
    this.config = {
      minBufferMs: config?.minBufferMs || STREAMING_CONFIG.minBufferMs,
      targetBufferMs: config?.targetBufferMs || STREAMING_CONFIG.targetBufferMs,
      chunkSampleRate: 16000,
      maxRetries: 3,
      strategy: 'chunked'
    };
    
    this.metrics = this.createEmptyMetrics();
  }
  
  /**
   * Play audio stream from AsyncGenerator
   */
  async playStream(
    chunkGenerator: AsyncGenerator<AudioChunk, void, unknown>
  ): Promise<void> {
    console.log('🎵 [Chunked Player] Starting playback...');
    this.state = 'buffering';
    this.metrics = this.createEmptyMetrics();
    this.metrics.generationStart = Date.now();
    
    let accumulatedChunks: AudioChunk[] = [];
    let fileIndex = 0;
    let isFirstFile = true;
    
    try {
      // Process chunks from generator
      for await (const chunk of chunkGenerator) {
        this.metrics.totalChunks++;
        this.metrics.totalBytes += chunk.sizeBytes;
        
        if (this.metrics.firstChunkTime === null) {
          this.metrics.firstChunkTime = Date.now();
          console.log(`🎯 [Chunked Player] First chunk in ${this.metrics.firstChunkTime - this.metrics.generationStart}ms`);
        }
        
        accumulatedChunks.push(chunk);
        
        // Create file when we have enough chunks
        if (accumulatedChunks.length >= this.CHUNKS_PER_FILE) {
          const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
          fileIndex++;
          
          console.log(`📦 [Chunked Player] Created file #${fileIndex}: ${filepath}`);
          
          // Play first file immediately after min buffer
          if (isFirstFile) {
            const bufferDuration = calculateAudioDuration(
              accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
            );
            
            if (bufferDuration >= this.config.minBufferMs) {
              console.log(`✅ [Chunked Player] Min buffer reached (${bufferDuration}ms) - starting playback`);
              await this.playFile(filepath);
              this.state = 'playing';
              this.metrics.firstPlayTime = Date.now();
              isFirstFile = false;
            }
          } else {
            // Preload next file
            await this.preloadNextFile(filepath);
          }
          
          accumulatedChunks = [];
        }
      }
      
      // Handle remaining chunks
      if (accumulatedChunks.length > 0) {
        const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
        console.log(`📦 [Chunked Player] Created final file: ${filepath}`);
        
        if (isFirstFile) {
          await this.playFile(filepath);
          this.state = 'playing';
          this.metrics.firstPlayTime = Date.now();
        } else {
          await this.preloadNextFile(filepath);
        }
      }
      
      // Wait for all files to finish playing
      await this.waitForCompletion();
      
      this.state = 'completed';
      console.log('✅ [Chunked Player] Playback completed');
      console.log(`📊 [Chunked Player] Stats:`, this.getStats());
      
    } catch (error) {
      console.error('❌ [Chunked Player] Playback error:', error);
      this.state = 'error';
      throw error;
    } finally {
      await this.cleanup();
    }
  }
  
  /**
   * Create WAV file from chunks
   */
  private async createChunkFile(
    chunks: AudioChunk[],
    index: number
  ): Promise<string> {
    const pcmBuffers = chunks.map(c => c.data);
    const wavBuffer = createWavFile(pcmBuffers, this.config.chunkSampleRate);
    const base64 = arrayBufferToBase64(wavBuffer);
    
    const filename = `stream_chunk_${Date.now()}_${index}.wav`;
    const filepath = `${FileSystem.cacheDirectory}${filename}`;
    
    await FileSystem.writeAsStringAsync(filepath, base64, {
      encoding: 'base64'
    });
    
    this.chunkFiles.push(filepath);
    return filepath;
  }
  
  /**
   * Play a single file
   */
  private async playFile(filepath: string): Promise<void> {
    console.log(`🔊 [Chunked Player] Playing: ${filepath}`);
    
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: filepath },
        { shouldPlay: true, volume: 1.0 }
      );
      
      this.currentSound = sound;
      
      // Setup playback monitoring for preloading
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          const progress = status.positionMillis / (status.durationMillis || 1);
          
          // Preload next file when current reaches threshold
          if (progress >= this.PRELOAD_THRESHOLD && this.nextSound === null) {
            const currentIndex = this.chunkFiles.indexOf(filepath);
            const nextFilepath = this.chunkFiles[currentIndex + 1];
            
            if (nextFilepath) {
              console.log(`⏭️ [Chunked Player] Preloading next file...`);
              this.preloadNextFile(nextFilepath);
            }
          }
          
          // Switch to next file when current finishes
          if (status.didJustFinish) {
            console.log(`✅ [Chunked Player] File finished: ${filepath}`);
            this.switchToNextFile();
          }
        }
      });
      
    } catch (error) {
      console.error(`❌ [Chunked Player] Play error:`, error);
      throw error;
    }
  }
  
  /**
   * Preload next file
   */
  private async preloadNextFile(filepath: string): Promise<void> {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: filepath },
        { shouldPlay: false, volume: 1.0 }
      );
      
      this.nextSound = sound;
      console.log(`✅ [Chunked Player] Preloaded: ${filepath}`);
      
    } catch (error) {
      console.error(`❌ [Chunked Player] Preload error:`, error);
    }
  }
  
  /**
   * Switch to next preloaded file
   */
  private async switchToNextFile(): Promise<void> {
    if (this.currentSound) {
      await this.currentSound.unloadAsync();
      this.currentSound = null;
    }
    
    if (this.nextSound) {
      const switchStart = Date.now();
      
      this.currentSound = this.nextSound;
      this.nextSound = null;
      
      await this.currentSound.playAsync();
      
      const switchTime = Date.now() - switchStart;
      console.log(`🔄 [Chunked Player] Switched in ${switchTime}ms`);
      
      if (switchTime > 100) {
        console.warn(`⚠️ [Chunked Player] Slow switch detected: ${switchTime}ms`);
      }
    }
  }
  
  /**
   * Wait for all files to complete
   */
  private async waitForCompletion(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        if (!this.currentSound && !this.nextSound) {
          clearInterval(checkInterval);
          resolve();
        }
        
        if (this.currentSound) {
          const status = await this.currentSound.getStatusAsync();
          if (status.isLoaded && status.didJustFinish && !this.nextSound) {
            clearInterval(checkInterval);
            resolve();
          }
        }
      }, 100);
    });
  }
  
  /**
   * Stop playback
   */
  async stop(): Promise<void> {
    console.log('⏹️ [Chunked Player] Stopping...');
    
    if (this.currentSound) {
      await this.currentSound.stopAsync();
      await this.currentSound.unloadAsync();
      this.currentSound = null;
    }
    
    if (this.nextSound) {
      await this.nextSound.unloadAsync();
      this.nextSound = null;
    }
    
    this.state = 'idle';
  }
  
  /**
   * Get current state
   */
  getState(): StreamingPlayerState {
    return this.state;
  }
  
  /**
   * Get statistics
   */
  getStats(): StreamingMetrics {
    return {
      ...this.metrics,
      averageChunkSize: this.metrics.totalChunks > 0 
        ? this.metrics.totalBytes / this.metrics.totalChunks 
        : 0,
      get timeToFirstChunk() {
        return this.firstChunkTime ? this.firstChunkTime - this.generationStart : null;
      },
      get timeToFirstPlay() {
        return this.firstPlayTime ? this.firstPlayTime - this.generationStart : null;
      },
      get totalLatency() {
        return this.firstPlayTime ? this.firstPlayTime - this.generationStart : null;
      }
    };
  }
  
  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 [Chunked Player] Cleaning up...');
    
    // Unload sounds
    if (this.currentSound) {
      await this.currentSound.unloadAsync();
      this.currentSound = null;
    }
    
    if (this.nextSound) {
      await this.nextSound.unloadAsync();
      this.nextSound = null;
    }
    
    // Delete temporary files
    for (const filepath of this.chunkFiles) {
      try {
        await FileSystem.deleteAsync(filepath, { idempotent: true });
      } catch (error) {
        console.warn(`⚠️ [Chunked Player] Failed to delete: ${filepath}`);
      }
    }
    
    this.chunkFiles = [];
    console.log('✅ [Chunked Player] Cleanup complete');
  }
  
  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): StreamingMetrics {
    return {
      generationStart: 0,
      firstChunkTime: null,
      firstPlayTime: null,
      totalChunks: 0,
      totalBytes: 0,
      bufferUnderruns: 0,
      averageChunkSize: 0,
      get timeToFirstChunk() { return null; },
      get timeToFirstPlay() { return null; },
      get totalLatency() { return null; }
    };
  }
}

export default ChunkedStreamingPlayer;
```

### 3.2 Periodic Cleanup Service (30 мин)

**Новый файл:** `src/services/temp-file-cleanup-service.ts`

```typescript
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Cleanup old temporary audio files
 * Runs on app start and periodically
 */
class TempFileCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  /**
   * Start periodic cleanup
   */
  start(): void {
    if (this.cleanupInterval) return;
    
    console.log('🧹 [Cleanup] Starting periodic cleanup...');
    
    // Run immediately
    this.cleanupOldFiles();
    
    // Run every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldFiles();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Stop periodic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🧹 [Cleanup] Stopped');
    }
  }
  
  /**
   * Cleanup old files
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) return;
      
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      const now = Date.now();
      const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
      
      let deletedCount = 0;
      let deletedBytes = 0;
      
      for (const filename of files) {
        // Only process our temp files
        if (!filename.startsWith('stream_chunk_') && 
            !filename.startsWith('speech_') &&
            !filename.startsWith('openai_speech_')) {
          continue;
        }
        
        const filepath = `${cacheDir}${filename}`;
        
        try {
          const info = await FileSystem.getInfoAsync(filepath);
          
          if (info.exists && info.modificationTime) {
            const age = now - info.modificationTime * 1000;
            
            if (age > MAX_AGE_MS) {
              await FileSystem.deleteAsync(filepath, { idempotent: true });
              deletedCount++;
              deletedBytes += info.size || 0;
            }
          }
        } catch (error) {
          console.warn(`⚠️ [Cleanup] Failed to process: ${filename}`);
        }
      }
      
      if (deletedCount > 0) {
        const mb = (deletedBytes / (1024 * 1024)).toFixed(2);
        console.log(`🧹 [Cleanup] Deleted ${deletedCount} files (${mb} MB)`);
      }
      
    } catch (error) {
      console.error('❌ [Cleanup] Error:', error);
    }
  }
}

export default new TempFileCleanupService();
```

---

## ФАЗА 4: Интеграция в TTSService (2.5 часа)

### 4.1 Обновление TTSService (2 часа)

**Файл:** `src/services/tts-service.ts`

**Изменения:**

```typescript
import cartesiaStreaming from './cartesia-streaming-service';
import ChunkedStreamingPlayer from './streaming-audio-player-chunked';
import tempFileCleanup from './temp-file-cleanup-service';
import { STREAMING_CONFIG } from '../config/streaming-config';

class TTSService {
  // Existing fields...
  
  // NEW: Streaming fields
  private useStreamingForCartesia: boolean = STREAMING_CONFIG.enabled;
  private streamingPlayer: ChunkedStreamingPlayer | null = null;
  private currentStreamingContext: string | null = null;
  
  constructor() {
    this.initialize();
    this.openaiApiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    this.loadSettings();
    
    // NEW: Initialize streaming if enabled
    if (this.useStreamingForCartesia) {
      console.log('✅ [TTS] Streaming TTS enabled');
      this.streamingPlayer = new ChunkedStreamingPlayer();
      
      // Start cleanup service
      tempFileCleanup.start();
      
      // Pre-connect WebSocket for faster first request
      cartesiaStreaming.connect().catch(err => {
        console.warn('⚠️ [TTS] Pre-connection failed:', err);
      });
    }
  }
  
  // ========================
  // UPDATED speak() METHOD
  // ========================
  
  async speak(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    // Mute check
    if (this.isMuted) {
      console.log(`🔇 [TTS] Muted - skipping speech`);
      return true;
    }
    
    try {
      console.log(`🎙️ [TTS] Speaking: "${text.substring(0, 50)}..."`);
      
      // Route to appropriate provider
      if (this.ttsProvider === 'openai') {
        return await this.speakOpenAI(text, options);
      } else {
        // Cartesia with streaming support
        if (this.useStreamingForCartesia) {
          try {
            return await this.speakCartesiaStreaming(text, options);
          } catch (error) {
            console.warn('⚠️ [TTS] Streaming failed, falling back to REST:', error);
            return await this.speakCartesiaRest(text, options);
          }
        } else {
          return await this.speakCartesiaRest(text, options);
        }
      }
      
    } catch (error) {
      console.error("❌ [TTS] Speak error:", error);
      return false;
    }
  }
  
  // ========================
  // NEW STREAMING METHOD
  // ========================
  
  /**
   * Speak using Cartesia streaming
   */
  private async speakCartesiaStreaming(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    if (!this.streamingPlayer) {
      throw new Error('Streaming player not initialized');
    }
    
    console.log('🎙️ [TTS] Using Cartesia streaming...');
    
    // Cancel previous streaming if any
    if (this.currentStreamingContext) {
      cartesiaStreaming.cancelGeneration();
      await this.streamingPlayer.stop();
    }
    
    const VOICE_ID = "e07c00bc-4134-4eae-9ea4-1a55fb45746b";
    
    // Map speed number to Cartesia speed string
    let speedString: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' = 'normal';
    if (options?.speed) {
      if (options.speed <= 0.75) speedString = 'slowest';
      else if (options.speed <= 0.9) speedString = 'slow';
      else if (options.speed >= 1.25) speedString = 'fastest';
      else if (options.speed >= 1.1) speedString = 'fast';
    }
    
    try {
      // Generate unique context
      const contextId = `tts-${Date.now()}`;
      this.currentStreamingContext = contextId;
      
      // Create AsyncGenerator
      const chunkGenerator = cartesiaStreaming.generateAudioStream({
        voiceId: VOICE_ID,
        text: text,
        emotion: options?.emotionLevel,
        speed: speedString,
        onFirstChunk: (latency) => {
          console.log(`🎯 [TTS] First chunk latency: ${latency}ms`);
        },
        onComplete: () => {
          console.log('✅ [TTS] Streaming generation complete');
        },
        onError: (error) => {
          console.error('❌ [TTS] Streaming generation error:', error);
        }
      });
      
      // Play stream
      if (options?.autoPlay !== false) {
        await this.streamingPlayer.playStream(chunkGenerator);
      }
      
      return true;
      
    } catch (error) {
      console.error('❌ [TTS] Streaming error:', error);
      throw error;
    } finally {
      this.currentStreamingContext = null;
    }
  }
  
  // ========================
  // RENAMED REST METHOD
  // ========================
  
  /**
   * Speak using Cartesia REST API (renamed from fetchCartesiaAudioFile)
   */
  private async speakCartesiaRest(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    console.log('🎙️ [TTS] Using Cartesia REST...');
    
    const audioFile = await this.fetchCartesiaAudioFileRest(text, options);
    
    if (!audioFile) {
      console.error("❌ [TTS] Failed to fetch audio");
      return false;
    }
    
    if (options?.autoPlay !== false) {
      return await this.playAudioFile(audioFile, options?.speed);
    }
    
    return true;
  }
  
  /**
   * Fetch audio file from Cartesia REST API
   * (Same as old fetchCartesiaAudioFile but renamed)
   */
  private async fetchCartesiaAudioFileRest(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<string | null> {
    // EXACT SAME CODE as existing fetchCartesiaAudioFile
    // Just rename and remove hardcoded key
    
    const API_KEY = process.env.EXPO_PUBLIC_CARTESIA_API_KEY; // ✅ FIXED
    
    if (!API_KEY) {
      console.error('❌ [TTS] Cartesia API key not configured');
      return null;
    }
    
    // ... rest of existing implementation ...
    
    // (keep all existing code, just use API_KEY from env)
  }
  
  // ========================
  // RENAMED OPENAI METHOD
  // ========================
  
  /**
   * Speak using OpenAI TTS (renamed for consistency)
   */
  private async speakOpenAI(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    console.log('🎙️ [TTS] Using OpenAI...');
    
    const audioFile = await this.fetchOpenAIAudioFile(text, options);
    
    if (!audioFile) {
      console.error("❌ [TTS] Failed to fetch audio");
      return false;
    }
    
    if (options?.autoPlay !== false) {
      return await this.playAudioFile(audioFile, options?.speed);
    }
    
    return true;
  }
  
  // ========================
  // CLEANUP
  // ========================
  
  async cleanup(): Promise<void> {
    await this.stop();
    
    if (this.streamingPlayer) {
      await this.streamingPlayer.stop();
    }
    
    cartesiaStreaming.disconnect();
    tempFileCleanup.stop();
  }
}
```

### 4.2 Feature Flag Control (30 мин)

**Добавить в UI настроек:**

```typescript
// In settings screen

import { STREAMING_CONFIG } from '../config/streaming-config';

function SettingsScreen() {
  const [streamingEnabled, setStreamingEnabled] = useState(STREAMING_CONFIG.enabled);
  
  const toggleStreaming = async () => {
    const newValue = !streamingEnabled;
    setStreamingEnabled(newValue);
    
    // Save to AsyncStorage
    await AsyncStorage.setItem('streaming_enabled', newValue.toString());
    
    // Update config (requires app restart)
    Alert.alert(
      'Restart Required',
      'Please restart the app to apply streaming settings.',
      [{ text: 'OK' }]
    );
  };
  
  return (
    <View>
      {/* ... existing settings ... */}
      
      <View>
        <Text>Streaming TTS (Experimental)</Text>
        <Switch value={streamingEnabled} onValueChange={toggleStreaming} />
        <Text style={{ fontSize: 12, color: 'gray' }}>
          Reduces latency from ~2.5s to ~0.3s
        </Text>
      </View>
    </View>
  );
}
```

---

## 📊 Целевые метрики

**Текущее состояние (REST API):**
- Time to first audio: ~2500ms
- Total request time: ~2500-3000ms
- Breakdown: Fetch=2000ms, ArrayBuffer=300ms, Save=200ms

**Целевое состояние (Streaming):**
- Time to first chunk: <300ms ✅
- Time to first playback: <500ms ✅
- Total latency improvement: ~8x faster ✅

**Метрики качества:**
- Audio quality: No degradation
- Playback continuity: <50ms gaps between chunks
- Memory usage: <10MB buffer
- Network reliability: >95% success rate

---

## 🚨 Rollback Plan

**Если Streaming не работает:**

1. **Immediate fallback** - уже реализовано через try/catch
2. **Feature flag disable** - установить `CARTESIA_STREAMING_ENABLED=false`
3. **Code rollback** - весь streaming код изолирован, легко удалить
4. **Alternative optimizations:**
   - Pre-generate common phrases
   - HTTP/2 connection pooling
   - Parallel requests for multiple questions
   - Client-side caching

**Критерии для rollback:**
- ❌ Success rate <80% в production
- ❌ Playback artifacts в >10% случаев
- ❌ Latency improvement <3x
- ❌ Memory leaks или crashes

---

## ✅ Success Criteria (Final)

**Technical:**
- ✅ WebSocket stable connection >95%
- ✅ First chunk latency <300ms avg
- ✅ Playback starts <500ms avg
- ✅ No audio artifacts or gaps
- ✅ Memory usage <10MB
- ✅ Cleanup works correctly
- ✅ Fallback to REST works

**User Experience:**
- ✅ Noticeably faster responses
- ✅ Smooth playback
- ✅ No quality degradation
- ✅ Works on iOS and Android

**Code Quality:**
- ✅ Well-documented
- ✅ Error handling robust
- ✅ Easy to disable/rollback
- ✅ Metrics logged

---

## 📝 Testing Checklist

**Unit Tests:**
- [ ] WAV header creation
- [ ] PCM merging
- [ ] Base64 conversion
- [ ] Duration calculation

**Integration Tests:**
- [ ] WebSocket connection
- [ ] Chunk receiving
- [ ] File creation
- [ ] Playback sequencing

**End-to-End Tests:**
- [ ] Full streaming flow
- [ ] Network interruption recovery
- [ ] Memory cleanup
- [ ] Concurrent requests

**Device Tests:**
- [ ] iOS (different versions)
- [ ] Android (different versions)
- [ ] Different network conditions
- [ ] Background/foreground switching

---

## 🎯 Estimated Timeline

- **ФАЗА 0 (PoC):** 4-5 hours
- **ФАЗА 1 (Types):** 1.5 hours
- **ФАЗА 2 (WebSocket):** 3 hours
- **ФАЗА 3 (Player):** 4 hours
- **ФАЗА 4 (Integration):** 2.5 hours
- **Testing & Polish:** 3 hours

**Total:** ~18-20 hours (~2.5 days)

---

## 🔧 Troubleshooting Guide

**WebSocket не подключается:**
- Проверить API key
- Проверить network permissions
- Попробовать без VPN
- Логировать WebSocket errors

**Чанки не приходят:**
- Проверить request format
- Логировать все WebSocket messages
- Проверить voice_id корректность

**Audio artifacts:**
- Проверить WAV header
- Проверить PCM byte order
- Проверить sample rate consistency
- Тестировать на разных фразах

**Memory leaks:**
- Проверить cleanup вызовы
- Использовать React DevTools Profiler
- Мониторить FileSystem.cacheDirectory size
- Проверить unloadAsync() для всех Sound objects

**Slow switching между файлами:**
- Увеличить PRELOAD_THRESHOLD
- Уменьшить CHUNKS_PER_FILE
- Проверить FileSystem performance
- Логировать switch timing

---

**END OF PLAN**
