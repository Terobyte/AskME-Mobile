import { useState, useRef, useEffect, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Platform, Alert } from 'react-native';

export type AudioState = 'IDLE' | 'RECORDING' | 'PROCESSING' | 'AI_SPEAKING';

export interface UseInterviewAudioReturn {
    audioState: AudioState;
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<string | null>;
    playAiAudio: (text: string, onComplete?: () => void) => Promise<void>; // Modified to take text and use TTSService internally or externally
    setProcessing: () => void;
    setIdle: () => void;
    cancelAudio: () => void;
    permissionGranted: boolean;
}

export const useInterviewAudio = (): UseInterviewAudioReturn => {
    const [audioState, setAudioState] = useState<AudioState>('IDLE');
    const [permissionGranted, setPermissionGranted] = useState(false);
    
    const recordingRef = useRef<Audio.Recording | null>(null);

    useEffect(() => {
        checkPermissions();
        return () => {
            // Cleanup
            if (recordingRef.current) {
                recordingRef.current.stopAndUnloadAsync();
            }
        };
    }, []);

    const checkPermissions = async () => {
        try {
            const { status } = await Audio.requestPermissionsAsync();
            setPermissionGranted(status === 'granted');
        } catch (error) {
            console.error("Permission Error:", error);
        }
    };

    const configureAudioMode = async (mode: 'record' | 'play') => {
        try {
            if (mode === 'record') {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: true,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false,
                });
            } else {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false,
                });
            }
        } catch (error) {
            console.error("Audio Mode Error:", error);
        }
    };

    const startRecording = async () => {
        if (audioState !== 'IDLE') return;

        try {
            await configureAudioMode('record');
            
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            
            recordingRef.current = recording;
            setAudioState('RECORDING');
            console.log("🎤 Recording Started");
        } catch (error) {
            console.error("Failed to start recording", error);
            Alert.alert("Error", "Could not start microphone.");
        }
    };

    const stopRecording = async (): Promise<string | null> => {
        if (audioState !== 'RECORDING' || !recordingRef.current) return null;

        try {
            setAudioState('PROCESSING'); // Immediate UI update
            await recordingRef.current.stopAndUnloadAsync();
            const uri = recordingRef.current.getURI();
            recordingRef.current = null;
            console.log("🎤 Recording Stopped, URI:", uri);
            return uri;
        } catch (error) {
            console.error("Failed to stop recording", error);
            setAudioState('IDLE');
            return null;
        }
    };

    // Note: The actual TTS logic is handled by the Service, but the hook tracks state
    // We expect the consumer to call TTSService, but to keep state in sync, 
    // we provide a wrapper or expect state updates.
    // For the requirement "Provide placeholder functions... playAiResponse", 
    // I will implement a state-aware wrapper.
    const playAiAudio = async (text: string, onComplete?: () => void) => {
        // This function is intended to be replaced or integrated with TTSService
        // For now, it manages state. The actual playing happens in the Screen via TTSService usually,
        // but to strictly adhere to "mic button disabled", we manage state here.
        
        // However, since we need to integrate with TTSService which is external,
        // the Screen will likely call TTSService.speak. 
        // We need the screen to tell us "AI Started" and "AI Stopped".
        // But the prompt asks for `playAiResponse` placeholder.
        
        console.log("🤖 AI Speaking State Set");
        setAudioState('AI_SPEAKING');
        
        // Placeholder implementation (Mock)
        // In real integration, we pass this state management to the TTS callback
    };
    
    const setProcessing = () => setAudioState('PROCESSING');
    const setIdle = () => setAudioState('IDLE');
    
    const cancelAudio = async () => {
         if (recordingRef.current) {
            try {
                await recordingRef.current.stopAndUnloadAsync();
            } catch(e) {}
            recordingRef.current = null;
         }
         setAudioState('IDLE');
    };

    return {
        audioState,
        startRecording,
        stopRecording,
        playAiAudio,
        setProcessing,
        setIdle,
        cancelAudio,
        permissionGranted
    };
};
