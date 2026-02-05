import * as FileSystem from 'expo-file-system/legacy';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { TTSProvider, OpenAIVoice, WordTimestamp } from '../types';  // PHASE 2: Added WordTimestamp
import { STREAMING_CONFIG } from '../config/streaming-config';
import { cartesiaStreamingService } from './cartesia-streaming-service';
import { chunkedStreamingPlayer } from './streaming-audio-player';

/**
 * Text-to-Speech Service supporting Cartesia and OpenAI APIs
 * 
 * Uses raw fetch (no SDK) to avoid React Native incompatibility with Node.js modules.
 * 
 * NEW: Supports WebSocket streaming for Cartesia (Phase 1-3)
 */
class TTSService {
  private soundObjects: Audio.Sound[] = [];
  private isPlaying: boolean = false;
  private isInitialized: boolean = false;

  // NEW: Mute state
  private isMuted: boolean = false;

  // NEW: TTS Provider selection
  private ttsProvider: TTSProvider = 'cartesia';
  private openaiVoice: OpenAIVoice = 'nova';
  private openaiApiKey?: string;

  // NEW: Streaming state
  private isStreaming: boolean = false;
  private currentStreamContextId: string | null = null;

  constructor() {
    this.initialize();
    this.openaiApiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    this.loadSettings();
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log("🔊 [TTS] Initializing audio...");

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers
      });

      this.isInitialized = true;
      console.log("✅ [TTS] Audio initialized");

    } catch (error) {
      console.error("❌ [TTS] Initialization failed:", error);
    }
  }

  // ========================
  // MUTE CONTROL
  // ========================

  /**
   * Set mute state
   */
  setMuted(muted: boolean): void {
    console.log(`🔇 [TTS] Mute state changed: ${muted}`);
    this.isMuted = muted;

    // Если включаем mute во время воспроизведения - остановить
    if (muted && this.isPlaying) {
      console.log('🔇 [TTS] Stopping playback due to mute');
      this.stop();
    }
  }

  /**
   * Get current mute state
   */
  getIsMuted(): boolean {
    return this.isMuted;
  }

  // ========================
  // TTS PROVIDER CONTROL
  // ========================

  /**
   * Set TTS provider
   */
  setTtsProvider(provider: TTSProvider): void {
    console.log(`🎙️ [TTS] Provider changed: ${this.ttsProvider} → ${provider}`);
    this.ttsProvider = provider;
    this.saveSettings();
  }

  /**
   * Get current TTS provider
   */
  getTtsProvider(): TTSProvider {
    return this.ttsProvider;
  }

  /**
   * Set OpenAI voice
   */
  setOpenaiVoice(voice: OpenAIVoice): void {
    console.log(`🎙️ [TTS] OpenAI voice changed: ${this.openaiVoice} → ${voice}`);
    this.openaiVoice = voice;
    this.saveSettings();
  }

  /**
   * Get current OpenAI voice
   */
  getOpenaiVoice(): OpenAIVoice {
    return this.openaiVoice;
  }

  // ========================
  // SETTINGS PERSISTENCE
  // ========================

  /**
   * Load settings from AsyncStorage
   */
  private async loadSettings(): Promise<void> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const settings = await AsyncStorage.default.getItem('tts_settings');

      if (settings) {
        const parsed = JSON.parse(settings);
        this.ttsProvider = parsed.provider || 'cartesia';
        this.openaiVoice = parsed.voice || 'nova';
        console.log(`✅ [TTS] Settings loaded: ${this.ttsProvider}/${this.openaiVoice}`);
      }
    } catch (error) {
      console.warn('⚠️ [TTS] Failed to load settings:', error);
    }
  }

  /**
   * Save settings to AsyncStorage
   */
  private async saveSettings(): Promise<void> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.setItem('tts_settings', JSON.stringify({
        provider: this.ttsProvider,
        voice: this.openaiVoice,
      }));
      console.log('✅ [TTS] Settings saved');
    } catch (error) {
      console.warn('⚠️ [TTS] Failed to save settings:', error);
    }
  }

  /**
   * Generate speech from text using selected provider
   * 
   * NEW: Automatically uses streaming for Cartesia if enabled (STREAMING_CONFIG.enabled)
   * Falls back to REST API on streaming errors
   */
  async speak(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    // ПРОВЕРКА MUTE
    if (this.isMuted) {
      console.log(`🔇 [TTS] Muted - skipping speech: "${text.substring(0, 30)}..."`);
      return true; // Возвращаем true чтобы не ломать логику
    }

    try {
      console.log(`🎙️ [TTS] Speaking: "${text.substring(0, 50)}..."`);

      // NEW: Try streaming first if enabled and using Cartesia
      if (STREAMING_CONFIG.enabled && this.ttsProvider === 'cartesia') {
        console.log('🌊 [TTS] Attempting streaming playback...');

        try {
          const success = await this.speakCartesiaStreaming(text, options);
          if (success) {
            console.log('✅ [TTS] Streaming playback successful');
            return true;
          }

          console.warn('⚠️ [TTS] Streaming failed, falling back to REST API');
        } catch (error) {
          console.error('❌ [TTS] Streaming error, falling back to REST API:', error);
        }
      }

      // Standard (REST API) path
      const audioFile = await this.fetchAudioFile(text, options);

      if (!audioFile) {
        console.error("❌ [TTS] Failed to fetch audio");
        return false;
      }

      if (options?.autoPlay !== false) {
        return await this.playAudioFile(audioFile, options?.speed);
      }

      return true;

    } catch (error) {
      console.error("❌ [TTS] Speak error:", error);
      return false;
    }
  }

  /**
   * Fetch audio file - automatically selects provider
   */
  private async fetchAudioFile(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<string | null> {
    try {
      // Выбор провайдера
      if (this.ttsProvider === 'openai') {
        console.log(`🎙️ [TTS] Using OpenAI TTS provider`);
        return await this.fetchOpenAIAudioFile(text, options);
      } else {
        console.log(`🎙️ [TTS] Using Cartesia TTS provider`);
        return await this.fetchCartesiaAudioFile(text, options);
      }
    } catch (error) {
      console.error('❌ [TTS] fetchAudioFile error:', error);
      return null;
    }
  }

  // ========================
  // OPENAI TTS METHODS
  // ========================

  /**
   * Fetch audio file from OpenAI API
   */
  private async fetchOpenAIAudioFile(
    text: string,
    options?: {
      emotion?: string; // Ignored in OpenAI, but kept for compatibility
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<string | null> {
    try {
      if (!this.openaiApiKey) {
        console.error('❌ [TTS] OpenAI API key not configured');
        return null;
      }

      console.log(`🎙️ [TTS] OpenAI TTS request...`);
      console.log(`🎙️ [TTS] Text: "${text.substring(0, 50)}..."`);
      console.log(`🎙️ [TTS] Voice: ${this.openaiVoice}`);
      console.log(`🎙️ [TTS] Speed: ${options?.speed || 1.0}x`);

      // OpenAI API request
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',  // или 'tts-1-hd' для лучшего качества
          input: text,
          voice: this.openaiVoice,
          speed: options?.speed || 1.0,
          response_format: 'mp3',
        }),
      });

      console.log(`📥 [TTS] OpenAI Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [TTS] OpenAI API Error:`, errorText);
        return null;
      }

      // Получить аудио данные
      const arrayBuffer = await response.arrayBuffer();
      console.log(`✅ [TTS] OpenAI Audio received: ${arrayBuffer.byteLength} bytes`);

      // Сохранить в файл
      const filename = `openai_speech_${Date.now()}.mp3`;
      const filepath = `${FileSystem.cacheDirectory}${filename}`;

      const base64Audio = this.arrayBufferToBase64(arrayBuffer);
      await FileSystem.writeAsStringAsync(filepath, base64Audio, {
        encoding: 'base64',
      });

      console.log(`💾 [TTS] OpenAI Audio saved: ${filepath}`);
      return filepath;

    } catch (error) {
      console.error('❌ [TTS] OpenAI TTS error:', error);
      return null;
    }
  }

  // ========================
  // CARTESIA TTS METHODS
  // ========================

  /**
   * Fetch audio file from Cartesia API using raw fetch
   */
  private async fetchCartesiaAudioFile(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<string | null> {
    try {
      console.log(`🎙️ [TTS] Starting Cartesia REST API call...`);
      console.log(`🎙️ [TTS] Text: "${text.substring(0, 50)}..."`);

      // ⚠️ TEMPORARY HARDCODE - FOR TESTING ONLY
      const API_KEY = "sk_car_8H5cHPGLMuZpaeXxqWNNve";  // ← Your real key from dashboard
      const VOICE_ID = "e07c00bc-4134-4eae-9ea4-1a55fb45746b";

      console.log("⚠️⚠️⚠️ [TTS] Using HARDCODED key (TEST MODE)");

      console.log(`🔑 [TTS] Key loaded: ${API_KEY.substring(0, 25)}...`);
      console.log(`🎭 [TTS] Emotion: ${options?.emotion || 'neutral'}`);
      console.log(`⚡ [TTS] Speed: ${options?.speed || 1.0}x`);

      // Build request with emotion controls
      const requestBody: any = {
        model_id: "sonic-3",
        transcript: text,
        voice: {
          mode: "id",
          id: VOICE_ID
        },
        language: "en",
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100
        }
      };

      // Add emotion controls if provided
      if (options?.emotion || options?.emotionLevel) {
        const emotionLevel = options.emotionLevel || [options.emotion || 'neutral'];
        requestBody.voice.__experimental_controls = {
          emotion: emotionLevel
        };
      }

      console.log(`📤 [TTS] Request:`, JSON.stringify(requestBody, null, 2));

      // Helper function for fetch with timeout
      const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 15000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
          }
          throw error;
        }
      };

      // Make request with timeout and timing
      const fetchStartTime = Date.now();
      console.log(`📤 [TTS] Starting TTS request to Cartesia API...`);

      const response = await fetchWithTimeout("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "X-API-Key": API_KEY,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }, 15000); // 15 seconds timeout

      const fetchTime = Date.now() - fetchStartTime;
      console.log(`📥 [TTS] Fetch completed in ${fetchTime}ms`);
      console.log(`📥 [TTS] Response status: ${response.status}`);

      // Check response
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [TTS] API Error (${response.status}):`, errorText);
        console.error(`❌ [TTS] Check API key, request format, and network connectivity`);

        return null;
      }

      // Get audio data with timing
      console.log(`✅ [TTS] Response OK, reading audio...`);
      const arrayBufferStartTime = Date.now();
      const arrayBuffer = await response.arrayBuffer();
      const arrayBufferTime = Date.now() - arrayBufferStartTime;
      console.log(`✅ [TTS] Audio received: ${arrayBuffer.byteLength} bytes (ArrayBuffer read in ${arrayBufferTime}ms)`);

      // Save to file
      const filename = `speech_${Date.now()}.mp3`;
      const filepath = `${FileSystem.cacheDirectory}${filename}`;

      const base64Audio = this.arrayBufferToBase64(arrayBuffer);

      const saveStartTime = Date.now();
      await FileSystem.writeAsStringAsync(filepath, base64Audio, {
        encoding: 'base64'
      });
      const saveTime = Date.now() - saveStartTime;

      console.log(`💾 [TTS] Saved to: ${filepath} (File write in ${saveTime}ms)`);
      console.log(`⏱️ [TTS] BREAKDOWN: Fetch=${fetchTime}ms, ArrayBuffer=${arrayBufferTime}ms, Save=${saveTime}ms, Total=${fetchTime + arrayBufferTime + saveTime}ms`);

      return filepath;

    } catch (error) {
      console.error("❌ [TTS] Fatal error:", error);
      if (error instanceof Error) {
        console.error("❌ [TTS] Error message:", error.message);
        console.error("❌ [TTS] Error stack:", error.stack);
      }
      return null;
    }
  }

  // ========================
  // STREAMING TTS METHODS (Phase 3)
  // ========================

  /**
   * Speak using Cartesia WebSocket streaming
   * 
   * NEW: Phase 3 - Streaming implementation
   * Uses WebSocket for real-time audio generation and chunked playback
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
    try {
      console.log('🌊 [TTS Streaming] Starting WebSocket generation...');

      const VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID || "e07c00bc-4134-4eae-9ea4-1a55fb45746b";

      // Stop any previous streaming playback
      if (this.isStreaming) {
        console.log('🛑 [TTS Streaming] Stopping previous stream...');
        await chunkedStreamingPlayer.stop();
        this.isStreaming = false;
      }

      // Map speed number to Cartesia speed string
      let speedString: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' = 'normal';
      if (options?.speed) {
        if (options.speed <= 0.75) speedString = 'slowest';
        else if (options.speed <= 0.9) speedString = 'slow';
        else if (options.speed >= 1.25) speedString = 'fastest';
        else if (options.speed >= 1.1) speedString = 'fast';
      }

      // Map emotion to Cartesia emotion array
      const emotionLevel = options?.emotionLevel || (options?.emotion ? [options.emotion] : undefined);

      console.log('🎙️ [TTS Streaming] Options:', {
        voiceId: VOICE_ID,
        speed: speedString,
        emotion: emotionLevel,
        textLength: text.length
      });

      // Create audio stream generator
      const chunkGenerator = cartesiaStreamingService.generateAudioStream({
        voiceId: VOICE_ID,
        text: text,
        emotion: emotionLevel,
        speed: speedString,
        onFirstChunk: (latency) => {
          console.log(`🎯 [TTS Streaming] First chunk in ${latency}ms`);
        },
        onError: (error) => {
          console.error('❌ [TTS Streaming] Generation error:', error);
        },
        onComplete: () => {
          console.log('✅ [TTS Streaming] Generation complete');
        },
        // PHASE 2: Forward timestamps directly to player
        onTimestampsReceived: (timestamps) => {
          chunkedStreamingPlayer.receiveTimestamps(timestamps);
        }
      });

      // Play the stream with sentence chunking
      this.isStreaming = true;

      if (options?.autoPlay !== false) {
        await chunkedStreamingPlayer.playStream(chunkGenerator, {
          originalText: text,
          enableSentenceChunking: true
        });
        console.log('✅ [TTS Streaming] Playback complete');
      }

      this.isStreaming = false;
      return true;

    } catch (error) {
      console.error('❌ [TTS Streaming] Error:', error);
      this.isStreaming = false;
      throw error;
    }
  }

  /**
   * Play audio file
   */
  private async playAudioFile(filepath: string, speed?: number): Promise<boolean> {
    try {
      const playbackRate = speed || 1.0;
      console.log(`🔊 [TTS] Playing: ${filepath}`);
      console.log(`🔊 [TTS] Playing at rate: ${playbackRate}`);

      const { sound } = await Audio.Sound.createAsync(
        { uri: filepath },
        {
          shouldPlay: true,
          volume: 1.0,
          rate: playbackRate,
          pitchCorrectionQuality: Audio.PitchCorrectionQuality.High
        }
      );

      this.soundObjects.push(sound);
      this.isPlaying = true;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          console.log("✅ [TTS] Playback finished");
          this.isPlaying = false;
        }
      });

      return true;

    } catch (error) {
      console.error("❌ [TTS] Playback error:", error);
      this.isPlaying = false;
      return false;
    }
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Stop all audio playback (including streaming)
   * 
   * NEW: Also stops streaming playback if active
   */
  async stop(): Promise<void> {
    console.log("⏹️ [TTS] Stopping all audio...");

    // NEW: Stop streaming if active
    if (this.isStreaming) {
      console.log("🛑 [TTS] Stopping streaming playback...");
      try {
        await chunkedStreamingPlayer.stop();
        this.isStreaming = false;
      } catch (error) {
        console.error("❌ [TTS] Error stopping streaming:", error);
      }
    }

    // Stop regular playback
    for (const sound of this.soundObjects) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (error) {
        console.error("❌ [TTS] Stop error:", error);
      }
    }

    this.soundObjects = [];
    this.isPlaying = false;

    console.log("✅ [TTS] All audio stopped");
  }

  /**
   * Preload audio and return a player object for manual control
   * This method is used by the interview logic for synchronized playback
   * 
   * NEW: Uses streaming if enabled (plays immediately, returns mock Sound)
   */
  async prepareAudio(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<Audio.Sound | null> {
    // ПРОВЕРКА MUTE
    if (this.isMuted) {
      console.log(`🔇 [TTS] Muted - skipping prepare: "${text.substring(0, 30)}..."`);
      return null;
    }

    try {
      console.log(`🎙️ [TTS] Preparing audio: "${text.substring(0, 50)}..."`);

      // NEW: Try streaming if enabled for Cartesia
      if (STREAMING_CONFIG.enabled && this.ttsProvider === 'cartesia') {
        console.log('🌊 [TTS] Using streaming for prepareAudio...');

        try {
          // FIX: НЕ запускаем streaming сразу, создаем Promise для отложенного запуска
          let streamingPromise: Promise<boolean> | null = null;
          let isPlaybackStarted = false;
          let statusCallback: ((status: any) => void) | null = null;

          const mockSound = {
            playAsync: async () => {
              console.log('🎵 [TTS Streaming Mock] playAsync called');

              // Запускаем streaming ТОЛЬКО при первом вызове playAsync
              if (!isPlaybackStarted) {
                isPlaybackStarted = true;
                console.log('▶️ [TTS Streaming Mock] Starting streaming playback...');

                try {
                  streamingPromise = this.speakCartesiaStreaming(text, {
                    ...options,
                    autoPlay: true
                  });

                  await streamingPromise;
                  console.log('✅ [TTS Streaming Mock] Playback complete');

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
                  console.error('❌ [TTS Streaming Mock] Playback error:', error);

                  // FIX: Вызываем callback даже при ошибке для предотвращения deadlock
                  if (statusCallback) {
                    console.log('📢 [TTS Streaming Mock] Triggering didJustFinish (error case)');
                    statusCallback({
                      isLoaded: true,
                      didJustFinish: true,
                      durationMillis: 0,
                      positionMillis: 0
                    });
                  }
                }
              } else {
                console.warn('⚠️ [TTS Streaming Mock] playAsync called multiple times, ignoring');
              }
            },

            setOnPlaybackStatusUpdate: (callback: any) => {
              console.log('🔄 [TTS Streaming Mock] setOnPlaybackStatusUpdate called');

              // FIX: Просто сохраняем callback, он будет вызван из playAsync
              statusCallback = callback;
            },

            stopAsync: async () => {
              console.log('🛑 [TTS Streaming Mock] Stop requested');
              await chunkedStreamingPlayer.stop();
              isPlaybackStarted = false;
              streamingPromise = null;
              statusCallback = null;
            },

            unloadAsync: async () => {
              console.log('🗑️ [TTS Streaming Mock] Unload');
              await chunkedStreamingPlayer.stop();
              isPlaybackStarted = false;
              streamingPromise = null;
              statusCallback = null;
            }
          } as any as Audio.Sound;

          console.log('✅ [TTS] Streaming mock Sound created (playback deferred)');
          return mockSound;

        } catch (error) {
          console.error('❌ [TTS] Streaming failed in prepareAudio, falling back:', error);
          // Fall through to REST API
        }
      }

      // Standard (REST API) path
      const audioFile = await this.fetchAudioFile(text, options);

      if (!audioFile) {
        console.error("❌ [TTS] Failed to fetch audio");
        return null;
      }

      console.log(`🔊 [TTS] Loading audio from: ${audioFile}`);

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioFile },
        {
          shouldPlay: false,
          volume: 1.0,
          rate: options?.speed || 1.0,
          pitchCorrectionQuality: Audio.PitchCorrectionQuality.High
        }
      );

      this.soundObjects.push(sound);

      console.log("✅ [TTS] Audio prepared successfully");
      return sound;

    } catch (error) {
      console.error("❌ [TTS] prepareAudio error:", error);
      return null;
    }
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stop();
  }
}

export default new TTSService();