// 1. CRITICAL: Import from 'legacy' to access writeAsStringAsync in SDK 54
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';

const TTS_API_URL = 'https://api.openai.com/v1/audio/speech';

// Helper: Custom Base64 conversion (Stable & Fast)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class TTSService {
  static currentSound: Audio.Sound | null = null;

  static async stop() {
    if (TTSService.currentSound) {
        try {
            await TTSService.currentSound.stopAsync();
            await TTSService.currentSound.unloadAsync();
        } catch (e) {
            console.log("Error stopping sound", e);
        }
        TTSService.currentSound = null;
    }
  }

  static async speak(text: string) {
    try {
      if (!text) return;

      // Stop previous if any
      await TTSService.stop();

      console.log('🔊 TTS: Requesting audio for:', text.substring(0, 15) + '...');

      // 1. Request Audio
      const response = await fetch(TTS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.EXPO_PUBLIC_OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'nova',
          input: text,
        }),
      });

      if (!response.ok) {
        console.error('❌ TTS API Error:', response.status);
        return;
      }

      console.log('✅ TTS: Response OK, converting...');

      // 2. Convert to Base64 manually
      const buffer = await response.arrayBuffer();
      const base64data = arrayBufferToBase64(buffer);
      
      const path = FileSystem.cacheDirectory + 'speech_' + Date.now() + '.mp3';

      // 3. Save using the Legacy API (Crucial for SDK 54)
      await FileSystem.writeAsStringAsync(path, base64data, {
        encoding: 'base64',
      });

      console.log('✅ TTS: File saved to', path);

      // 4. Configure Audio for Speaker (Loud volume)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      // 5. Play
      const { sound } = await Audio.Sound.createAsync(
        { uri: path },
        { shouldPlay: true }
      );
      
      TTSService.currentSound = sound;

      // Cleanup memory when done
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          if (TTSService.currentSound === sound) TTSService.currentSound = null;
        }
      });
      
      console.log('✅ TTS: Playing!');

    } catch (error) {
      console.error('❌ TTS FAILURE:', error);
    }
  }
}
