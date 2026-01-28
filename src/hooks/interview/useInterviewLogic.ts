import { useState, useRef, useCallback } from 'react';
import { GeminiAgentService } from '../../services/gemini-agent';
import { generateInterviewPlan } from '../../interview-planner';
import { StorageService } from '../../services/storage-service';
import {
  InterviewPlan,
  InterviewTopic,
  EvaluationMetrics,
  QuestionResult,
  FinalInterviewReport,
  ChatMessage,
  InterviewMode,
  VoiceGenerationContext,
} from '../../types';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

export interface InterviewMetrics {
  anger: number;
  topicSuccess: number;
}

export interface UseInterviewLogicConfig {
  geminiApiKey: string;
  onAISpeakStart?: () => void;
  onAISpeakEnd?: () => void;
  onInterviewComplete?: (results: FinalInterviewReport) => void;
}

export interface UseInterviewLogicReturn {
  // State
  messages: Message[];
  currentTopic: InterviewTopic | null;
  metrics: {
    anger: number;
    topicSuccess: number;
  };
  isProcessing: boolean;
  interviewComplete: boolean;
  currentMetrics: EvaluationMetrics | null;
  finalReport: FinalInterviewReport | null;

  // Actions
  initializeInterview: (resumeText: string, jdText: string, mode: InterviewMode) => Promise<void>;
  handleUserResponse: (userText: string) => Promise<void>;
  handleSaveAndRestart: (resumeText: string, jdText: string, mode: InterviewMode) => Promise<void>;
  handleForceFinish: () => Promise<void>;
}

