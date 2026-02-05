# 🔴 КРИТИЧЕСКАЯ ПРОБЛЕМА: Блокировка микрофона при воспроизведении

## 🚨 Симптомы
- Звук останавливается в середине воспроизведения ("...performance optimization and advanced native modules")
- Микрофон блокируется
- Вечная загрузка

## 🔍 Диагноз

### Причина №1: Deadlock в prepareAudio + playSynchronizedResponse

#### Проблемный код:

**`tts-service.ts` → `prepareAudio()` (строки 664-676)**:
```typescript
// Запускаем streaming НЕМЕДЛЕННО
const streamingPromise = this.speakCartesiaStreaming(text, {
    ...options,
    autoPlay: true  // ← Начинает играть СРАЗУ
});

// Создаем mock Sound
const mockSound = {
    playAsync: async () => {
        console.log('🎵 [TTS Streaming Mock] Waiting for streaming completion...');
        await streamingPromise;  // ← ЖДЕМ завершения streaming
        console.log('✅ [TTS Streaming Mock] Playback complete');
    },
    setOnPlaybackStatusUpdate: (callback: any) => {
        streamingPromise.then(() => {  // ← ЖДЕМ завершения streaming
            if (callback) {
                callback({ didJustFinish: true });
            }
        });
    }
};
```

**`useInterviewLogic.ts` → `playSynchronizedResponse()` (строки 235-255)**:
```typescript
// Получаем player (который УЖЕ начал играть)
const player = await TTSService.prepareAudio(text, options);

// Устанавливаем callback
if (player) {
    await new Promise<void>((resolve) => {
        player.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
                player.setOnPlaybackStatusUpdate(null);
                resolve();  // ← ЖДЕМ didJustFinish
            }
        });
        player.playAsync();  // ← Вызываем playAsync (который ЖДЕТ streamingPromise)
    });
}
```

### Проблема:
1. `prepareAudio` запускает `speakCartesiaStreaming(autoPlay: true)` - streaming **УЖЕ ИГРАЕТ**
2. Возвращает mock Sound с `playAsync()`, который **ЖДЕТ** завершения streaming
3. `playSynchronizedResponse` вызывает `player.playAsync()` - блокируется в ожидании
4. Но streaming **НЕ ЗАВЕРШАЕТСЯ**, потому что наш новый код имеет **race condition**!

### Причина №2: Race condition в AudioQueue после наших исправлений

#### Потенциальная проблема:
После добавления `playCurrentPromise`, возможно зацикливание:

```typescript
// В playCurrent()
if (this.playCurrentPromise) {
    console.log('⏸️ Waiting for previous playCurrent to finish...');
    await this.playCurrentPromise;  // ← ЖДЕМ
    return;
}

this.playCurrentPromise = (async () => {
    // ...
    
    // В didJustFinish:
    this.playCurrent();  // ← Рекурсивный вызов
    
    // ← НО мы НЕ обнуляем playCurrentPromise!
})();
```

### Причина №3: onAIEnd не вызывается

Если streaming не завершается, то `onAIEnd?.()` не вызывается (строка 275 в useInterviewLogic.ts), и:
- Микрофон остается заблокированным
- `isProcessing` остается `true`
- UI показывает вечную загрузку

---

## 🎯 План исправления

### Фаза 1: Исправить mock Sound в prepareAudio (КРИТИЧНО)

**Проблема**: playAsync ждет завершения streaming, но streaming уже играет.

**Решение**: НЕ запускаем streaming при `autoPlay: true`, а запускаем его ТОЛЬКО при вызове `playAsync()`.

#### Код:

