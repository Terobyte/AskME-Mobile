import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';

/**
 * Text-to-Speech Service using Cartesia API
 * 
 * Uses raw fetch (no SDK) to avoid React Native incompatibility with Node.js modules.
 */
class TTSService {
  private soundObjects: Audio.Sound[] = [];
  private isPlaying: boolean = false;
  private isInitialized: boolean = false;

  constructor() {
    this.initialize();
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
        playThroughEarpieceAndroid: false
      });
      
      this.isInitialized = true;
      console.log("✅ [TTS] Audio initialized");
      
    } catch (error) {
      console.error("❌ [TTS] Initialization failed:", error);
    }
  }

  /**
   * Generate speech from text using Cartesia API
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
    try {
      console.log(`🎙️ [TTS] Speaking: "${text.substring(0, 50)}..."`);
      
      const audioFile = await this.fetchAudioFile(text, options);
      
      if (!audioFile) {
        console.error("❌ [TTS] Failed to fetch audio");
        return false;
      }
      
      if (options?.autoPlay !== false) {
        return await this.playAudioFile(audioFile);
      }
      
      return true;
      
    } catch (error) {
      console.error("❌ [TTS] Speak error:", error);
      return false;
    }
  }

  /**
   * Fetch audio file from Cartesia API using raw fetch
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
      console.log(`🎙️ [TTS] Starting Cartesia REST API call...`);
      console.log(`🎙️ [TTS] Text: "${text.substring(0, 50)}..."`);
      
      // Get credentials from env
      const API_KEY = process.env.EXPO_PUBLIC_CARTESIA_API_KEY || "";
      const VOICE_ID = process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID || "e07c00bc-4134-4eae-9ea4-1a55fb45746b";
      
      // Validate key
      if (!API_KEY || API_KEY.includes('YOUR_') || API_KEY.length < 20) {
        console.error("❌ [TTS] Invalid API key!");
        console.error(`❌ Key preview: ${API_KEY.substring(0, 30)}...`);
        return null;
      }
      
      console.log(`🔑 [TTS] Key loaded: ${API_KEY.substring(0, 25)}...`);
      console.log(`🎭 [TTS] Emotion: ${options?.emotion || 'neutral'}`);
      console.log(`⚡ [TTS] Speed: ${options?.speed || 1.0}x`);
      
      // Build minimal request (no experimental controls first)
      const requestBody = {
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
          sample_rate: 22050
        }
      };
      
      console.log(`📤 [TTS] Request:`, JSON.stringify(requestBody, null, 2));
      
      // Make request
      const response = await fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "X-API-Key": API_KEY,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`📥 [TTS] Response status: ${response.status}`);
      
      // Check response
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [TTS] API Error (${response.status}):`, errorText);
        
        // Log request details for debugging
        console.error(`❌ [TTS] Request was:`, JSON.stringify(requestBody, null, 2));
        console.error(`❌ [TTS] Headers:`, {
          "X-API-Key": `${API_KEY.substring(0, 25)}...`,
          "Cartesia-Version": "2024-06-10"
        });
        
        return null;
      }
      
      // Get audio data
      console.log(`✅ [TTS] Response OK, reading audio...`);
      const arrayBuffer = await response.arrayBuffer();
      console.log(`✅ [TTS] Audio received: ${arrayBuffer.byteLength} bytes`);
      
      // Save to file
      const filename = `speech_${Date.now()}.mp3`;
      const filepath = `${FileSystem.cacheDirectory}${filename}`;
      
      const base64Audio = this.arrayBufferToBase64(arrayBuffer);
      
      await FileSystem.writeAsStringAsync(filepath, base64Audio, {
        encoding: 'base64'
      });
      
      console.log(`💾 [TTS] Saved to: ${filepath}`);
      
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

  /**
   * Play audio file
   */
  private async playAudioFile(filepath: string): Promise<boolean> {
    try {
      console.log(`🔊 [TTS] Playing: ${filepath}`);
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: filepath },
        { shouldPlay: true, volume: 1.0 }
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
   * Stop all audio playback
   */
  async stop(): Promise<void> {
    console.log("⏹️ [TTS] Stopping all audio...");
    
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
   */
  async prepareAudio(
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<Audio.Sound | null> {
    try {
      console.log(`🎙️ [TTS] Preparing audio: "${text.substring(0, 50)}..."`);
      
      const audioFile = await this.fetchAudioFile(text, options);
      
      if (!audioFile) {
        console.error("❌ [TTS] Failed to fetch audio");
        return null;
      }
      
      console.log(`🔊 [TTS] Loading audio from: ${audioFile}`);
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioFile },
        { shouldPlay: false, volume: 1.0 }
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
