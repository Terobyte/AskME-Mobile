import { Audio } from 'expo-av';
// Импортируем новый API для файлов
import { File, Paths } from 'expo-file-system';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || "";

class TTSServiceClass {
    currentSound: Audio.Sound | null = null;

    // --- ГЛАВНЫЙ МЕТОД ---
    async prepareAudio(text: string): Promise<Audio.Sound | null> {
        try {
            console.log("🔊 TTS: Requesting audio for:", text.substring(0, 15) + "...");
            
            // 1. Качаем и сохраняем файл (возвращает путь)
            const uri = await this.fetchAudioFile(text);
            if (!uri) {
                console.warn("⚠️ TTS: No URI returned");
                return null;
            }

            // 2. Создаем объект звука Expo AV
            console.log("✅ TTS: File ready, loading into memory...");
            const { sound } = await Audio.Sound.createAsync(
                { uri },
                { shouldPlay: false } // Только загружаем, не играем
            );

            return sound;
        } catch (error) {
            console.error("❌ TTS Prepare Error:", error);
            return null;
        }
    }

    // Метод для совместимости (играет сразу)
    async speak(text: string) {
        const sound = await this.prepareAudio(text);
        if (sound) {
            this.currentSound = sound;
            sound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    sound.unloadAsync();
                }
            });
            await sound.playAsync();
        }
    }

    async stop() {
        if (this.currentSound) {
            try {
                await this.currentSound.stopAsync();
                await this.currentSound.unloadAsync();
            } catch(e) {}
            this.currentSound = null;
        }
    }

    // --- НОВЫЙ МЕТОД СКАЧИВАНИЯ (Expo FileSystem API) ---
    private async fetchAudioFile(text: string): Promise<string | null> {
        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'tts-1',
                    input: text,
                    voice: 'shimmer', 
                    response_format: 'mp3',
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                console.error("TTS API Error:", err);
                return null;
            }

            // 1. Создаем ссылку на файл в кэше (используем новый класс File и Paths)
            const filename = `speech_${Date.now()}.mp3`;
            const file = new File(Paths.cache, filename);

            // 2. Получаем бинарные данные (ArrayBuffer) и делаем из них Uint8Array
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // 3. Пишем байты прямо в файл (больше никаких Base64!)
            file.write(uint8Array);

            console.log("✅ TTS: File saved to:", file.uri);
            return file.uri;

        } catch (error) {
            console.error("TTS Fetch Error:", error);
            return null;
        }
    }
}

export const TTSService = new TTSServiceClass();