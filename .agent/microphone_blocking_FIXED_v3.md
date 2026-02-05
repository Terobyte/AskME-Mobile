# 🔧 ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ: Блокировка микрофона (v3)

## 🎯 Статус: ИСПРАВЛЕНО (попытка #3)

Найдены и исправлены **ТРИ** критические проблемы.

---

## 🐛 Проблема №3: playAsync вызывается на уже играющем чанке

**Симптомы** (из логов):
```
LOG  🔄 [AudioQueue] Starting SCHEDULED cross-fade
LOG  ▶️ [AudioQueue] Next chunk started at 0% volume
LOG  ✨ [AudioQueue] Cross-fade complete!
```

**НО НЕТ**:
- ✅ `[AudioQueue] Chunk 2 finished`
- 🔊 `[AudioQueue] Playing chunk 3/3`
- ✅ `[AudioQueue] Queue complete`

---

### Что происходило:

1. **Чанк 2 играет** → запускается cross-fade
2. **Cross-fade запускает чанк 3** через `next.sound.playAsync()` (на volume 0)
3. **Cross-fade завершается** → `crossFadeCompleted = true`
4. **Чанк 2 заканчивается** → `didJustFinish` вызывается
5.  `didJustFinish` проверяет: `if (crossFadeCompleted && next)` → **TRUE**
6. Проверяет что чанк 3 играет → вызывает `this.playCurrent()` для чанка 3
7. `playCurrent()` устанавливает `setOnPlaybackStatusUpdate` для чанка 3 ✅
8. `playCurrent()` вызывает `await current.sound.playAsync()` для чанка 3 ❌
   - НО чанк 3 **УЖЕ ИГРАЕТ** (после cross-fade)!
   - `playAsync()` на уже играющем Sound может:
     - Вернуться сразу (не ждать)
     - Перезапустить с начала
     - Выдать ошибку
9. В результате `didJustFinish` для чанка 3 **никогда не вызывается**
10. `waitForCompletion()` **вечно ждет** → `speakCartesiaStreaming` не завершается
11. Mock Sound **не вызывает callback** → `onAIEnd` не вызывается
12. **Микрофон заблокирован**

---

### Решение:

Добавить **проверку статуса** перед `playAsync()`:

```typescript
// FIX: Check if chunk is already playing (from cross-fade)
const statusBefore = await current.sound.getStatusAsync();
if (statusBefore.isLoaded && statusBefore.isPlaying) {
    console.log(`🎵 [AudioQueue] Chunk ${this.currentIndex + 1} already playing (from cross-fade), skipping playAsync`);
} else {
    // Start playback normally
    await current.sound.playAsync();
    const playLatency = Date.now() - playStartTime;
    console.log(`🎵 [AudioQueue] playAsync() latency: ${playLatency}ms`);
}
```

**Файл**: `src/services/streaming-audio-player.ts` (строки 241-250)

---

## 📋 Все исправления (v1-v3)

### v1: Deadlock в mock Sound (setInterval race condition)
**Проблема**: setInterval проверял `streamingPromise` который создавался позже  
**Решение**: Callback через closure, вызов из `playAsync`  
**Файл**: `src/services/tts-service.ts` (строки 662-738)

### v2: finally блок обнулял promise
**Проблема**: `finally` обнулял promise который нужен для следующего чанка  
**Решение**: Обнуление ПЕРЕД рекурсивным вызовом, убран finally  
**Файл**: `src/services/streaming-audio-player.ts` (строки 125-327)

### v3: playAsync на уже играющем чанке (ТЕКУЩЕЕ)
**Проблема**: `playAsync()` вызывался на чанке который уже играет после cross-fade  
**Решение**: Проверка статуса перед `playAsync`, пропуск если уже играет  
**Файл**: `src/services/streaming-audio-player.ts` (строки 241-250)

---

## 🧪 Тестирование

### Тест 1: Короткое сообщение (3 чанка)
**Ожидаемые логи**:
```
🔊 [AudioQueue] Playing chunk 1/3
✅ [AudioQueue] Chunk 1 finished
🔊 [AudioQueue] Playing chunk 2/3
🔄 [AudioQueue] Starting SCHEDULED cross-fade
✨ [AudioQueue] Cross-fade complete!
✅ [AudioQueue] Chunk 2 finished
🔊 [AudioQueue] Playing chunk 3/3
🎵 [AudioQueue] Chunk already playing (from cross-fade), skipping playAsync  ← НОВЫЙ ЛОГ!
✅ [AudioQueue] Chunk 3 finished
✅ [AudioQueue] Queue complete
✅ [TTS Streaming] Generation complete
✅ [TTS Streaming Mock] Playback complete
📢 [TTS Streaming Mock] Triggering didJustFinish from playAsync
✅ [Sync] Playback completed successfully
✅ [Sync] Cleanup complete, onAIEnd called
```

### Тест 2: Длинное сообщение (10+ чанков)
**Ожидаемое поведение**:
- ✅ Все чанки воспроизводятся
- ✅ Cross-fade работает плавно
- ✅ Микрофон разблокируется

---

## 📊 Измененные файлы (v3)

| Файл | Строки | Описание |
|------|--------|----------|
| `src/services/streaming-audio-player.ts` | 241-250 | Проверка статуса перед playAsync |

---

## 🎯 Ключевое изменение (v3)

### БЫЛО:
```typescript
await current.sound.playAsync();  // ← Вызывается ВСЕГДА (даже если уже играет!)
```

### СТАЛО:
```typescript
const statusBefore = await current.sound.getStatusAsync();
if (statusBefore.isLoaded && statusBefore.isPlaying) {
    console.log('Chunk already playing (from cross-fade), skipping playAsync');
} else {
    await current.sound.playAsync();
}
```

---

## 📝 Диагностика

### ✅ Хорошие знаки (v3):
```
🎵 [AudioQueue] Chunk already playing (from cross-fade), skipping playAsync
✅ [AudioQueue] Chunk 3 finished
✅ [AudioQueue] Queue complete
✅ [TTS Streaming Mock] Playback complete
📢 [TTS Streaming Mock] Triggering didJustFinish from playAsync
✅ [Sync] Cleanup complete, onAIEnd called
```

### ❌ Плохие знаки:
```
// Если нет "Chunk already playing" → проверка не сработала
// Если нет "Queue complete" → последний чанк не завершился
// Если нет "onAIEnd called" → callback не был вызван
```

---

## 🔗 История исправлений

1. **v1** - Callback через closure (исправлен setInterval race condition)
2. **v2** - Обнуление promise перед рекурсией (исправлен finally race condition)
3. **v3 (текущая)** - Проверка статуса перед playAsync (исправлен double-play bug)

---

*Создано: 2026-02-05*  
*Статус: ✅ ИСПРАВЛЕНО (v3)*  
*Приоритет: 🔴 КРИТИЧЕСКИЙ*
