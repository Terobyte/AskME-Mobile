import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, LayoutAnimation, Platform, UIManager, SafeAreaView, Modal, StatusBar, TextInput, Animated, ActivityIndicator, Image, Easing as RNEasing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';
import Slider from '@react-native-community/slider';
import { InterviewMode, InterviewPlan, EvaluationMetrics, AiResponse, QuestionResult, FinalInterviewReport } from '../types';
import AnimatedReanimated, { useSharedValue, useAnimatedProps, withTiming, withDelay, Easing, runOnJS, useDerivedValue, useAnimatedStyle, withSpring, withSequence, withRepeat, interpolateColor } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import RNShake from 'react-native-shake';

import { GeminiAgentService } from '../services/gemini-agent';
import { generateInterviewPlan } from '../interview-planner';
import { TTSService } from '../services/tts-service';
import { useTypewriter } from '../hooks/useTypewriter';
import { useInterviewAudio, safeAudioModeSwitch } from '../hooks/interview/useInterviewAudio';
import { MetricsHud } from '../components/MetricsHud';
import { ScoreReveal } from '../components/interview/ScoreReveal';
import { DebugOverlay } from '../components/interview/DebugOverlay';

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

const INITIAL_PLAN: InterviewPlan = {
    meta: { mode: 'short', total_estimated_time: '5m' },
    queue: [{ id: 'intro', topic: 'Introduction', type: 'Intro', estimated_time: '5m', context: "The user is introducing themselves. Ask them to describe their background and experience briefly." }]
};

