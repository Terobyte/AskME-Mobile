import { useState, useRef, useEffect } from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import {
  InterviewPlan,
  EvaluationMetrics,
  QuestionResult,
  FinalInterviewReport,
  InterviewMode,
  ChatMessage
} from '../../types';
import { GeminiAgentService } from '../../services/gemini-agent';
import { generateInterviewPlan } from '../../interview-planner';
import { TTSService } from '../../services/tts-service';
import { safeAudioModeSwitch } from './useInterviewAudio';

// ============================================
// TYPES
// ============================================

interface UseInterviewLogicConfig {
  // Audio coordination (dependency injection)
  onAIStart?: () => void;         // Called when AI starts speaking
  onAIEnd?: () => void;           // Called when AI finishes speaking

  // Optional callbacks
  onInterviewComplete?: (results: FinalInterviewReport) => void;
}

interface UseInterviewLogicReturn {
  // State
  messages: { id: string; text: string; sender: 'user' | 'ai' }[];
  anger: number;
  currentTopic: string;
  isProcessing: boolean;
  isFinished: boolean;

  // Metrics
  metrics: EvaluationMetrics | null;
  topicSuccess: number;
  topicPatience: number;

  // Interview state
  plan: InterviewPlan | null;
  currentTopicIndex: number;
  isLobbyPhase: boolean;
  isPlanReady: boolean;
  finalReport: FinalInterviewReport | null;

  // Functions
  initializeInterview: (resume: string, jobDescription: string, mode: InterviewMode) => Promise<void>;
  processUserInput: (text: string) => Promise<void>;
  forceFinish: () => Promise<void>;
  restart: () => void;
  simulateAnswer: (intentType: string | number) => Promise<string | null>;  // Updated: now accepts number for score

  // Computed
  progress: number;
}

const INITIAL_PLAN: InterviewPlan = {
  meta: { mode: 'short', total_estimated_time: '5m' },
  queue: [{
    id: 'intro',
    topic: 'Introduction',
    type: 'Intro',
    estimated_time: '5m',
    context: "The user is introducing themselves. Ask them to describe their background and experience briefly."
  }]
};

// ============================================
// HOOK
// ============================================

