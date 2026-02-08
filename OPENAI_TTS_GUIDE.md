# OpenAI TTS - Руководство по использованию

## Обзор

OpenAI Text-to-Speech API предоставляет возможность конвертировать текст в реалистичный голосовой аудио на основе модели `gpt-4o-mini-tts`.

**Возможности:**
- Озвучка письменных блог-постов
- Создание аудио на разных языках
- Realtime аудио вывод с использованием стриминга

> **Важно:** Наша политика требует четкого уведомления конечных пользователей о том, что голос TTS создан ИИ, а не человеком.

---

## Быстрый старт

Endpoint `speech` принимает три основных входных параметра:

1. **Модель** — используемая TTS модель
2. **Текст** — текст для озвучивания
3. **Голос** — голос для воспроизведения

### Пример запроса (Python)

```python
from pathlib import Path
from openai import OpenAI

client = OpenAI()
speech_file_path = Path(__file__).parent / "speech.mp3"

with client.audio.speech.with_streaming_response.create(
    model="gpt-4o-mini-tts",
    voice="coral",
    input="Today is a wonderful day to build something people love!",
    instructions="Speak in a cheerful and positive tone.",
) as response:
    response.stream_to_file(speech_file_path)
```

По умолчанию endpoint возвращает MP3 файл, но можно настроить любой поддерживаемый формат.

---

## Модели Text-to-Speech

| Модель | Описание |
|--------|----------|
| `gpt-4o-mini-tts` | Новейшая и самая надежная модель. Поддерживает управление аспектами речи через инструкции |
| `tts-1` | Меньшая задержка, но более низкое качество |
| `tts-1-hd` | Высокое качество |

### Управление речью через `instructions` (только gpt-4o-mini-tts)

С помощью инструкций можно контролировать:
- Акцент
- Эмоциональный диапазон
- Интонацию
- Имитации
- Скорость речи
- Тон
- Шёпот

---

## Голоса

Доступно **13 встроенных голосов**:

| Голос | Описание |
|-------|----------|
| `alloy` | Сбалансированный |
| `ash` | Мягкий, спокойный |
| `ballad` | Экспрессивный, музыкальный |
| `coral` | Весёлый, позитивный |
| `echo` | Мужской, мягкий |
| `fable` | Мужской, британский |
| `nova` | Женский, дружелюбный |
| `onyx` | Мужской, глубокий |
| `sage` | Тёплый, сказочный |
| `shimmer` | Женский, мягкий |
| `verse` | Энергичный, динамичный |
| `marin` | ⭐ Лучшее качество |
| `cedar` | ⭐ Лучшее качество |

> **Рекомендация:** Для лучшего качества используйте `marin` или `cedar`.

### Доступность голосов по моделям

- `gpt-4o-mini-tts`: все 13 голосов
- `tts-1` / `tts-1-hd`: только alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer

---

## Realtime стриминг

Speech API поддерживает realtime аудио стриминг с использованием chunk transfer encoding. Аудио может воспроизводиться до полной генерации файла.

### Пример стриминга в реальном времени

```python
import asyncio
from openai import AsyncOpenAI
from openai.helpers import LocalAudioPlayer

openai = AsyncOpenAI()

async def main() -> None:
    async with openai.audio.speech.with_streaming_response.create(
        model="gpt-4o-mini-tts",
        voice="coral",
        input="Today is a wonderful day to build something people love!",
        instructions="Speak in a cheerful and positive tone.",
        response_format="pcm",
    ) as response:
        await LocalAudioPlayer().play(response)

if __name__ == "__main__":
    asyncio.run(main())
```

Для самой быстрой реакции используйте форматы `wav` или `pcm`.

---

## Поддерживаемые форматы вывода

| Формат | Описание |
|--------|----------|
| `mp3` | Формат по умолчанию для общих случаев |
| `opus` | Для интернет стриминга и коммуникаций, низкая задержка |
| `aac` | Для цифровой компрессии, предпочитается YouTube, Android, iOS |
| `flac` | Lossless компрессия для аудиофилов |
| `wav` | Несжатый WAV, подходит для low-latency приложений |
| `pcm` | Как WAV но содержит raw samples в 24kHz (16-bit signed, little-endian), без заголовка |

---

## Поддерживаемые языки

Модель TTS поддерживает те же языки, что и Whisper:

Afrikaans, Arabic, Armenian, Azerbaijani, Belarusian, Bosnian, Bulgarian, Catalan, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, Galician, German, Greek, Hebrew, Hindi, Hungarian, Icelandic, Indonesian, Italian, Japanese, Kannada, Kazakh, Korean, Latvian, Lithuanian, Macedonian, Malay, Marathi, Maori, Nepali, Norwegian, Persian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Tagalog, Tamil, Thai, Turkish, Ukrainian, Urdu, Vietnamese, Welsh.

> Голоса оптимизированы для английского языка.

---

## Custom Voices (Пользовательские голоса)

Пользовательские голоса позволяют создать уникальный голос для вашего приложения.

### Требования

- Максимум 20 голосов на организацию
- Аудио сэмплы должны быть 30 секунд или меньше
- Поддерживаемые форматы: mpeg, wav, ogg, aac, flac, webm, mp4

### Создание голоса

Требуется две аудиозаписи:

1. **Consent recording** — запись согласия голосового актёра
2. **Sample recording** — actual audio sample для репликации

### Фразы согласия (Consent phrases)

| Язык | Фраза |
|------|-------|
| en | "I am the owner of this voice and I consent to OpenAI using this voice to create a synthetic voice model." |
| ru | "Я являюсь владельцем этого голоса и даю согласие OpenAI на использование этого голоса для создания модели синтетического голоса." |
| de | "Ich bin der Eigentümer dieser Stimme und bin damit einverstanden, dass OpenAI diese Stimme zur Erstellung eines synthetischen Stimmmodells verwendet." |
| ... | (см. полный список в официальной документации) |

### Создание consent записи

```bash
curl https://api.openai.com/v1/audio/voice_consents \
  -X POST \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "name=test_consent" \
  -F "language=en" \
  -F "recording=@$HOME/tmp/voice_consent/consent_recording.wav;type=audio/x-wav"
```

### Создание голоса

```bash
curl https://api.openai.com/v1/audio/voices \
  -X POST \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "name=test_voice" \
  -F "audio_sample=@$HOME/tmp/voice_consent/audio_sample_recording.wav;type=audio/x-wav" \
  -F "consent=cons_123abc"
```

### Использование custom голоса

```bash
curl https://api.openai.com/v1/audio/speech \
  -X POST \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini-tts",
    "voice": { "id": "voice_123abc" },
    "input": "Maple est le meilleur golden retriever du monde entier.",
    "language": "fr",
    "format": "wav"
  }' \
  --output sample.wav
```

---

## Советы для создания качественного голоса

1. Записывайте в тихом помещении с минимальным эхом
2. Используйте профессиональный XLR микрофон
3. Держитесь на расстоянии 7-8 дюймов от микрофона с pop-фильтром
4. Модель копирует всё точно — тон, каденцию, энергию, паузы
5. Будьте последовательны в энергии, стиле и акценте

---

## Ссылки

- [OpenAI Text-to-Speech API](https://platform.openai.com/docs/guides/text-to-speech)
- [Audio API Reference](https://platform.openai.com/docs/api-reference/audio/createSpeech)
- [Interactive Demo](https://openai.fm/) — послушать все голоса
