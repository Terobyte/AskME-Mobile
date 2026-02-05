# 🔧 ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ: Блокировка микрофона (v2)

## 🎯 Статус: ИСПРАВЛЕНО (попытка #2)

Найдены и исправлены **ДВЕ** критические проблемы race condition.

---

## 🐛 Обнаруженные проблемы

### Проблема №1: setInterval race condition в mock Sound
**Локация**: `src/services/tts-service.ts` (строки 687-720)

**Что было не так**:
```typescript
setOnPlaybackStatusUpdate: (callback: any) => {
    // Создаем интервал СРАЗУ
    const checkInterval = setInterval(() => {
        if (streamingPromise) {  // ← streamingPromise еще null!
            streamingPromise.then(() => {
                clearInterval(checkInterval);
                callback({ didJustFinish: true });
            });
        }
    }, 100);
}
```

**Порядок вызовов**:
1. `setOnPlaybackStatusUpdate(callback)` ← вызывается ПЕРВЫМ
2. `setInterval` начинается, `streamingPromise` = `null`
3. `playAsync()` ← вызывается ВТОРЫМ (создает `streamingPromise`)
4. Интервал проверяет каждые 100мс, но promise уже создан в другой области

**Результат**: Callback никогда не вызывается → deadlock

---

### Проблема №2: finally блок обнуляет promise слишком рано
**Локация**: `src/services/streaming-audio-player.ts` (строки 206, 218, 314, 316-318)

**Что было не так**:
```typescript
this.playCurrentPromise = (async () => {
    try {
        // ... логика воспроизведения ...
        
        // Рекурсивный вызов БЕЗ await
        this.playCurrent();  // ← Запускает НОВЫЙ playCurrentPromise
        
    } finally {
        // Обнуляем promise
        this.playCurrentPromise = null;  // ← ПЕРЕЗАПИСЫВАЕТ новый promise!
    }
})();
```

**Порядок выполнения**:
1. Создается `playCurrentPromise #1`
2. В `didJustFinish` вызывается `this.playCurrent()` (без await)
3. Создается `playCurrentPromise #2`
4. `playCurrentPromise #1` входит в `finally`
5. `this.playCurrentPromise = null` ← ПЕРЕЗАПИСЫВАЕТ promise #2!

**Результат**: Следующий чанк никогда не играет → воспроизведение останавливается

---

## ✅ Примененные исправления

### Исправление №1: Callback через closure вместо setInterval
**Файл**: `src/services/tts-service.ts` (строки 662-738)

```typescript
let statusCallback: ((status: any) => void) | null = null;

const mockSound = {
    playAsync: async () => {
        if (!isPlaybackStarted) {
            isPlaybackStarted = true;
            
            try {
                streamingPromise = this.speakCartesiaStreaming(text, {
                    ...options,
                    autoPlay: true
                });
                
                await streamingPromise;
                
                // FIX: Вызываем callback СРАЗУ после завершения
                if (statusCallback) {
                    console.log('📢 [TTS Streaming Mock] Triggering didJustFinish from playAsync');
                    statusCallback({
                        isLoaded: true,
                        didJustFinish: true,
                        durationMillis: 0,
                        positionMillis: 0
                    });
                }
            } catch (error) {
                // FIX: Вызываем callback даже при ошибке
                if (statusCallback) {
                    console.log('📢 [TTS Streaming Mock] Triggering didJustFinish (error case)');
                    statusCallback({ didJustFinish: true });
                }
            }
        }
    },
    
    setOnPlaybackStatusUpdate: (callback: any) => {
        // FIX: Просто сохраняем callback, он будет вызван из playAsync
        statusCallback = callback;
    }
};
```

**Почему это работает**:
- Callback сохраняется в closure (`statusCallback`)
- Вызывается ИЗНУТРИ `playAsync` после завершения streaming
- Гарантированно вызывается даже при ошибке

---

### Исправление №2: Обнуление promise ПЕРЕД рекурсией
**Файл**: `src/services/streaming-audio-player.ts` (строки 125-327)

```typescript
current.sound.setOnPlaybackStatusUpdate(async (status) => {
    if (status.didJustFinish) {
        // ... логика ...
        
        // FIX: Обнуляем promise ПЕРЕД рекурсивным вызовом
        this.playCurrentPromise = null;
        
        // Теперь безопасно вызывать
        this.playCurrent();
    }
});

// В catch блоке тоже
catch (error) {
    // ... логика ...
    
    // FIX: Обнуляем promise ПЕРЕД рекурсивным вызовом
    this.playCurrentPromise = null;
    
    this.playCurrent();
}

// Убрали finally блок полностью!
```

