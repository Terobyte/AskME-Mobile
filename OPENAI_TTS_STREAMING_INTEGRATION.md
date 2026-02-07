# OpenAI TTS Streaming Integration Plan

## Обновление Февраль 2025

**OpenAI обновила TTS API!** Новые возможности:

| Параметр | Старое значение | Новое значение |
|----------|-----------------|----------------|
| Модель | `gpt-4o-audio-preview` | `gpt-4o-mini-tts` |
| Голосов | 6 | 13 |
| Управление тоном | Нет | `instructions` параметр ⭐ |
| Лучшее качество | - | `marin`, `cedar` ⭐ |

### Новые голоса (2025):

```
Стандартные (6): alloy, echo, fable, nova, onyx, shimmer
Новые (7):       ash, ballad, coral, sage, verse, marin, cedar
```

**Рекомендация:** Используйте `marin` или `cedar` для лучшего качества.

---

## Статус Реализации

| Компонент | Статус | Файл | Действие |
|-----------|--------|------|----------|
| OpenAI Streaming Service | ⚠️ UPDATE | `src/services/openai-streaming-service.ts` | Обновить модель, голоса, добавить byte alignment |
| OpenAI Streaming Player | ⚠️ UPDATE | `src/services/audio/OpenAIStreamingPlayer.ts` | Обновить модель, добавить instructions |
| PCM16 Resampler (24kHz→16kHz) | ✅ DONE | `src/utils/audio/PCM16Resampler.ts` | - |
| Types (OpenAIVoice, etc.) | ⚠️ UPDATE | `src/types.ts` | Добавить новые голоса, OpenAITTSModel |
| TTS Service Integration | ⚠️ UPDATE | `src/services/tts-service.ts` | Обновить модель |
| TestAudioStreamPage UI | ❌ TODO | `src/screens/TestAudioStreamPage.tsx` | Интеграция + instructions UI |
| .env Configuration | ❌ TODO | `EXPO_PUBLIC_OPENAI_API_KEY` | Добавить |

---

## План Работ

### Phase 1: Обновить types.ts

**Файл:** `src/types.ts` (строки ~294-300)

```typescript
/**
 * OpenAI TTS Model
 * gpt-4o-mini-tts - newest, supports instructions, recommended
 * tts-1 - lower latency
 * tts-1-hd - higher quality
 */
export type OpenAITTSModel = 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';

/**
 * OpenAI TTS Voice - Full list for gpt-4o-mini-tts
 * Updated 2025-02
 * marin and cedar recommended for best quality
 */
export type OpenAIVoice =
  | 'alloy'   // Сбалансированный
  | 'ash'     // NEW - Soft, calm voice
  | 'ballad'  // NEW - Expressive, musical quality
  | 'coral'   // NEW - Cheerful, upbeat tone
  | 'echo'    // Мужской, мягкий
  | 'fable'   // Мужской, британский
  | 'nova'    // Женский, дружелюбный
  | 'onyx'    // Мужской, глубокий
  | 'sage'    // NEW - Warm, storytelling voice
  | 'shimmer' // Женский, мягкий
  | 'verse'   // NEW - Energetic, dynamic tone
  | 'marin'   // NEW - ⭐ Best quality recommended
  | 'cedar';  // NEW - ⭐ Best quality recommended

/**
 * OpenAI Streaming Options
 */
export interface OpenAIStreamingOptions {
  voiceId: OpenAIVoice;
  text: string;
  model?: OpenAITTSModel;
  speed?: number; // 0.25 - 4.0
  instructions?: string; // 🆕 Voice style instructions
  onChunk?: (chunk: AudioChunk) => void;
  onFirstChunk?: (latency: number) => void;
}

/**
 * OpenAI Stream Config
 */
export interface OpenAIStreamConfig {
  apiKey: string;
  model?: OpenAITTSModel;
  voiceId: OpenAIVoice;
  speed?: number;
  instructions?: string;
}
```

---

### Phase 2: Обновить openai-streaming-service.ts

**Файл:** `src/services/openai-streaming-service.ts`

**2.1 Обновить импорты и типы:**

```typescript
import { AudioChunk, OpenAIVoice, OpenAITTSModel, OpenAIStreamConfig } from '../types';

export interface OpenAIStreamOptions extends OpenAIStreamConfig {
  text: string;
  onFirstChunk?: (latency: number) => void;
  onChunk?: (chunk: AudioChunk) => void;
}
```

**2.2 Добавить byte alignment handling:**