```typescript
// src/services/tts-service.ts → prepareAudio()

async prepareAudio(
  text: string,
  options?: {
    emotion?: string;
    speed?: number;
    emotionLevel?: string[];
  }
): Promise<Audio.Sound | null> {
  // ... проверка mute ...

  try {
    console.log(`🎙️ [TTS] Preparing audio: "${text.substring(0, 50)}..."`);

    // NEW: Try streaming if enabled for Cartesia
    if (STREAMING_CONFIG.enabled && this.ttsProvider === 'cartesia') {
      console.log('🌊 [TTS] Using streaming for prepareAudio...');

      try {
        // FIX: НЕ запускаем streaming сразу, создаем Promise для отложенного запуска
        let streamingPromise: Promise<boolean> | null = null;
        let isPlaybackStarted = false;

        const mockSound = {
          playAsync: async () => {
            console.log('🎵 [TTS Streaming Mock] playAsync called');
            
            // Запускаем streaming ТОЛЬКО при первом вызове playAsync
            if (!isPlaybackStarted) {
              isPlaybackStarted = true;
              console.log('▶️ [TTS Streaming Mock] Starting streaming playback...');
              
              streamingPromise = this.speakCartesiaStreaming(text, {
                ...options,
                autoPlay: true
              });
              
              await streamingPromise;
              console.log('✅ [TTS Streaming Mock] Playback complete');
            } else {
              console.warn('⚠️ [TTS Streaming Mock] playAsync called multiple times, ignoring');
            }
          },
          
          setOnPlaybackStatusUpdate: (callback: any) => {
            console.log('🔄 [TTS Streaming Mock] setOnPlaybackStatusUpdate called');
            
            // Ждем завершения streaming (если он запущен)
            if (streamingPromise) {
              streamingPromise.then(() => {
                if (callback) {
                  console.log('📢 [TTS Streaming Mock] Triggering didJustFinish');
                  callback({
                    isLoaded: true,
                    didJustFinish: true,
                    durationMillis: 0,
                    positionMillis: 0
                  });
                }
              }).catch((error) => {
                console.error('❌ [TTS Streaming Mock] Error in callback:', error);
              });
            }
          },
          
          stopAsync: async () => {
            console.log('🛑 [TTS Streaming Mock] Stop requested');
            await chunkedStreamingPlayer.stop();
            isPlaybackStarted = false;
          },
          
          unloadAsync: async () => {
            console.log('🗑️ [TTS Streaming Mock] Unload');
            await chunkedStreamingPlayer.stop();
            isPlaybackStarted = false;
          }
        } as any as Audio.Sound;

        console.log('✅ [TTS] Streaming mock Sound created (playback deferred)');
        return mockSound;

      } catch (error) {
        console.error('❌ [TTS] Streaming failed in prepareAudio, falling back:', error);
        // Fall through to REST API
      }
    }

    // ... остальной код REST API ...
  } catch (error) {
    console.error("❌ [TTS] prepareAudio error:", error);
    return null;
  }
}
```

---

### Фаза 2: Гарантировать вызов onAIEnd (КРИТИЧНО)

**Проблема**: Если streaming падает с ошибкой, `onAIEnd` не вызывается.

**Решение**: Обернуть в try-finally в `playSynchronizedResponse`.

#### Код:

```typescript
// src/hooks/interview/useInterviewLogic.ts → playSynchronizedResponse()

const playSynchronizedResponse = async (
  text: string,
  options?: {
    emotion?: string;
    speed?: number;
    emotionLevel?: string[];
  }
): Promise<void> => {
  setIsProcessing(true);

  // Notify audio hook to stop recording (prevent echo)
  onAIStart?.();

  try {
    console.log("🔄 Sync: Preloading audio for:", text.substring(0, 10) + "...");

    // Force speaker mode before TTS playback
    console.log("🔊 Forcing speaker output for TTS...");
    await safeAudioModeSwitch('playback');

    // Small delay to ensure audio mode is applied
    await new Promise(resolve => setTimeout(resolve, 100));

    // Prepare audio with emotion options
    const player = await TTSService.prepareAudio(text, options);

    console.log("💥 Sync: BOOM! Playing.");

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: text, sender: 'ai' }]);

    // Append to History Buffer
    historyBuffer.current.push({ role: 'assistant', content: text });

    if (player) {
      await new Promise<void>((resolve, reject) => {
        // FIX: Добавляем timeout для предотвращения вечного ожидания
        const timeout = setTimeout(() => {
          console.error('⏰ [Sync] Playback timeout - forcing resolve');
          player.setOnPlaybackStatusUpdate(null);
          reject(new Error('Playback timeout'));
        }, 60000); // 60 секунд максимум

        player.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            clearTimeout(timeout);
            player.setOnPlaybackStatusUpdate(null);
            resolve();
          }
        });

        player.playAsync().catch((error) => {
          clearTimeout(timeout);
          console.error('❌ [Sync] playAsync error:', error);
          reject(error);
        });
      });
    }

    console.log('✅ [Sync] Playback completed successfully');

  } catch (e) {
    console.error("❌ Sync Error:", e);
  } finally {
    // FIX: ВСЕГДА вызываем onAIEnd в finally
    setIsProcessing(false);
    onAIEnd?.();
    console.log('✅ [Sync] Cleanup complete, onAIEnd called');
  }
};
```