// ============================================
// CONSTANTS
// ============================================

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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useInterviewLogic(config: UseInterviewLogicConfig): UseInterviewLogicReturn {
  const { onAISpeakStart, onAISpeakEnd, onInterviewComplete } = config;

  // State Management
  const [resumeText, setResumeText] = useState<string>('');
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [anger, setAnger] = useState<number>(0);
  const [topicSuccess, setTopicSuccess] = useState<number>(0);
  const [topicPatience, setTopicPatience] = useState<number>(0);
  const [currentTopicIndex, setCurrentTopicIndex] = useState<number>(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [interviewComplete, setInterviewComplete] = useState<boolean>(false);
  const [currentMetrics, setCurrentMetrics] = useState<EvaluationMetrics | null>(null);
  const [finalReport, setFinalReport] = useState<FinalInterviewReport | null>(null);
  const [isLobbyPhase, setIsLobbyPhase] = useState<boolean>(true);
  const [previousTopicResult, setPreviousTopicResult] = useState<string | null>(null);

  // Refs
  const agentRef = useRef<GeminiAgentService | null>(null);
  const historyBuffer = useRef<ChatMessage[]>([]);
  const bulkEvalPromise = useRef<Promise<QuestionResult[]> | null>(null);

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  const addMessage = useCallback((text: string, sender: 'user' | 'ai') => {
    const message: Message = {
      id: `${Date.now()}_${sender}`,
      text,
      sender,
    };
    setMessages(prev => [...prev, message]);

    // Update history buffer
    historyBuffer.current.push({
      role: sender === 'user' ? 'user' : 'assistant',
      content: text,
    });
  }, []);

  const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    retries: number = MAX_RETRIES
  ): Promise<T> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1)));
        console.warn(`Retry ${i + 1}/${retries} after error:`, error);
      }
    }
    throw new Error('Max retries exceeded');
  };

  // ============================================
  // CORE LOGIC FUNCTIONS
  // ============================================

  const initializeInterview = useCallback(async (
    resume: string,
    jd: string,
    mode: InterviewMode
  ) => {
    try {
      setIsProcessing(true);
      setResumeText(resume);

      // Initialize Gemini Agent
      agentRef.current = new GeminiAgentService();

      // Reset state
      setCurrentTopicIndex(0);
      setPreviousTopicResult(null);
      setTopicSuccess(0);
      setTopicPatience(0);
      setAnger(0);
      setInterviewComplete(false);
      setFinalReport(null);
      setCurrentMetrics(null);
      historyBuffer.current = [];
      setMessages([]);

      // Set initial plan (intro only)
      setPlan(INITIAL_PLAN);
      setIsLobbyPhase(true);

      // Generate greeting
      const greeting = "Hello, I'm Victoria. I'll be conducting your technical interview today. I have your details in front of me. Whenever you're ready to begin, just let me know.";
      
      if (onAISpeakStart) onAISpeakStart();
      addMessage(greeting, 'ai');
      if (onAISpeakEnd) onAISpeakEnd();

      // Generate full plan asynchronously
      generateInterviewPlan(resume, jd, mode)
        .then(generatedPlan => {
          setPlan(prev => {
            if (!prev) return generatedPlan;
            return {
              ...generatedPlan,
              queue: [prev.queue[0], ...generatedPlan.queue.slice(1)]
            };
          });
          console.log("✅ Plan Ready:", generatedPlan.queue.length, "topics");
        })
        .catch(err => {
          console.error("Plan Generation Error:", err);
        });

    } catch (error) {
      console.error("Initialization Error:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [addMessage, onAISpeakStart, onAISpeakEnd]);

  const handleUserResponse = useCallback(async (userText: string) => {
    if (!agentRef.current || isProcessing || !userText.trim()) return;

    try {
      setIsProcessing(true);

      // Add user message
      addMessage(userText.trim(), 'user');

      // ============================================
      // LOBBY PHASE LOGIC
      // ============================================
      if (isLobbyPhase) {
        console.log("🏨 [LOBBY] Analyzing Lobby Input...");

        const lobbyTopic: InterviewTopic = {
          id: 'lobby',
          topic: 'Lobby Check',
          type: 'Intro',
          context: "User is in the waiting lobby.",
          estimated_time: '1m'
        };

        const lastAiText = historyBuffer.current.length > 0
          ? historyBuffer.current[historyBuffer.current.length - 1].content
          : "Welcome to the lobby.";

        const analysis: any = await retryWithBackoff(() =>
          agentRef.current!.evaluateUserAnswer(userText.trim(), lobbyTopic, lastAiText)
        );

        if (analysis.intent === 'READY_CONFIRM') {
          console.log("✅ [LOBBY] User Ready -> STARTING INTRO");

          const currentPlan = plan || INITIAL_PLAN;
          const initialContext = {
            currentTopic: currentPlan.queue[0],
            previousResult: null,
            angerLevel: 0,
            isLastTopic: false
          };

          const introResponse = await retryWithBackoff(() =>
            agentRef.current!.startInterview(resumeText, "Candidate", initialContext)
          );

          const introMsg = typeof introResponse === 'string'
            ? introResponse
            : introResponse.message;

          setIsLobbyPhase(false);
          setCurrentTopicIndex(0);

          if (onAISpeakStart) onAISpeakStart();
          addMessage(introMsg, 'ai');
          if (onAISpeakEnd) onAISpeakEnd();

        } else {
          console.log("🗣️ [LOBBY] Small Talk");
          const chatMsg = await retryWithBackoff(() =>
            agentRef.current!.generateVoiceResponse({
              currentTopic: lobbyTopic,
              nextTopic: null,
              transitionMode: 'STAY'
            }, "User is not ready yet. Just chat politely or say 'Take your time'.", historyBuffer.current)
          );

          if (onAISpeakStart) onAISpeakStart();
          addMessage(chatMsg, 'ai');
          if (onAISpeakEnd) onAISpeakEnd();
        }

        return;
      }

      // ============================================
      // REGULAR INTERVIEW LOGIC
      // ============================================
      if (!plan) return;

      const safeIndex = Math.min(currentTopicIndex, plan.queue.length - 1);
      const currentTopic = plan.queue[safeIndex];

      // Analysis Phase
      console.log("🔍 Analyzing User Intent...");
      const lastAiText = historyBuffer.current.length > 0
        ? historyBuffer.current[historyBuffer.current.length - 1].content
        : "Start of topic";

      const analysis: any = await retryWithBackoff(() =>
        agentRef.current!.evaluateUserAnswer(userText.trim(), currentTopic, lastAiText)
      );

      console.log("📊 Analysis Result:", JSON.stringify(analysis));

      // Handle Intro Topic (Index 0)
      if (currentTopicIndex === 0) {
        if (analysis.intent === 'NONSENSE') {
          console.log("🤡 [INTRO] Nonsense detected -> STAY.");
          setCurrentMetrics(analysis.metrics);
          setTopicPatience(prev => Math.min(100, prev + 50));
          setAnger(prev => Math.min(100, prev + 35));

          const speech = await retryWithBackoff(() =>
            agentRef.current!.generateVoiceResponse({
              currentTopic,
              nextTopic: null,
              transitionMode: 'STAY',
              angerLevel: anger + 10
            }, undefined, historyBuffer.current)
          );

          if (onAISpeakStart) onAISpeakStart();
          addMessage(speech, 'ai');
          if (onAISpeakEnd) onAISpeakEnd();
          return;
        }

        if (analysis.intent === 'CLARIFICATION') {
          console.log("🤔 [INTRO] Clarification requested -> STAY.");
          const speech = await retryWithBackoff(() =>
            agentRef.current!.generateVoiceResponse({
              currentTopic,
              nextTopic: null,
              transitionMode: 'STAY'
            }, undefined, historyBuffer.current)
          );

          if (onAISpeakStart) onAISpeakStart();
          addMessage(speech, 'ai');
          if (onAISpeakEnd) onAISpeakEnd();
          return;
        }

        // Valid input -> Move to next topic
        console.log("✅ [INTRO] Valid input -> MOVING NEXT.");
        setTopicSuccess(0);
        setTopicPatience(0);
        setCurrentMetrics(analysis.metrics);

        const nextIndex = 1;
        setCurrentTopicIndex(nextIndex);
        const nextTopic = plan.queue[nextIndex];

        const speech = await retryWithBackoff(() =>
          agentRef.current!.generateVoiceResponse({
            currentTopic,
            nextTopic,
            transitionMode: 'NEXT_PASS'
          }, undefined, historyBuffer.current)
        );

        if (onAISpeakStart) onAISpeakStart();
        addMessage(speech, 'ai');
        if (onAISpeakEnd) onAISpeakEnd();
        return;
      }

      // Handle Clarification (blocking)
      if (analysis.intent === 'CLARIFICATION') {
        console.log("🛑 CLARIFICATION DETECTED -> FORCE STAY");
        const speech = await retryWithBackoff(() =>
          agentRef.current!.generateVoiceResponse({
            currentTopic,
            nextTopic: null,
            transitionMode: 'STAY',
            angerLevel: anger
          }, undefined, historyBuffer.current)
        );

        if (onAISpeakStart) onAISpeakStart();
        addMessage(speech, 'ai');
        if (onAISpeakEnd) onAISpeakEnd();
        return;
      }

      setCurrentMetrics(analysis.metrics);

      // Game Logic Phase
      let transitionMode: VoiceGenerationContext['transitionMode'] = 'STAY';
      let shouldPenalizeAnger = true;
      let shouldFinishInterview = false;

      let newSuccess = topicSuccess;
      let newPatience = topicPatience;
      let newAnger = anger;

      if (analysis.intent === 'GIVE_UP') {
        console.log("🏳️ User GAVE UP.");
        newPatience = 110;
      } else if (analysis.intent === 'SHOW_ANSWER') {
        console.log("💡 User asked for ANSWER.");
        newPatience = 110;
        shouldPenalizeAnger = false;
        transitionMode = 'NEXT_EXPLAIN';
      } else if (analysis.intent === 'NONSENSE') {
        console.log("🤡 User is Trolling/Nonsense.");
        newPatience += 50;
        newAnger += 35;
        transitionMode = 'STAY';
        setCurrentMetrics({ accuracy: 0, depth: 0, structure: 0, reasoning: "Response was identified as nonsense/irrelevant." });
      } else {
        // ATTEMPT -> Normal Scoring
        const { accuracy, depth, structure } = analysis.metrics;
        const overall = (accuracy + depth + structure) / 3;

        console.log(`🔹 Overall Score: ${overall.toFixed(1)}`);

        if (overall < 5) {
          newPatience += ((10 - overall) * 7);
        } else if (overall < 7) {
          newSuccess += (overall * 7);
          newPatience += 10;
        } else {
          newSuccess += (overall * 13);
          newPatience -= (overall * 3);
        }
      }

      // Clamp values
      newSuccess = Math.min(Math.max(newSuccess, 0), 100);
      newPatience = Math.min(Math.max(newPatience, 0), 100);
      newAnger = Math.min(Math.max(newAnger, 0), 100);

      setTopicSuccess(newSuccess);
      setTopicPatience(newPatience);
      setAnger(newAnger);

      // Transition Logic
      let nextIndex = currentTopicIndex;

      // Check for termination
      if (newAnger >= 100) {
        console.log("🤬 Anger Limit Reached. Initiating Termination.");
        const terminationSpeech = await retryWithBackoff(() =>
          agentRef.current!.generateVoiceResponse({
            currentTopic,
            nextTopic: null,
            transitionMode: 'TERMINATE_ANGER',
            angerLevel: 100
          }, undefined, historyBuffer.current)
        );

        if (onAISpeakStart) onAISpeakStart();
        addMessage(terminationSpeech, 'ai');
        if (onAISpeakEnd) onAISpeakEnd();

        setInterviewComplete(true);
        return;
      } else if (newSuccess >= 100) {
        transitionMode = 'NEXT_PASS';
        nextIndex++;
        setPreviousTopicResult("PASSED_SUCCESS");
        setTopicSuccess(0);
        setTopicPatience(0);
        setAnger(prev => Math.max(0, prev - 5));
      } else if (newPatience >= 100) {
        if (transitionMode !== 'NEXT_EXPLAIN') transitionMode = 'NEXT_FAIL';
        nextIndex++;
        setPreviousTopicResult("FAILED_PATIENCE");
        setTopicSuccess(0);
        setTopicPatience(0);

        if (shouldPenalizeAnger) {
          setAnger(prev => Math.min(100, prev + 35));
        }
      }

      // Check for end of interview
      if (nextIndex >= plan.queue.length) {
        console.log("🏁 End of Interview Detected.");
        transitionMode = 'FINISH_INTERVIEW';
        shouldFinishInterview = true;
      } else {
        if (nextIndex !== currentTopicIndex) {
          console.log(`⏩ Transitioning to Topic ${nextIndex}`);
          setCurrentTopicIndex(nextIndex);

          // Trigger batch evaluation for previous topics
          if (nextIndex === plan.queue.length - 1) {
            console.log("🚀 Triggering Background Batch Eval...");
            const historySnapshot = [...historyBuffer.current];
            bulkEvalPromise.current = agentRef.current.evaluateBatch(historySnapshot);
          }
        }
      }

      // Generate voice response
      const nextTopic = transitionMode === 'FINISH_INTERVIEW'
        ? null
        : plan.queue[Math.min(nextIndex, plan.queue.length - 1)];

      const speech = await retryWithBackoff(() =>
        agentRef.current!.generateVoiceResponse({
          currentTopic,
          nextTopic,
          transitionMode,
          angerLevel: anger
        }, undefined, historyBuffer.current)
      );

      if (onAISpeakStart) onAISpeakStart();
      addMessage(speech, 'ai');
      if (onAISpeakEnd) onAISpeakEnd();

      // Handle interview completion
      if (shouldFinishInterview) {
        console.log("📊 Generating Final Report...");

        try {
          const previousResults = bulkEvalPromise.current
            ? await bulkEvalPromise.current
            : [];

          const lastInteraction: ChatMessage = {
            role: 'user',
            content: userText.trim()
          };

          const finalResult = await retryWithBackoff(() =>
            agentRef.current!.evaluateFinal(lastInteraction, previousResults)
          );

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

          console.log("✅ Final Report Ready");
          setFinalReport(report);

          // Auto-save to history
          await StorageService.saveInterview({
            id: `interview_${Date.now()}`,
            jobTitle: plan?.queue?.[0]?.category || 'Practice Interview',
            companyName: plan?.meta?.mode || 'General',
            date: Date.now(),
            averageScore: report.averageScore,
            report,
          });

          if (onInterviewComplete) {
            onInterviewComplete(report);
          }

        } catch (err) {
          console.error("Report Generation Error:", err);
        }

        setInterviewComplete(true);
      }

    } catch (error) {
      console.error("Error handling user response:", error);
      addMessage("I encountered an error processing your response. Please try again.", 'ai');
    } finally {
      setIsProcessing(false);
    }
  }, [
    isProcessing,
    isLobbyPhase,
    plan,
    currentTopicIndex,
    anger,
    topicSuccess,
    topicPatience,
    resumeText,
    addMessage,
    onAISpeakStart,
    onAISpeakEnd,
    onInterviewComplete
  ]);

  const handleSaveAndRestart = useCallback(async (
    resume: string,
    jd: string,
    mode: InterviewMode
  ) => {
    await initializeInterview(resume, jd, mode);
  }, [initializeInterview]);

  const handleForceFinish = useCallback(async () => {
    console.log("🛑 Force Finish Triggered");

    try {
      // Generate mock report for testing
      const mockQuestions: QuestionResult[] = [
        {
          id: `mock_q1_${Date.now()}`,
          topic: "React Native Performance Optimization",
          score: 8.5,
          feedback: "Excellent understanding of performance bottlenecks.",
          userAnswer: "For performance optimization, I focus on using FlatList...",
          metrics: { accuracy: 9, depth: 8, structure: 8 }
        },
        {
          id: `mock_q2_${Date.now()}`,
          topic: "State Management Patterns",
          score: 9.0,
          feedback: "Strong knowledge of Redux, Context API, and Zustand.",
          userAnswer: "I prefer Redux Toolkit for complex apps...",
          metrics: { accuracy: 9, depth: 9, structure: 9 }
        },
        {
          id: `mock_q3_${Date.now()}`,
          topic: "Native Module Development",
          score: 7.2,
          feedback: "Good foundation in bridging iOS/Android native code.",
          userAnswer: "I've built native modules using the bridge...",
          metrics: { accuracy: 7, depth: 7, structure: 8 }
        }
      ];

      const mockReport: FinalInterviewReport = {
        questions: mockQuestions,
        averageScore: 8.2,
        overallSummary: "Interview ended via force finish. You showed great potential in your responses.",
        timestamp: Date.now()
      };

      setFinalReport(mockReport);
      setInterviewComplete(true);

      if (onInterviewComplete) {
        onInterviewComplete(mockReport);
      }

    } catch (error) {
      console.error("Force Finish Error:", error);
    }
  }, [onInterviewComplete]);

  // ============================================
  // RETURN INTERFACE
  // ============================================

  return {
    // State
    messages,
    currentTopic: plan && currentTopicIndex < plan.queue.length
      ? plan.queue[currentTopicIndex]
      : null,
    metrics: {
      anger,
      topicSuccess,
    },
    isProcessing,
    interviewComplete,
    currentMetrics,
    finalReport,

    // Actions
    initializeInterview,
    handleUserResponse,
    handleSaveAndRestart,
    handleForceFinish,
  };
}