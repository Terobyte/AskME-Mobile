# Дополнительные оптимизации (Фаза 2 и 4)

## 🎯 Опциональные улучшения

Если после применения **Фазы 1 и 3** артефакты полностью не устранились, можно применить следующие оптимизации:

---

## 📊 Фаза 2: Интеллектуальная детекция кроссфейда

### Проблема
Текущий кроссфейд применяется **ВСЕГДА**, даже если между предложениями нет естественной паузы.

**Пример**:
```
Файл 1 (заканчивается): "...working with, You"
Файл 2 (начинается): "You can also..."

Кроссфейд: "with, Youuuu can also" (удвоение "You")
```

### Решение
Использовать timestamp данные для определения пауз и применять кроссфейд **ТОЛЬКО** при наличии тишины.

### Код

#### 1. Обновить интерфейс QueueItem
```typescript
// В AudioQueue класс
private queue: {
    sound: Audio.Sound;
    filepath: string;
    isPreloaded: boolean;
    hasSilenceAtEnd?: boolean;     // НОВОЕ: Есть ли тишина в конце файла
    lastWordTimestamp?: number;     // НОВОЕ: Время последнего слова
}[] = [];
```

#### 2. Добавить метод детекции тишины
```typescript
/**
 * Detect if there's silence at the end of accumulated chunks
 * based on word timestamps
 */
private detectSilenceAtEnd(
    totalDurationMs: number,
    lastProcessedWordIndex: number
): boolean {
    if (this.incomingTimestamps.length === 0) {
        // Нет timestamps → предполагаем НЕТ тишины
        return false;
    }
    
    // Получаем все слова в текущем файле
    const wordsInFile = this.incomingTimestamps.slice(
        this.lastProcessedTimestampIndex,
        lastProcessedWordIndex + 1
    );
    
    if (wordsInFile.length === 0) {
        return false;
    }
    
    // Время последнего слова
    const lastWord = wordsInFile[wordsInFile.length - 1];
    const lastWordEndMs = (lastWord.timestampSeconds + (lastWord.durationSeconds || 0)) * 1000;
    
    // Если между последним словом и концом файла > 100мс, считаем тишиной
    const silenceDuration = totalDurationMs - lastWordEndMs;
    const hasSilence = silenceDuration > 100; // 100мс порог
    
    console.log(`🔇 [Silence Detection] Last word at ${lastWordEndMs.toFixed(0)}ms, ` +
                `file ends at ${totalDurationMs.toFixed(0)}ms, ` +
                `silence: ${silenceDuration.toFixed(0)}ms → ${hasSilence ? 'YES' : 'NO'}`);
    
    return hasSilence;
}
```

#### 3. Установить флаг при создании файла
```typescript
// В метод playStream(), после создания файла
if (this.chunkingMode === ChunkingMode.SENTENCE_MODE) {
    // ... существующий код создания файла ...
    
    const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
    
    // Детектируем тишину
    const hasSilence = this.detectSilenceAtEnd(
        this.totalAudioDurationMs,
        this.lastProcessedTimestampIndex
    );
    
    // Сохраняем метаданные в очереди
    await this.audioQueue.enqueue(filepath, {
        hasSilenceAtEnd: hasSilence,
        lastWordTimestamp: this.totalAudioDurationMs
    });
}
```

#### 4. Обновить метод enqueue
```typescript
async enqueue(
    filepath: string, 
    metadata?: { hasSilenceAtEnd?: boolean; lastWordTimestamp?: number }
): Promise<void> {
    console.log(`📦 [AudioQueue] Preloading: ${filepath}`);

    const { sound } = await Audio.Sound.createAsync(
        { uri: filepath },
        { shouldPlay: false, volume: 1.0 }
    );

    this.queue.push({
        sound,
        filepath,
        isPreloaded: true,
        hasSilenceAtEnd: metadata?.hasSilenceAtEnd ?? true,  // По умолчанию true
        lastWordTimestamp: metadata?.lastWordTimestamp
    });

    console.log(`✅ [AudioQueue] Enqueued (total: ${this.queue.length}), ` +
                `silence: ${metadata?.hasSilenceAtEnd ? 'YES' : 'NO'}`);
}
```

#### 5. Использовать в playCurrent()
```typescript
// В методе playCurrent(), перед планированием crossfade
if (next) {
    const status = await current.sound.getStatusAsync();
    if (status.isLoaded && status.durationMillis) {
        
        // НОВОЕ: Проверяем, есть ли тишина в конце
        const useCrossfade = current.hasSilenceAtEnd ?? true;
        
        if (useCrossfade) {
            // Существующий crossfade код
            const triggerTime = status.durationMillis - this.CROSSFADE_MS;
            
            if (triggerTime > 0) {
                console.log(`⏰ [AudioQueue] Scheduling cross-fade in ${triggerTime}ms (silence detected)`);
                // ... существующий crossfade код ...
            }
        } else {
            console.log(`⏭️ [AudioQueue] Skipping crossfade (no silence at end of file)`);
            // Просто ждем didJustFinish для прямого перехода
        }
    }
}
```

### Результат
- ✅ Кроссфейд применяется ТОЛЬКО при естественных паузах
- ✅ Нет "удвоения" голоса на стыках без паузы
- ✅ Более естественное звучание