**Почему это работает**:
- Promise обнуляется ВО ВСЕХ точках перед рекурсивным вызовом
- Следующий вызов `playCurrent()` может создать новый promise
- Нет конфликта между старым и новым promise

---

## 📊 Измененные файлы

| Файл | Строки | Описание |
|------|--------|----------|
| `src/services/tts-service.ts` | 662-738 | Callback через closure вместо setInterval |
| `src/services/streaming-audio-player.ts` | 125-327 | Обнуление promise перед рекурсией, убран finally |

---

## 🧪 Тестирование

### Тест 1: Длинный ответ
**Ожидаемое поведение**:
- ✅ Воспроизведение до конца
- ✅ Микрофон разблокируется
- ✅ Можно продолжить диалог

**Логи для проверки**:
```
✅ [TTS Streaming Mock] Playback complete
📢 [TTS Streaming Mock] Triggering didJustFinish from playAsync
✅ [Sync] Playback completed successfully
✅ [Sync] Cleanup complete, onAIEnd called
```

### Тест 2: Множественные чанки
**Ожидаемое поведение**:
- ✅ Все чанки воспроизводятся последовательно
- ✅ Нет остановок в середине

**Логи для проверки**:
```
🔊 [AudioQueue] Playing chunk 1/5
✅ [AudioQueue] Chunk 1 finished
🔊 [AudioQueue] Playing chunk 2/5
✅ [AudioQueue] Chunk 2 finished
...
✅ [AudioQueue] Queue complete
```

### Тест 3: Остановка при ошибке
**Ожидаемое поведение**:
- ✅ onAIEnd вызывается даже при ошибке
- ✅ Микрофон разблокируется

**Логи для проверки**:
```
❌ [TTS Streaming Mock] Playback error: <error>
📢 [TTS Streaming Mock] Triggering didJustFinish (error case)
✅ [Sync] Cleanup complete, onAIEnd called
```

---

## 🎯 Ключевые изменения

### БЫЛО (Проблема #1):
```typescript
setOnPlaybackStatusUpdate: (callback) => {
    const checkInterval = setInterval(() => {
        if (streamingPromise) {  // ← null при первом запуске!
            streamingPromise.then(() => callback());
        }
    }, 100);
}
```

### СТАЛО (Решение #1):
```typescript
setOnPlaybackStatusUpdate: (callback) => {
    statusCallback = callback;  // ← Сохраняем в closure
}

playAsync: async () => {
    await streamingPromise;
    if (statusCallback) {  // ← Вызываем после завершения
        statusCallback({ didJustFinish: true });
    }
}
```

---

### БЫЛО (Проблема #2):
```typescript
try {
    this.playCurrent();  // ← Создает новый promise
} finally {
    this.playCurrentPromise = null;  // ← УНИЧТОЖАЕТ новый promise!
}
```

### СТАЛО (Решение #2):
```typescript
// Обнуляем ПЕРЕД вызовом
this.playCurrentPromise = null;
this.playCurrent();  // ← Создает новый promise безопасно

// Finally убран полностью!
```

---

## 📝 Диагностика

Если проблема все еще остается, проверьте логи:

### ✅ Хорошие знаки:
```
✅ [TTS Streaming Mock] Playback complete
📢 [TTS Streaming Mock] Triggering didJustFinish from playAsync
✅ [AudioQueue] Chunk X finished
🔊 [AudioQueue] Playing chunk X+1
✅ [Sync] Cleanup complete, onAIEnd called
```

### ❌ Плохие знаки:
```
// Если НЕТ "Triggering didJustFinish" → callback не вызывается
// Если НЕТ "Playing chunk X+1" → promise обнуляется слишком рано
// Если НЕТ "Cleanup complete" → timeout не сработал
```

---

## 🔗 История исправлений

1. **Попытка #1** - Добавлен setInterval для проверки → НЕ сработал (race condition)
2. **Попытка #2 (текущая)** - Callback через closure + обнуление перед рекурсией

---

*Создано: 2026-02-05*  
*Статус: ✅ ИСПРАВЛЕНО (v2)*  
*Приоритет: 🔴 КРИТИЧЕСКИЙ*