export default function VoiceInterviewScreen() {
    const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
    const [showSettings, setShowSettings] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showDebug, setShowDebug] = useState(false); // Secret Debug Toggle

    // Gemini Agent
    const agentRef = useRef<GeminiAgentService | null>(null);
    const [isAgentThinking, setIsAgentThinking] = useState(false);

    // Context State (Global)
    const [resumeText, setResumeText] = useState(MOCK_RESUME);
    const [jdText, setJdText] = useState(MOCK_JOB_DESCRIPTION);
    const [mode, setMode] = useState<InterviewMode>('short');
    const [sliderValue, setSliderValue] = useState(0);
    const [resumeFile, setResumeFile] = useState<any>(null);
    const [plan, setPlan] = useState<InterviewPlan | null>(null);
    const [currentMetrics, setCurrentMetrics] = useState<EvaluationMetrics | null>(null);
    const [finalReport, setFinalReport] = useState<FinalInterviewReport | null>(null);
    const bulkEvalPromise = useRef<Promise<QuestionResult[]> | null>(null);

    // RPG Scoring State
    const [topicSuccess, setTopicSuccess] = useState(0);
    const [topicPatience, setTopicPatience] = useState(0);
    const [anger, setAnger] = useState(0); // Start at 0

    // Dev Tools State
    const [debugValue, setDebugValue] = useState("10");
    const [isDebugTtsMuted, setIsDebugTtsMuted] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);


    const [isPlanReady, setIsPlanReady] = useState(false);
    const [isLobbyPhase, setIsLobbyPhase] = useState(true);

    // Campaign State
    const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
    const [isInterviewFinished, setIsInterviewFinished] = useState(false);
    const [previousTopicResult, setPreviousTopicResult] = useState<string | null>(null);

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

    // Chat History
    const [messages, setMessages] = useState<{ id: string, text: string, sender: 'user' | 'ai' }[]>([]);

    // Gemini History Buffer (Strictly for AI context)
    const historyBuffer = useRef<{ role: 'user' | 'assistant' | 'system', content: string }[]>([]);

    const latestAiMessage = messages.length > 0 && messages[messages.length - 1].sender === 'ai'
        ? messages[messages.length - 1].text
        : "";
    const displayedAiText = useTypewriter(latestAiMessage, 30);

    // Live Bubble State
    const [liveTranscript, setLiveTranscript] = useState("");
    const [isFinalChunk, setIsFinalChunk] = useState(false);
    const [displayTranscript, setDisplayTranscript] = useState("");
    const targetTranscript = useRef("");
    const latestTranscriptRef = useRef("");

    // Audio Recording Hook
    const {
        isRecording,
        startRecording,
        stopRecording,
        micScale,
        isSendingData,
    } = useInterviewAudio({
        onTranscriptUpdate: (text, isFinal) => {
            if (isFinal) {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setLiveTranscript(prev => {
                    const spacer = prev.length > 0 ? " " : "";
                    return prev + spacer + text.trim();
                });
                setIsFinalChunk(true);
            }
        },
        onRecordingStop: () => {
            finalizeMessage();
        },
        onStatusChange: (newStatus) => {
            setStatus(newStatus);
        },
    });

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
        latestTranscriptRef.current = liveTranscript;
        if (liveTranscript === "") setDisplayTranscript("");
    }, [liveTranscript]);

    const finalizeMessage = async (overrideText?: string) => {
        const textToFinalize = overrideText || latestTranscriptRef.current;

        if (isAgentThinking) return;

        if (textToFinalize.trim().length > 0) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setMessages(prev => [...prev, { id: Date.now().toString(), text: textToFinalize.trim(), sender: 'user' }]);

            // Append to History Buffer
            historyBuffer.current.push({ role: 'user', content: textToFinalize.trim() });

            setLiveTranscript("");
            targetTranscript.current = "";
            latestTranscriptRef.current = "";
            setDisplayTranscript("");
            setIsFinalChunk(false);

            if (agentRef.current) {
                setIsAgentThinking(true);
                try {
                    // --- LOBBY PHASE LOGIC ---
                    if (isLobbyPhase) {
                        console.log("🏨 [LOBBY] Analyzing Lobby Input...");

                        // Use a dummy topic for analysis context
                        const lobbyTopic: any = { topic: "Lobby Check", context: "User is in the waiting lobby." };
                        const lastAiText = historyBuffer.current.length > 0
                            ? historyBuffer.current[historyBuffer.current.length - 1].content
                            : "Welcome to the lobby.";

                        const analysis: any = await agentRef.current.evaluateUserAnswer(textToFinalize.trim(), lobbyTopic, lastAiText);

                        if (analysis.intent === 'READY_CONFIRM') {
                            // OPTIMISTIC START: We don't care if plan is fully ready, because we have Intro.
                            console.log("✅ [LOBBY] User Ready -> STARTING INTRO (Optimistic)");

                            // Fallback to INITIAL_PLAN if plan is null (though it shouldn't be due to setPlan in handleStartInterview)
                            const currentPlan = plan || INITIAL_PLAN;

                            // Initialize Agent Context properly
                            const initialContext = {
                                currentTopic: currentPlan.queue[0], // This is Intro
                                previousResult: null,
                                angerLevel: 0,
                                isLastTopic: false
                            };

                            // Call Start Interview Logic
                            const introResponse = await agentRef.current.startInterview(resumeText, "Candidate", initialContext);
                            let introMsg = "";
                            if (typeof introResponse === 'string') {
                                introMsg = introResponse;
                            } else {
                                introMsg = introResponse.message;
                            }

                            setIsLobbyPhase(false);
                            setCurrentTopicIndex(0); // Actually we are AT intro now.

                            await playSynchronizedResponse(introMsg);

                        } else {
                            console.log("🗣️ [LOBBY] Small Talk");
                            // Just chat or acknowledge
                            const chatMsg = await agentRef.current.generateVoiceResponse({
                                currentTopic: lobbyTopic,
                                nextTopic: null,
                                transitionMode: 'STAY'
                            }, "User is not ready yet. Just chat politely or say 'Take your time'.", historyBuffer.current);
                            await playSynchronizedResponse(chatMsg);
                        }

                        setIsAgentThinking(false);
                        return; // EXIT LOBBY LOGIC
                    }

                    // --- REGULAR INTERVIEW LOGIC ---
                    if (!plan) return;

                    let effectiveTopicIndex = currentTopicIndex;
                    let effectivePrevResult = previousTopicResult;

                    const safeIndex = Math.min(effectiveTopicIndex, plan.queue.length - 1);
                    const currentTopic = plan.queue[safeIndex];

                    // --- 1. ANALYSIS PHASE (JUDGE) ---
                    // We analyze EVERY answer, including Intro, to log intent/metrics.
                    console.log("🔍 [1] Analyzing User Intent...");

                    const lastAiText = historyBuffer.current.length > 0
                        ? historyBuffer.current[historyBuffer.current.length - 1].content
                        : "Start of topic";

                    const analysis: any = await agentRef.current.evaluateUserAnswer(textToFinalize.trim(), currentTopic, lastAiText);
                    console.log("📊 [1] Result:", JSON.stringify(analysis));

                    // --- SPECIAL CASE: INTRO (Index 0) ---
                    if (currentTopicIndex === 0) {
                        // 1. NONSENSE CHECK
                        if (analysis.intent === 'NONSENSE') {
                            console.log("🤡 [INTRO] Nonsense detected -> STAY.");
                            setCurrentMetrics(analysis.metrics);

                            // Punishment
                            setTopicPatience(prev => Math.min(100, prev + 50));
                            setAnger(prev => Math.min(100, prev + 35));

                            const speech = await agentRef.current.generateVoiceResponse({
                                currentTopic: currentTopic,
                                nextTopic: null,
                                transitionMode: 'STAY',
                                angerLevel: anger + 10
                            }, undefined, historyBuffer.current);
                            await playSynchronizedResponse(speech);
                            return;
                        }

                        // 2. CLARIFICATION CHECK (Stay if confused)
                        if (analysis.intent === 'CLARIFICATION') {
                            console.log("🤔 [INTRO] Clarification requested -> STAY.");
                            const speech = await agentRef.current.generateVoiceResponse({
                                currentTopic: currentTopic,
                                nextTopic: null,
                                transitionMode: 'STAY',

                            }, undefined, historyBuffer.current);
                            await playSynchronizedResponse(speech);
                            return;
                        }

                        // 3. VALID INPUT (ATTEMPT, GIVE_UP, SHOW_ANSWER, READY_CONFIRM) -> MOVE NEXT
                        console.log("✅ [INTRO] Valid input -> MOVING NEXT.");

                        // Reset Stats for Topic 1
                        setTopicSuccess(0);
                        setTopicPatience(0);

                        setCurrentMetrics(analysis.metrics);

                        // Transition to Topic 1
                        const nextIndex = 1;
                        setCurrentTopicIndex(nextIndex);
                        const nextTopic = plan.queue[nextIndex];

                        const speech = await agentRef.current.generateVoiceResponse({
                            currentTopic: currentTopic,
                            nextTopic: nextTopic,
                            transitionMode: 'NEXT_PASS',
                        }, undefined, historyBuffer.current);

                        await playSynchronizedResponse(speech);
                        return; // EXIT EARLY
                    }

                    // --- BLOCKING CLARIFICATION CHECK ---
                    if (analysis.intent === 'CLARIFICATION') {
                        console.log("🛑 [LOGIC] CLARIFICATION DETECTED -> FORCE STAY & RETURN");

                        // 1. Generate explanation response (STAY mode)
                        const speech = await agentRef.current.generateVoiceResponse({
                            currentTopic: currentTopic,
                            nextTopic: null,
                            transitionMode: 'STAY',
                            angerLevel: anger
                        }, undefined, historyBuffer.current);

                        // 2. Play Audio
                        await playSynchronizedResponse(speech);

                        // 3. CRITICAL: Stop execution here
                        setIsAgentThinking(false);
                        return;
                    }

                    setCurrentMetrics(analysis.metrics); // Show HUD immediately

                    // --- 2. GAME LOGIC PHASE ---
                    let transitionMode: 'STAY' | 'NEXT_FAIL' | 'NEXT_PASS' | 'NEXT_EXPLAIN' | 'FINISH_INTERVIEW' | 'TERMINATE_ANGER' = 'STAY';
                    let shouldPenalizeAnger = true;
                    let shouldFinishInterview = false;

                    // Local Math Vars
                    let newSuccess = topicSuccess;
                    let newPatience = topicPatience;
                    let newAnger = anger;

                    if (analysis.intent === 'GIVE_UP') {
                        console.log("🏳️ User GAVE UP.");
                        newPatience = 110; // Instant Fail
                    }
                    else if (analysis.intent === 'SHOW_ANSWER') {
                        console.log("💡 User asked for ANSWER.");
                        newPatience = 110; // Instant Fail (Progress-wise)
                        shouldPenalizeAnger = false; // MERCY
                        transitionMode = 'NEXT_EXPLAIN';
                    }
                    else if (analysis.intent === 'CLARIFICATION') {
                        console.log("🤔 User asked for CLARIFICATION.");
                        // No metric changes, stay on topic
                    }
                    else if (analysis.intent === 'NONSENSE') {
                        console.log("🤡 User is Trolling/Nonsense.");

                        // 1. Penalize heavily
                        newPatience += 50; // Lose patience fast
                        newAnger += 35; // Make her angry

                        // 2. Force STAY
                        transitionMode = 'STAY';

                        // 3. Force specific feedback metric to 0
                        setCurrentMetrics({ accuracy: 0, depth: 0, structure: 0, reasoning: "Response was identified as nonsense/irrelevant." });
                    }
                    else {
                        // ATTEMPT -> Normal Scoring
                        const { accuracy, depth, structure } = analysis.metrics;
                        const overall = (accuracy + depth + structure) / 3;

                        console.log(`🔹 [MATH] Overall: ${overall.toFixed(1)}`);

                        if (overall < 5) newPatience += ((10 - overall) * 7);
                        else if (overall < 7) { newSuccess += (overall * 7); newPatience += 10; }
                        else { newSuccess += (overall * 13); newPatience -= (overall * 3); }
                    }

                    // Clamp
                    newSuccess = Math.min(Math.max(newSuccess, 0), 100);
                    newPatience = Math.min(Math.max(newPatience, 0), 100);
                    newAnger = Math.min(Math.max(newAnger, 0), 100);

                    // Update UI State
                    setTopicSuccess(newSuccess);
                    setTopicPatience(newPatience);
                    setAnger(newAnger);

                    // --- 3. TRANSITION CHECK ---
                    let nextIndex = effectiveTopicIndex;

                    // PRIORITY 1: GLOBAL KILL SWITCH (Termination)
                    if (newAnger >= 100) {
                        console.log("🤬 Anger Limit Reached. Initiating Termination.");

                        // 1. Generate "You're Fired" Speech
                        const terminationSpeech = await agentRef.current.generateVoiceResponse({
                            currentTopic: currentTopic,
                            nextTopic: null,
                            transitionMode: 'TERMINATE_ANGER',
                            angerLevel: 100
                        }, undefined, historyBuffer.current);

                        // 2. Play the Speech FULLY
                        await playSynchronizedResponse(terminationSpeech);

                        // 3. SHOW GAME OVER (Only after audio finishes)
                        setIsInterviewFinished(true);
                        return; // Stop execution
                    }
                    else if (newSuccess >= 100) {
                        transitionMode = 'NEXT_PASS';
                        nextIndex++;
                        setPreviousTopicResult("PASSED_SUCCESS");
                        // Reset Stats
                        setTopicSuccess(0);
                        setTopicPatience(0);
                        // Anger Relief
                        setAnger(prev => Math.max(0, prev - 5));
                    }
                    else if (newPatience >= 100) {
                        // If we didn't already set EXPLAIN, set FAIL
                        if (transitionMode !== 'NEXT_EXPLAIN') transitionMode = 'NEXT_FAIL';

                        nextIndex++;
                        setPreviousTopicResult("FAILED_PATIENCE");
                        // Reset Stats
                        setTopicSuccess(0);
                        setTopicPatience(0);

                        // Anger Penalty (unless Mercy)
                        if (shouldPenalizeAnger) {
                            setAnger(prev => Math.min(100, prev + 35));
                            // Note: We don't need to check termination here again because 
                            // if newAnger hit 100 above, we already returned.
                            // But for next loop, we add anger. 
                            // Actually, we should calculate this penalty into newAnger earlier if we want immediate termination on patience fail + anger spike.
                            // But per instruction "If I say Nonsense and anger hits 100...", that's handled by the top check.
                            // For patience fail, we add anger for NEXT time.
                        } else {
                            console.log("😇 Mercy Rule: Anger saved.");
                        }
                    }

                    // CHECK FOR END OF INTERVIEW
                    if (plan && nextIndex >= plan.queue.length) {
                        console.log("🏁 End of Interview Detected.");
                        transitionMode = 'FINISH_INTERVIEW';
                        shouldFinishInterview = true;
                        // DO NOT increment currentTopicIndex (keep at last valid index for safety)
                    } else {
                        // Normal Transition
                        if (nextIndex !== currentTopicIndex) {
                            console.log(`⏩ Transitioning UI to Topic ${nextIndex}`);
                            setCurrentTopicIndex(nextIndex);

                            // --- OPTIMIZED BATCH EVALUATION TRIGGER ---
                            // If we are entering the LAST topic (n-1), trigger eval for 0 to n-2 in background
                            if (plan && nextIndex === plan.queue.length - 1) {
                                console.log("🚀 Triggering Background Batch Eval for previous topics...");
                                // Create a snapshot of history excluding the current (last) topic's interaction
                                // But since we just transitioned, historyBuffer currently contains up to n-2 answers?
                                // No, historyBuffer contains EVERYTHING so far.
                                // We want to evaluate everything BEFORE the upcoming final question.
                                // So we send the current history snapshot.
                                const historySnapshot = [...historyBuffer.current];
                                bulkEvalPromise.current = agentRef.current.evaluateBatch(historySnapshot);
                                // Do NOT await. Let it run.
                            }
                        }
                    }

                    // --- 4. ACTING PHASE (VOICE) ---
                    console.log("🎬 [4] Generating Speech for Mode:", transitionMode);

                    // Safety check for nextTopic (if finished, it's null)
                    const nextTopic = (transitionMode === 'FINISH_INTERVIEW')
                        ? null
                        : plan.queue[Math.min(nextIndex, plan.queue.length - 1)];

                    const speech = await agentRef.current.generateVoiceResponse({
                        currentTopic: currentTopic, // Context of what we just talked about
                        nextTopic: nextTopic,       // Context of where we are going (or null)
                        transitionMode: transitionMode,
                        angerLevel: anger // Pass final anger for feedback
                    }, undefined, historyBuffer.current);

                    await playSynchronizedResponse(speech);

                    // SHOW MODAL AFTER AUDIO & FINAL REPORT GEN
                    if (shouldFinishInterview) {
                        // --- FINAL REPORT GENERATION ---
                        console.log("📊 Generating Final Report...");
                        setIsAgentThinking(true); // Keep spinner

                        try {
                            // 1. Await the background batch (n-1)
                            const previousResults = bulkEvalPromise.current
                                ? await bulkEvalPromise.current
                                : [];

                            // 2. Evaluate the FINAL interaction (which is just finishing now)
                            // We need the user's LAST answer. 
                            // historyBuffer.current has the full history. The last user msg is the one we just processed.
                            // Actually, 'textToFinalize' is the last user answer.
                            const lastInteraction = { role: 'user' as const, content: textToFinalize.trim() };

                            const finalResult = await agentRef.current.evaluateFinal(lastInteraction, previousResults);

                            // 3. Aggregate
                            const allResults = [...previousResults, finalResult.finalQuestion];
                            const avg = allResults.length > 0
                                ? allResults.reduce((a, b) => a + b.score, 0) / allResults.length
                                : 0;

                            const report: FinalInterviewReport = {
                                questions: allResults,
                                averageScore: Number(avg.toFixed(1)),
                                overallSummary: finalResult.overallSummary,
                                timestamp: Date.now()
                            };

                            console.log("✅ Final Report Ready:", JSON.stringify(report, null, 2));
                            setFinalReport(report);

                        } catch (err) {
                            console.error("Report Gen Error:", err);
                        }

                        setIsInterviewFinished(true);
                    }
                } catch (error) {
                    console.error("Agent Error:", error);
                } finally {
                    setIsAgentThinking(false);
                }
            }
        }
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
        setShowSettings(false); // Hide settings immediately

        try {
            // 1. Initialize Agent
            agentRef.current = new GeminiAgentService();

            // 2. Reset State
            setCurrentTopicIndex(0);
            setPreviousTopicResult(null);
            setTopicSuccess(0);
            setTopicPatience(0);
            setAnger(0);
            setIsInterviewFinished(false);
            historyBuffer.current = []; // Clear history on restart

            // OPTIMISTIC START: Set Plan to Intro Only immediately
            setPlan(INITIAL_PLAN);
            setIsPlanReady(false); // Indicates full plan is loading
            setIsLobbyPhase(true);
            setMessages([]);

            // 3. Play Immediate Greeting
            const greeting = "Hello, I'm Victoria. I'll be conducting your technical interview today. I have your details in front of me. Whenever you're ready to begin, just let me know.";
            await playSynchronizedResponse(greeting);

            // 4. Async Plan Generation
            generateInterviewPlan(resumeText, jdText, mode).then(generatedPlan => {
                setPlan(prev => {
                    if (!prev) return generatedPlan;
                    // Merge new questions into existing plan (keeping Intro at 0)
                    return {
                        ...generatedPlan,
                        queue: [prev.queue[0], ...generatedPlan.queue.slice(1)]
                    };
                });
                setIsPlanReady(true);
                console.log("✅ Plan Ready:", generatedPlan.queue.length, "topics");
            }).catch(err => {
                console.error("Plan Gen Error:", err);
                Alert.alert("Error", "Failed to generate interview plan.");
            });

        } catch (error) {
            Alert.alert("Error", "Failed to initialize interview.");
            console.error(error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReturnToSettings = () => {
        setIsInterviewFinished(false);
        setShowSettings(true);
        setMessages([]); // Clear chat
        // We keep resumeText/jdText loaded
    };

    const toggleRecording = () => {
        if (isAgentThinking) return;

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const playSynchronizedResponse = async (text: string) => {
        // 🛑 STOP ECHO LOOP: Ensure Mic is OFF before AI speaks
        if (isRecording) {
            console.log("🛑 Preventing Self-Listening: Stopping Mic before TTS.");
            await stopRecording();
        }

        setIsAgentThinking(true);

        // DEV: Mute TTS if requested
        if (isDebugTtsMuted) {
            console.log("🔇 [DEV] TTS Muted. Adding message without audio.");
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: text, sender: 'ai' }]);
            historyBuffer.current.push({ role: 'assistant', content: text });
            setIsAgentThinking(false);
            return;
        }

        try {
            console.log("🔄 Sync: Preloading audio for:", text.substring(0, 10) + "...");

            // 🔊 CRITICAL: Force speaker mode before TTS playback
            console.log("🔊 Forcing speaker output for TTS...");
            await safeAudioModeSwitch('playback');
            
            // Small delay to ensure audio mode is applied
            await new Promise(resolve => setTimeout(resolve, 100));

            // Prepare audio
            const player = await TTSService.prepareAudio(text);

            console.log("💥 Sync: BOOM! Playing.");

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: text, sender: 'ai' }]);

            // Append to History Buffer
            historyBuffer.current.push({ role: 'assistant', content: text });

            if (player) {
                await new Promise<void>((resolve) => {
                    const listener = player.addListener('playbackStatusUpdate', (status: any) => {
                        if (status.didJustFinish) {
                            listener.remove();
                            // @ts-ignore
                            if (typeof player.release === 'function') player.release();
                            else player.remove();
                            resolve();
                        }
                    });
                    player.play();
                });
            }

        } catch (e) {
            console.error("Sync Error:", e);
            // Only add message if not already added (though logic above adds it before play)
            // The catch block in original code added message again? No, setMessages was called.
            // If error happens before setMessages, we might miss it.
            // But original code had setMessages in catch block too.
            // I'll keep the logic consistent: setMessages was called before playback.
            // If error occurs, we just log.
        } finally {
            setIsAgentThinking(false);
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

    // Safe Force Finish Handler - stops audio safely before showing score
    const handleForceFinish = async () => {
        console.log("🛑 [DEBUG] Force Finish Triggered");

        // 1. Stop all audio first
        try {
            await TTSService.stop();
            if (isRecording) {
                await stopRecording();
            }
        } catch (e) {
            console.error("Force Finish Audio Stop Error:", e);
        }

        // 2. Prepare mock final report
        const mockReport: FinalInterviewReport = {
            questions: [],
            averageScore: 8.7,
            overallSummary: "Interview ended via debug mode. You showed great potential in your responses. Keep practicing to improve your technical communication skills!",
            timestamp: Date.now()
        };

        // 3. Use setTimeout to allow audio cleanup, then batch BOTH state updates
        setTimeout(() => {
            console.log("🎬 [DEBUG] Setting finalReport and isInterviewFinished together");
            setFinalReport(mockReport);
            setIsInterviewFinished(true);
        }, 500);
    };

    const handleSimulate = async () => {
        if (!plan || !agentRef.current) return;
        if (isSimulating) return;

        setIsSimulating(true);
        console.log(`⚡ [DEV] Simulating answer: ${debugValue}`);

        try {
            let simText = "";
            if (debugValue === "I_AM_READY") {
                simText = "I am ready.";
            } else {
                const currentTopic = plan.queue[Math.min(currentTopicIndex, plan.queue.length - 1)];
                simText = await agentRef.current.generateSimulatedAnswer(currentTopic, debugValue, resumeText);
            }

            console.log(`🤖 [DEV] Simulated Text: ${simText}`);

            // Inject into system as if user spoke it
            setLiveTranscript(simText);
            await finalizeMessage(simText);
        } catch (e) {
            console.error("Simulation Failed", e);
        } finally {
            setIsSimulating(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

            {/* DEV CONSOLE */}
            <DebugOverlay
                visible={showDebug}
                onClose={() => setShowDebug(false)}
                anger={anger}
                debugValue={debugValue}
                isDebugTtsMuted={isDebugTtsMuted}
                isSimulating={isSimulating}
                setAnger={setAnger}
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
                    metrics={currentMetrics}
                    success={topicSuccess}
                    patience={topicPatience}
                    anger={anger}
                    topicTitle={plan && plan.queue[Math.min(currentTopicIndex, plan.queue.length - 1)]
                        ? `${Math.min(currentTopicIndex, plan.queue.length - 1)}. ${plan.queue[Math.min(currentTopicIndex, plan.queue.length - 1)].topic}`
                        : "Introduction"}
                />
            )}

            {/* ... Rest of your UI (Modals, Chat, Buttons) remains the same ... */}
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

            {/* Old Finish Modal removed - using ScoreReveal Modal instead */}

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

            {/* SCORE REVEAL OVERLAY */}
            <Modal visible={isInterviewFinished} transparent animationType="fade">
                <BlurView intensity={90} tint="dark" style={styles.blurContainer}>
                    <ScoreReveal
                        score={finalReport ? finalReport.averageScore : 0}
                        summary={finalReport ? finalReport.overallSummary : "Calculating results..."}
                        loading={!finalReport}
                        onReturnToMenu={handleReturnToSettings}
                    />
                </BlurView>
            </Modal>

            <View style={styles.controls}>
                <TouchableOpacity
                    onPress={toggleRecording}
                    disabled={isAgentThinking}
                    activeOpacity={0.7}
                >
                    <Animated.View style={[
                        styles.micButton,
                        isRecording ? styles.recording : null,
                        isAgentThinking ? styles.micButtonDisabled : null,
                        { transform: [{ scale: micScale }] }
                    ]}>
                        {isAgentThinking ? (
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
                            backgroundColor: isAgentThinking ? '#10B981' : (isSendingData ? '#A855F7' : '#FACC15'),
                            shadowColor: isAgentThinking ? '#10B981' : (isSendingData ? '#A855F7' : '#FACC15'),
                        }
                    ]} />
                )}
            </View>
        </SafeAreaView>
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