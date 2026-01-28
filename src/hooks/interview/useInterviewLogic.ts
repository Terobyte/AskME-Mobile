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

  const processUserInput = async (text: string): Promise<void> => {
    const textToFinalize = text.trim();

    if (isProcessing) return;

    if (textToFinalize.length > 0) {
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

            // 3. VALID INPUT -> MOVE NEXT
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

            const terminationSpeech = await agentRef.current.generateVoiceResponse({
              currentTopic: currentTopic,
              nextTopic: null,
              transitionMode: 'TERMINATE_ANGER',
              angerLevel: 100
            }, undefined, historyBuffer.current);

            await playSynchronizedResponse(terminationSpeech);

            setIsFinished(true);
            return;
          }
          else if (newSuccess >= 100) {
            transitionMode = 'NEXT_PASS';
            nextIndex++;
            setPreviousTopicResult("PASSED_SUCCESS");
            setTopicSuccess(0);
            setTopicPatience(0);
            setAnger(prev => Math.max(0, prev - 5));
          }
          else if (newPatience >= 100) {
            if (transitionMode !== 'NEXT_EXPLAIN') transitionMode = 'NEXT_FAIL';

            nextIndex++;
            setPreviousTopicResult("FAILED_PATIENCE");
            setTopicSuccess(0);
            setTopicPatience(0);

            if (shouldPenalizeAnger) {
              setAnger(prev => Math.min(100, prev + 35));
            } else {
              console.log("😇 Mercy Rule: Anger saved.");
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

    const mockReport: FinalInterviewReport = {
      questions: [],
      averageScore: 8.7,
      overallSummary: "Interview ended via debug mode. You showed great potential in your responses. Keep practicing to improve your technical communication skills!",
      timestamp: Date.now()
    };

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
    
    // Computed
    progress,
  };
};