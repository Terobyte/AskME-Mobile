import * as FileSystem from 'expo-file-system/legacy';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { TTSProvider, OpenAIVoice, DeepgramVoice, WordTimestamp, VibeConfig } from '../types';  // PHASE 2: Added WordTimestamp, VibeConfig
import { STREAMING_CONFIG } from '../config/streaming-config';
import { cartesiaStreamingService } from './cartesia-streaming-service';
import { chunkedStreamingPlayer } from './streaming-audio-player';
import { getCartesiaStreamingPlayer } from './audio/CartesiaStreamingPlayer';
import { getDeepgramStreamingPlayer } from './audio/DeepgramStreamingPlayer';
import { getOpenAIStreamingPlayer } from './audio/OpenAIStreamingPlayer';
import Constants from 'expo-constants';

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
  private openaiVoice: OpenAIVoice = 'marin';  // Best quality voice
  private deepgramVoice: DeepgramVoice = 'aura-2-thalia-en';
  private openaiApiKey?: string;
  private openaiInstructions: string = 'Speak in a professional, business-like tone.';  // Professional tone

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

  /**
   * Set Deepgram voice
   */
  setDeepgramVoice(voice: DeepgramVoice): void {
    console.log(`🎙️ [TTS] Deepgram voice changed: ${this.deepgramVoice} → ${voice}`);
    this.deepgramVoice = voice;
    this.saveSettings();
  }

  /**
   * Get current Deepgram voice
   */
  getDeepgramVoice(): DeepgramVoice {
    return this.deepgramVoice;
  }

  /**
   * Set OpenAI instructions (voice style)
   */
  setOpenaiInstructions(instructions: string): void {
    this.openaiInstructions = instructions;
    console.log(`🎙️ [TTS] OpenAI instructions: "${instructions}"`);
    this.saveSettings();
  }

  /**
   * Get current OpenAI instructions
   */
  getOpenaiInstructions(): string {
    return this.openaiInstructions;
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
        this.openaiVoice = parsed.openaiVoice || 'nova';
        this.deepgramVoice = parsed.deepgramVoice || 'aura-2-thalia-en';
        this.openaiInstructions = parsed.openaiInstructions || '';
        console.log(`✅ [TTS] Settings loaded: ${this.ttsProvider}/${this.openaiVoice}/${this.deepgramVoice}`);
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
        openaiVoice: this.openaiVoice,
        deepgramVoice: this.deepgramVoice,
        openaiInstructions: this.openaiInstructions,
      }));
      console.log('✅ [TTS] Settings saved');
    } catch (error) {
      console.warn('⚠️ [TTS] Failed to save settings:', error);
    }
  }

  /**
   * Generate speech from text using selected provider
   *
   * NEW: Always uses streaming for Cartesia, Deepgram, and OpenAI
   * Falls back to REST API only for Cartesia/Deepgram if streaming fails
   * OpenAI has NO REST fallback - streaming only
   */
  async speak(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
      vibe?: VibeConfig;  // Vibe for OpenAI emotion support
    }
  ): Promise<boolean> {
    // ПРОВЕРКА MUTE
    if (this.isMuted) {
      console.log(`🔇 [TTS] Muted - skipping speech: "${text.substring(0, 30)}..."`);
      return true; // Возвращаем true чтобы не ломать логику
    }

    try {
      console.log(`🎙️ [TTS] Speaking: "${text.substring(0, 50)}..."`);

      // OpenAI: Streaming only, no fallback
      if (this.ttsProvider === 'openai') {
        console.log(`🌊 [TTS] OpenAI streaming only (no REST fallback)`);
        try {
          const success = await this.speakOpenAIStreaming(text, options);
          if (success) {
            console.log('✅ [TTS] OpenAI streaming successful');
            return true;
          }
          console.error('❌ [TTS] OpenAI streaming failed - no fallback available');
          return false;
        } catch (error) {
          console.error('❌ [TTS] OpenAI streaming error:', error);
          return false;
        }
      }

      // Cartesia/Deepgram: Try streaming first, fallback to REST
      if (STREAMING_CONFIG.enabled && (this.ttsProvider === 'cartesia' || this.ttsProvider === 'deepgram')) {
        console.log(`🌊 [TTS] Attempting streaming playback (${this.ttsProvider})...`);

        try {
          let success = false;

          if (this.ttsProvider === 'cartesia') {
            success = await this.speakCartesiaStreaming(text, options);
          } else {
            success = await this.speakDeepgramStreaming(text, options);
          }

          if (success) {
            console.log('✅ [TTS] Streaming playback successful');
            return true;
          }

          console.warn('⚠️ [TTS] Streaming failed, falling back to REST API');
        } catch (error) {
          console.error('❌ [TTS] Streaming error, falling back to REST API:', error);
        }
      }

      // Standard (REST API) path - only for Cartesia/Deepgram
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
   * NOTE: OpenAI only uses streaming, this is REST fallback for Cartesia/Deepgram
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
      // Выбор провайдера (OpenAI streaming only - no REST fallback)
      if (this.ttsProvider === 'deepgram') {
        console.log(`🎙️ [TTS] Using Deepgram TTS provider (REST fallback)`);
        return await this.fetchDeepgramAudioFile(text, options);
      } else {
        console.log(`🎙️ [TTS] Using Cartesia TTS provider (REST fallback)`);
        return await this.fetchCartesiaAudioFile(text, options);
      }
    } catch (error) {
      console.error('❌ [TTS] fetchAudioFile error:', error);
      return null;
    }
  }

  // ========================
  // DEEPGRAM TTS METHODS
  // ========================

  /**
   * Fetch audio file from Deepgram API (REST fallback)
   */
  private async fetchDeepgramAudioFile(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<string | null> {
    try {
      const API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY;

      if (!API_KEY) {
        console.error('❌ [TTS] Deepgram API key not configured');
        return null;
      }

      console.log(`🎙️ [TTS] Deepgram TTS request...`);
      console.log(`🎙️ [TTS] Text: "${text.substring(0, 50)}..."`);
      console.log(`🎙️ [TTS] Voice: ${this.deepgramVoice}`);

      // Deepgram REST API for TTS
      const response = await fetch(`https://api.deepgram.com/v1/speak?model=${this.deepgramVoice}&encoding=linear16&sample_rate=16000`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
        }),
      });

      console.log(`📥 [TTS] Deepgram Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [TTS] Deepgram API Error:`, errorText);
        return null;
      }

      // Get audio data (PCM16 linear16)
      const arrayBuffer = await response.arrayBuffer();
      console.log(`✅ [TTS] Deepgram Audio received: ${arrayBuffer.byteLength} bytes`);

      // Convert PCM16 to WAV format for playback
      const wavBuffer = this.pcm16ToWav(arrayBuffer, 16000);

      // Save to file
      const filename = `deepgram_speech_${Date.now()}.wav`;
      const filepath = `${FileSystem.cacheDirectory}${filename}`;

      const base64Audio = this.arrayBufferToBase64(wavBuffer);
      await FileSystem.writeAsStringAsync(filepath, base64Audio, {
        encoding: 'base64',
      });

      console.log(`💾 [TTS] Deepgram Audio saved: ${filepath}`);
      return filepath;

    } catch (error) {
      console.error('❌ [TTS] Deepgram TTS error:', error);
      return null;
    }
  }

  /**
   * Convert PCM16 data to WAV format
   */
  private pcm16ToWav(pcm16Data: ArrayBuffer, sampleRate: number): ArrayBuffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcm16Data.byteLength;
    const bufferSize = 44 + dataSize;

    const wavBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(wavBuffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Copy PCM data
    const pcmView = new Uint8Array(pcm16Data);
    const wavView = new Uint8Array(wavBuffer);
    wavView.set(pcmView, 44);

    return wavBuffer;
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

      // Load API key from environment variables
      const API_KEY = process.env.EXPO_PUBLIC_CARTESIA_API_KEY;
      const VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID;

      if (!API_KEY) {
        console.error("❌ [TTS] EXPO_PUBLIC_CARTESIA_API_KEY not configured in .env");
        return null;
      }

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
   * NEW: Uses react-native-audio-api CartesiaStreamingPlayer
   * TRUE streaming - plays chunks as they arrive
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
      console.log('🌊 [TTS Streaming] Starting NEW engine (react-native-audio-api)...');

      const VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID;
      if (!VOICE_ID) {
        throw new Error('EXPO_PUBLIC_CARTESIA_VOICE_ID not configured');
      }

      // Get the new streaming player
      const player = getCartesiaStreamingPlayer();

      // Stop any previous playback
      if (player.isCurrentlyPlaying() || player.isCurrentlyStreaming()) {
        console.log('🛑 [TTS Streaming] Stopping previous stream...');
        player.stop();
      }

      // Map speed number to Cartesia speed string
      let speedString: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' = 'normal';
      if (options?.speed) {
        if (options.speed <= 0.75) speedString = 'slowest';
        else if (options.speed <= 0.9) speedString = 'slow';
        else if (options.speed >= 1.25) speedString = 'fastest';
        else if (options.speed >= 1.1) speedString = 'fast';
      }

      const emotionLevel = options?.emotionLevel || (options?.emotion ? [options.emotion] : undefined);

      console.log('🎙️ [TTS Streaming] Options:', {
        voiceId: VOICE_ID,
        speed: speedString,
        emotion: emotionLevel,
        textLength: text.length
      });

      // Use new player
      await player.speak(text, {
        voiceId: VOICE_ID,
        emotion: emotionLevel,
        speed: speedString,
      });

      console.log('✅ [TTS Streaming] Playback complete');
      return true;

    } catch (error) {
      console.error('❌ [TTS Streaming] Error:', error);
      throw error;
    }
  }

  /**
   * Speak using Deepgram WebSocket streaming
   *
   * Uses react-native-audio-api DeepgramStreamingPlayer
   * TRUE streaming - plays chunks as they arrive
   */
  private async speakDeepgramStreaming(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
    }
  ): Promise<boolean> {
    try {
      console.log('🌊 [TTS Streaming] Starting Deepgram streaming engine (react-native-audio-api)...');

      const DEEPGRAM_API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY;
      if (!DEEPGRAM_API_KEY) {
        throw new Error('EXPO_PUBLIC_DEEPGRAM_API_KEY not configured');
      }

      // Get the Deepgram streaming player
      const player = getDeepgramStreamingPlayer();

      // Stop any previous playback
      if (player.isCurrentlyPlaying() || player.isCurrentlyStreaming()) {
        console.log('🛑 [TTS Streaming] Stopping previous Deepgram stream...');
        player.stop();
      }

      console.log('🎙️ [TTS Streaming] Options:', {
        voiceId: this.deepgramVoice,
        textLength: text.length
      });

      // Use Deepgram player (uses Sec-WebSocket-Protocol for authentication)
      await player.speak(text, {
        voiceId: this.deepgramVoice,
      });

      console.log('✅ [TTS Streaming] Deepgram playback complete');
      return true;

    } catch (error) {
      console.error('❌ [TTS Streaming] Deepgram streaming error:', error);
      throw error;
    }
  }

  /**
   * Speak with OpenAI streaming
   */
  private async speakOpenAIStreaming(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
      autoPlay?: boolean;
      vibe?: VibeConfig;  // Vibe for OpenAI emotion support
    }
  ): Promise<boolean> {
    try {
      console.log('🌊 [TTS Streaming] Starting OpenAI streaming engine (react-native-audio-api)...');

      const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      if (!OPENAI_API_KEY) {
        throw new Error('EXPO_PUBLIC_OPENAI_API_KEY not configured');
      }

      // Get the OpenAI streaming player
      const player = getOpenAIStreamingPlayer(OPENAI_API_KEY);

      // Stop any previous playback
      if (player.isCurrentlyPlaying() || player.isCurrentlyStreaming()) {
        console.log('🛑 [TTS Streaming] Stopping previous OpenAI stream...');
        player.stop();
      }

      // 🎭 EMOTION: Use vibe-based instructions if provided
      let instructions = this.openaiInstructions; // fallback to static
      let speed = options?.speed;

      if (options?.vibe) {
        // Import here to avoid circular dependency
        const { VibeCalculator } = require('./vibe-calculator');
        const openaiConfig = VibeCalculator.getOpenAIConfig(options.vibe.label);
        instructions = openaiConfig.instructions;
        speed = speed ?? openaiConfig.speed;

        console.log('🎭 [OpenAI Emotion] Using vibe-based config:', {
          vibe: options.vibe.label,
          instructions: instructions,
          speed: speed
        });
      }

      console.log('🎙️ [TTS Streaming] Options:', {
        voiceId: this.openaiVoice,
        textLength: text.length,
        speed: speed,
        instructions: instructions || undefined
      });

      // Use OpenAI player (fetch API with streaming response)
      await player.speak(text, {
        voiceId: this.openaiVoice,
        speed: speed,
        instructions: instructions || undefined,
      });

      console.log('✅ [TTS Streaming] OpenAI playback complete');
      return true;

    } catch (error) {
      console.error('❌ [TTS Streaming] OpenAI streaming error:', error);
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
   * Stops all streaming players: Cartesia, Deepgram, and OpenAI
   */
  async stop(): Promise<void> {
    console.log("⏹️ [TTS] Stopping all audio...");

    // Stop Cartesia streaming player
    const cartesiaPlayer = getCartesiaStreamingPlayer();
    if (cartesiaPlayer.isCurrentlyPlaying() || cartesiaPlayer.isCurrentlyStreaming()) {
      console.log("🛑 [TTS] Stopping Cartesia streaming player...");
      try {
        cartesiaPlayer.stop();
      } catch (error) {
        console.error("❌ [TTS] Error stopping Cartesia streaming:", error);
      }
    }

    // Stop Deepgram streaming player
    const deepgramPlayer = getDeepgramStreamingPlayer();
    if (deepgramPlayer.isCurrentlyPlaying() || deepgramPlayer.isCurrentlyStreaming()) {
      console.log("🛑 [TTS] Stopping Deepgram streaming player...");
      try {
        deepgramPlayer.stop();
      } catch (error) {
        console.error("❌ [TTS] Error stopping Deepgram streaming:", error);
      }
    }

    // Stop OpenAI streaming player
    const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (OPENAI_API_KEY) {
      const openaiPlayer = getOpenAIStreamingPlayer(OPENAI_API_KEY);
      if (openaiPlayer.isCurrentlyPlaying() || openaiPlayer.isCurrentlyStreaming()) {
        console.log("🛑 [TTS] Stopping OpenAI streaming player...");
        try {
          openaiPlayer.stop();
        } catch (error) {
          console.error("❌ [TTS] Error stopping OpenAI streaming:", error);
        }
      }
    }

    // Stop legacy streaming if active (for fallback)
    if (this.isStreaming) {
      console.log("🛑 [TTS] Stopping legacy streaming playback...");
      try {
        await chunkedStreamingPlayer.stop();
        this.isStreaming = false;
      } catch (error) {
        console.error("❌ [TTS] Error stopping legacy streaming:", error);
      }
    }

    // Stop regular playback (for Deepgram/Cartesia REST fallback)
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
      vibe?: VibeConfig;  // Vibe for OpenAI emotion support
    }
  ): Promise<Audio.Sound | null> {
    // ПРОВЕРКА MUTE
    if (this.isMuted) {
      console.log(`🔇 [TTS] Muted - skipping prepare: "${text.substring(0, 30)}..."`);
      return null;
    }

    try {
      console.log(`🎙️ [TTS] Preparing audio: "${text.substring(0, 50)}..."`);

      // NEW: Try streaming if enabled for Cartesia, Deepgram, or OpenAI
      if (STREAMING_CONFIG.enabled && (this.ttsProvider === 'cartesia' || this.ttsProvider === 'deepgram' || this.ttsProvider === 'openai')) {
        console.log(`🌊 [TTS] Using NEW streaming engine for prepareAudio (${this.ttsProvider})...`);

        try {
          let isPlaybackStarted = false;
          let isPlaybackComplete = false;  // Track completion for race condition fix
          let statusCallback: ((status: any) => void) | null = null;

          // Select appropriate player based on provider
          const isCartesia = this.ttsProvider === 'cartesia';
          const isOpenAI = this.ttsProvider === 'openai';
          const player = isCartesia ? getCartesiaStreamingPlayer() : isOpenAI ? getOpenAIStreamingPlayer(Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY!) : getDeepgramStreamingPlayer();

          const playFunction = async () => {
            if (isCartesia) {
              const VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID;
              if (!VOICE_ID) throw new Error('VOICE_ID not configured');

              let speedString: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' = 'normal';
              if (options?.speed) {
                if (options.speed <= 0.75) speedString = 'slowest';
                else if (options.speed <= 0.9) speedString = 'slow';
                else if (options.speed >= 1.25) speedString = 'fastest';
                else if (options.speed >= 1.1) speedString = 'fast';
              }

              const emotionLevel = options?.emotionLevel || (options?.emotion ? [options.emotion] : undefined);

              await (player as any).speak(text, {
                voiceId: VOICE_ID,
                emotion: emotionLevel,
                speed: speedString,
              });
            } else if (isOpenAI) {
              // OpenAI streaming
              const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
              if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

              // 🎭 EMOTION: Use vibe-based instructions if provided
              let instructions = this.openaiInstructions; // fallback to static
              let speed = options?.speed;

              if (options?.vibe) {
                // Import here to avoid circular dependency
                const { VibeCalculator } = require('./vibe-calculator');
                const openaiConfig = VibeCalculator.getOpenAIConfig(options.vibe.label);
                instructions = openaiConfig.instructions;
                speed = speed ?? openaiConfig.speed;

                console.log('🎭 [OpenAI Emotion] prepareAudio: Using vibe-based config:', {
                  vibe: options.vibe.label,
                  instructions: instructions,
                  speed: speed
                });
              }

              await (player as any).speak(text, {
                voiceId: this.openaiVoice,
                speed: speed,
                instructions: instructions || undefined,
              });
            } else {
              // Deepgram streaming
              const DEEPGRAM_API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY;
              if (!DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY not configured');

              await (player as any).speak(text, {
                voiceId: this.deepgramVoice,
              });
            }
          };

          // Create listener functions for cleanup
          const doneListener = () => {
            console.log('📢 [TTS Streaming Mock] Player done - triggering callback');
            isPlaybackComplete = true;
            if (statusCallback) {
              statusCallback({
                isLoaded: true,
                didJustFinish: true,
                durationMillis: 0,
                positionMillis: 0
              });
            }
          };

          const errorListener = (data: any) => {
            console.error('❌ [TTS Streaming Mock] Player error:', data);
            isPlaybackComplete = true;
            if (statusCallback) {
              statusCallback({
                isLoaded: true,
                didJustFinish: true,  // Trigger finish even on error
                durationMillis: 0,
                positionMillis: 0
              });
            }
          };

          // Subscribe to player events
          player.on('done', doneListener);
          player.on('error', errorListener);

          const cleanupListeners = () => {
            player.off('done', doneListener);
            player.off('error', errorListener);
          };

          const mockSound = {
            playAsync: async () => {
              console.log(`🎵 [TTS Streaming Mock] playAsync called (${this.ttsProvider} engine)`);

              if (!isPlaybackStarted) {
                isPlaybackStarted = true;
                console.log('▶️ [TTS Streaming Mock] Starting playback...');

                try {
                  await playFunction();

                  console.log('✅ [TTS Streaming Mock] Playback complete');

                  // Cleanup listeners
                  cleanupListeners();

                } catch (error) {
                  console.error('❌ [TTS Streaming Mock] Playback error:', error);
                  // Cleanup and trigger callback
                  cleanupListeners();
                  if (statusCallback) {
                    statusCallback({ isLoaded: true, didJustFinish: true, durationMillis: 0, positionMillis: 0 });
                  }
                }
              }
            },

            setOnPlaybackStatusUpdate: (callback: any) => {
              console.log('🔄 [TTS Streaming Mock] setOnPlaybackStatusUpdate called');
              statusCallback = callback;

              // CRITICAL FIX: If playback already completed, trigger callback immediately
              // This fixes race condition where 'done' event fires before callback is registered
              if (isPlaybackComplete && statusCallback) {
                console.log('📢 [TTS Streaming Mock] Already complete, triggering callback immediately');
                statusCallback({
                  isLoaded: true,
                  didJustFinish: true,
                  durationMillis: 0,
                  positionMillis: 0
                });
              }
            },

            stopAsync: async () => {
              console.log('🛑 [TTS Streaming Mock] Stop requested');
              player.stop();
              isPlaybackStarted = false;
              cleanupListeners();
            },

            unloadAsync: async () => {
              console.log('🗑️ [TTS Streaming Mock] Unload');
              player.stop();
              isPlaybackStarted = false;
              cleanupListeners();
            }
          } as any as Audio.Sound;

          console.log('✅ [TTS] NEW Streaming mock Sound created');
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
   * Get the appropriate streaming player based on current provider
   *
   * This method returns the singleton streaming player for event-driven playback.
   * Used by interview logic for synchronized audio-text coordination.
   *
   * @returns Streaming player instance (Cartesia, OpenAI, or Deepgram)
   */
  async getStreamingPlayer(): Promise<any> {
    const provider = this.getTtsProvider();

    switch (provider) {
      case 'openai': {
        const OPENAI_API_KEY = Constants.expoConfig?.extra?.openaiApiKey as string || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
        if (!OPENAI_API_KEY) {
          throw new Error('EXPO_PUBLIC_OPENAI_API_KEY not configured');
        }
        return getOpenAIStreamingPlayer(OPENAI_API_KEY, { sampleRate: 16000 });
      }
      case 'deepgram':
        return getDeepgramStreamingPlayer({ sampleRate: 16000 });
      case 'cartesia':
      default:
        return getCartesiaStreamingPlayer({ sampleRate: 16000 });
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