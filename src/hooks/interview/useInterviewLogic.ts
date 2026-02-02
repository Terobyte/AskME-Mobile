import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import {
  InterviewPlan,
  InterviewTopic,
  EvaluationMetrics,
  QuestionResult,
  FinalInterviewReport,
  InterviewMode,
  ChatMessage,
  VibeConfig
} from '../../types';
import { GeminiAgentService } from '../../services/gemini-agent';
import { generateInterviewPlan } from '../../interview-planner';
import TTSService from '../../services/tts-service';
import { safeAudioModeSwitch } from './useInterviewAudio';
import { VibeCalculator } from '../../services/vibe-calculator';

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
  engagement: number;                // NEW
  currentVibe: VibeConfig | null;    // NEW
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
  setEngagement: (value: number) => void;  // NEW: For debug overlay slider

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
  const [engagement, setEngagement] = useState(50);  // NEW: starts at 50 (neutral)
  const [currentVibe, setCurrentVibe] = useState<VibeConfig | null>(null);  // NEW
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

  /**
   * Helper function to extract conversation messages for a specific topic
   * @param history Full conversation history
   * @param topic Topic name to extract messages for
   * @param topicIndex Index of the topic in the interview plan
   * @param allTopics All topics from the interview plan
   * @returns Array of conversation messages for the topic
   */
  const extractTopicMessages = useCallback((
    history: ChatMessage[],
    topic: string,
    topicIndex: number,
    allTopics: InterviewTopic[]
  ): Array<{ speaker: 'Victoria' | 'User'; text: string; timestamp: number }> => {
    console.log(`🔍 Extracting messages for topic "${topic}" (index ${topicIndex})`);
    
    if (!history || history.length === 0) {
      console.log('⚠️ Empty history, returning empty array');
      return [];
    }

    // Find the starting point: Victoria's message that introduces this topic
    let startIndex = -1;
    const topicKeywords = topic.toLowerCase().split(' ').filter(word => word.length > 3);
    
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'assistant') {
        const contentLower = msg.content.toLowerCase();
        // Check if message contains topic keywords
        const matchCount = topicKeywords.filter(keyword => contentLower.includes(keyword)).length;
        if (matchCount >= Math.min(2, topicKeywords.length)) {
          startIndex = i;
          console.log(`✓ Found topic start at index ${i}`);
          break;
        }
      }
    }

    if (startIndex === -1) {
      console.log(`⚠️ Could not find start of topic "${topic}"`);
      return [];
    }

    // Find the ending point: Victoria's message that introduces the NEXT topic
    let endIndex = history.length; // Default to end of history
    
    if (topicIndex < allTopics.length - 1) {
      const nextTopic = allTopics[topicIndex + 1];
      const nextTopicKeywords = nextTopic.topic.toLowerCase().split(' ').filter(word => word.length > 3);
      
      for (let i = startIndex + 1; i < history.length; i++) {
        const msg = history[i];
        if (msg.role === 'assistant') {
          const contentLower = msg.content.toLowerCase();
          const matchCount = nextTopicKeywords.filter(keyword => contentLower.includes(keyword)).length;
          if (matchCount >= Math.min(2, nextTopicKeywords.length)) {
            endIndex = i;
            console.log(`✓ Found topic end at index ${i} (next topic starts)`);
            break;
          }
        }
      }
    }

    // Extract messages between start and end
    const topicMessages = history.slice(startIndex, endIndex);
    console.log(`📝 Extracted ${topicMessages.length} messages for topic "${topic}"`);

    // Transform to required format
    const rawExchange = topicMessages.map(msg => ({
      speaker: (msg.role === 'assistant' ? 'Victoria' : 'User') as 'Victoria' | 'User',
      text: msg.content,
      timestamp: msg.timestamp || Date.now()
    }));

    return rawExchange;
  }, []);

  const playSynchronizedResponse = async (
    text: string,
    options?: {
      emotion?: string;
      speed?: number;
      emotionLevel?: string[];
    }
  ): Promise<void> => {
    setIsProcessing(true);

    // Notify audio hook to stop recording (prevent echo)
    onAIStart?.();

    // ⏱️ TTS TIMING: Start timing
    const ttsStart = Date.now();
    console.log(`🔊 [TTS DEBUG] Starting playback for: "${text.substring(0, 30)}..."`);
    console.log(`🔊 [TTS DEBUG] Text length: ${text.length} characters`);
    console.log(`🔊 [TTS DEBUG] Expected duration: ~${Math.ceil(text.length * 100 / 1000)}s (100ms per char)`);

    try {
      console.log("🔄 Sync: Preloading audio for:", text.substring(0, 10) + "...");

      // Force speaker mode before TTS playback
      console.log("🔊 Forcing speaker output for TTS...");
      await safeAudioModeSwitch('playback');

      // Small delay to ensure audio mode is applied
      await new Promise(resolve => setTimeout(resolve, 100));

      // Prepare audio with emotion options
      const player = await TTSService.prepareAudio(text, options);

      console.log("💥 Sync: BOOM! Playing.");

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages(prev => [...prev, { id: Date.now().toString() + '_ai', text: text, sender: 'ai' }]);

      // Append to History Buffer
      historyBuffer.current.push({ role: 'assistant', content: text });

      if (player) {
        await new Promise<void>((resolve) => {
          player.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              player.setOnPlaybackStatusUpdate(null);
              resolve();
            }
          });
          player.playAsync();
        });
      }

      // ⏱️ TTS TIMING: Log completion
      const ttsEnd = Date.now();
      const ttsDuration = ttsEnd - ttsStart;
      console.log(`🔊 [TTS DEBUG] Playback completed in ${ttsDuration}ms (${(ttsDuration / 1000).toFixed(1)}s)`);
      
      if (ttsDuration > text.length * 120) {
        console.error(`⚠️ [TTS DEBUG] ABNORMAL: TTS took ${ttsDuration}ms for ${text.length} chars`);
        console.error(`⚠️ [TTS DEBUG] Expected: ~${text.length * 100}ms (100ms per char)`);
      }

    } catch (e) {
      console.error("Sync Error:", e);
      const ttsEnd = Date.now();
      const ttsDuration = ttsEnd - ttsStart;
      console.error(`❌ [TTS DEBUG] Failed after ${ttsDuration}ms`);
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

      // ✅ STEP 1: Calculate next topic BEFORE any API calls (for context)
      let nextIndex = currentTopicIndex + 1;
      let nextTopicData: InterviewTopic | null = null;
      if (plan && nextIndex < plan.queue.length) {
        nextTopicData = plan.queue[nextIndex];
      }
      console.log(`📍 [NEXT_TOPIC] Predicted next: ${nextTopicData ? `"${nextTopicData.topic}" (Index ${nextIndex})` : "None (final)"}`);

      if (agentRef.current) {
        setIsProcessing(true);
        try {
          // --- LOBBY PHASE LOGIC ---
          if (isLobbyPhase) {
            console.log("🏨 [LOBBY] Processing lobby input...");

            // Use a dummy topic for analysis context
            const lobbyTopic: any = { topic: "Lobby Check", context: "User is in the waiting lobby." };
            const lastAiText = historyBuffer.current.length > 1
              ? historyBuffer.current.filter(msg => msg.role === 'assistant').slice(-1)[0]?.content || "Welcome to the lobby."
              : "Welcome to the lobby.";

            const currentPlan = plan || INITIAL_PLAN;

            // ⭐ UNIFIED CALL: Single API call for evaluation + voice
            console.log("🔍 [UNIFIED] Starting evaluation and voice generation...");
            console.log(`📍 [UNIFIED] Context: Lobby phase`);
            console.log(`📍 [UNIFIED] Next Topic: "${currentPlan.queue[0].topic}" (Intro)`);

            const unified = await agentRef.current.evaluateAndRespond(
              textToFinalize,
              lobbyTopic,
              lastAiText,
              {
                nextTopic: currentPlan.queue[0], // Intro topic
                angerLevel: 0, // Lobby has no anger
                engagementLevel: engagement,           // ← ADD
                vibe: currentVibe || undefined,        // ← ADD
                historyBuffer: historyBuffer.current,
                isIntro: false,
                currentTopicIndex: -1, // Before intro
                totalTopics: currentPlan.queue.length
              }
            );

            const analysis = unified.evaluation;
            const speech = unified.voiceResponse;

            console.log(`📊 [UNIFIED] Evaluation: Intent ${analysis.intent}`);
            console.log(`💬 [UNIFIED] Response: "${speech.substring(0, 60)}..."`);

            if (analysis.intent === 'READY_CONFIRM') {
              // User is ready to start
              console.log("✅ [LOBBY] User Ready -> STARTING INTRO");

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
              console.log("🗣️ [LOBBY] Small Talk - playing unified response");
              await playSynchronizedResponse(speech);
            }

            setIsProcessing(false);
            return; // EXIT LOBBY LOGIC
          }

          // --- REGULAR INTERVIEW LOGIC ---
          if (!plan) return;

          // --- SPECIAL CASE: INTRO (Index 0) ---
          if (currentTopicIndex === 0) {
            console.log("🎯 [INTRO] Special handling activated");

            const introTopic = plan.queue[0];
            const nextTopic = plan.queue[1];
            const introLastAiText = historyBuffer.current.filter(msg => msg.role === 'assistant').slice(-1)[0]?.content || "Start of intro";

            // ⭐ UNIFIED CALL: Single API call for evaluation + voice
            console.log("🔍 [UNIFIED] Starting evaluation and voice generation...");
            console.log(`📍 [UNIFIED] Current: "${introTopic.topic}" (Index 0 - Intro)`);
            console.log(`📍 [UNIFIED] Next: "${nextTopic.topic}" (Topic 1)`);

            const introUnified = await agentRef.current.evaluateAndRespond(
              textToFinalize,
              introTopic,
              introLastAiText,
              {
                nextTopic: nextTopic,
                angerLevel: 0, // Intro has no anger
                historyBuffer: historyBuffer.current,
                isIntro: true, // ← CRITICAL: Prevents "Hello" repetition
                currentTopicIndex: 0,
                totalTopics: plan.queue.length
              }
            );

            const introAnalysis = introUnified.evaluation;
            const introSpeech = introUnified.voiceResponse;

            console.log(`📊 [UNIFIED] Evaluation: Score ${introAnalysis.compositeScore.toFixed(1)}, Level: ${introAnalysis.level}, Intent: ${introAnalysis.intent}`);
            console.log(`💬 [UNIFIED] Response: "${introSpeech.substring(0, 60)}..."`);

            // EXCEPTION: Clarification on Intro should stay
            if (introAnalysis.intent === 'CLARIFICATION') {
              console.log("🤔 [INTRO] Clarification requested - staying on intro");
              console.log("🔊 [STATE SYNC] Playing voice (no state change)");
              await playSynchronizedResponse(introSpeech);
              setIsProcessing(false);
              return;
            }

            // RULE: All other responses on Intro auto-advance
            console.log("✅ [INTRO] Auto-advancing to Topic 1");

            // Apply metrics
            setCurrentMetrics(introAnalysis.metrics);

            // Handle NONSENSE - still applies anger penalty but advances
            if (introAnalysis.intent === 'NONSENSE') {
              console.log("🤡 [INTRO] Nonsense detected - advancing with anger penalty");
              setAnger(prev => Math.min(100, prev + 35));
            }

            // ✅ FIX: Play voice FIRST, then advance state
            console.log("🔊 [STATE SYNC] Playing voice BEFORE state advance");
            console.log(`📍 [STATE SYNC] Current index: 0 (locked until voice plays)`);
            
            // Use unified TTSService with emotion options
            await playSynchronizedResponse(introSpeech, {
              emotion: currentVibe?.cartesiaEmotion,
              speed: currentVibe?.speed,
              emotionLevel: currentVibe?.emotionLevel
            });

            console.log("✅ [STATE SYNC] Voice playing, now safe to advance state");
            console.log("📍 [STATE SYNC] Advancing to index 1");
            console.log(`📍 [STATE SYNC] New topic: "${plan.queue[1].topic}"`);
            console.log("✅ [STATE SYNC] UI and AI state synchronized");

            // ✅ FIX: AFTER voice plays, advance state
            setCurrentTopicIndex(1);
            setTopicSuccess(0); // Reset for new topic
            setTopicPatience(0); // Reset for new topic
            // Anger carries forward (don't reset)

            console.log(`🔄 [INTRO] Transition complete. Anger: ${anger}`);
            setIsProcessing(false);
            return; // Exit early
          }

          // --- REGULAR TOPICS (Index >= 1) ---
          const regularSafeIndex = Math.min(currentTopicIndex, plan.queue.length - 1);
          const regularCurrentTopic = plan.queue[regularSafeIndex];
          const regularLastAiText = historyBuffer.current.filter(msg => msg.role === 'assistant').slice(-1)[0]?.content || "Start of topic";

          // ⭐ UNIFIED CALL: Single API call for evaluation + voice
          console.log("🔍 [UNIFIED] Starting evaluation and voice generation...");
          console.log(`📍 [UNIFIED] Current: "${regularCurrentTopic.topic}" (Index ${currentTopicIndex})`);
          console.log(`📍 [UNIFIED] Next: ${nextTopicData ? `"${nextTopicData.topic}"` : "None (final)"}`);

          const regularUnified = await agentRef.current.evaluateAndRespond(
            textToFinalize,
            regularCurrentTopic,
            regularLastAiText,
            {
              nextTopic: nextTopicData,
              angerLevel: anger,
              engagementLevel: engagement,              // ← ADD
              vibe: currentVibe || undefined,           // ← ADD
              historyBuffer: historyBuffer.current,
              isIntro: false,
              currentTopicIndex: currentTopicIndex,
              totalTopics: plan.queue.length
            }
          );

          const analysis = regularUnified.evaluation;
          const speech = regularUnified.voiceResponse;

          console.log(`📊 [UNIFIED] Evaluation complete`);
          console.log(`   Score: ${analysis.compositeScore.toFixed(1)}`);
          console.log(`   Level: ${analysis.level}`);
          console.log(`   Intent: ${analysis.intent}`);
          console.log(`💬 [UNIFIED] Response: "${speech.substring(0, 60)}..."`);

          // ============================================
          // ENGAGEMENT & VIBE SYSTEM
          // ============================================

          console.log("📊 [EMOTIONS] Calculating engagement delta...");

          // Step 1: Calculate engagement change
          const engagementDelta = VibeCalculator.calculateEngagementDelta(
            analysis.compositeScore,
            analysis.intent
          );

          // Step 2: Update engagement (clamp 0-100)
          const oldEngagement = engagement;
          const newEngagement = Math.max(0, Math.min(100, engagement + engagementDelta));
          setEngagement(newEngagement);

          console.log(`📊 [EMOTIONS] Engagement: ${oldEngagement} → ${newEngagement} (${engagementDelta >= 0 ? '+' : ''}${engagementDelta})`);

          // Step 3: Detect absurd errors (for Amused vibe)
          const isAbsurd = VibeCalculator.detectAbsurdError(
            textToFinalize,
            analysis.issues
          );

          if (isAbsurd) {
            console.log("🤪 [VIBE] Absurd error detected (potential Amused state)");
          }

          // Step 4: Determine Victoria's emotional state
          const vibe = VibeCalculator.determineVibe(
            anger,  // Use existing anger variable
            newEngagement,
            { 
              isAbsurdError: isAbsurd,
              intent: analysis.intent 
            }
          );

          // Step 5: Update vibe state
          setCurrentVibe(vibe);

          // Step 6: Log vibe details
          console.log(`🎭 [VIBE] ${vibe.label} (${vibe.cartesiaEmotion})`);
          console.log(`🎭 [VIBE] Speed: ${vibe.speed}x`);
          if (vibe.emotionLevel && vibe.emotionLevel.length > 0) {
            console.log(`🎭 [VIBE] Emotion Levels: ${vibe.emotionLevel.join(', ')}`);
          }
          console.log(`🎭 [VIBE] Description: ${vibe.description}`);
          console.log(`🎭 [VIBE] Prompt Modifier: ${vibe.promptModifier.substring(0, 80)}...`);

          // ============================================
          // END ENGAGEMENT & VIBE SYSTEM
          // ============================================

          // --- BLOCKING CLARIFICATION CHECK ---
          if (analysis.intent === 'CLARIFICATION') {
            console.log("🤔 [CLARIFICATION] Staying on topic, no state change");
            console.log("✅ [CLARIFICATION] State preserved:");
            console.log(`   Success: ${topicSuccess} (unchanged)`);
            console.log(`   Patience: ${topicPatience} (unchanged)`);
            console.log(`   Anger: ${anger} (unchanged)`);

            // Use unified TTSService with emotion options
            await playSynchronizedResponse(speech, {
              emotion: currentVibe?.cartesiaEmotion,
              speed: currentVibe?.speed,
              emotionLevel: currentVibe?.emotionLevel
            });
            setIsProcessing(false);
            return;
          }

          setCurrentMetrics(analysis.metrics);

          // --- 2. GAME LOGIC PHASE ---
          let transitionMode: 'STAY' | 'NEXT_FAIL' | 'NEXT_PASS' | 'NEXT_EXPLAIN' | 'FINISH_INTERVIEW' | 'TERMINATE_ANGER' = 'STAY';
          let shouldFinishInterview = false;

          let newSuccess = topicSuccess;
          let newPatience = topicPatience;
          let newAnger = anger;
          let effectiveTopicIndex = currentTopicIndex;

          if (analysis.intent === 'GIVE_UP') {
            console.log("🏳️ User GAVE UP.");
            newPatience = 110;
          }
          else if (analysis.intent === 'SHOW_ANSWER') {
            console.log("💡 User asked for ANSWER.");
            newPatience = 110;
            transitionMode = 'NEXT_EXPLAIN';
          }
          else if (analysis.intent === 'NONSENSE') {
            console.log("🤡 User is Trolling/Nonsense.");

            newPatience += 50;
            newAnger += 35;

            transitionMode = 'STAY';

            setCurrentMetrics({ accuracy: 0, depth: 0, structure: 0, reasoning: "Response was identified as nonsense/irrelevant." });
          }
          else if (analysis.intent === 'STRONG_ATTEMPT' || analysis.intent === 'WEAK_ATTEMPT') {
            // ATTEMPT -> Normal Scoring using new compositeScore when available
            // Fall back to calculated overall for backward compatibility
            const { accuracy, depth, structure } = analysis.metrics;
            const calculatedOverall = (accuracy + depth + structure) / 3;

            // Use compositeScore from new evaluation system if available, else fallback
            const overall = analysis.compositeScore !== undefined ? analysis.compositeScore : calculatedOverall;

            console.log(`🔹 [MATH] Overall: ${overall.toFixed(1)} (compositeScore: ${analysis.compositeScore?.toFixed(1) || 'N/A'})`);

            // Log new evaluation fields if available
            if (analysis.level) {
              console.log(`📊 [LEVEL] Quality Level: ${analysis.level}`);
            }
            if (analysis.issues && analysis.issues.length > 0) {
              console.log(`⚠️ [ISSUES] ${analysis.issues.join(', ')}`);
            }
            if (analysis.suggestedFeedback) {
              console.log(`💬 [FEEDBACK] "${analysis.suggestedFeedback}"`);
            }

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
            } else if (overall <= 8.9) {
              // G. Good answer (adjusted threshold to match new quality levels)
              newSuccess += (overall * 13);
              newPatience -= (overall * 3);
              console.log(`📈 [SCORE] Good (${overall.toFixed(1)}) - Success +${(overall * 13).toFixed(0)}, Patience -${(overall * 3).toFixed(0)}`);
            } else {
              // H. Excellent answer (>=9) - ONLY case where anger reduces
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

            // Use unified TTSService with emotion options
            await playSynchronizedResponse(speech, {
              emotion: currentVibe?.cartesiaEmotion,
              speed: currentVibe?.speed,
              emotionLevel: currentVibe?.emotionLevel
            });

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

                // Use unified TTSService with emotion options
                await playSynchronizedResponse(speech, {
                  emotion: currentVibe?.cartesiaEmotion,
                  speed: currentVibe?.speed,
                  emotionLevel: currentVibe?.emotionLevel
                });

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
            // Trigger batch evaluation for previous topics
            if (plan && nextIndex === plan.queue.length - 1) {
              console.log("🚀 Triggering Background Batch Eval for previous topics...");
              const historySnapshot = [...historyBuffer.current];
              bulkEvalPromise.current = agentRef.current.evaluateBatch(historySnapshot);
            }
          }

          // ✅ FIX: Play voice BEFORE advancing state
          console.log("🔊 [STATE SYNC] Playing voice BEFORE state advance");
          console.log(`📍 [STATE SYNC] Current index: ${currentTopicIndex} (locked until voice plays)`);
          
          // Use unified TTSService with emotion options
          await playSynchronizedResponse(speech, {
            emotion: currentVibe?.cartesiaEmotion,
            speed: currentVibe?.speed,
            emotionLevel: currentVibe?.emotionLevel
          });

          console.log("✅ [STATE SYNC] Voice playing, now safe to advance state");

          // ✅ FIX: Advance state AFTER voice plays
          if (nextIndex !== currentTopicIndex) {
            if (!shouldFinishInterview) {
              console.log(`📍 [STATE SYNC] Advancing to index ${nextIndex}`);
              console.log(`📍 [STATE SYNC] New topic: "${plan.queue[nextIndex].topic}"`);
              setCurrentTopicIndex(nextIndex);
              console.log("✅ [STATE SYNC] UI and AI state synchronized");
            } else {
              console.log("🏁 [STATE] Interview finished, not advancing index");
              console.log(`📍 [STATE] Final index: ${currentTopicIndex} (last topic completed)`);
            }
          } else {
            console.log(`📍 [STATE SYNC] Staying on index ${currentTopicIndex}`);
            const stayTopic = plan.queue[currentTopicIndex];
            console.log(`📍 [STATE SYNC] Topic: "${stayTopic.topic}"`);
          }

          // GENERATE FINAL REPORT
          if (shouldFinishInterview) {
            console.log("📊 Generating Final Report...");
            setIsProcessing(true);

            try {
              const previousResults = bulkEvalPromise.current
                ? await bulkEvalPromise.current
                : [];

              // Enrich batch results with raw exchanges
              console.log('🔄 Enriching batch results with raw Q&A exchanges...');
              const enrichedPreviousResults = previousResults.map((result, index) => {
                const rawExchange = extractTopicMessages(
                  historyBuffer.current,
                  result.topic,
                  index,
                  plan.queue
                );
                return {
                  ...result,
                  rawExchange
                };
              });
              console.log(`✅ Enriched ${enrichedPreviousResults.length} batch results with raw exchanges`);

              const lastInteraction = { role: 'user' as const, content: textToFinalize };

              const finalResult = await agentRef.current.evaluateFinal(lastInteraction, enrichedPreviousResults);

              // Enrich final question with raw exchange
              console.log('🔄 Enriching final question with raw Q&A exchange...');
              const finalQuestionRawExchange = extractTopicMessages(
                historyBuffer.current,
                finalResult.finalQuestion.topic,
                plan.queue.length - 1, // Final question is the last topic
                plan.queue
              );
              const enrichedFinalQuestion = {
                ...finalResult.finalQuestion,
                rawExchange: finalQuestionRawExchange
              };
              console.log(`✅ Enriched final question with ${finalQuestionRawExchange.length} raw exchange messages`);

              const allResults = [...enrichedPreviousResults, enrichedFinalQuestion];
              
              // Log summary of raw exchange data
              const totalMessages = allResults.reduce((sum, result) => sum + (result.rawExchange?.length || 0), 0);
              console.log(`📊 Total raw exchange messages captured: ${totalMessages}`);
              
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
            console.log("✅ [FINISH] Interview complete. Report set.");
            setIsProcessing(false);
            return;
          }
        } catch (error) {
          console.error("Agent Error:", error);
          Alert.alert("Error", "An error occurred during the interview. Please try again.");
        } finally {
          // ⏱️ DEBUG TIMING: Log total response time with breakdown
          const endTime = Date.now();
          const duration = endTime - startTime;
          console.log(`⏱️ [TIMING] Victoria response cycle COMPLETED in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
          console.log(`   Unified call: ~5-6s (evaluation + voice generation)`);
          console.log(`   State calculation: ~0.01s (client-side)`);
          console.log(`   TTS playback: ~${Math.max(0, duration - 6000)}ms`);

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
      setEngagement(50);      // Reset to neutral
      setCurrentVibe(null);   // Clear vibe
      setIsFinished(false);
      setFinalReport(null);
      historyBuffer.current = [];
      setResumeText(resume);

      // 3. Set initial plan (Intro only)
      setPlan(INITIAL_PLAN);
      setIsPlanReady(false);
      setIsLobbyPhase(true);
      setMessages([]);

      // ✅ NEW: Start plan generation IMMEDIATELY (non-blocking)
      // This runs in background while greeting plays
      console.log("🎰 [INIT] Starting plan generation in background...");
      generateInterviewPlan(resume, jobDescription, mode)
        .then(generatedPlan => {
          console.log("✅ [PLAN] Generated:", generatedPlan.queue.length, "topics");
          setPlan(prev => {
            if (!prev) return generatedPlan;
            return {
              ...generatedPlan,
              queue: [prev.queue[0], ...generatedPlan.queue.slice(1)]
            };
          });
          setIsPlanReady(true);
        })
        .catch(err => {
          console.error("❌ [PLAN] Generation failed:", err);
          console.log("⚠️ [PLAN] Using fallback plan...");
          // Use fallback plan instead of showing error
          setPlan({
            meta: { mode, total_estimated_time: '20m' },
            queue: [
              { id: 'intro', topic: 'Introduction', type: 'Intro', estimated_time: '5m', context: 'Tell me about yourself and your background.' },
              { id: 'tech1', topic: 'Technical Experience', type: 'Match', estimated_time: '10m', context: 'Discuss your main technical skills and projects.' },
              { id: 'soft1', topic: 'Problem Solving', type: 'SoftSkill', estimated_time: '5m', context: 'How do you approach technical challenges?' }
            ]
          });
          setIsPlanReady(true);
        });

      // 4. Play immediate greeting (don't wait for plan)
      const greeting = "Hello, I'm Victoria. I'll be conducting your technical interview today. I have your details in front of me. Whenever you're ready to begin, just let me know.";
      await playSynchronizedResponse(greeting);

    } catch (error) {
      console.error("❌ [INIT] Initialization failed:", error);
      Alert.alert("Error", "Failed to initialize interview.");
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
    setEngagement(50);      // Reset to neutral
    setCurrentVibe(null);   // Clear vibe
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
      if (upperIntent === 'CLARIFICATION' || upperIntent === 'CLARIFY') {
        console.log("⚡ [SIMULATE] Special action: CLARIFICATION → generateSpecialAction('clarify')");
        return await agentRef.current.generateSpecialAction('clarify', currentTopicData);
      }
      if (upperIntent === 'SHOW_ANSWER') {
        console.log("⚡ [SIMULATE] Special action: SHOW_ANSWER → generateSpecialAction('show_answer')");
        return await agentRef.current.generateSpecialAction('show_answer', currentTopicData);
      }

      // Check for new semantic quality levels (direct usage)
      const validQualityLevels = ['excellent', 'good', 'mediocre', 'poor', 'fail'];
      const lowerIntent = intentType.toLowerCase();
      if (validQualityLevels.includes(lowerIntent)) {
        console.log(`⚡ [SIMULATE] Semantic quality level: '${lowerIntent}'`);
        return await agentRef.current.generateSimulatedAnswer(
          currentTopicData,
          lowerIntent as 'excellent' | 'good' | 'mediocre' | 'poor' | 'fail',
          resumeText
        );
      }
    }

    // Convert numeric intent to semantic quality level
    let qualityLevel: 'excellent' | 'good' | 'mediocre' | 'poor' | 'fail';

    // Parse numeric value (handles both number and string numbers)
    const numericValue = typeof intentType === 'number' ? intentType : Number(intentType);

    if (!isNaN(numericValue)) {
      // Map numeric score to semantic quality level
      if (numericValue >= 9) {
        qualityLevel = 'excellent';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'excellent' (9-10)`);
      } else if (numericValue >= 7) {
        qualityLevel = 'good';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'good' (7-8.9)`);
      } else if (numericValue >= 5) {
        qualityLevel = 'mediocre';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'mediocre' (5-6.9)`);
      } else if (numericValue >= 3) {
        qualityLevel = 'poor';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'poor' (3-4.9)`);
      } else {
        // 0, 1, 2 → 'fail' (trying but completely wrong, NOT nonsense)
        qualityLevel = 'fail';
        console.log(`⚡ [SIMULATE] Score ${numericValue} → 'fail' (0-2.9) ⚠️ Attempting but wrong, NOT nonsense`);
      }
    } else if (typeof intentType === 'string' && intentType.toLowerCase() === 'poor_0') {
      // Legacy 'poor_0' intent maps to 'fail'
      qualityLevel = 'fail';
      console.log("⚡ [SIMULATE] Legacy 'poor_0' → 'fail'");
    } else {
      // Unknown intent - default to mediocre
      qualityLevel = 'mediocre';
      console.warn(`⚠️ [SIMULATE] Unknown intentType '${intentType}', defaulting to 'mediocre'`);
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
  // VIBE RECALCULATION ON MANUAL ENGAGEMENT CHANGE
  // ============================================
  
  useEffect(() => {
    // Only recalculate if we have existing vibe data (interview is active)
    if (currentVibe && !isLobbyPhase) {
      console.log(`🔄 [VIBE] Manual engagement change detected: ${engagement}`);
      const newVibe = VibeCalculator.determineVibe(anger, engagement, {});
      setCurrentVibe(newVibe);
      console.log(`🎭 [VIBE] Updated to: ${newVibe.label} (${newVibe.cartesiaEmotion})`);
    }
  }, [engagement]); // Only trigger on engagement changes

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
    engagement,                // NEW
    currentVibe,              // NEW
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
    setEngagement,   // NEW: For debug overlay slider

    // Computed
    progress,
  };
};