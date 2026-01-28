import { useState, useRef, useEffect } from 'react';
import { Alert, Platform, Animated } from 'react-native';
import { useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync, IOSOutputFormat } from 'expo-audio';
import { TTSService } from '../../services/tts-service';

// ============================================
// TYPES
// ============================================

interface UseInterviewAudioOptions {
  onTTSStart?: () => void;
  onTTSEnd?: () => void;
  onTranscriptUpdate?: (transcript: string, isFinal: boolean) => void;
  onRecordingStop?: () => void; // Called when recording stops (for finalizeMessage)
  onStatusChange?: (status: 'idle' | 'listening') => void; // For status updates
  onError?: (error: Error) => void;
}

interface UseInterviewAudioReturn {
  // State
  isRecording: boolean;
  transcript: string;
  micScale: Animated.Value;
  isSendingData: boolean;
  error: string | null;
  permissionGranted: boolean;
  
  // Methods
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  clearError: () => void;
}

// ============================================
// AUDIO MODE HELPER (Retry logic for robust switching)
// ============================================

export const safeAudioModeSwitch = async (mode: 'recording' | 'playback'): Promise<boolean> => {
  try {
    if (mode === 'recording') {
      // RECORDING MODE: Simple and compatible
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    } else {
      // PLAYBACK MODE: Simple and compatible
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });
    }
    
    console.log(`✅ Audio Mode: ${mode}`);
    return true;
    
  } catch (err) {
    console.error(`❌ Audio Mode Switch Failed:`, err);
    throw err;
  }
};


// ============================================
// CUSTOM HOOK
// ============================================

