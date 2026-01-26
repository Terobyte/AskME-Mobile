import { createAudioPlayer, AudioSource, AudioPlayer } from 'expo-audio';
// Импортируем новый API для файлов
import { File, Paths } from 'expo-file-system';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || "";

class TTSServiceClass {
    currentPlayer: AudioPlayer | null = null;

    // --- ГЛАВНЫЙ МЕТОД ---
    async prepareAudio(text: string): Promise<AudioPlayer | null> {
        try {
            console.log("🔊 TTS: Requesting audio for:", text.substring(0, 15) + "...");
            
            // 1. Качаем и сохраняем файл (возвращает путь)
            const uri = await this.fetchAudioFile(text);
            if (!uri) {
                console.warn("⚠️ TTS: No URI returned");
                return null;
            }

            // 2. Создаем объект звука Expo Audio
            console.log("✅ TTS: File ready, loading into memory...");
            const source: AudioSource = { uri };
            const player = createAudioPlayer(source);
            
            // Note: The player starts loading immediately.
            return player;
        } catch (error) {
            console.error("❌ TTS Prepare Error:", error);
            return null;
        }
    }

    // Метод для совместимости (играет сразу)
    async speak(text: string) {
        const player = await this.prepareAudio(text);
        if (player) {
            this.currentPlayer = player;
            player.addListener('playbackStatusUpdate', (status) => {
                if (status.didJustFinish) {
                    // Cleanup
                    // @ts-ignore
                    if (typeof player.release === 'function') player.release();
                    else player.remove();
                }
            });
            player.play();
        }
    }

    async stop() {
        if (this.currentPlayer) {
            try {
                this.currentPlayer.pause();
                // @ts-ignore
                if (typeof this.currentPlayer.release === 'function') this.currentPlayer.release();
                else this.currentPlayer.remove();
            } catch(e) {}
            this.currentPlayer = null;
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