```typescript
export class OpenAIStreamingService {
  private abortController: AbortController | null = null;
  private isStreaming: boolean = false;
  private pendingBytes: Uint8Array = new Uint8Array(0); // 🆕 Byte alignment

  // ...

  async *generateAudioStream(
    options: OpenAIStreamOptions
  ): AsyncGenerator<AudioChunk> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.isStreaming = true;
    this.pendingBytes = new Uint8Array(0); // Reset

    const {
      apiKey,
      text,
      voiceId,
      model = 'gpt-4o-mini-tts',  // ✅ Updated default
      speed = 1.0,
      instructions,  // 🆕
      onFirstChunk,
      onChunk,
    } = options;

    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║      OpenAI Streaming Service           ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║ Model:              ${String(model).padEnd(24)} ║`);
    console.log(`║ Voice:              ${String(voiceId).padEnd(24)} ║`);
    console.log(`║ Speed:              ${String(speed.toFixed(2)).padEnd(24)} ║`);
    if (instructions) {
      console.log(`║ Instructions:      ${String(instructions.substring(0, 20)).padEnd(24)} ║`);
    }
    console.log(`║ Text length:        ${String(text.length + ' chars').padEnd(24)} ║`);
    console.log(`╚════════════════════════════════════════╝`);

    try {
      const requestBody: Record<string, unknown> = {
        model,
        input: text,
        voice: voiceId,
        response_format: 'pcm',
        speed,
      };

      // 🆕 Add instructions only for gpt-4o-mini-tts
      if (instructions && model === 'gpt-4o-mini-tts') {
        requestBody.instructions = instructions;
      }

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      // ... error handling ...

      const reader = response.body!.getReader();
      let chunkIndex = 0;
      let firstChunk = true;
      let totalBytes = 0;

      console.log('[OpenAI Streaming] Stream connected, reading chunks...');

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.isStreaming = false;
          console.log(`[OpenAI Streaming] Stream complete: ${chunkIndex} chunks, ${totalBytes} bytes total`);
          break;
        }

        if (value) {
          // 🆕 Byte alignment handling - combine with pending bytes
          const combined = new Uint8Array(this.pendingBytes.length + value.length);
          combined.set(this.pendingBytes);
          combined.set(value, this.pendingBytes.length);

          // Only process complete PCM16 samples (2 bytes per sample)
          const completeBytes = Math.floor(combined.length / 2) * 2;
          this.pendingBytes = combined.slice(completeBytes);

          if (completeBytes > 0) {
            totalBytes += completeBytes;

            const pcmData = new Int16Array(
              combined.buffer,
              combined.byteOffset,
              completeBytes / 2
            );

            const chunk: AudioChunk = {
              data: {
                data: pcmData,
                format: 'pcm16',
                sampleRate: 24000,
              },
              index: chunkIndex++,
              timestamp: Date.now(),
            };

            if (firstChunk && onFirstChunk) {
              const latency = Date.now() - startTime;
              onFirstChunk(latency);
              console.log(`[OpenAI Streaming] First chunk received: ${latency}ms latency`);
              firstChunk = false;
            }

            if (onChunk) {
              onChunk(chunk);
            }

            yield chunk;
          }
        }
      }

      // 🆕 Handle remaining bytes
      if (this.pendingBytes.length >= 2) {
        const remaining = Math.floor(this.pendingBytes.length / 2) * 2;
        if (remaining > 0) {
          const pcmData = new Int16Array(
            this.pendingBytes.buffer,
            this.pendingBytes.byteOffset,
            remaining / 2
          );
          yield {
            data: { data: pcmData, format: 'pcm16', sampleRate: 24000 },
            index: chunkIndex++,
            timestamp: Date.now(),
          };
        }
      }

    } catch (error) {
      this.isStreaming = false;

      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[OpenAI Streaming] Stream aborted');
        return;
      }

      console.error('[OpenAI Streaming] Error:', error);
      throw error;
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isStreaming = false;
    this.pendingBytes = new Uint8Array(0); // Reset
  }
}
```

---

### Phase 3: Обновить OpenAIStreamingPlayer.ts

**Файл:** `src/services/audio/OpenAIStreamingPlayer.ts`

**3.1 Обновить speak метод:**

```typescript
async speak(text: string, options?: {
  voiceId?: OpenAIVoice;
  speed?: number;
  instructions?: string;  // 🆕
}): Promise<void> {
  // ...

  const stream = this.openaiService.generateAudioStream({
    apiKey: this.apiKey,
    text,
    voiceId: options?.voiceId || 'marin',  // Changed default to marin (best quality)
    model: 'gpt-4o-mini-tts',
    speed: options?.speed ?? 1.0,
    instructions: options?.instructions,  // 🆕
    onFirstChunk: (latency) => {
      this.firstChunkTime = Date.now();
      console.log(`[OpenAIStreamingPlayer] First chunk latency: ${latency}ms`);
    },
    onChunk: (chunk) => {
      this.chunksReceived++;
    },
  });

  // ...
}
```

---

### Phase 4: Обновить tts-service.ts

**Файл:** `src/services/tts-service.ts`

**4.1 Заменить все упоминания старой модели:**

```bash
# Найти:
gpt-4o-mini-audio-preview
gpt-4o-audio-preview