export const useInterviewAudio = (options: UseInterviewAudioOptions = {}): UseInterviewAudioReturn => {
  const {
    onTTSStart,
    onTTSEnd,
    onTranscriptUpdate,
    onRecordingStop,
    onStatusChange,
    onError
  } = options;

  // State
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isSendingData, setIsSendingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const micScale = useRef(new Animated.Value(1)).current;

  // Refs
  const ws = useRef<WebSocket | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const lastPosition = useRef(0);
  const streamInterval = useRef<NodeJS.Timeout | null>(null);
  const latestTranscriptRef = useRef('');

  // ============================================
  // DEEPGRAM WEBSOCKET CONNECTION
  // ============================================

  const connectToDeepgram = async (): Promise<void> => {
    const API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY || '';
    const cleanKey = API_KEY.trim();
    
    if (!cleanKey) {
      const error = new Error('Deepgram API Key is missing');
      setError(error.message);
      onError?.(error);
      Alert.alert('Configuration Error', error.message);
      return;
    }

    const socketUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&filler_words=true&encoding=linear16&sample_rate=16000&container=wav&interim_results=true`;
    
    try {
      const socket = new WebSocket(socketUrl, ['token', cleanKey]);
      ws.current = socket;

      socket.onopen = () => {
        console.log('✅ WebSocket Connected');
        setIsRecording(true);
        onStatusChange?.('listening');
        setError(null);
      };

      socket.onmessage = async (event) => {
        try {
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            
            if (msg.channel?.alternatives?.[0]?.transcript) {
              const text = msg.channel.alternatives[0].transcript;
              
              if (text.trim().length > 0) {
                if (msg.is_final) {
                  setLiveTranscript(prev => {
                    const spacer = prev.length > 0 ? ' ' : '';
                    const newTranscript = prev + spacer + text.trim();
                    latestTranscriptRef.current = newTranscript;
                    onTranscriptUpdate?.(newTranscript, true);
                    return newTranscript;
                  });
                } else {
                  // Interim result
                  onTranscriptUpdate?.(text, false);
                }
              }
            }
          }
        } catch (e) {
          console.error('WS Message Error:', e);
          const error = e instanceof Error ? e : new Error('WebSocket message parsing failed');
          setError(error.message);
          onError?.(error);
        }
      };

      socket.onerror = (e: any) => {
        console.error('WebSocket Error:', e);
        const error = new Error('WebSocket connection error');
        setError(error.message);
        onError?.(error);
        stopRecording();
      };

      socket.onclose = () => {
        console.log('🔌 WebSocket Closed');
        setIsRecording(false);
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Failed to connect to Deepgram');
      console.error('Deepgram Connection Error:', error);
      setError(error.message);
      onError?.(error);
      throw error;
    }
  };

  // ============================================
  // START RECORDING
  // ============================================

  const startRecording = async (): Promise<void> => {
    try {
      console.log('🎙️ Starting Recording...');

      // 1. Clean up previous recorder state
      if (recorder.isRecording) {
        console.log('⚠️ Recorder already recording, forcing stop...');
        try {
          await recorder.stop();
        } catch (e) {
          console.warn('⚠️ Recorder stop failed (expected):', e);
        }
      }

      // 2. Wait for audio device to be fully released
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('✅ Recorder state cleaned');

      // 3. Stop TTS to prevent echo
      console.log('🛑 Stopping any active TTS playback...');
      await TTSService.stop();
      onTTSEnd?.();

      // 4. Wait for audio session to release
      await new Promise(resolve => setTimeout(resolve, 300));
      console.log('✅ Audio session released');

      // 5. Reset state
      setLiveTranscript('');
      latestTranscriptRef.current = '';
      lastPosition.current = 0;
      setError(null);

      // 6. Check permissions
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        const error = new Error('Microphone permission denied');
        setError(error.message);
        onError?.(error);
        Alert.alert('Permission Required', 'Microphone access is required for voice recording.');
        return;
      }
      setPermissionGranted(true);

      // 7. Configure audio mode for recording
      console.log('🎙️ Configuring audio mode for recording...');
      await safeAudioModeSwitch('recording');

      // 8. Wait for audio mode to apply
      await new Promise(resolve => setTimeout(resolve, 150));
      console.log('✅ Audio mode applied');

      // 9. Connect to Deepgram WebSocket
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        await connectToDeepgram();
      }

      // 10. Prepare recorder with valid 16kHz config for Deepgram
      console.log('🎙️ Preparing recorder...');
      
      await recorder.prepareToRecordAsync({
        extension: '.wav',
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 128000,
        android: {
          outputFormat: 'mpeg4',
          audioEncoder: 'aac',
        },
        ios: {
          outputFormat: IOSOutputFormat.LINEARPCM,
          audioQuality: 96,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        }
      });

      console.log('✅ Recorder prepared successfully');

      // 11. Start recording
      recorder.record();
      console.log('🎙️ Recorder Started. URI:', recorder.uri);
      setIsRecording(true);

      // 12. Start streaming loop
      if (streamInterval.current) {
        clearInterval(streamInterval.current);
      }

      streamInterval.current = setInterval(async () => {
        // Safety checks
        if (!recorder.isRecording || !recorder.uri) return;

        try {
          // Read the growing file
          const response = await fetch(recorder.uri);
          const blob = await response.blob();

          // Send new data to Deepgram
          if (blob.size > lastPosition.current) {
            const chunk = blob.slice(lastPosition.current);

            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              ws.current.send(chunk);
              setIsSendingData(true);
            }

            lastPosition.current = blob.size;
          } else {
            setIsSendingData(false);
          }
        } catch (e) {
          console.warn('Stream Read Error:', e);
        }
      }, 150);

    } catch (err: any) {
      const error = err instanceof Error ? err : new Error('Failed to start recording');
      console.error('❌ Recording failed:', error);
      setError(error.message);
      onError?.(error);
      
      Alert.alert(
        'Microphone Error',
        `Could not start recording: ${error.message}. Try restarting the app.`
      );
    }
  };

  // ============================================
  // STOP RECORDING
  // ============================================

  const stopRecording = async (): Promise<void> => {
    console.log('🛑 Stopping recording...');

    try {
      // 1. Stop streaming interval first
      if (streamInterval.current) {
        clearInterval(streamInterval.current);
        streamInterval.current = null;
        console.log('✅ Stream interval cleared');
      }

      // 2. Stop recorder
      if (recorder.isRecording) {
        await recorder.stop();
        console.log('✅ Recorder stopped');
      }

      // 3. Close WebSocket
      if (ws.current) {
        if (ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        ws.current.close();
        ws.current = null;
        console.log('✅ WebSocket closed');
      }

      // 4. Reset UI state
      setIsRecording(false);
      setIsSendingData(false);
      onStatusChange?.('idle');

      // 5. Wait for audio device to be fully released
      await new Promise(resolve => setTimeout(resolve, 200));
      console.log('✅ Audio device fully released');

      // 6. Notify parent that recording stopped (for finalizeMessage)
      onRecordingStop?.();

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to stop recording');
      console.error('❌ Error stopping recording:', err);
      setError(err.message);
      onError?.(err);
    }
  };

  // ============================================
  // TOGGLE RECORDING
  // ============================================

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  // ============================================
  // CLEAR ERROR
  // ============================================

  const clearError = (): void => {
    setError(null);
  };

  // ============================================
  // MIC PULSING ANIMATION
  // ============================================

  useEffect(() => {
    if (isRecording) {
      // Start pulsing animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(micScale, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true
          }),
          Animated.timing(micScale, {
            toValue: 1.0,
            duration: 800,
            useNativeDriver: true
          })
        ])
      ).start();
    } else {
      // Reset scale when not recording
      micScale.setValue(1);
    }
  }, [isRecording, micScale]);

  // ============================================
  // INITIALIZATION & CLEANUP
  // ============================================

  useEffect(() => {
    // Initialize audio permissions and configuration
    (async () => {
      try {
        // Request permissions
        const status = await AudioModule.requestRecordingPermissionsAsync();
        setPermissionGranted(status.granted);
        
        if (!status.granted) {
          const error = new Error('Microphone permission denied');
          setError(error.message);
          onError?.(error);
          Alert.alert('Permission Required', 'Microphone access is required.');
          return;
        }

        // Configure audio session - simple and robust
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });

        console.log('✅ Audio Mode Configured');

      } catch (e) {
        const error = e instanceof Error ? e : new Error('Audio configuration failed');
        console.error('Audio Config Error:', error);
        setError(error.message);
        onError?.(error);
      }
    })();

    // Cleanup on unmount
    return () => {
      console.log('🧹 useInterviewAudio: Cleaning up...');

      // 1. Stop TTS
      TTSService.stop()
        .then(() => {
          console.log('✅ TTS stopped on unmount');
          onTTSEnd?.();
        })
        .catch(e => console.warn('⚠️ TTS stop failed:', e));

      // 2. Stop recorder
      if (recorder.isRecording) {
        recorder.stop()
          .then(() => console.log('✅ Recorder stopped on unmount'))
          .catch(e => console.warn('⚠️ Recorder stop failed on unmount:', e));
      }

      // 3. Clear streaming interval
      if (streamInterval.current) {
        clearInterval(streamInterval.current);
        streamInterval.current = null;
        console.log('✅ Stream interval cleared on unmount');
      }

      // 4. Close WebSocket
      if (ws.current) {
        ws.current.close();
        ws.current = null;
        console.log('✅ WebSocket closed on unmount');
      }

      console.log('✅ useInterviewAudio cleanup complete');
    };
  }, []); // Empty dependency array - runs once on mount/unmount

  // ============================================
  // RETURN INTERFACE
  // ============================================

  return {
    // State
    isRecording,
    transcript: liveTranscript,
    micScale,
    isSendingData,
    error,
    permissionGranted,
    
    // Methods
    startRecording,
    stopRecording,
    toggleRecording,
    clearError,
  };
};