---

## 🔧 Фаза 4: Увеличение минимального буфера

### Проблема
Текущий `minBufferMs = 200` может быть недостаточен для стабильного воспроизведения на некоторых устройствах.

### Решение
Увеличить буфер до 300-400мс для большей надежности.

### Код

#### Вариант А: Через .env
```bash
# .env
EXPO_PUBLIC_CARTESIA_STREAMING_MIN_BUFFER_MS=300
```

#### Вариант Б: Через streaming-config.ts
```typescript
// src/config/streaming-config.ts
export const STREAMING_CONFIG = {
    enabled: true,
    minBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_MIN_BUFFER_MS || '300'),  // Было: 200
    targetBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_TARGET_BUFFER_MS || '500'),
    strategy: 'chunked' as const
};
```

### Компромиссы
- ⬆️ Увеличение надежности воспроизведения
- ⬇️ Увеличение задержки на ~100мс (незначительно)

### Рекомендация
Применить **ТОЛЬКО** если после Фазы 1-3 все еще остаются артефакты.

---

## 📊 Приоритезация фаз

| Фаза | Проблема | Приоритет | Сложность | Эффект |
|------|----------|-----------|-----------|--------|
| **Фаза 1** ✅ | Race Condition | 🔴 Критический | Средняя | Высокий |
| **Фаза 3** ✅ | Синхронизация | 🔴 Критический | Средняя | Высокий |
| **Фаза 2** ⏳ | Умный кроссфейд | 🟡 Средний | Высокая | Средний |
| **Фаза 4** ⏳ | Буфер | 🟢 Низкий | Низкая | Низкий |

### Рекомендованная последовательность:
1. ✅ **Сначала**: Применить Фазы 1 и 3 (уже сделано)
2. 🧪 **Тестирование**: Проверить на реальных длинных ответах
3. 🔍 **Если нужно**: Применить Фазу 2 (умный кроссфейд)
4. 🔧 **Если все еще нужно**: Применить Фазу 4 (увеличить буфер)

---

## 🧪 Тестовые сценарии для Фазы 2

### Тест 1: Речь без пауз
**Текст**: "I worked with React Native for three years at Google then moved to Meta"

**Ожидаемое поведение**:
- Логи: `⏭️ [AudioQueue] Skipping crossfade (no silence at end of file)`
- Звук: Прямой переход без кроссфейда

### Тест 2: Речь с паузами
**Текст**: "I worked with React Native. Then I moved to Meta."

**Ожидаемое поведение**:
- Логи: `⏰ [AudioQueue] Scheduling cross-fade in XXXms (silence detected)`
- Звук: Плавный кроссфейд на паузе

### Тест 3: Длинная фраза
**Текст**: "Certainly. I am interested in hearing about your career path, key experiences, and what technologies you've enjoyed working with, You can also touch upon what led you to apply for this role"

**Ожидаемое поведение**:
- Логи: Смешанные (кроссфейд на точке после "Certainly", прямой переход на запятых)
- Звук: Чистое произношение "key", "touch upon" без артефактов

---

## 📝 Дополнительная диагностика

### Логи для отслеживания
Если проблема не устранилась, добавьте дополнительное логирование:

```typescript
// В начале playCurrent()
console.log(`🔊 [AudioQueue] Playing chunk ${this.currentIndex + 1}/${this.queue.length}, ` +
            `silence: ${current.hasSilenceAtEnd ? 'YES' : 'NO'}, ` +
            `transitioning: ${this._isTransitioning}`);

// В crossFadeTimeout
console.log(`🔄 [AudioQueue] Crossfade triggered at ${Date.now()}, ` +
            `expected: ${this.lastTransitionTime + triggerTime}`);

// В didJustFinish
console.log(`✅ [AudioQueue] didJustFinish at ${finishTime}, ` +
            `crossfade started: ${crossFadeStarted}, ` +
            `completed: ${crossFadeCompleted}`);
```

### Мониторинг временных интервалов
```typescript
// Добавить в AudioQueue
private chunkStartTimes: number[] = [];

// В начале playCurrent()
this.chunkStartTimes.push(Date.now());

// В didJustFinish
if (this.chunkStartTimes.length > 1) {
    const actualDuration = finishTime - this.chunkStartTimes[this.currentIndex];
    console.log(`📊 [AudioQueue] Actual playback duration: ${actualDuration}ms`);
}
```

---

## 🎯 Критерии успеха

### Полное устранение артефактов
- ✅ Нет кликов/разрывов на словах "key", "touch upon", "highlights", "through"
- ✅ Плавные переходы между чанками
- ✅ Естественное звучание речи

### Логи должны показывать
- ✅ Только ОДИН переход между чанками (либо crossfade, либо didJustFinish)
- ✅ Нет сообщений о race condition (`⏭️ Transition already in progress`)
- ✅ GAP между чанками \u003c 50мс

### Звуковые метрики
- ✅ Отсутствие "двоения" голоса
- ✅ Отсутствие металлического/стеклянного оттенка
- ✅ Сохранение естественного темпа речи

---

*Создано: 2026-02-05*  
*Автор: Antigravity AI*  
*Статус: Опциональные улучшения*