# Заменить на:
gpt-4o-mini-tts
```

**4.2 Обновить вызов OpenAI player:**

```typescript
await (player as any).speak(text, {
  voiceId: this.openaiVoice,
  speed: options?.speed,
  instructions: options?.instructions,  // 🆕
});
```

---

### Phase 5: Интеграция в TestAudioStreamPage.tsx

**Файл:** `src/screens/TestAudioStreamPage.tsx`

**5.1 Добавить импорты (после строки ~33):**

```typescript
import {
  OpenAIStreamingPlayer,
  PlayerState as OpenAIPlayerState,
  PlayerMetrics as OpenAIPlayerMetrics,
  getOpenAIStreamingPlayer,
} from '../services/audio/OpenAIStreamingPlayer';
import { Constants } from 'expo-constants';  // Добавить для API key
```

**5.2 Обновить тип TTSProvider (строка ~44):**

```typescript
type TTSProvider = 'cartesia' | 'deepgram' | 'openai';
```

**5.3 Обновить playerRef тип (строка ~66):**

```typescript
const playerRef = useRef<CartesiaStreamingPlayer | DeepgramStreamingPlayer | OpenAIStreamingPlayer | null>(null);
```

**5.4 Добавить state для OpenAI (после строки ~73):**

```typescript
const [openaiVoice, setOpenaiVoice] = useState<OpenAIVoice>('marin'); // Default = best quality
const [openaiInstructions, setOpenaiInstructions] = useState<string>(''); // 🆕

// 🆕 Instruction presets
const instructionPresets = [
  { label: 'Default', value: '' },
  { label: 'Cheerful', value: 'Speak in a cheerful and positive tone.' },
  { label: 'Calm', value: 'Speak in a calm, soothing voice.' },
  { label: 'Whisper', value: 'Whisper softly.' },
  { label: 'Excited', value: 'Sound excited and energetic!' },
  { label: 'Professional', value: 'Speak in a professional, business-like tone.' },
  { label: 'Storyteller', value: 'Speak like a storyteller, with dramatic pauses.' },
];
```

**5.5 Обновить player creation (строки ~99-112):**

```typescript
const player = ttsProvider === 'cartesia'
  ? getCartesiaStreamingPlayer({
      sampleRate: 16000,
      preBufferThreshold: 500,
      maxBufferSize: 5,
      chunkSize: 2048,
    })
  : ttsProvider === 'deepgram'
  ? getDeepgramStreamingPlayer({
      sampleRate: 16000,
      preBufferThreshold: 500,
      maxBufferSize: 5,
      chunkSize: 2048,
    })
  : getOpenAIStreamingPlayer(
      Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY || 'your-key-here',
      {
        sampleRate: 16000,
        preBufferThreshold: 500,
        maxBufferSize: 5,
        chunkSize: 2048,
      }
    );
