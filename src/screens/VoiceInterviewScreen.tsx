import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, LayoutAnimation, Platform, UIManager, SafeAreaView, Modal, StatusBar, TextInput, Animated, ActivityIndicator, Image } from 'react-native';
import { Audio } from 'expo-av';
import { Buffer } from 'buffer';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';
import Slider from '@react-native-community/slider';
import * as FileSystem from 'expo-file-system';
import { InterviewMode, InterviewPlan } from '../types';

import { GeminiAgentService, EvaluationMetrics, GeminiInterviewResponse } from '../services/gemini-agent';
import { generateInterviewPlan } from '../interview-planner';
import { TTSService } from '../services/tts-service';
import { useTypewriter } from '../hooks/useTypewriter';

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
  const [isRecording, setIsRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(true); // Start with Settings OPEN
  const [isGenerating, setIsGenerating] = useState(false);
  
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
  const [messages, setMessages] = useState<{id: string, text: string, sender: 'user' | 'ai'}[]>([]);
  
  // Interview State Tracking (for state-aware Gemini calls)
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const [topicSuccess, setTopicSuccess] = useState(0);
  const [topicPatience, setTopicPatience] = useState(0);
  const [anger, setAnger] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [currentMetrics, setCurrentMetrics] = useState<EvaluationMetrics | null>(null);
  const [isInterviewPhaseActive, setIsInterviewPhaseActive] = useState(false); // Explicit flag for interview phase
  
  // Get latest AI message text for Typewriter
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

  const [isSendingData, setIsSendingData] = useState(false); 
  const micScale = useRef(new Animated.Value(1)).current; 

  const ws = useRef<WebSocket | null>(null);
  const recording = useRef<Audio.Recording | null>(null);
  const lastPosition = useRef(0); 
  const streamInterval = useRef<NodeJS.Timeout | null>(null);
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);

  const VOLUME_THRESHOLD = -65; 

  // Mic Pulsing
  useEffect(() => {
      if (isRecording) {
          Animated.loop(
              Animated.sequence([
                  Animated.timing(micScale, { toValue: 1.1, duration: 800, useNativeDriver: true }),
                  Animated.timing(micScale, { toValue: 1.0, duration: 800, useNativeDriver: true })
              ])
          ).start();
      } else {
          micScale.setValue(1); 
      }
  }, [isRecording]);

  // Permissions & Cleanup
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access microphone was denied');
      }
    })();

    return () => {
      TTSService.stop(); // Stop audio on unmount
      if (recording.current) {
          recording.current.stopAndUnloadAsync().catch(err => console.log("Cleanup Error", err));
          recording.current = null;
      }
      if (streamInterval.current) {
          clearInterval(streamInterval.current);
          streamInterval.current = null;
      }
      if (silenceTimer.current) {
          clearTimeout(silenceTimer.current);
          silenceTimer.current = null;
      }
      if (ws.current) {
          ws.current.close();
          ws.current = null;
      }
      setIsRecording(false);
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

  const finalizeMessage = async () => {
      const textToFinalize = latestTranscriptRef.current; 
      
      // Strict Guard: Prevent duplicate calls if already thinking
      if (isAgentThinking) {
          console.log("⚠️ BLOCKED DUPLICATE API CALL: Agent is already thinking.");
          return;
      }
      
      // Guard: Don't process if interview is finished
      if (isFinished) {
          console.log("⚠️ Interview is finished. Ignoring further input.");
          return;
      }
      
      if (textToFinalize.trim().length > 0) {
          console.log('🔥 TRIGGERING GEMINI API CALL for:', textToFinalize.substring(0, 20) + "...");
          
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setMessages(prev => [...prev, { id: Date.now().toString(), text: textToFinalize.trim(), sender: 'user' }]);
          
          setLiveTranscript("");
          targetTranscript.current = "";
          latestTranscriptRef.current = ""; 
          setDisplayTranscript("");
          setIsFinalChunk(false);

          // Trigger AI Response
          if (agentRef.current && plan) {
            setIsAgentThinking(true); // LOCK
            try {
                let reply: string | null = null;
                
                if (isInterviewPhaseActive && currentTopicIndex < plan.queue.length) {
                  // STATE-AWARE CALL for interview phase
                  const currentTopic = plan.queue[currentTopicIndex].topic;
                  
                  const responseJson = await agentRef.current.sendUserResponse(
                    textToFinalize.trim(),
                    {
                      success: topicSuccess,
                      patience: topicPatience,
                      anger: anger
                    },
                    currentTopic,
                    currentTopicIndex,
                    plan.queue.length
                  );
                  
                  // Parse JSON response
                  try {
                    const response: GeminiInterviewResponse = JSON.parse(responseJson);
                    console.log("📊 Parsed Gemini Response:", response);
                    
                    // Apply new state from Gemini
                    setTopicSuccess(response.state.success);
                    setTopicPatience(response.state.patience);
                    setAnger(response.state.anger);
                    setCurrentMetrics(response.evaluation);
                    
                    // Handle decision
                    if (response.decision === 'TERMINATE') {
                      console.log("⛔ Interview TERMINATED");
                      setIsFinished(true);
                      reply = response.text;
                    } else if (response.decision === 'NEXT_SUCCESS' || response.decision === 'NEXT_FAIL' || response.decision === 'NEXT_EXPLAIN') {
                      console.log(`➡️ Moving to next topic: ${response.decision}`);
                      setCurrentTopicIndex(prev => prev + 1);
                      setTopicSuccess(0);
                      setTopicPatience(0);
                      reply = response.text;
                    } else if (response.decision === 'STAY') {
                      console.log("🔄 Staying on current topic");
                      reply = response.text;
                    } else {
                      // Unknown decision type - log warning
                      console.warn('⚠️ Unknown decision type:', response.decision);
                      reply = response.text;
                    }
                    
                  } catch (e: any) {
                    console.error("Failed to parse Gemini JSON:", e);
                    console.error("Raw response:", responseJson);
                    const errorMsg = e.message || 'Unknown error';
                    const preview = responseJson.substring(0, 100);
                    Alert.alert("Error", `Invalid AI response format: ${errorMsg}\n\nPreview: ${preview}...`);
                    setIsAgentThinking(false);
                    return;
                  }
                } else {
                  // SIMPLE CALL for lobby/intro or after interview ends
                  reply = await agentRef.current.sendUserResponse(textToFinalize.trim());
                  
                  // After first response in lobby, activate interview phase
                  if (!isInterviewPhaseActive && messages.length >= 1) {
                    console.log("🎬 Activating interview phase");
                    setIsInterviewPhaseActive(true);
                  }
                }
                
                // Speak & Update UI
                if (reply) {
                    TTSService.speak(reply);
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: reply, sender: 'ai' }]);
                }
            } catch (error) {
                console.error("Agent Error:", error);
                Alert.alert("Error", "Something went wrong. Please try again.");
            } finally {
                setIsAgentThinking(false); // UNLOCK
            }
          }
      }
  };

  // --- Document Picker ---
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

  // --- Main Logic: Save & Restart ---
  const handleSaveAndRestart = async () => {
      setIsGenerating(true);
      try {
          // Reset interview state
          setCurrentTopicIndex(0);
          setTopicSuccess(0);
          setTopicPatience(0);
          setAnger(0);
          setIsFinished(false);
          setCurrentMetrics(null);
          setIsInterviewPhaseActive(false); // Reset phase flag
          
          // 1. Generate Plan
          const generatedPlan = await generateInterviewPlan(resumeText, jdText, mode);
          setPlan(generatedPlan);
          
          // 2. Initialize Agent
          agentRef.current = new GeminiAgentService();
          
          // 3. Start Agent (Hidden Greeting)
          const introMsg = await agentRef.current.startInterview(generatedPlan.queue, resumeText, "Candidate");
          
          setMessages([{ id: 'system_start', text: introMsg, sender: 'ai' }]);
          setShowSettings(false); // Close Modal
          
      } catch (error) {
          Alert.alert("Error", "Failed to initialize interview.");
          console.error(error);
      } finally {
          setIsGenerating(false);
      }
  };

  const connectToDeepgram = async () => {
    const API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY || ""; 
    const cleanKey = API_KEY.trim();
    if (!cleanKey) {
        console.error("Deepgram API Key missing in .env");
        Alert.alert("Configuration Error", "Deepgram API Key is missing.");
        return;
    }
    const socketUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&encoding=linear16&sample_rate=16000&container=wav`;
    const socket = new WebSocket(socketUrl, ['token', cleanKey]);
    ws.current = socket;
    socket.onopen = () => {
      setIsRecording(true); 
      setStatus('listening');
    };
    socket.onmessage = async (event) => {
        try {
            if (typeof event.data === 'string') {
                const msg = JSON.parse(event.data);
                if (msg.channel?.alternatives?.[0]?.transcript) {
                    const text = msg.channel.alternatives[0].transcript;
                    if (silenceTimer.current) clearTimeout(silenceTimer.current);
                    if (text.trim().length > 0) {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        if (msg.is_final) {
                            setLiveTranscript(prev => {
                                const spacer = prev.length > 0 ? " " : "";
                                return prev + spacer + text.trim();
                            });
                            setIsFinalChunk(true);
                            silenceTimer.current = setTimeout(() => { finalizeMessage(); }, 4000); 
                        } else {
                            silenceTimer.current = setTimeout(() => { finalizeMessage(); }, 4000); 
                        }
                    }
                }
            } 
        } catch (e) {
            console.error("WS Message Error:", e);
        }
    };
    socket.onerror = (e: any) => {
        stopRecording();
    };
    socket.onclose = (e) => {
        setIsRecording(false);
        setStatus('idle');
    };
  };

  const startRecording = async () => {
    try {
        if (recording.current) await stopRecording();
        setLiveTranscript("");
        targetTranscript.current = "";
        setDisplayTranscript("");
        lastPosition.current = 0; 
        
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Permission missing', 'Microphone access is required.');
            return;
        }
        await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
        });
        await connectToDeepgram();
        const recordingOptions = {
            android: {
                extension: '.wav',
                outputFormat: Audio.AndroidOutputFormat.MPEG_4,
                audioEncoder: Audio.AndroidAudioEncoder.AAC,
                sampleRate: 16000,
                numberOfChannels: 1,
                bitRate: 128000,
                metering: true,
            },
            ios: {
                extension: '.wav',
                outputFormat: Audio.IOSOutputFormat.LINEARPCM,
                audioQuality: Audio.IOSAudioQuality.HIGH,
                sampleRate: 16000,
                numberOfChannels: 1,
                bitRate: 128000,
                linearPCMBitDepth: 16,
                linearPCMIsBigEndian: false,
                linearPCMIsFloat: false,
                metering: true,
            },
            web: { mimeType: 'audio/wav', bitsPerSecond: 128000 },
        };
        const { recording: newRecording } = await Audio.Recording.createAsync(recordingOptions);
        recording.current = newRecording;
        lastPosition.current = 0; 
        streamInterval.current = setInterval(async () => {
            if (!recording.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) return;

            try {
                const status = await recording.current.getStatusAsync();
                const metering = status.metering ?? -160;
                
                const isSpeaking = metering > VOLUME_THRESHOLD && metering !== -160;

                const uri = recording.current.getURI();
                if (!uri) return;

                const response = await fetch(uri);
                const blob = await response.blob();
                
                if (blob.size > lastPosition.current) {
                    const chunk = blob.slice(lastPosition.current);
                    ws.current.send(chunk);
                    lastPosition.current = blob.size;
                }
                
                setIsSendingData(isSpeaking);
            } catch (e: any) {}
        }, 500);
        newRecording.setOnRecordingStatusUpdate((status) => {});
    } catch (err) {
        Alert.alert("Error", "Could not start microphone.");
    }
  };

  const stopRecording = async () => {
    try {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        if (streamInterval.current) {
            clearInterval(streamInterval.current);
            streamInterval.current = null;
        }
        if (recording.current) {
            await recording.current.stopAndUnloadAsync();
            recording.current = null;
        }
        if (ws.current) {
            if (ws.current.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: 'CloseStream' }));
            }
            ws.current.close();
            ws.current = null;
        }
        setIsRecording(false);
        setStatus('idle');
        finalizeMessage();
    } catch (error) {
        console.error("Error stopping recording:", error);
    }
  };

  const toggleRecording = () => {
      if (isRecording) {
          stopRecording();
      } else {
          startRecording();
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
                  style={{width: '100%', height: 40}}
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
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      
      {/* Minimalist Header */}
      <View style={styles.header}>
          <Text style={{fontWeight:'bold', fontSize:18}}>AskME AI</Text>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconButton}>
              <Ionicons name="settings-outline" size={24} color="#333" />
          </TouchableOpacity>
      </View>

      {/* Control Center Modal (Glass) */}
      <Modal visible={showSettings} animationType="fade" transparent>
          <BlurView intensity={20} style={styles.blurContainer} tint="light">
              <View style={styles.modalContainer}>
                  <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>Control Center</Text>
                      {/* Allow closing only if plan exists */}
                      {plan && (
                          <TouchableOpacity onPress={() => setShowSettings(false)}>
                              <Ionicons name="close" size={28} color="#333" />
                          </TouchableOpacity>
                      )}
                  </View>

                  <ScrollView style={styles.modalContent}>
                      {/* 1. Context */}
                      <Text style={styles.sectionTitle}>1. Setup</Text>
                      <TouchableOpacity style={styles.glassButton} onPress={pickResume}>
                          <Ionicons name="document-text-outline" size={24} color="#333" />
                          <Text style={styles.glassButtonText}>
                              {resumeFile ? `Resume: ${resumeFile.name}` : "Upload Resume"}
                          </Text>
                          {resumeFile && <Ionicons name="checkmark-circle" size={20} color="#4CAF50" style={{marginLeft: 10}} />}
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.glassButton} onPress={pasteJD}>
                          <Ionicons name="clipboard-outline" size={24} color="#333" />
                          <Text style={styles.glassButtonText}>
                              {jdText !== MOCK_JOB_DESCRIPTION ? "JD Pasted!" : "Paste Job Description"}
                          </Text>
                          {jdText !== MOCK_JOB_DESCRIPTION && <Ionicons name="checkmark-circle" size={20} color="#4CAF50" style={{marginLeft: 10}} />}
                      </TouchableOpacity>

                      {/* 2. Duration */}
                      <Text style={styles.sectionTitle}>2. Duration</Text>
                      {renderSlider()}
                      
                      {/* 3. The Plan (If generated) */}
                      {plan && (
                          <View style={{marginTop: 20}}>
                              <Text style={styles.sectionTitle}>3. Agenda Preview</Text>
                              <View style={styles.planPreview}>
                                  {plan.queue.map((item, i) => (
                                      <Text key={item.id} style={{fontSize: 14, color: '#333', marginBottom: 5}}>
                                          {i+1}. {item.topic} {item.score ? `(${item.score}/10)` : ''}
                                      </Text>
                                  ))}
                              </View>
                          </View>
                      )}

                      {/* Action Button */}
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

      {/* Chat Area */}
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
                    {/* Avatar for AI */}
                    {msg.sender === 'ai' && (
                        <View style={{alignItems: 'center', marginRight: 8}}>
                             <Text style={{fontSize: 10, color: '#999', marginBottom: 2}}>Victoria</Text>
                             <Image source={{uri: VICTORIA_AVATAR_URL}} style={styles.avatar} />
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
                            {/* Typewriter Effect only for the latest AI message */}
                            {msg.sender === 'ai' && index === messages.length - 1 
                                ? displayedAiText 
                                : msg.text}
                        </Text>
                    </View>
                </View>
            ))}
            
            {/* Live Bubble */}
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

      {/* Controls */}
      <View style={styles.controls}>
          <TouchableOpacity onPress={toggleRecording}>
            <Animated.View style={[
                styles.micButton, 
                isRecording ? styles.recording : null,
                { transform: [{ scale: micScale }] } 
            ]}>
                <Ionicons name={isRecording ? "stop" : "mic"} size={32} color="#FFF" />
            </Animated.View>
          </TouchableOpacity>
          
          {/* VAD Pixel */}
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
      backgroundColor: '#007AFF', // Blue
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
  // Modal Styles
  blurContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
  },
  modalContainer: {
      backgroundColor: 'rgba(30,30,30,0.3)', // Dark "Tech Glass"
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
  modalButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
  },
  cancelBtn: {
      padding: 15,
      borderRadius: 10,
      backgroundColor: '#F3F4F6',
      flex: 1,
      marginRight: 10,
      alignItems: 'center',
  },
  saveBtn: {
      padding: 15,
      borderRadius: 10,
      backgroundColor: '#4CAF50',
      flex: 1,
      marginLeft: 10,
      alignItems: 'center',
  },
  cancelBtnText: {
      color: '#333',
      fontWeight: 'bold',
  },
  saveBtnText: {
      color: '#FFF',
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
  }
});