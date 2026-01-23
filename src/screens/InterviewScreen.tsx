import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, SafeAreaView, ScrollView, Alert, Image } from 'react-native';
import { useInterviewAudio } from '../hooks/useInterviewAudio';
import { PushToTalkButton } from '../components/PushToTalkButton';
import { GeminiAgentService } from '../services/gemini-agent';
import { TTSService } from '../services/tts-service';
import { transcribeAudio } from '../services/transcription-service';
import { InterviewTopic } from '../types';

// Mock Data for MVP
const MOCK_AGENDA: InterviewTopic[] = [
    { id: '1', topic: 'Introduction', type: 'Intro', estimated_time: '2m' },
    { id: '2', topic: 'React Native Bridges', type: 'Match', estimated_time: '5m' },
    { id: '3', topic: 'Memory Management', type: 'Gap', estimated_time: '5m' }
];

const VICTORIA_AVATAR = 'https://i.pravatar.cc/150?img=47';

interface Message {
    id: string;
    role: 'user' | 'ai';
    text: string;
}

export default function InterviewScreen() {
    const { 
        audioState, 
        startRecording, 
        stopRecording, 
        playAiAudio, // Note: We use this for state tracking primarily
        setProcessing,
        setIdle,
        setAiSpeaking: setAiSpeakingState // We'll add this to hook or just use the hook's internal logic
    } = useInterviewAudio();

    // Hook doesn't export setAiSpeaking directly, but playAiAudio sets it.
    // We will handle the flow manually in handleStop.

    const [messages, setMessages] = useState<Message[]>([]);
    const agentRef = useRef<GeminiAgentService | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);

    useEffect(() => {
        // Initialize Agent
        agentRef.current = new GeminiAgentService();
        initializeInterview();
    }, []);

    const initializeInterview = async () => {
        if (!agentRef.current) return;
        try {
            // Simulate AI Start
            const startText = await agentRef.current.startInterview(MOCK_AGENDA, "Experienced React Native Dev...", "Mobile Engineer");
            addMessage('ai', startText);
            playResponse(startText);
        } catch (e) {
            console.error("Init Error", e);
        }
    };

    const addMessage = (role: 'user' | 'ai', text: string) => {
        setMessages(prev => [...prev, { id: Date.now().toString(), role, text }]);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    };

    const handleInteraction = async () => {
        if (audioState === 'IDLE') {
            await startRecording();
        } else if (audioState === 'RECORDING') {
            await processUserAudio();
        }
    };

    const processUserAudio = async () => {
        // 1. Stop Recording
        const uri = await stopRecording();
        if (!uri) return;

        // 2. Transcribe (STT)
        try {
            const userText = await transcribeAudio(uri);
            if (!userText || userText.trim() === "") {
                Alert.alert("No speech detected", "Please try again.");
                setIdle();
                return;
            }
            
            addMessage('user', userText);

            // 3. Get AI Response (Gemini)
            if (agentRef.current) {
                const aiText = await agentRef.current.sendUserResponse(userText);
                if (aiText) {
                    addMessage('ai', aiText);
                    // 4. Play Audio (TTS)
                    await playResponse(aiText);
                } else {
                    setIdle();
                }
            }
        } catch (error) {
            console.error("Processing Error", error);
            Alert.alert("Error", "Something went wrong.");
            setIdle();
        }
    };

    const playResponse = async (text: string) => {
        // Trigger Hook State: AI_SPEAKING
        // We need to access the setAiSpeaking logic. 
        // Since useInterviewAudio exposes `playAiAudio`, we can use that to set state,
        // but we want to use the real TTSService.
        
        // Let's modify the flow: 
        // We will manually call TTSService.speak AND manage the hook state.
        
        // Since the hook doesn't export `setAiSpeaking` (I missed exporting it in the previous file write, checking...),
        // I checked the file write: `export const useInterviewAudio = (): UseInterviewAudioReturn => { ... playAiAudio ... }`
        // playAiAudio sets state to AI_SPEAKING.
        
        // I will use playAiAudio as a state setter wrapper
        await playAiAudio(text); // This sets state to AI_SPEAKING
        
        // Now call the real service
        await TTSService.speak(text, () => {
             console.log("🔊 Audio Finished Callback");
             setIdle(); // Back to IDLE when done
        });
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Victoria (AI Interviewer)</Text>
            </View>

            <ScrollView 
                style={styles.chatContainer}
                ref={scrollViewRef}
                contentContainerStyle={{ padding: 20 }}
            >
                {messages.map(msg => (
                    <View key={msg.id} style={[
                        styles.bubble, 
                        msg.role === 'user' ? styles.userBubble : styles.aiBubble
                    ]}>
                        {msg.role === 'ai' && <Image source={{uri: VICTORIA_AVATAR}} style={styles.avatar} />}
                        <Text style={[
                            styles.text, 
                            msg.role === 'user' ? styles.userText : styles.aiText
                        ]}>
                            {msg.text}
                        </Text>
                    </View>
                ))}
            </ScrollView>

            <View style={styles.footer}>
                <PushToTalkButton 
                    state={audioState}
                    onPress={handleInteraction}
                />
                <Text style={styles.statusText}>
                    {audioState === 'IDLE' && "Tap to Reply"}
                    {audioState === 'RECORDING' && "Listening..."}
                    {audioState === 'PROCESSING' && "Analyzing Response..."}
                    {audioState === 'AI_SPEAKING' && "Victoria is speaking..."}
                </Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        padding: 20,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    chatContainer: {
        flex: 1,
    },
    footer: {
        backgroundColor: '#FFF',
        paddingBottom: 40,
        paddingTop: 20,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
    },
    bubble: {
        flexDirection: 'row',
        marginBottom: 16,
        maxWidth: '85%',
    },
    userBubble: {
        alignSelf: 'flex-end',
        backgroundColor: '#10B981',
        padding: 12,
        borderRadius: 16,
        borderBottomRightRadius: 4,
    },
    aiBubble: {
        alignSelf: 'flex-start',
        backgroundColor: '#E5E7EB',
        padding: 12,
        borderRadius: 16,
        borderBottomLeftRadius: 4,
        alignItems: 'center',
    },
    text: {
        fontSize: 16,
        lineHeight: 24,
    },
    userText: {
        color: '#FFF',
    },
    aiText: {
        color: '#1F2937',
    },
    avatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        marginRight: 8,
    },
    statusText: {
        marginTop: 10,
        color: '#6B7280',
        fontSize: 14,
    }
});