export const useInterviewLogic = (config: UseInterviewLogicConfig = {}): UseInterviewLogicReturn => {
  const { onAIStart, onAIEnd, onInterviewComplete } = config;

  // Core State
  const [messages, setMessages] = useState<{ id: string; text: string; sender: 'user' | 'ai' }[]>([]);
  const [anger, setAnger] = useState(0);
  const [topicSuccess, setTopicSuccess] = useState(0);
  const [topicPatience, setTopicPatience] = useState(0);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [currentMetrics, setCurrentMetrics] = useState<EvaluationMetrics | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLobbyPhase, setIsLobbyPhase] = useState(true);
  const [isPlanReady, setIsPlanReady] = useState(false);
  const [finalReport, setFinalReport] = useState<FinalInterviewReport | null>(null);
  const [previousTopicResult, setPreviousTopicResult] = useState<string | null>(null);

  // Refs
  const agentRef = useRef<GeminiAgentService | null>(null);
  const historyBuffer = useRef<ChatMessage[]>([]);
  const bulkEvalPromise = useRef<Promise<QuestionResult[]> | null>(null);
  const latestTranscriptRef = useRef('');

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const currentTopic = plan && plan.queue[Math.min(currentTopicIndex, plan.queue.length - 1)]
    ? plan.queue[Math.min(currentTopicIndex, plan.queue.length - 1)].topic
    : "Introduction";

  const progress = plan
    ? Math.min((currentTopicIndex / plan.queue.length) * 100, 100)
    : 0;

  // ============================================
  // CORE FUNCTIONS
  // ============================================

  const playSynchronizedResponse = async (text: string): Promise<void> => {
    setIsProcessing(true);

    // Notify audio hook to stop recording (prevent echo)
    onAIStart?.();

    try {
      console.log("🔄 Sync: Preloading audio for:", text.substring(0, 10) + "...");

      // Force speaker mode before TTS playback
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
    } finally {
      setIsProcessing(false);
      // Notify audio hook that AI finished speaking
      onAIEnd?.();
    }
  };

  // Track last processed input to prevent duplicate processing
  const lastProcessedInput = useRef<string>('');

  const processUserInput = async (text: string): Promise<void> => {
    const textToFinalize = text.trim();

    // ✅ FIX: Guard against processing the same text twice (prevents infinite loop)
    if (textToFinalize === lastProcessedInput.current && textToFinalize.length > 0) {
      console.log(`⚠️ [PROCESS] Duplicate input detected, ignoring: "${textToFinalize.substring(0, 30)}..."`);
      return;
    }

    // ⏱️ DEBUG TIMING: Track Victoria's response time (declared at function scope for finally access)
    const startTime = Date.now();

    if (isProcessing) return;

    if (textToFinalize.length > 0) {
      // Mark this input as being processed
      lastProcessedInput.current = textToFinalize;

      console.log(`⏱️ [TIMING] Victoria response cycle STARTED at ${new Date(startTime).toISOString()}`);

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: textToFinalize, sender: 'user' }]);

      // Append to History Buffer
      historyBuffer.current.push({ role: 'user', content: textToFinalize });

      if (agentRef.current) {
        setIsProcessing(true);
        try {
          // --- LOBBY PHASE LOGIC ---
          if (isLobbyPhase) {
            console.log("🏨 [LOBBY] Analyzing Lobby Input...");

            // Use a dummy topic for analysis context
            const lobbyTopic: any = { topic: "Lobby Check", context: "User is in the waiting lobby." };
            const lastAiText = historyBuffer.current.length > 0
              ? historyBuffer.current[historyBuffer.current.length - 1].content
              : "Welcome to the lobby.";

            const analysis: any = await agentRef.current.evaluateUserAnswer(textToFinalize, lobbyTopic, lastAiText);

            if (analysis.intent === 'READY_CONFIRM') {
              // User is ready to start
              console.log("✅ [LOBBY] User Ready -> STARTING INTRO (Optimistic)");

              const currentPlan = plan || INITIAL_PLAN;

              // Initialize Agent Context properly
              const initialContext = {
                currentTopic: currentPlan.queue[0],
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
              setCurrentTopicIndex(0);

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

            setIsProcessing(false);
            return; // EXIT LOBBY LOGIC
          }

          // --- REGULAR INTERVIEW LOGIC ---
          if (!plan) return;

          let effectiveTopicIndex = currentTopicIndex;
          let effectivePrevResult = previousTopicResult;

          const safeIndex = Math.min(effectiveTopicIndex, plan.queue.length - 1);
          const currentTopic = plan.queue[safeIndex];

          // --- 1. ANALYSIS PHASE (JUDGE) ---
          console.log("🔍 [1] Analyzing User Intent...");

          const lastAiText = historyBuffer.current.length > 0
            ? historyBuffer.current[historyBuffer.current.length - 1].content
            : "Start of topic";

          const analysis: any = await agentRef.current.evaluateUserAnswer(textToFinalize, currentTopic, lastAiText);
          console.log("📊 [1] Result:", JSON.stringify(analysis));

          // --- SPECIAL CASE: INTRO (Index 0) ---
          if (currentTopicIndex === 0) {
            console.log("🎯 [INTRO] Special handling activated");

            // EXCEPTION: Clarification on Intro should stay
            if (analysis.intent === 'CLARIFICATION') {
              console.log("🤔 [INTRO] Clarification requested - staying on intro");
              const speech = await agentRef.current.generateVoiceResponse({
                currentTopic: currentTopic,
                nextTopic: null,
                transitionMode: 'STAY',
              }, undefined, historyBuffer.current);
              await playSynchronizedResponse(speech);
              return;
            }

            // RULE: All other responses on Intro auto-advance
            console.log("✅ [INTRO] Auto-advancing to Topic 1");

            // Apply metrics
            setCurrentMetrics(analysis.metrics);

            // Handle NONSENSE - still applies anger penalty but advances
            if (analysis.intent === 'NONSENSE') {
              console.log("🤡 [INTRO] Nonsense detected - advancing with anger penalty");
              setAnger(prev => Math.min(100, prev + 35));
            }

            // Force transition to next topic
            setCurrentTopicIndex(1);
            setTopicSuccess(0); // Reset for new topic
            setTopicPatience(0); // Reset for new topic
            // Anger carries forward (don't reset)

            const nextTopic = plan.queue[1];
            const speech = await agentRef.current.generateVoiceResponse({
              currentTopic: currentTopic,
              nextTopic: nextTopic,
              transitionMode: 'NEXT_PASS',
            }, undefined, historyBuffer.current);

            await playSynchronizedResponse(speech);
            console.log(`🔄 [INTRO] Transitioned. Anger: ${anger}`);
            return; // Exit early
          }

          // --- BLOCKING CLARIFICATION CHECK ---
          if (analysis.intent === 'CLARIFICATION') {
            console.log("🤔 [CLARIFICATION] User asked for clarification");
            console.log("✅ [CLARIFICATION] State preserved:");
            console.log(`   Success: ${topicSuccess} (unchanged)`);
            console.log(`   Patience: ${topicPatience} (unchanged)`);
            console.log(`   Anger: ${anger} (unchanged)`);

            const speech = await agentRef.current.generateVoiceResponse({
              currentTopic: currentTopic,
              nextTopic: null,
              transitionMode: 'STAY',
              angerLevel: anger
            }, undefined, historyBuffer.current);

            await playSynchronizedResponse(speech);
            setIsProcessing(false);
            return;
          }

          setCurrentMetrics(analysis.metrics);

          // --- 2. GAME LOGIC PHASE ---
          let transitionMode: 'STAY' | 'NEXT_FAIL' | 'NEXT_PASS' | 'NEXT_EXPLAIN' | 'FINISH_INTERVIEW' | 'TERMINATE_ANGER' = 'STAY';
          let shouldPenalizeAnger = true;
          let shouldFinishInterview = false;

          let newSuccess = topicSuccess;
          let newPatience = topicPatience;
          let newAnger = anger;

          if (analysis.intent === 'GIVE_UP') {
            console.log("🏳️ User GAVE UP.");
            newPatience = 110;
          }
          else if (analysis.intent === 'SHOW_ANSWER') {
            console.log("💡 User asked for ANSWER.");
            newPatience = 110;
            shouldPenalizeAnger = false;
            transitionMode = 'NEXT_EXPLAIN';
          }
          else if (analysis.intent === 'CLARIFICATION') {
            console.log("🤔 User asked for CLARIFICATION.");
          }
          else if (analysis.intent === 'NONSENSE') {
            console.log("🤡 User is Trolling/Nonsense.");

            newPatience += 50;
            newAnger += 35;

            transitionMode = 'STAY';

            setCurrentMetrics({ accuracy: 0, depth: 0, structure: 0, reasoning: "Response was identified as nonsense/irrelevant." });
          }
          else {
            // ATTEMPT -> Normal Scoring (ANGER REMOVED FROM FORMULAS PER RULE 2)
            const { accuracy, depth, structure } = analysis.metrics;
            const overall = (accuracy + depth + structure) / 3;

            console.log(`🔹 [MATH] Overall: ${overall.toFixed(1)}`);

            // Rule 2: Anger does NOT increase on poor attempts (only NONSENSE or NEXT_FAIL)
            if (overall < 5) {
              // E. Poor answer - only patience grows, NO anger
              newPatience += ((10 - overall) * 7);
              console.log(`📉 [SCORE] Poor (${overall.toFixed(1)}) - Patience +${((10 - overall) * 7).toFixed(0)}, Anger unchanged`);
            } else if (overall < 7) {
              // F. Mediocre answer
              newSuccess += (overall * 7);
              newPatience += 10;
              console.log(`📊 [SCORE] Mediocre (${overall.toFixed(1)}) - Success +${(overall * 7).toFixed(0)}, Patience +10`);
            } else if (overall <= 8) {
              // G. Good answer
              newSuccess += (overall * 13);
              newPatience -= (overall * 3);
              console.log(`📈 [SCORE] Good (${overall.toFixed(1)}) - Success +${(overall * 13).toFixed(0)}, Patience -${(overall * 3).toFixed(0)}`);
            } else {
              // H. Excellent answer (>8) - ONLY case where anger reduces
              newSuccess += (overall * 13);
              newPatience -= (overall * 3);
              newAnger -= 5; // ⬅️ ONLY REDUCTION for excellent answers
              console.log(`🌟 [SCORE] Excellent (${overall.toFixed(1)}) - Success +${(overall * 13).toFixed(0)}, Anger -5`);
            }
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

            const terminationSpeech = await agentRef.current.generateVoiceResponse({
              currentTopic: currentTopic,
              nextTopic: null,
              transitionMode: 'TERMINATE_ANGER',
              angerLevel: 100
            }, undefined, historyBuffer.current);

            await playSynchronizedResponse(terminationSpeech);

            // ✅ FIX BUG 3: Generate minimal report on early termination
            const partialQuestions: QuestionResult[] = [];

            // Include any questions answered so far from history
            if (historyBuffer.current.length > 0) {
              console.log("📊 [TERMINATE] Processing partial history for report...");
              try {
                const results = await agentRef.current.evaluateBatch(historyBuffer.current);
                partialQuestions.push(...results);
              } catch (e) {
                console.error("❌ [TERMINATE] Failed to evaluate partial history:", e);
              }
            }

            const terminationReport: FinalInterviewReport = {
              questions: partialQuestions,
              averageScore: partialQuestions.length > 0
                ? Number((partialQuestions.reduce((sum, q) => sum + q.score, 0) / partialQuestions.length).toFixed(1))
                : 0,
              overallSummary: `Interview was terminated early due to high frustration level. Only ${currentTopicIndex} out of ${plan?.queue.length || 0} topics were covered. The candidate's responses did not meet expectations.`,
              timestamp: Date.now()
            };

            console.log("📊 [TERMINATE] Setting termination report");
            setFinalReport(terminationReport);
            onInterviewComplete?.(terminationReport);

            setIsFinished(true);
            return;
          }
          else if (newSuccess >= 100) {
            console.log("➡️ [TRANSITION] Moving to next topic (SUCCESS)");
            transitionMode = 'NEXT_PASS';
            nextIndex++;
            setPreviousTopicResult("PASSED_SUCCESS");

            // ⚠️ CRITICAL: Reset per-topic metrics
            setTopicSuccess(0);
            setTopicPatience(0);
            // ⚠️ CRITICAL: Anger is NOT reset (carries through entire interview)

            console.log("🔄 [RESET] Success and Patience reset to 0");
            console.log(`💢 [CARRY] Anger remains at ${newAnger}`);
          }
          else if (newPatience >= 100) {
            console.log("➡️ [TRANSITION] Moving to next topic (PATIENCE LIMIT)");

            // SHOW_ANSWER mercy rule
            if (transitionMode === 'NEXT_EXPLAIN') {
              console.log("😇 [MERCY] SHOW_ANSWER - No anger penalty");
              nextIndex++;
              setPreviousTopicResult("EXPLAINED");
              setTopicSuccess(0);
              setTopicPatience(0);
              // ⚠️ NO anger penalty (mercy rule)
            } else {
              // Regular patience fail - PRE-FLIGHT CHECK for termination
              const tempAnger = newAnger + 35;
              console.log(`⚠️ [PRE-FLIGHT] Checking anger: ${newAnger} + 35 = ${tempAnger}`);

              if (tempAnger >= 100) {
                // ABORT! This would terminate!
                console.log("🤬 [ABORT] Anger would exceed 100! Terminating instead.");
                transitionMode = 'TERMINATE_ANGER';
                newAnger = 100;
                setAnger(100);

                const terminationSpeech = await agentRef.current.generateVoiceResponse({
                  currentTopic: currentTopic,
                  nextTopic: null,
                  transitionMode: 'TERMINATE_ANGER',
                  angerLevel: 100
                }, undefined, historyBuffer.current);

                await playSynchronizedResponse(terminationSpeech);

                // ✅ FIX BUG 3: Generate minimal report on patience-triggered termination
                const partialQuestions: QuestionResult[] = [];

                if (historyBuffer.current.length > 0) {
                  console.log("📊 [TERMINATE] Processing partial history for report...");
                  try {
                    const results = await agentRef.current.evaluateBatch(historyBuffer.current);
                    partialQuestions.push(...results);
                  } catch (e) {
                    console.error("❌ [TERMINATE] Failed to evaluate partial history:", e);
                  }
                }

                const terminationReport: FinalInterviewReport = {
                  questions: partialQuestions,
                  averageScore: partialQuestions.length > 0
                    ? Number((partialQuestions.reduce((sum, q) => sum + q.score, 0) / partialQuestions.length).toFixed(1))
                    : 0,
                  overallSummary: `Interview was terminated early due to accumulated frustration. Only ${currentTopicIndex} out of ${plan?.queue.length || 0} topics were covered.`,
                  timestamp: Date.now()
                };

                console.log("📊 [TERMINATE] Setting termination report");
                setFinalReport(terminationReport);
                onInterviewComplete?.(terminationReport);

                setIsFinished(true);
                return;
              } else {
                // Safe to proceed with NEXT_FAIL
                transitionMode = 'NEXT_FAIL';
                nextIndex++;
                setPreviousTopicResult("FAILED_PATIENCE");

                // ⬅️ ANGER PENALTY APPLIED HERE!
                newAnger += 35;
                setAnger(newAnger);
                console.log(`💢 [ANGER] Patience fail penalty: Anger is now ${newAnger}`);

                // Reset per-topic metrics
                setTopicSuccess(0);
                setTopicPatience(0);
                console.log("🔄 [RESET] Success and Patience reset to 0");
              }
            }
          }

          // CHECK FOR END OF INTERVIEW
          if (plan && nextIndex >= plan.queue.length) {
            console.log("🏁 End of Interview Detected.");
            transitionMode = 'FINISH_INTERVIEW';
            shouldFinishInterview = true;
          } else {
            if (nextIndex !== currentTopicIndex) {
              console.log(`⏩ Transitioning UI to Topic ${nextIndex}`);
              setCurrentTopicIndex(nextIndex);

              // Trigger batch evaluation for previous topics
              if (plan && nextIndex === plan.queue.length - 1) {
                console.log("🚀 Triggering Background Batch Eval for previous topics...");
                const historySnapshot = [...historyBuffer.current];
                bulkEvalPromise.current = agentRef.current.evaluateBatch(historySnapshot);
              }
            }
          }

          // --- 4. ACTING PHASE (VOICE) ---
          console.log("🎬 [4] Generating Speech for Mode:", transitionMode);

          const nextTopic = (transitionMode === 'FINISH_INTERVIEW')
            ? null
            : plan.queue[Math.min(nextIndex, plan.queue.length - 1)];

          const speech = await agentRef.current.generateVoiceResponse({
            currentTopic: currentTopic,
            nextTopic: nextTopic,
            transitionMode: transitionMode,
            angerLevel: anger
          }, undefined, historyBuffer.current);

          await playSynchronizedResponse(speech);

          // GENERATE FINAL REPORT
          if (shouldFinishInterview) {
            console.log("📊 Generating Final Report...");
            setIsProcessing(true);

            try {
              const previousResults = bulkEvalPromise.current
                ? await bulkEvalPromise.current
                : [];

              const lastInteraction = { role: 'user' as const, content: textToFinalize };

              const finalResult = await agentRef.current.evaluateFinal(lastInteraction, previousResults);

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
              onInterviewComplete?.(report);

            } catch (err) {
              console.error("Report Gen Error:", err);
            }

            setIsFinished(true);
          }
        } catch (error) {
          console.error("Agent Error:", error);
          Alert.alert("Error", "An error occurred during the interview. Please try again.");
        } finally {
          // ⏱️ DEBUG TIMING: Log total response time
          const endTime = Date.now();
          const duration = endTime - startTime;
          console.log(`⏱️ [TIMING] Victoria response cycle COMPLETED in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

          setIsProcessing(false);
        }
      }
    }
  };

  const initializeInterview = async (
    resume: string,
    jobDescription: string,
    mode: InterviewMode
  ): Promise<void> => {
    try {
      // 1. Initialize Agent
      agentRef.current = new GeminiAgentService();

      // 2. Reset State
      setCurrentTopicIndex(0);
      setPreviousTopicResult(null);
      setTopicSuccess(0);
      setTopicPatience(0);
      setAnger(0);
      setIsFinished(false);
      setFinalReport(null);
      historyBuffer.current = [];
      setResumeText(resume);

      // 3. Set initial plan (Intro only)
      setPlan(INITIAL_PLAN);
      setIsPlanReady(false);
      setIsLobbyPhase(true);
      setMessages([]);

      // 4. Play immediate greeting
      const greeting = "Hello, I'm Victoria. I'll be conducting your technical interview today. I have your details in front of me. Whenever you're ready to begin, just let me know.";
      await playSynchronizedResponse(greeting);

      // 5. Generate full plan asynchronously
      generateInterviewPlan(resume, jobDescription, mode)
        .then(generatedPlan => {
          setPlan(prev => {
            if (!prev) return generatedPlan;
            return {
              ...generatedPlan,
              queue: [prev.queue[0], ...generatedPlan.queue.slice(1)]
            };
          });
          setIsPlanReady(true);
          console.log("✅ Plan Ready:", generatedPlan.queue.length, "topics");
        })
        .catch(err => {
          console.error("Plan Gen Error:", err);
          Alert.alert("Error", "Failed to generate interview plan.");
        });

    } catch (error) {
      Alert.alert("Error", "Failed to initialize interview.");
      console.error(error);
      throw error;
    }
  };

  const forceFinish = async (): Promise<void> => {
    console.log("🛑 Force Finish Triggered");

    try {
      await TTSService.stop();
    } catch (e) {
      console.error("Force Finish Audio Stop Error:", e);
    }

    const timestamp = Date.now();
    const mockQuestions: QuestionResult[] = [
      {
        topic: "React Native Performance Optimization",
        userAnswer: "I would use FlatList with proper optimization props like getItemLayout, remove console.logs, and use Hermes engine.",
        score: 8.5,
        feedback: "Excellent understanding of performance bottlenecks. You correctly identified FlatList vs ScrollView trade-offs and explained VirtualizedList internals. Could improve by mentioning Hermes engine optimizations.",
        metrics: { accuracy: 9, depth: 8, structure: 8, reasoning: "Strong technical foundation" }
      },
      {
        topic: "State Management Patterns",
        userAnswer: "I prefer Redux Toolkit for large apps, Context for simple state, and Zustand for medium complexity.",
        score: 9.0,
        feedback: "Strong knowledge of Redux, Context API, and Zustand. Your explanation of Redux Toolkit vs classic Redux was spot-on. Great example using real-world use cases.",
        metrics: { accuracy: 9, depth: 9, structure: 9, reasoning: "Comprehensive understanding" }
      },
      {
        topic: "Native Module Development",
        userAnswer: "I create native modules by bridging iOS and Android code, exposing methods through the bridge.",
        score: 7.2,
        feedback: "Good foundation in bridging iOS/Android native code. You understand the basics of TurboModules but missed some advanced concepts like JSI threading. Practice building more complex native modules.",
        metrics: { accuracy: 7, depth: 7, structure: 8, reasoning: "Needs JSI knowledge" }
      },
      {
        topic: "Memory Management & Leaks",
        userAnswer: "I clean up timers and listeners in useEffect cleanup, and avoid closures that capture large objects.",
        score: 6.5,
        feedback: "You know the common pitfalls (listeners, timers, closures) but struggled to explain WeakMap/WeakRef usage. Your debugging approach using Performance Monitor was correct. Study Hermes memory profiling tools.",
        metrics: { accuracy: 6, depth: 6, structure: 7, reasoning: "Basic understanding" }
      },
      {
        topic: "Advanced Animation Techniques",
        userAnswer: "I use Animated API for simple animations and try to use native driver when possible.",
        score: 4.0,
        feedback: "Basic knowledge of Animated API but lacked understanding of Reanimated 2 worklets. Couldn't explain the difference between UI thread and JS thread execution. Needs more hands-on practice with complex animations.",
        metrics: { accuracy: 4, depth: 3, structure: 5, reasoning: "Needs significant improvement" }
      }
    ];

    const averageScore = Number((mockQuestions.reduce((sum, q) => sum + q.score, 0) / mockQuestions.length).toFixed(1));

    const mockReport: FinalInterviewReport = {
      questions: mockQuestions,
      averageScore,
      overallSummary: "You demonstrated solid fundamentals in React Native development, particularly excelling in performance optimization and state management patterns. Your understanding of native module basics is good, though advanced concepts like JSI and Reanimated worklets need more practice. Focus on deepening your knowledge of memory profiling and modern animation libraries.",
      timestamp
    };

    console.log("📊 [DEBUG] Mock Report Created:");
    console.log("📊 [DEBUG] Questions Count:", mockQuestions.length);
    console.log("📊 [DEBUG] Average Score:", averageScore);
    console.log("📊 [DEBUG] Full Report:", JSON.stringify(mockReport, null, 2));

    setTimeout(() => {
      setFinalReport(mockReport);
      setIsFinished(true);
      onInterviewComplete?.(mockReport);
    }, 500);
  };

  const restart = (): void => {
    setIsFinished(false);
    setMessages([]);
    setPlan(null);
    setCurrentTopicIndex(0);
    setPreviousTopicResult(null);
    setTopicSuccess(0);
    setTopicPatience(0);
    setAnger(0);
    setCurrentMetrics(null);
    setFinalReport(null);
    setIsLobbyPhase(true);
    setIsPlanReady(false);
    historyBuffer.current = [];
    bulkEvalPromise.current = null;
  };

  // ============================================
  // SIMULATE ANSWER (for DEV Tools)
  // ============================================
  // 
  // REFACTORED: Now uses semantic type system instead of numeric levels.
  // Maps incoming intent types to either:
  // - QualityLevel: 'excellent' | 'good' | 'average' | 'poor' | 'fail'
  // - SpecialAction: 'nonsense' | 'give_up' | 'clarify' | 'show_answer'
  // ============================================

  const simulateAnswer = async (intentType: string | number): Promise<string | null> => {
    console.log("⚡ [SIMULATE] Called with intentType:", intentType);
    console.log("⚡ [SIMULATE] Type:", typeof intentType);
    console.log("⚡ [SIMULATE] Current state:");
    console.log("   - plan:", !!plan);
    console.log("   - currentTopicIndex:", currentTopicIndex);
    console.log("   - resumeText length:", resumeText.length);

    if (!agentRef.current) {
      console.error("❌ [SIMULATE] Agent not initialized");
      return null;
    }

    if (!plan || !plan.queue[currentTopicIndex]) {
      console.error("❌ [SIMULATE] No current topic available");
      return null;
    }

    const currentTopicData = plan.queue[currentTopicIndex];
    console.log("⚡ [SIMULATE] Topic:", currentTopicData.topic);

    // ============================================
    // INTENT TYPE MAPPING (Old → New)
    // ============================================
    // This mapping converts the old numeric/string system to the new semantic types.
    // 
    // QUALITY LEVELS (attempts to answer):
    //   9, 10 → 'excellent' (expected score 9-10)
    //   7, 8  → 'good'      (expected score 7-8)
    //   5, 6  → 'average'   (expected score 5-6)
    //   3, 4  → 'poor'      (expected score 3-4)
    //   0, 1, 2, 'poor_0' → 'fail' (expected score 0-2) ⚠️ NOT nonsense!
    //
    // SPECIAL ACTIONS (non-answers):
    //   'NONSENSE' → generateSpecialAction('nonsense') → triggers anger
    //   'GIVE_UP'  → generateSpecialAction('give_up')  → no anger
    //   'CLARIFICATION' → generateSpecialAction('clarify') → stays on topic
    //   'SHOW_ANSWER'   → generateSpecialAction('show_answer') → educational
    // ============================================

    // Check for special action strings first
    if (typeof intentType === 'string') {
      const upperIntent = intentType.toUpperCase();

      // Special actions use the new generateSpecialAction function
      if (upperIntent === 'NONSENSE') {
        console.log("⚡ [SIMULATE] Special action: NONSENSE → generateSpecialAction('nonsense')");
        return await agentRef.current.generateSpecialAction('nonsense', currentTopicData);
      }
      if (upperIntent === 'GIVE_UP') {
        console.log("⚡ [SIMULATE] Special action: GIVE_UP → generateSpecialAction('give_up')");
        return await agentRef.current.generateSpecialAction('give_up', currentTopicData);
      }
      if (upperIntent === 'CLARIFICATION') {
        console.log("⚡ [SIMULATE] Special action: CLARIFICATION → generateSpecialAction('clarify')");
        return await agentRef.current.generateSpecialAction('clarify', currentTopicData);
      }
      if (upperIntent === 'SHOW_ANSWER') {
        console.log("⚡ [SIMULATE] Special action: SHOW_ANSWER → generateSpecialAction('show_answer')");
        return await agentRef.current.generateSpecialAction('show_answer', currentTopicData);
      }

      // Check for new semantic quality levels (direct usage)
      const validQualityLevels = ['excellent', 'good', 'average', 'poor', 'fail'];
      const lowerIntent = intentType.toLowerCase();
      if (validQualityLevels.includes(lowerIntent)) {
        console.log(`⚡ [SIMULATE] Semantic quality level: '${lowerIntent}'`);
        return await agentRef.current.generateSimulatedAnswer(
          currentTopicData,
          lowerIntent as 'excellent' | 'good' | 'average' | 'poor' | 'fail',
          resumeText
        );
      }
    }

    // Convert numeric intent to semantic quality level
    let qualityLevel: 'excellent' | 'good' | 'average' | 'poor' | 'fail';

    // Parse numeric value (handles both number and string numbers)
    const numericValue = typeof intentType === 'number' ? intentType : Number(intentType);

    if (!isNaN(numericValue)) {
      // Map numeric score to semantic quality level
      if (numericValue >= 9) {
        qualityLevel = 'excellent';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'excellent' (9-10)`);
      } else if (numericValue >= 7) {
        qualityLevel = 'good';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'good' (7-8)`);
      } else if (numericValue >= 5) {
        qualityLevel = 'average';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'average' (5-6)`);
      } else if (numericValue >= 3) {
        qualityLevel = 'poor';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'poor' (3-4)`);
      } else {
        // 0, 1, 2 → 'fail' (trying but completely wrong, NOT nonsense)
        qualityLevel = 'fail';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'fail' (0-2) ⚠️ Attempting but wrong, NOT nonsense`);
      }
    } else if (typeof intentType === 'string' && intentType.toLowerCase() === 'poor_0') {
      // Legacy 'poor_0' intent maps to 'fail'
      qualityLevel = 'fail';
      console.log("⚡ [SIMULATE] Legacy 'poor_0' → 'fail'");
    } else {
      // Unknown intent - default to average
      qualityLevel = 'average';
      console.warn(`⚠️ [SIMULATE] Unknown intentType '${intentType}', defaulting to 'average'`);
    }

    console.log(`⚡ [SIMULATE] Final quality level: '${qualityLevel}'`);

    try {
      const simulatedAnswer = await agentRef.current.generateSimulatedAnswer(
        currentTopicData,
        qualityLevel,
        resumeText
      );

      if (!simulatedAnswer) {
        console.error("❌ [SIMULATE] Generated answer is null");
        return null;
      }

      console.log("✅ [SIMULATE] Generated answer:", simulatedAnswer.substring(0, 100) + "...");
      return simulatedAnswer;
    } catch (error) {
      console.error("❌ [SIMULATE] Failed:", error);
      return null;
    }
  };

  // ============================================
  // VALIDATION FUNCTION
  // ============================================

  const validateStateTransition = (
    before: { success: number; patience: number; anger: number },
    after: { success: number; patience: number; anger: number },
    intent: string,
    overall: number,
    decision: string
  ): boolean => {
    let isValid = true;

    // Rule: CLARIFICATION should not change state
    if (intent === 'CLARIFICATION') {
      if (after.success !== before.success ||
        after.patience !== before.patience ||
        after.anger !== before.anger) {
        console.error("❌ VALIDATION FAILED: CLARIFICATION changed state!");
        isValid = false;
      }
    }

    // Rule: Anger should only grow on NONSENSE or NEXT_FAIL
    if (after.anger > before.anger) {
      if (intent !== 'NONSENSE' && decision !== 'NEXT_FAIL') {
        console.error(`❌ VALIDATION FAILED: Anger grew illegally! Intent: ${intent}, Decision: ${decision}`);
        isValid = false;
      }
    }

    // Rule: All values must be 0-100
    if (after.success < 0 || after.success > 100 ||
      after.patience < 0 || after.patience > 100 ||
      after.anger < 0 || after.anger > 100) {
      console.error("❌ VALIDATION FAILED: State values out of bounds!");
      isValid = false;
    }

    if (isValid) {
      console.log("✅ VALIDATION PASSED: State transition is valid");
    }

    return isValid;
  };

  // ============================================
  // CLEANUP
  // ============================================

  useEffect(() => {
    return () => {
      console.log('🧹 useInterviewLogic: Cleaning up...');
      TTSService.stop().catch(e => console.warn('⚠️ TTS stop failed on unmount:', e));
    };
  }, []);

  // ============================================
  // RETURN INTERFACE
  // ============================================

  return {
    // State
    messages,
    anger,
    currentTopic,
    isProcessing,
    isFinished,

    // Metrics
    metrics: currentMetrics,
    topicSuccess,
    topicPatience,

    // Interview state
    plan,
    currentTopicIndex,
    isLobbyPhase,
    isPlanReady,
    finalReport,

    // Functions
    initializeInterview,
    processUserInput,
    forceFinish,
    restart,
    simulateAnswer,  // NEW: For DEV tools smart simulation

    // Computed
    progress,
  };
};