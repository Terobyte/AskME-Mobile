import { createAudioPlayer, AudioSource, AudioPlayer } from 'expo-audio';
// Импортируем новый API для файлов
import { File, Paths } from 'expo-file-system';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || "";

// Cartesia API configuration
const CARTESIA_API_KEY = process.env.EXPO_PUBLIC_CARTESIA_API_KEY || "";
const CARTESIA_VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID || "e07c00bc-4134-4eae-9ea4-1a55fb45746b";

if (!CARTESIA_API_KEY) {
  console.error("❌ [TTS] Cartesia API key missing in .env");
}

class TTSServiceClass {
    currentPlayer: AudioPlayer | null = null;

    constructor() {
        // Test Cartesia connection on startup
        setTimeout(() => {
            this.testMinimalCartesiaRequest();
        }, 1000);
    }

    // --- MINIMAL TEST METHOD ---
    private async testMinimalCartesiaRequest(): Promise<boolean> {
        console.log("🧪 [TTS] Testing minimal Cartesia request...");
        
        try {
            const response = await fetch("https://api.cartesia.ai/tts/bytes", {
                method: "POST",
                headers: {
                    "X-API-Key": CARTESIA_API_KEY,
                    "Cartesia-Version": "2024-06-10",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model_id: "sonic-3",
                    transcript: "Test",
                    voice: {
                        mode: "id",
                        id: CARTESIA_VOICE_ID
                    },
                    language: "en",
                    output_format: {
                        container: "mp3",
                        encoding: "mp3",
                        sample_rate: 22050
                    }
                })
            });
            
            console.log(`🧪 [TTS] Minimal test status: ${response.status}`);
            
            if (response.ok) {
                console.log(`✅ [TTS] Minimal request SUCCESS!`);
                const arrayBuffer = await response.arrayBuffer();
                console.log(`✅ [TTS] Audio size: ${arrayBuffer.byteLength} bytes`);
                return true;
            } else {
                const errorText = await response.text();
                console.error(`❌ [TTS] Minimal request failed:`, errorText);
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [TTS] Test error:`, error);
            return false;
        }
    }

    // --- ГЛАВНЫЙ МЕТОД ---
    async prepareAudio(
        text: string,
        options?: {
            emotion?: string;
            speed?: number;
            emotionLevel?: string[];
        }
    ): Promise<AudioPlayer | null> {
        try {
            console.log("🔊 TTS: Requesting audio for:", text.substring(0, 15) + "...");
            
            // 1. Качаем и сохраняем файл (возвращает путь)
            const uri = await this.fetchAudioFile(text, options);
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
    async speak(
        text: string,
        options?: {
            emotion?: string;
            speed?: number;
            emotionLevel?: string[];
        }
    ) {
        const player = await this.prepareAudio(text, options);
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

    // --- НОВЫЙ МЕТОД СКАЧИВАНИЯ (Cartesia API) ---
    private async fetchAudioFile(
        text: string,
        options?: {
            emotion?: string;
            speed?: number;
            emotionLevel?: string[];
        }
    ): Promise<string | null> {
        try {
            console.log(`🎙️ [TTS] Fetching audio from Cartesia...`);
            console.log(`🎙️ [TTS] Text: "${text.substring(0, 50)}..."`);
            console.log(`🎙️ [TTS] Emotion: ${options?.emotion || 'neutral'}`);
            console.log(`🎙️ [TTS] Speed: ${options?.speed || 1.0}x`);
            
            // Map speed to Cartesia categorical format
            const speedMapping: Record<string, string> = {
                '0.85': 'slowest',
                '0.90': 'slow',
                '0.95': 'slow',
                '1.00': 'normal',
                '1.05': 'fast',
                '1.10': 'fast',
                '1.20': 'fastest',
                '1.30': 'fastest'
            };
            
            const speedKey = (options?.speed || 1.0).toFixed(2);
            const cartesiaSpeed = speedMapping[speedKey] || 'normal';
            
            // Build base request (Sonic 3 format)
            const requestBody: any = {
                model_id: "sonic-3",
                transcript: text,
                voice: {
                    mode: "id",
                    id: CARTESIA_VOICE_ID
                },
                language: "en",
                output_format: {
                    container: "mp3",
                    encoding: "mp3",
                    sample_rate: 22050
                }
            };
            
            // Add experimental controls only if emotion/speed provided
            if (options?.speed || options?.emotion || options?.emotionLevel) {
                requestBody.voice.experimental_controls = {};
                
                if (options.speed && cartesiaSpeed !== 'normal') {
                    requestBody.voice.experimental_controls.speed = cartesiaSpeed;
                }
                
                if (options.emotionLevel && options.emotionLevel.length > 0) {
                    requestBody.voice.experimental_controls.emotion = options.emotionLevel;
                } else if (options.emotion && options.emotion !== 'neutral') {
                    requestBody.voice.experimental_controls.emotion = [options.emotion];
                }
            }
            
            console.log(`🎙️ [TTS] Request body:`, JSON.stringify(requestBody, null, 2));
            
            // Call Cartesia API
            const response = await fetch("https://api.cartesia.ai/tts/bytes", {
                method: "POST",
                headers: {
                    "X-API-Key": CARTESIA_API_KEY,
                    "Cartesia-Version": "2024-06-10",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ [TTS] Cartesia API Error (${response.status}):`, errorText);
                console.error(`❌ [TTS] Request was:`, JSON.stringify(requestBody, null, 2));
                console.error(`❌ [TTS] API Key (preview):`, CARTESIA_API_KEY.substring(0, 20) + '...');
                return null;
            }
            
            console.log(`✅ [TTS] Cartesia response OK`);
            
            // 1. Создаем ссылку на файл в кэше (используем новый класс File и Paths)
            const filename = `speech_${Date.now()}.mp3`;
            const file = new File(Paths.cache, filename);

            // 2. Получаем бинарные данные (ArrayBuffer) и делаем из них Uint8Array
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            console.log(`✅ [TTS] Audio size: ${arrayBuffer.byteLength} bytes`);

            // 3. Пишем байты прямо в файл (больше никаких Base64!)
            file.write(uint8Array);

            console.log(`💾 [TTS] Saved to: ${file.uri}`);
            return file.uri;

        } catch (error) {
            console.error("❌ [TTS] Fetch error:", error);
            return null;
        }
    }
}

export const TTSService = new TTSServiceClass();