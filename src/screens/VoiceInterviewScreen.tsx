import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, LayoutAnimation, Platform, UIManager, SafeAreaView, Modal, StatusBar, ActivityIndicator, Image, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';
import Slider from '@react-native-community/slider';
import { InterviewMode } from '../types';
import * as Haptics from 'expo-haptics';
import RNShake from 'react-native-shake';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

import { useTypewriter } from '../hooks/useTypewriter';
import { useInterviewAudio } from '../hooks/interview/useInterviewAudio';
import { useInterviewLogic } from '../hooks/interview/useInterviewLogic';
import { MetricsHud } from '../components/MetricsHud';
import { DebugOverlay } from '../components/interview/DebugOverlay';
import { ResultsModal } from '../components/interview/ResultsModal';
import { HistoryPanel } from '../components/history/HistoryPanel';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

// Mock Data
const MOCK_RESUME = `Senior React Native Developer with 5 years of experience. Expert in TypeScript, Redux, and Native Modules.`;
const MOCK_JOB_DESCRIPTION = `We are looking for a Senior Mobile Engineer to build our flagship iOS and Android app.`;
const VICTORIA_AVATAR_URL = 'https://i.pravatar.cc/150?img=47';

export default function VoiceInterviewScreen() {
    const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
    const [showSettings, setShowSettings] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const [showDetailedResults, setShowDetailedResults] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Settings State
    const [resumeText, setResumeText] = useState(MOCK_RESUME);
    const [jdText, setJdText] = useState(MOCK_JOB_DESCRIPTION);
    const [mode, setMode] = useState<InterviewMode>('short');
    const [sliderValue, setSliderValue] = useState(0);
    const [resumeFile, setResumeFile] = useState<any>(null);

    // Dev Tools State
    const [debugValue, setDebugValue] = useState("10");
    const [isDebugTtsMuted, setIsDebugTtsMuted] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);

    // Live Bubble State
    const [liveTranscript, setLiveTranscript] = useState("");
    const [displayTranscript, setDisplayTranscript] = useState("");
    const targetTranscript = useRef("");

    // ✅ FIX: Use ref to track latest transcript for closure-safe access in callbacks
    const liveTranscriptRef = useRef("");

    // Audio Recording Hook
    const {
        isRecording,
        startRecording,
        stopRecording,
        micScale,
        isSendingData,
        transcript,
    } = useInterviewAudio({
        onTranscriptUpdate: (text, isFinal) => {
            if (isFinal) {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setLiveTranscript(prev => {
                    const spacer = prev.length > 0 ? " " : "";
                    const newValue = prev + spacer + text.trim();
                    // ✅ FIX: Keep ref in sync with state
                    liveTranscriptRef.current = newValue;
                    return newValue;
                });
            }
        },
        onRecordingStop: () => {
            // ✅ FIX: Read from ref instead of state to avoid stale closure
            const currentTranscript = liveTranscriptRef.current;
            console.log(`🎙️ [RECORDING_STOP] Transcript to process: "${currentTranscript.substring(0, 50)}..."`);

            if (currentTranscript.trim().length > 0) {
                processUserInput(currentTranscript);

                // Clear both state and ref
                setLiveTranscript("");
                liveTranscriptRef.current = "";
                targetTranscript.current = "";
                setDisplayTranscript("");
            } else {
                console.log("⚠️ [RECORDING_STOP] Empty transcript, skipping processUserInput");
            }
        },
        onStatusChange: (newStatus) => {
            setStatus(newStatus);
        },
    });

    // Interview Logic Hook (with audio coordination)
    const {
        messages,
        anger,
        engagement,              // ← NEW
        currentVibe,            // ← NEW
        currentTopic,
        isProcessing,
        isFinished,
        metrics,
        topicSuccess,
        topicPatience,
        plan,
        currentTopicIndex,
        isLobbyPhase,
        isPlanReady,
        finalReport,
        initializeInterview,
        processUserInput,
        forceFinish,
        restart,
        progress,
        simulateAnswer,  // NEW: For smart AI simulation
        setEngagement,   // ← NEW: For debug overlay slider
    } = useInterviewLogic({
        onAIStart: async () => {
            // Stop recording when AI starts speaking
            if (isRecording) {
                console.log("🛑 [Coordination] Stopping mic before AI speaks");
                await stopRecording();
            }
            setStatus('speaking');
        },
        onAIEnd: () => {
            // AI finished speaking
            setStatus('idle');
        },
        onInterviewComplete: (results) => {
            console.log("✅ Interview Complete:", results);
        }
    });

    // Typewriter effect for AI messages
    const latestAiMessage = messages.length > 0 && messages[messages.length - 1].sender === 'ai'
        ? messages[messages.length - 1].text
        : "";
    const displayedAiText = useTypewriter(latestAiMessage, 30);

    // Secret Shake Listener
    useEffect(() => {
        const subscription = RNShake.addListener(() => {
            setShowDebug(prev => !prev);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        });

        return () => {
            subscription.remove();
        };
    }, []);

    // Transcript Animation
    useEffect(() => {
        const interval = setInterval(() => {
            if (displayTranscript.length < targetTranscript.current.length) {
                setDisplayTranscript(prev => targetTranscript.current.substring(0, prev.length + 1));
            }
        }, 30);
        return () => clearInterval(interval);
    }, [displayTranscript]);

    useEffect(() => {
        targetTranscript.current = liveTranscript;
        if (liveTranscript === "") setDisplayTranscript("");
    }, [liveTranscript]);

    // Slider Logic
    const getModeFromSlider = (val: number): InterviewMode => {
        if (val === 0) return 'short';
        if (val === 1) return 'medium';
        return 'freestyle';
    };

    const handleSliderChange = (val: number) => {
        setSliderValue(val);
        setMode(getModeFromSlider(val));
    };

    const pickResume = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'application/pdf',
                copyToCacheDirectory: true
            });

            if (result.canceled === false) {
                setResumeFile(result.assets[0]);
                setResumeText("Extracted Resume Content...");
            }
        } catch (err) {
            console.error(err);
        }
    };

    const pasteJD = async () => {
        try {
            const text = await Clipboard.getStringAsync();
            if (text) {
                setJdText(text);
                Alert.alert("Success", "Job Description pasted!");
            } else {
                Alert.alert("Clipboard Empty", "No text found.");
            }
        } catch (err) {
            console.error("Paste Error", err);
        }
    };

    const handleSaveAndRestart = async () => {
        setIsGenerating(true);
        setShowSettings(false);

        try {
            await initializeInterview(resumeText, jdText, mode);
        } catch (error) {
            Alert.alert("Error", "Failed to initialize interview.");
            console.error(error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReturnToSettings = () => {
        restart();
        setShowSettings(true);
        setShowDetailedResults(false);
    };

    // Swipe left from right edge to open history
    const swipeGesture = Gesture.Pan()
        .onEnd((event) => {
            // Swipe left from right edge (negative velocityX, negative translationX)
            if (event.velocityX < -500 && event.translationX < -50) {
                setShowHistory(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
        });

    const toggleRecording = () => {
        if (isProcessing) return;

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const handleForceFinish = async () => {
        console.log("🛑 [DEBUG] Force Finish Triggered from Screen");
        await forceFinish();
    };

    const handleSimulate = async () => {
        if (!plan) return;
        if (isSimulating) return;

        setIsSimulating(true);
        console.log(`⚡ [DEV] Simulating answer with level: ${debugValue}`);
        console.log(`⚡ [DEV] Current topic: ${currentTopic}`);

        try {
            // Special case: "I_AM_READY" is a simple text injection
            if (debugValue === "I_AM_READY") {
                const simText = "I am ready.";
                console.log(`🤖 [DEV] Using quick text: ${simText}`);
                // ✅ FIX: Don't set liveTranscript - processUserInput adds to messages directly
                // Setting liveTranscript causes ghost duplication (shows in live bubble then messages)
                await processUserInput(simText);
                return;
            }

            // Use AI to generate a smart, contextual answer
            console.log(`🤖 [DEV] Generating AI answer for level: ${debugValue}...`);
            const aiGeneratedAnswer = await simulateAnswer(debugValue);

            if (!aiGeneratedAnswer) {
                console.error("❌ [DEV] AI returned null, falling back to template");
                const fallback = `I would approach this ${currentTopic} question by focusing on best practices and my experience.`;
                // ✅ FIX: Don't set liveTranscript - avoids ghost duplication
                await processUserInput(fallback);
                return;
            }

            console.log(`✅ [DEV] AI Generated Answer: ${aiGeneratedAnswer.substring(0, 100)}...`);

            // ✅ FIX: Inject directly into processUserInput without live bubble
            // This avoids ghost duplication where message appears in live bubble then messages
            await processUserInput(aiGeneratedAnswer);

        } catch (e) {
            console.error("❌ Simulation Failed:", e);
            Alert.alert("Simulation Error", "Could not generate AI answer. Check console.");
        } finally {
            setIsSimulating(false);
        }
    };

    const renderSlider = () => {
        return (
            <View style={styles.sliderWrapper}>
                <View style={styles.sliderLabels}>
                    <Text style={[styles.sliderLabel, sliderValue === 0 && styles.sliderLabelActive]}>Short</Text>
                    <Text style={[styles.sliderLabel, sliderValue === 1 && styles.sliderLabelActive]}>Long</Text>
                    <Text style={[styles.sliderLabel, sliderValue === 2 && styles.sliderLabelActive]}>Infinite</Text>
                </View>
                <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={0}
                    maximumValue={2}
                    step={1}
                    value={sliderValue}
                    onValueChange={handleSliderChange}
                    minimumTrackTintColor="#000000"
                    maximumTrackTintColor="#E0E0E0"
                    thumbTintColor="#000000"
                />
            </View>
        );
    };

    return (
        <GestureDetector gesture={swipeGesture}>
            <SafeAreaView style={styles.container}>
                <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

                {/* DEV CONSOLE */}
                <DebugOverlay
                    visible={showDebug}
                    onClose={() => setShowDebug(false)}
                    anger={anger}
                    engagement={engagement}              // ← ADD
                    currentVibe={currentVibe}           // ← ADD
                    debugValue={debugValue}
                    isDebugTtsMuted={isDebugTtsMuted}
                    isSimulating={isSimulating}
                    setAnger={(val) => console.warn("Direct anger setting disabled in refactored version")}
                    setEngagement={setEngagement}       // ← FIXED: Use real setter from hook
                    setDebugValue={setDebugValue}
                    setIsDebugTtsMuted={setIsDebugTtsMuted}
                    onSimulate={handleSimulate}
                    onForceFinish={handleForceFinish}
                />

                <View style={styles.header}>
                    <Text style={{ fontWeight: 'bold', fontSize: 18 }}>AskME AI</Text>
                    <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconButton}>
                        <Ionicons name="settings-outline" size={24} color="#333" />
                    </TouchableOpacity>
                </View>

                {/* Metrics HUD - Only visible when debug is OPEN */}
                {showDebug && (
                    <MetricsHud
                        metrics={metrics}
                        success={topicSuccess}
                        patience={topicPatience}
                        anger={anger}
                        topicTitle={`${currentTopicIndex}. ${currentTopic}`}
                    />
                )}

                {/* Settings Modal */}
                <Modal visible={showSettings} animationType="fade" transparent>
                    <BlurView intensity={20} style={styles.blurContainer} tint="light">
                        <View style={styles.modalContainer}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Control Center</Text>
                                <TouchableOpacity
                                    onPress={() => setShowSettings(false)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                    <Ionicons name="close" size={28} color="#333" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView style={styles.modalContent}>
                                <Text style={styles.sectionTitle}>1. Setup</Text>
                                <TouchableOpacity style={styles.glassButton} onPress={pickResume}>
                                    <Ionicons name="document-text-outline" size={24} color="#333" />
                                    <Text style={styles.glassButtonText}>
                                        {resumeFile ? `Resume: ${resumeFile.name}` : "Upload Resume"}
                                    </Text>
                                    {resumeFile && <Ionicons name="checkmark-circle" size={20} color="#4CAF50" style={{ marginLeft: 10 }} />}
                                </TouchableOpacity>

                                <TouchableOpacity style={styles.glassButton} onPress={pasteJD}>
                                    <Ionicons name="clipboard-outline" size={24} color="#333" />
                                    <Text style={styles.glassButtonText}>
                                        {jdText !== MOCK_JOB_DESCRIPTION ? "JD Pasted!" : "Paste Job Description"}
                                    </Text>
                                    {jdText !== MOCK_JOB_DESCRIPTION && <Ionicons name="checkmark-circle" size={20} color="#4CAF50" style={{ marginLeft: 10 }} />}
                                </TouchableOpacity>

                                <Text style={styles.sectionTitle}>2. Duration</Text>
                                {renderSlider()}

                                {plan && (
                                    <View style={{ marginTop: 20 }}>
                                        <Text style={styles.sectionTitle}>3. Agenda Preview</Text>
                                        <View style={styles.planPreview}>
                                            {plan.queue.map((item, i) => (
                                                <Text key={item.id} style={{ fontSize: 14, color: '#333', marginBottom: 5 }}>
                                                    {i}. {item.topic}
                                                </Text>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                <TouchableOpacity
                                    style={styles.modalGenerateButton}
                                    onPress={handleSaveAndRestart}
                                    disabled={isGenerating}
                                >
                                    {isGenerating ? (
                                        <ActivityIndicator color="#FFF" />
                                    ) : (
                                        <Text style={styles.modalGenerateButtonText}>
                                            {plan ? "SAVE & RESTART" : "GENERATE & START"}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </BlurView>
                </Modal>

                {/* Chat Container */}
                <View style={styles.chatContainer}>
                    <ScrollView
                        style={styles.chatList}
                        contentContainerStyle={{ padding: 20, paddingBottom: 150 }}
                        ref={ref => ref?.scrollToEnd({ animated: true })}
                        showsVerticalScrollIndicator={false}
                    >
                        {messages.map((msg, index) => (
                            <View key={msg.id} style={[
                                styles.messageRow,
                                msg.sender === 'user' ? styles.rowRight : styles.rowLeft
                            ]}>
                                {msg.sender === 'ai' && (
                                    <View style={{ alignItems: 'center', marginRight: 8 }}>
                                        <Text style={{ fontSize: 10, color: '#999', marginBottom: 2 }}>Victoria</Text>
                                        <Image source={{ uri: VICTORIA_AVATAR_URL }} style={styles.avatar} />
                                    </View>
                                )}

                                <View style={[
                                    styles.bubble,
                                    msg.sender === 'user' ? styles.userBubble : styles.aiBubble
                                ]}>
                                    <Text style={[
                                        styles.bubbleText,
                                        msg.sender === 'ai' ? styles.aiText : null
                                    ]}>
                                        {msg.sender === 'ai' && index === messages.length - 1
                                            ? displayedAiText
                                            : msg.text}
                                    </Text>
                                </View>
                            </View>
                        ))}

                        {displayTranscript.length > 0 && (
                            <View style={[styles.messageRow, styles.rowRight]}>
                                <View style={[styles.bubble, styles.liveBubble]}>
                                    <Text style={[styles.bubbleText, styles.liveBubbleText]}>{displayTranscript}</Text>
                                </View>
                            </View>
                        )}

                        {messages.length === 0 && displayTranscript.length === 0 && (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderText}>Tap the mic to begin.</Text>
                            </View>
                        )}
                    </ScrollView>
                </View>

                {/* UNIFIED RESULTS MODAL */}
                <ResultsModal
                    visible={isFinished}
                    mode={showDetailedResults ? 'detail' : 'reveal'}
                    onClose={handleReturnToSettings}
                    report={finalReport}
                    roleTitle={resumeFile?.name || "Interview Session"}
                />

                {/* HISTORY PANEL */}
                <HistoryPanel
                    visible={showHistory}
                    onClose={() => setShowHistory(false)}
                />

                {/* Mic Controls */}
                <View style={styles.controls}>
                    <TouchableOpacity
                        onPress={toggleRecording}
                        disabled={isProcessing}
                        activeOpacity={0.7}
                    >
                        <Animated.View style={[
                            styles.micButton,
                            isRecording ? styles.recording : null,
                            isProcessing ? styles.micButtonDisabled : null,
                            { transform: [{ scale: micScale }] }
                        ]}>
                            {isProcessing ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Ionicons name={isRecording ? "stop" : "mic"} size={32} color="#FFF" />
                            )}
                        </Animated.View>
                    </TouchableOpacity>

                    {isRecording && (
                        <View style={[
                            styles.vadPixel,
                            {
                                backgroundColor: isProcessing ? '#10B981' : (isSendingData ? '#A855F7' : '#FACC15'),
                                shadowColor: isProcessing ? '#10B981' : (isSendingData ? '#A855F7' : '#FACC15'),
                            }
                        ]} />
                    )}
                </View>
            </SafeAreaView>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 10,
        backgroundColor: '#FFF',
        zIndex: 10,
    },
    iconButton: {
        padding: 10,
    },
    chatContainer: {
        flex: 1,
    },
    chatList: {
        flex: 1,
    },
    messageRow: {
        flexDirection: 'row',
        marginBottom: 15,
        alignItems: 'flex-end',
    },
    rowLeft: {
        justifyContent: 'flex-start',
    },
    rowRight: {
        justifyContent: 'flex-end',
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        marginRight: 8,
        backgroundColor: '#E0E0E0',
    },
    bubble: {
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        maxWidth: '75%',
    },
    userBubble: {
        backgroundColor: '#F3F4F6',
        borderBottomRightRadius: 4,
    },
    aiBubble: {
        backgroundColor: '#007AFF',
        borderBottomLeftRadius: 4,
    },
    liveBubble: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderBottomRightRadius: 4,
    },
    bubbleText: {
        fontSize: 16,
        color: '#374151',
        lineHeight: 24,
    },
    aiText: {
        color: '#FFFFFF',
    },
    liveBubbleText: {
        color: '#000000',
    },
    placeholderContainer: {
        marginTop: 100,
        alignItems: 'center',
    },
    placeholderText: {
        color: '#9CA3AF',
        fontSize: 16,
    },
    controls: {
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        alignItems: 'center',
    },
    micButton: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
    vadPixel: {
        position: 'absolute',
        right: -20,
        top: 30,
        width: 6,
        height: 6,
        borderRadius: 3,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 6,
        elevation: 5,
    },
    recording: {
        backgroundColor: '#EF4444',
        transform: [{ scale: 1.1 }],
    },
    micButtonDisabled: {
        backgroundColor: '#6B7280',
        opacity: 0.8,
    },
    blurContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        backgroundColor: 'rgba(30,30,30,0.3)',
        width: '90%',
        borderRadius: 25,
        maxHeight: '85%',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    modalContent: {
        padding: 20,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginTop: 10,
        marginBottom: 15,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    glassButton: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        padding: 16,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 15,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    glassButtonText: {
        color: '#333',
        fontWeight: '600',
        marginLeft: 10,
        fontSize: 16,
    },
    sliderWrapper: {
        marginVertical: 10,
        paddingHorizontal: 10,
    },
    sliderLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 5,
        paddingHorizontal: 10,
    },
    sliderLabel: {
        fontSize: 14,
        color: '#999',
    },
    sliderLabelActive: {
        color: '#000',
        fontWeight: 'bold',
    },
    modalGenerateButton: {
        backgroundColor: '#000',
        paddingVertical: 18,
        borderRadius: 15,
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 50,
    },
    modalGenerateButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    planPreview: {
        backgroundColor: 'rgba(255,255,255,0.5)',
        padding: 15,
        borderRadius: 10,
    },
});