---

### Фаза 3: Добавить обработку ошибок в AudioQueue (КРИТИЧНО)

**Проблема**: Если возникает ошибка в `playCurrent`, promise может не resolve.

**Решение**: Улучшить error handling.

#### Код:

```typescript
// src/services/streaming-audio-player.ts → AudioQueue.playCurrent()

private async playCurrent(): Promise<void> {
    // FIX: Wait for previous playCurrent to complete (prevents double calls)
    if (this.playCurrentPromise) {
        console.log('⏸️ [AudioQueue] Waiting for previous playCurrent to finish...');
        await this.playCurrentPromise;
        return;
    }
    
    // Create new promise for this playback
    this.playCurrentPromise = (async () => {
        try {
            // ... существующий код ...
            
        } catch (error) {
            console.error('❌ [AudioQueue] Critical error in playCurrent:', error);
            
            // Reset flags
            this._isTransitioning = false;
            
            // Try to continue with next chunk
            this.currentIndex++;
            
            if (this.currentIndex < this.queue.length) {
                console.log('🔄 [AudioQueue] Attempting to recover with next chunk...');
                // Recursive call (will wait for this promise to complete)
                this.playCurrent();
            } else {
                console.error('❌ [AudioQueue] No more chunks, stopping playback');
                this._isPlaying = false;
                
                if (this.completionResolve) {
                    this.completionResolve();
                }
            }
            
        } finally {
            // FIX: ВСЕГДА очищаем promise reference
            this.playCurrentPromise = null;
        }
    })();
    
    await this.playCurrentPromise;
}
```

---

## 📋 Чек-лист исправлений

- [ ] **Фаза 1**: Исправить mock Sound в `prepareAudio` (отложенный запуск streaming)
- [ ] **Фаза 2**: Добавить try-finally в `playSynchronizedResponse` с timeout
- [ ] **Фаза 3**: Улучшить error handling в `AudioQueue.playCurrent()`
- [ ] **Тестирование**: Проверить на длинных ответах
- [ ] **Регрессия**: Убедиться, что короткие ответы работают

---

## 🧪 Тестирование

### Тест 1: Длинный ответ
Попросите Викторию рассказать о своем опыте (30+ секунд).

**Ожидаемое поведение**:
- Звук воспроизводится до конца
- Микрофон разблокируется после завершения
- Нет вечной загрузки

### Тест 2: Прерывание
Прервите Викторию во время воспроизведения (начните говорить).

**Ожидаемое поведение**:
- Воспроизведение останавливается
- Микрофон активируется
- Нет блокировки

### Тест 3: Короткие ответы
Попросите Викторию дать короткий ответ (5-10 секунд).

**Ожидаемое поведение**:
- Работает как раньше
- Нет регрессии

---

## 📊 Диаграмма проблемы

### ДО исправления:
```
prepareAudio:
  ├─ Запускает speakCartesiaStreaming(autoPlay: true) ← НАЧИНАЕТ ИГРАТЬ
  └─ Возвращает mockSound с:
      └─ playAsync() → await streamingPromise ← ЖДЕТ ЗАВЕРШЕНИЯ

playSynchronizedResponse:
  ├─ Получает player (УЖЕ ИГРАЕТ)
  ├─ Вызывает player.playAsync() ← БЛОКИРУЕТСЯ В ОЖИДАНИИ
  └─ Ждет didJustFinish ← НИКОГДА НЕ ПРИХОД ИТ (если ошибка)
      
Результат: DEADLOCK → Микрофон заблокирован → Вечная загрузка
```

### ПОСЛЕ исправления:
```
prepareAudio:
  └─ Возвращает mockSound с:
      └─ playAsync() → ЗАПУСКАЕТ streaming ← НАЧИНАЕТ ИГРАТЬ ТОЛЬКО ПРИ ВЫЗОВЕ

playSynchronizedResponse:
  ├─ Получает player (ЕЩЕ НЕ ИГРАЕТ)
  ├─ Вызывает player.playAsync() ← ЗАПУСКАЕТ streaming
  ├─ Ждет didJustFinish с timeout
  └─ finally → onAIEnd() ВСЕГДА ← Разблокирует микрофон
      
Результат: ✅ Корректное воспроизведение → Микрофон разблокируется
```

---

*Создано: 2026-02-05*  
*Приоритет: 🔴 КРИТИЧЕСКИЙ*  
*Статус: Требует немедленного исправления*