```

**5.6 Обновить handleStart (строки ~199-208):**

```typescript
try {
  if (ttsProvider === 'cartesia') {
    await (playerRef.current as CartesiaStreamingPlayer).speak(TEST_TEXTS[selectedText], {
      emotion: ['positivity:high'],
      speed: 'normal',
    });
  } else if (ttsProvider === 'deepgram') {
    await (playerRef.current as DeepgramStreamingPlayer).speak(TEST_TEXTS[selectedText], {
      voiceId: 'aura-2-thalia-en',
    });
  } else {
    // OpenAI с instructions 🆕
    await (playerRef.current as OpenAIStreamingPlayer).speak(TEST_TEXTS[selectedText], {
      voiceId: openaiVoice,
      instructions: openaiInstructions || undefined,
    });
  }
```

**5.7 Добавить OpenAI кнопку в provider selector:**

```typescript
<TouchableOpacity
  style={[
    styles.providerButton,
    ttsProvider === 'openai' && styles.providerButtonActive,
    ttsProvider === 'openai' && { backgroundColor: '#10B981', borderColor: '#10B981' },
  ]}
  onPress={() => setTtsProvider('openai')}>
  <Text
    style={[
      styles.providerButtonText,
      ttsProvider === 'openai' && styles.providerButtonTextActive,
    ]}>
    OpenAI
  </Text>
</TouchableOpacity>
```

**5.8 Добавить voice selector + instructions UI для OpenAI:**

```typescript
{/* OpenAI Voice Selection */}
{ttsProvider === 'openai' && (
  <>
    {/* Voice Selector */}
    <View style={styles.voiceSelector}>
      <Text style={styles.sectionTitle}>Voice (marin/cedar = best ⭐)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
        {(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const).map((voice) => (
          <TouchableOpacity
            key={voice}
            style={[
              styles.voiceButton,
              openaiVoice === voice && styles.voiceButtonActive,
              (voice === 'marin' || voice === 'cedar') && styles.voiceButtonPremium,
            ]}
            onPress={() => setOpenaiVoice(voice)}>
            <Text
              style={[
                styles.voiceButtonText,
                openaiVoice === voice && styles.voiceButtonTextActive,
              ]}>
              {voice}{voice === 'marin' || voice === 'cedar' ? '⭐' : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>

    {/* 🆕 Instructions Selector */}
    <View style={styles.instructionsSelector}>
      <Text style={styles.sectionTitle}>Voice Style</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
        {instructionPresets.map((preset) => (
          <TouchableOpacity
            key={preset.label}
            style={[
              styles.voiceButton,
              openaiInstructions === preset.value && styles.voiceButtonActive,
            ]}
            onPress={() => setOpenaiInstructions(preset.value)}>
            <Text
              style={[
                styles.voiceButtonText,
                openaiInstructions === preset.value && styles.voiceButtonTextActive,
              ]}>
              {preset.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>

    {/* Custom instructions input */}
    {openaiInstructions && !instructionPresets.find(p => p.value === openaiInstructions) && (
      <View style={styles.customInstructionsContainer}>
        <TextInput
          style={styles.customInstructionsInput}
          placeholder="Custom instructions (optional)"
          value={openaiInstructions}
          onChangeText={setOpenaiInstructions}
          multiline
        />
      </View>
    )}
  </>
)}
```

**5.9 Обновить описание provider:**

```typescript
<Text style={styles.textPreview}>
  {ttsProvider === 'cartesia'
    ? 'Cartesia Sonic API - WebSocket streaming with emotion support'
    : ttsProvider === 'deepgram'
    ? 'Deepgram Aura API - WebSocket streaming with natural voices'
    : 'OpenAI gpt-4o-mini-tts - HTTP streaming with 13 voices + instructions'}
</Text>
```

**5.10 Добавить импорт TextInput:**

```typescript
import {
  // ...
  TextInput,  // Добавить
} from 'react-native';
```

**5.11 Добавить стили:**

```typescript
voiceSelector: {
  gap: 8,
},
voiceScroll: {
  flexDirection: 'row',
},
voiceButton: {
  paddingVertical: 8,
  paddingHorizontal: 16,
  borderRadius: 8,
  backgroundColor: '#1F2937',
  borderWidth: 1,
  borderColor: '#374151',
  marginRight: 8,
},
voiceButtonActive: {
  backgroundColor: '#10B981',
  borderColor: '#10B981',
},
voiceButtonPremium: {
  borderColor: '#FBBF24', // Gold border for marin/cedar
  borderWidth: 2,
},
voiceButtonText: {
  color: '#9CA3AF',
  fontWeight: '500',
  fontSize: 12,
},
voiceButtonTextActive: {
  color: '#FFFFFF',
},
instructionsSelector: {
  gap: 8,
  marginTop: 8,
},
customInstructionsContainer: {
  marginTop: 8,
},
customInstructionsInput: {
  backgroundColor: '#1F2937',
  borderRadius: 8,
  padding: 12,
  color: '#F9FAFB',
  minHeight: 80,
  borderWidth: 1,
  borderColor: '#374151',
},
```

---

### Phase 6: .env Configuration

**Файл:** `.env`

```bash
EXPO_PUBLIC_OPENAI_API_KEY=sk-your-openai-api-key-here
```

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    TestAudioStreamPage.tsx                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Provider Switch: [Cartesia] [Deepgram] [OpenAI]           │
│                        │          │         │               │
│                        ▼          ▼         ▼               │
│            CartesiaWS   DeepgramWS  OpenAI Fetch            │
│            (16kHz PCM)  (16kHz PCM) (24kHz PCM)             │
│                  │          │         │                     │
│                  │          │    [Byte Alignment]           │
│                  │          │    PCM16Resampler             │
│                  │          │    (24k→16k)                  │
│                  │          │         │                     │
│                  └──────────┴─────────┘                     │
│                               ▼                              │
│                     {Provider}StreamingPlayer               │
│                       (16kHz Pipeline)                       │
│                               │                              │
│            JitterBuffer → AudioContext                      │
│                               │                              │
│                           🎧 Speakers                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Сводка Изменений

| Файл | Строки | Действие |
|------|--------|----------|
| `src/types.ts` | ~294-320 | Добавить OpenAITTSModel, обновить OpenAIVoice, добавить interfaces |
| `src/services/openai-streaming-service.ts` |全线 | Обновить модель, голоса, добавить byte alignment, instructions |
| `src/services/audio/OpenAIStreamingPlayer.ts` | ~299 | Обновить модель, добавить instructions |
| `src/services/tts-service.ts` | поиск/замена | `gpt-4o-mini-audio-preview` → `gpt-4o-mini-tts` |
| `src/screens/TestAudioStreamPage.tsx` | ~33+, ~44, ~66, ~73+, ~99-120, ~192-214, ~330-400, ~365-369, ~768+ | Полная интеграция UI + instructions |
| `.env` | - | Добавить `EXPO_PUBLIC_OPENAI_API_KEY` |

---

## Тестирование

1. Запустить app: `npm start`
2. Открыть `TestAudioStreamPage`
3. Выбрать **OpenAI** provider
4. Выбрать голос:
   - **marin** или **cedar** для лучшего качества ⭐
   - **coral** для весёлого тона
   - **nova** для женского дружелюбного голоса
5. Выбрать Voice Style:
   - **Cheerful** - весёлый тон
   - **Calm** - спокойный тон
   - **Whisper** - шёпот
   - **Excited** - энергичный тон
6. Нажать **Play**
7. Проверить:
   - [ ] Звук воспроизводится нормально (не ускоренный)
   - [ ] Метрики обновляются (Buffer %, Latency, Chunks/s)
   - [ ] Логи показывают ресемплинг 24kHz→16kHz
   - [ ] Instructions работают (слышно изменение тона)
   - [ ] Событие 'done' срабатывает в конце
   - [ ] Протестировать все 13 голосов

---

## Ожидаемые Логи

```
╔════════════════════════════════════════╗
║      OpenAI Streaming Service           ║
╠════════════════════════════════════════╣
║ Model:              gpt-4o-mini-tts     ║
║ Voice:              marin               ║
║ Speed:              1.00                ║
║ Instructions:       Speak in a che...   ║
║ Text length:        45 chars            ║
╚════════════════════════════════════════╝

[OpenAI Streaming] Stream connected, reading chunks...
[PCM16Resampler] 24kHz → 16kHz: 4800 samples → 3200 samples
[OpenAI ProcessCycle] Threshold reached - starting playback!
✅ OpenAI stream complete
```

---

## Checklist

**Phase 1-4: Backend Update**
- [ ] Обновить `types.ts` - добавить OpenAITTSModel, 13 голосов, interfaces
- [ ] Обновить `openai-streaming-service.ts` - модель, byte alignment, instructions
- [ ] Обновить `OpenAIStreamingPlayer.ts` - модель, instructions
- [ ] Обновить `tts-service.ts` - модель

**Phase 5-6: UI Integration**
- [ ] Добавить импорты OpenAIStreamingPlayer + TextInput + Constants
- [ ] Обновить TTSProvider type
- [ ] Добавить openaiVoice state (default='marin')
- [ ] Добавить openaiInstructions state + presets
- [ ] Обновить player creation
- [ ] Обновить handleStart для OpenAI с instructions
- [ ] Добавить OpenAI кнопку в UI
- [ ] Добавить voice selector для 13 голосов
- [ ] Выделить marin/cedar как "премиум" (звезда ⭐)
- [ ] Добавить instructions selector с пресетами
- [ ] Добавить custom instructions input
- [ ] Добавить стили для всех новых элементов
- [ ] Добавить API key в .env
- [ ] Протестировать все 13 голосов
- [ ] Протестировать instructions пресеты

---

## Ссылки

- [OpenAI Text-to-Speech API](https://platform.openai.com/docs/guides/text-to-speech)
- [Audio API Reference](https://platform.openai.com/docs/api-reference/audio/createSpeech)
- [Interactive Demo](https://openai.fm/) - послушать все голоса
