import { InterviewTopic, AiResponse, InterviewContext, AnalysisResponse, VoiceGenerationContext, ChatMessage, QuestionResult, FinalInterviewReport } from "../types";
const MODEL_ID = "gemini-2.5-flash";// ⛔️ DO NOT CHANGE THIS MODEL! 
// "gemini-2.5-flash" is the ONLY stable model for this API.
// Using "1.5" or others will BREAK the app.

// ============================================
// DEBUG SIMULATION TYPE SYSTEM
// ============================================
// 
// WHY: The old system used numeric levels (0-10) which were:
//   - Confusing (what's the difference between a 4 and a 5?)
//   - Not aligned with actual scoring zones (getScoreColor uses >7, >=5, <5)
//   - Mixed quality levels with special actions (NONSENSE is not a score)
//
// NEW DESIGN: Separate quality levels from special actions with clear semantic names.
//   - QualityLevel: Represents actual answer quality (excellent → fail)
//   - SpecialAction: Represents non-answer behaviors (nonsense, give_up, etc.)
//
// CRITICAL DIFFERENCE:
//   - 'fail' (QualityLevel): Candidate is TRYING but getting it wrong (score 0-2)
//   - 'nonsense' (SpecialAction): Candidate is NOT trying, trolling (triggers anger)
// ============================================

/**
 * QualityLevel: Semantic representation of answer quality.
 * Maps to expected score ranges for consistent evaluation.
 * 
 * Example outputs:
 * - 'excellent': "At Coinbase, we faced severe jank on our portfolio screen. I migrated 
 *    from FlatList to FlashList, implemented MMKV for caching, and reduced TTI by 40%."
 * - 'fail': "React Native performance? I think that's related to CSS optimization, 
 *    like using flexbox properly helps the app run faster on servers."
 */
type QualityLevel = 'excellent' | 'good' | 'average' | 'poor' | 'fail';

/**
 * SpecialAction: Non-answer behaviors that don't represent quality attempts.
 * Each has specific interview flow implications.
 * 
 * - 'nonsense': Triggers anger (trolling, off-topic)
 * - 'give_up': Polite skip (no anger penalty)
 * - 'clarify': Request for rephrasing (stays on topic)
 * - 'show_answer': Request for explanation (educational)
 */
type SpecialAction = 'nonsense' | 'give_up' | 'clarify' | 'show_answer';

/**
 * LEVEL_DESCRIPTIONS: Detailed Gemini prompts for each quality level.
 * These descriptions guide the AI to generate appropriately-scored responses.
 * 
 * Each description includes:
 * - What the answer should demonstrate
 * - Specific examples of content to include/exclude
 * - Expected speaking style and format
 */
const LEVEL_DESCRIPTIONS: Record<QualityLevel, string> = {
  excellent: `Score 9-10 (Expert-Level Mastery):
    - Share a SPECIFIC war story from real production experience
    - Mention exact tools/libraries by name: MMKV, FlashList, Reanimated 2, JSI, Hermes, TurboModules
    - Explain WHY you chose approach X over Y with trade-offs considered
    - Reference specific metrics or outcomes ("reduced bundle size by 60%", "dropped TTI from 4s to 1.2s")
    - Demonstrate deep architectural understanding
    - Format: "At Coinbase, we faced [Problem]. I evaluated [Options], chose [Solution] because [Reasoning]. The result was [Metric]."
    - Sound like a confident Staff Engineer who has battle scars`,

  good: `Score 7-8 (Solid Practical Experience):
    - Show real-world experience with correct technical terminology
    - Give concrete examples from production but with less detail than expert
    - Demonstrate understanding of best practices and common patterns
    - Mention relevant tools correctly but without deep war stories
    - Format: "I've used Zustand for state management in my last two projects. It works really well for mid-size apps because the boilerplate is minimal compared to Redux."
    - Sound like a Sr. Developer who knows their craft`,

  average: `Score 5-6 (Textbook Understanding):
    - Show correct theoretical understanding without real-world depth
    - Use correct concepts but in generic, impersonal way
    - Could have been copied from documentation or a tutorial
    - No personal experience indicators ("In my project...", "We faced...")
    - Format: "Redux is a state management library that uses actions and reducers. It's commonly used for managing global state in React applications."
    - Sound like someone who studied but hasn't shipped production apps`,

  poor: `Score 3-4 (Weak/Confused Understanding):
    - Show incomplete or confused understanding
    - Use buzzwords incorrectly or out of context
    - Very vague, lacks any real substance or specifics
    - May mention correct terms but fail to explain them
    - Format: "Performance is like... about making the app fast? I think you use something like... useMemo for that..."
    - Sound hesitant and unsure, lots of filler words`,

  fail: `Score 0-2 (Fundamentally Wrong BUT ATTEMPTING):
    - CRITICALLY: This is NOT nonsense/trolling - candidate IS trying to answer
    - Demonstrate fundamental misunderstanding of the concept
    - Confuse related concepts (e.g., CSS vs state management, server vs client)
    - Use technically-sounding language but completely wrong
    - Format: "React Native performance? I think that's handled by the CSS engine. If you write good flexbox it helps the database run faster."
    - Sound earnest but completely off-base`
};

/**
 * SPECIAL_ACTIONS: Prompts for non-answer behaviors.
 * These are distinct from quality levels because they don't represent attempts to answer.
 * 
 * Key distinction:
 * - 'nonsense' triggers ANGER (interviewer frustration) because candidate isn't trying
 * - 'give_up', 'clarify', 'show_answer' don't trigger anger (professional behaviors)
 */
const SPECIAL_ACTIONS: Record<SpecialAction, string> = {
  nonsense: `NONSENSE/TROLLING (⚠️ This triggers interviewer ANGER):
    - Talk about completely irrelevant things
    - Be creative and absurd: SpongeBob, cooking recipes, anime, zodiac signs, random gibberish
    - Make ZERO attempt to address the technical question
    - Be funny but totally unhelpful
    - Example: "I live in Bikini Bottom and my favorite color is pizza. Did you know that octopuses have three hearts?"`,

  give_up: `POLITE SKIP (no anger penalty):
    - Professionally admit lack of knowledge
    - Request to move to the next question
    - Keep tone respectful and humble
    - Example: "Honestly, I'm not familiar with this topic. Could we move on to the next question?"`,

  clarify: `CLARIFICATION REQUEST (no anger, stays on topic):
    - Ask interviewer to rephrase or clarify the question
    - Show genuine confusion about what's being asked
    - Professional and engaged tone
    - Example: "Could you rephrase that? I'm not quite sure what aspect you'd like me to focus on."`,

  show_answer: `REQUEST FOR EXPLANATION (educational, no anger):
    - Admit being stuck but wanting to learn
    - Ask interviewer to explain the correct approach
    - Show intellectual curiosity despite not knowing
    - Example: "I'm stuck on this one. Could you walk me through what the best approach would be?"`
};

export class GeminiAgentService {
  private apiKey: string;
  private history: any[] = [];
  private resume: string = "";
  private role: string = "";

  private baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
  constructor() {
    // Prefer environment variable
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
    if (!this.apiKey) console.error("API Key missing! Check .env file.");
  }

  async startInterview(resume: string, role: string, initialContext: InterviewContext): Promise<AiResponse | string> {
    this.resume = resume;
    this.role = role;
    this.history = []; // Reset History

    // ✅ FIX BUG 1: Generate dynamic, contextual transition using Gemini
    // Instead of using a hardcoded prompt, we call Gemini directly
    // to create a natural, professional transition into the introduction question.

    const prompt = `
      You are Victoria, a Principal Software Engineer conducting a technical interview.
      
      CONTEXT:
      - The user just said "I'm ready" to begin the interview.
      - You have ALREADY introduced yourself in the lobby (do NOT say hello or introduce yourself again).
      - The first topic is "Introduction" - asking the candidate to introduce themselves.
      
      CANDIDATE RESUME CONTEXT (use to personalize if possible):
      ${resume.substring(0, 500)}
      
      TASK:
      Generate a natural, professional transition (1-2 sentences) that:
      1. Acknowledges their readiness briefly
      2. Asks them to tell you about themselves and their background
      3. Sounds conversational and human (not robotic)
      
      CONSTRAINT:
      - Do NOT say "Hello", "Hi", or introduce yourself.
      - Keep it under 30 words.
      - Speak naturally as Victoria would.
      
      Return ONLY the spoken response (no explanations, no quotes).
    `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    };

    try {
      const response = await this.callGemini(payload);
      console.log("✅ [START_INTERVIEW] Gemini generated intro:", response);
      return response;
    } catch (e) {
      console.error("❌ [START_INTERVIEW] Gemini call failed:", e);
      // Fallback to a simple but not hardcoded response
      return "Great, let's begin. Please start by telling me a bit about yourself and your professional background.";
    }
  }

  // --- 1. ANALYSIS JUDGE ---
  async evaluateUserAnswer(userText: string, currentTopic: InterviewTopic, lastAiQuestion: string): Promise<AnalysisResponse | string> {
    const prompt = `
      ROLE: Analytical Judge (JSON ONLY)
      TASK: Evaluate the candidate's answer.
      
      CONTEXT:
      - Topic: "${currentTopic.topic}"
      - Description: "${currentTopic.context || 'General'}"
      - ACTUAL QUESTION ASKED TO CANDIDATE: "${lastAiQuestion}"
      - User Input: "${userText}"
      
      ===== INTENT CLASSIFICATION RULES =====
      - "GIVE_UP": User says "I don't know", "Skip", "Next", "Pass".
      - "SHOW_ANSWER": User asks "Tell me the answer", "What is it?", "How would you answer?".
      - "CLARIFICATION": User asks "Can you repeat?", "Rephrase please?", "What do you mean?", "I don't understand the question".
      - "READY_CONFIRM": User says "I'm ready", "Let's start", "Go ahead", "I am prepared".
      - "NONSENSE": The user is trolling, speaking gibberish, repeating words mindlessly (e.g., "blah blah", "yes yes yes"), or referencing pop culture/irrelevant topics (e.g., "I live in Bikini Bottom") that have nothing to do with the interview.
        ⚠️ CRITICAL: NONSENSE is the ONLY intent that triggers anger increase!
      - "ATTEMPT": User tries to answer (even if wrong or poor quality).

      ===== CLARIFICATION SPECIAL HANDLING =====
      If intent = "CLARIFICATION":
        - This means user is asking for help understanding
        - Metrics should be: { "accuracy": 0, "depth": 0, "structure": 0, "reasoning": "User requested clarification" }
        - This does NOT count as a bad answer
        - System will STAY on current topic and rephrase question

      ===== TASK =====
      Evaluate the answer based on the ACTUAL QUESTION ASKED.
      If the question was a follow-up (e.g., about specific metrics), grade based on that, not the generic topic.
      
      ===== SCORING (0-10) =====
      - 10: Perfect, deep, expert.
      - 7-9: Good understanding, correct approach.
      - 5-6: Basic understanding, some gaps.
      - 1-4: Vague, wrong, or short.
      - 0: Complete failure or nonsense.
      
      ===== OUTPUT JSON SCHEMA =====
      {
        "metrics": { "accuracy": number, "depth": number, "structure": number, "reasoning": "string" },
        "intent": "ATTEMPT" | "GIVE_UP" | "CLARIFICATION" | "SHOW_ANSWER" | "READY_CONFIRM" | "NONSENSE"
      }
      `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1, // Strict logic
        responseMimeType: "application/json"
      }
    };

    try {
      const raw = await this.callGemini(payload);
      const clean = this.cleanJson(raw);
      return JSON.parse(clean) as AnalysisResponse;
    } catch (e) {
      console.error("Analysis Error:", e);
      // Fallback
      return {
        metrics: { accuracy: 0, depth: 0, structure: 0, reasoning: "Error" },
        intent: "ATTEMPT"
      };
    }
  }

  // --- 3. BATCH EVALUATOR (N-1 Questions) ---
  async evaluateBatch(history: ChatMessage[]): Promise<QuestionResult[]> {
    const prompt = `
      ROLE: Technical Evaluator (JSON ONLY)
      TASK: Analyze these User Answers from a technical interview.
      
      HISTORY TO ANALYZE:
      ${JSON.stringify(history)}
      
      INSTRUCTION:
      - Identify each Q&A pair.
      - Ignore "System" or "Intro" messages if they don't have a clear Q&A.
      - For each valid Q&A pair, assign a score (0-10), brief feedback, and metrics.
      - Return a valid JSON array. Do NOT output trailing commas.
      
      OUTPUT JSON SCHEMA:
      [
        { 
          "topic": "string", 
          "userAnswer": "string", 
          "score": number, 
          "feedback": "string",
          "metrics": { "accuracy": number, "depth": number, "structure": number, "reasoning": "string" }
        },
        ...
      ]
      `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    };

    try {
      const raw = await this.callGemini(payload);
      const clean = this.cleanJsonArray(raw); // Use specialized cleaner for Arrays
      return JSON.parse(clean) as QuestionResult[];
    } catch (e) {
      console.error("Batch Eval Error:", e);
      return [];
    }
  }

  // --- 4. FINAL EVALUATOR (Last Question + Summary) ---
  async evaluateFinal(lastHistoryItem: ChatMessage, previousResults: QuestionResult[]): Promise<{ finalQuestion: QuestionResult, overallSummary: string }> {
    const prompt = `
      ROLE: Lead Interviewer (JSON ONLY)
      TASK: Evaluate the FINAL answer and generate an Overall Summary.
      
      CONTEXT - PREVIOUS RESULTS:
      ${JSON.stringify(previousResults)}
      
      FINAL INTERACTION:
      ${JSON.stringify(lastHistoryItem)}
      
      INSTRUCTION:
      1. Evaluate the final interaction (Score 0-10 + Feedback + Metrics).
      2. Review ALL results (Previous + Final) to generate a "comprehensive_summary" of the candidate's performance.
      
      OUTPUT JSON SCHEMA:
      {
        "finalQuestion": { 
          "topic": "Final Topic", 
          "userAnswer": "string", 
          "score": number, 
          "feedback": "string",
          "metrics": { "accuracy": number, "depth": number, "structure": number, "reasoning": "string" }
        },
        "overallSummary": "string (3-4 sentences summarizing strengths/weaknesses)"
      }
      `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    };

    try {
      const raw = await this.callGemini(payload);
      const clean = this.cleanJson(raw);
      return JSON.parse(clean);
    } catch (e) {
      console.error("Final Eval Error:", e);
      return {
        finalQuestion: {
          topic: "Final",
          userAnswer: "",
          score: 0,
          feedback: "Error",
          metrics: { accuracy: 0, depth: 0, structure: 0, reasoning: "Error" }
        },
        overallSummary: "Failed to generate summary."
      };
    }
  }

  // ============================================
  // 5. DEV TOOLS: SIMULATED CANDIDATE (REFACTORED)
  // ============================================
  // 
  // This section provides tools for testing the interview logic by
  // generating simulated candidate responses at various quality levels.
  //
  // KEY CHANGES FROM OLD SYSTEM:
  // - Old: Used numeric strings ('0' to '10') + special intents ('NONSENSE', etc.)
  // - New: Semantic QualityLevel type + separate SpecialAction type
  //
  // BENEFITS:
  // 1. Type-safe: TypeScript prevents invalid levels like 'medium' or '11'
  // 2. Clear scoring alignment: Each level maps to a clear score range
  // 3. Separation of concerns: Quality attempts vs non-answer actions
  // ============================================

  /**
   * Helper function to get expected score range for a quality level.
   * Useful for logging, debugging, and validating AI scoring accuracy.
   * 
   * @param level - The QualityLevel to get score range for
   * @returns Object with min, max, and average expected scores
   */
  private getScoreRange(level: QualityLevel): { min: number; max: number; avg: number } {
    const ranges: Record<QualityLevel, { min: number; max: number; avg: number }> = {
      excellent: { min: 9, max: 10, avg: 9.5 },
      good: { min: 7, max: 8, avg: 7.5 },
      average: { min: 5, max: 6, avg: 5.5 },
      poor: { min: 3, max: 4, avg: 3.5 },
      fail: { min: 0, max: 2, avg: 1.0 },
    };
    return ranges[level];
  }

  /**
   * Generates a simulated candidate answer at a specific quality level.
   * 
   * USAGE:
   * ```typescript
   * // Generate an expert-level answer
   * const answer = await agent.generateSimulatedAnswer(topic, 'excellent', resume);
   * 
   * // Generate a failing-but-trying answer
   * const badAnswer = await agent.generateSimulatedAnswer(topic, 'fail', resume);
   * ```
   * 
   * @param topic - The current interview topic/question
   * @param level - The quality level: 'excellent' | 'good' | 'average' | 'poor' | 'fail'
   * @param resumeText - Candidate's resume for context personalization
   * @returns Generated spoken answer text
   */
  async generateSimulatedAnswer(
    topic: InterviewTopic,
    level: QualityLevel,
    resumeText: string
  ): Promise<string> {
    // Get the level description from our constants
    const levelDescription = LEVEL_DESCRIPTIONS[level];
    const scoreRange = this.getScoreRange(level);

    console.log(`⚡ [SIMULATE] Level: ${level} (expected score: ${scoreRange.min}-${scoreRange.max}, avg: ${scoreRange.avg})`);

    const prompt = `
      You are a candidate participating in a technical voice interview.

      **YOUR IDENTITY (Rooted in Resume):**
      ${resumeText.substring(0, 400)}
      (If the resume is empty/mock, assume the persona of "Temirlan, a Senior React Native Developer with 5 years of experience".)

      **YOUR STYLE:**
      - Pragmatic, conversational, experienced developer personality
      - Speak from experience ("In my last project...", "Honestly...", "From my experience...")
      - Short sentences, natural flow. NO markdown, NO bullet points
      - NO placeholders like "[Company]". Always invent realistic specifics:
        ❌ Bad: "At [Company], I used [Tool]"
        ✅ Good: "At Stripe, I implemented Reanimated 2 for the payment flow animations"

      **QUESTION CONTEXT:**
      Topic: ${topic.topic}
      Context: ${topic.context || 'General technical question'}

      **TASK:** Generate a spoken answer at this quality level:
      ${levelDescription}

      **CONSTRAINTS:**
      - Keep it 3-5 sentences maximum
      - Natural spoken conversation (as if in a video call)
      - Use "I" statements ("In my last role...", "I've found that...")
      - Sound human, not robotic

      Return ONLY the spoken answer (no explanations, no quotes, no meta-commentary).
    `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9 } // High creativity for varied responses
    };

    try {
      const response = await this.callGemini(payload);
      console.log(`✅ [SIMULATE] Generated ${level} answer:`, response.substring(0, 100) + '...');
      return response;
    } catch (e) {
      console.error(`❌ [SIMULATE] Failed to generate ${level} answer:`, e);
      return "Simulation Error: Could not generate answer.";
    }
  }

  /**
   * Generates a simulated special action (non-answer behavior).
   * 
   * Use this for behaviors that aren't quality-based attempts:
   * - 'nonsense': Trolling/off-topic (triggers anger)
   * - 'give_up': Polite skip (no anger)
   * - 'clarify': Ask for rephrasing (stays on topic)
   * - 'show_answer': Request explanation (educational)
   * 
   * USAGE:
   * ```typescript
   * // Generate trolling response that will trigger anger
   * const troll = await agent.generateSpecialAction('nonsense', topic);
   * 
   * // Generate polite give-up
   * const skip = await agent.generateSpecialAction('give_up');
   * ```
   * 
   * @param action - The special action type
   * @param currentTopic - Optional topic context for more relevant responses
   * @returns Generated spoken phrase (1-2 sentences)
   */
  async generateSpecialAction(
    action: SpecialAction,
    currentTopic?: InterviewTopic
  ): Promise<string> {
    const actionDescription = SPECIAL_ACTIONS[action];

    console.log(`⚡ [SPECIAL_ACTION] Type: ${action} (${action === 'nonsense' ? '⚠️ TRIGGERS ANGER' : 'no anger'})`);

    const prompt = `
      You are a candidate in a technical interview.

      ${currentTopic ? `CURRENT TOPIC: ${currentTopic.topic}` : 'CONTEXT: General interview question'}

      **TASK:** ${actionDescription}

      **CONSTRAINTS:**
      - 1-2 sentences maximum
      - Natural spoken language (no markdown, no bullets)
      - Stay in character as an interview candidate
      - Sound natural and human

      Return ONLY the spoken phrase.
    `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8 } // Slightly creative but consistent
    };

    try {
      const response = await this.callGemini(payload);
      console.log(`✅ [SPECIAL_ACTION] Generated ${action}:`, response);
      return response;
    } catch (e) {
      console.error(`❌ [SPECIAL_ACTION] Failed to generate ${action}:`, e);

      // Return sensible fallbacks for each action type
      const fallbacks: Record<SpecialAction, string> = {
        nonsense: "I live in Bikini Bottom and my favorite color is pizza.",
        give_up: "I'm not sure about this one. Can we move on?",
        clarify: "Could you rephrase that question?",
        show_answer: "I'm stuck. Could you explain the approach?"
      };
      return fallbacks[action];
    }
  }

  // --- 2. VOICE ACTOR ---
  async generateVoiceResponse(context: VoiceGenerationContext, overridePrompt?: string, history?: ChatMessage[]): Promise<string> {
    // Build Prompt based on Transition Mode
    let behaviorInstruction = "";

    // Inject "No Greeting" Constraint for Intro Topic
    let greetingConstraint = "";
    if (context.currentTopic?.id === 'intro' || context.currentTopic?.type === 'Intro') {
      greetingConstraint = `
          CONTEXT: You have ALREADY introduced yourself in the lobby. The user just said "Ready".
          CONSTRAINT: Do NOT say "Hello", "Hi", or state your name again. Simply acknowledge the user's readiness and ask them to introduce themselves.
          `;
    }

    // Question Logic Injection
    let questionLogic = "";
    if (context.nextTopic) {
      if (context.nextTopic.type === 'SoftSkill') {
        questionLogic = `
               NEXT QUESTION STRATEGY (Soft Skill: "${context.nextTopic.topic}"):
               - Constraint: Do NOT ask generic definition questions (e.g., "What is flexibility?").
               - Instruction: Generate a Situational Question specifically related to the Candidate's Role.
               - Example: "As a Senior Engineer, how do you handle disagreements about code quality?"
               `;
      } else {
        questionLogic = `
               NEXT QUESTION STRATEGY (Technical: "${context.nextTopic.topic}"):
               - Instruction: Randomly choose (50/50) between:
                 A) Scenario: "Imagine you face [Problem] in [Topic]. How do you solve it?"
                 B) Experience: "Tell me about a time you used [Topic] in a complex project."
               `;
      }
    }

    if (overridePrompt) {
      behaviorInstruction = `INSTRUCTION: ${overridePrompt}`;
    } else {
      switch (context.transitionMode) {
        case 'STAY':
          behaviorInstruction = `User is still on topic: "${context.currentTopic.topic}". Ask a follow-up or dig deeper based on history.`;
          break;
        case 'NEXT_FAIL':
          behaviorInstruction = `Adopt a strict, professional tone. Briefly acknowledge the answer was incorrect/missing. Do NOT lecture. Immediately transition to NEXT TOPIC: "${context.nextTopic?.topic}". ${questionLogic}`;
          break;
        case 'NEXT_PASS':
          behaviorInstruction = `Adopt a neutral or slightly approving tone. Transition smoothly to NEXT TOPIC: "${context.nextTopic?.topic}". ${questionLogic}`;
          break;
        case 'NEXT_EXPLAIN':
          behaviorInstruction = `Briefly explain the core concept the user missed (Teach them). Then transition to NEXT TOPIC: "${context.nextTopic?.topic}". ${questionLogic}`;
          break;
        case 'FINISH_INTERVIEW':
          const mood = (context.angerLevel || 0) > 50 ? "cold and brief" : "warm and encouraging";
          behaviorInstruction = `The interview is over. You are ${mood}. Briefly thank the candidate. Give a very short, 1-sentence overall feedback based on the final Anger level (${context.angerLevel}). Say goodbye.`;
          break;
        case 'TERMINATE_ANGER':
          behaviorInstruction = `You are furious. The candidate has wasted your time with poor answers. Harshly terminate the interview immediately. Say something like "That's enough. We are done here." and hang up.`;
          break;
      }
    }

    const prompt = `
      You are Victoria, a Principal Software Engineer.
      Tone: Professional, slightly strict but fair.
      
      ${greetingConstraint}
      ${behaviorInstruction}
      
      Constraint: Speak naturally as Victoria. Do not repeat robotic phrases. Keep it spoken-word friendly. No markdown. Short and clear.
      `;

    // Convert history to Gemini format
    const historyParts = (history || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const payload = {
      contents: [
        ...historyParts,
        { role: "user", parts: [{ text: prompt }] }
      ],
      generationConfig: { temperature: 0.7 } // Creative for voice
    };

    try {
      const text = await this.callGemini(payload);
      return text;
    } catch (e) {
      return "I'm having trouble speaking right now. Let's move on.";
    }
  }

  private async callGemini(payload: any): Promise<string> {
    const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private cleanJson(text: string): string {
    // 1. Remove Markdown Code Blocks (```json ... ```)
    let cleaned = text.replace(/```json/g, "").replace(/```/g, "");

    // 2. Trim whitespace
    cleaned = cleaned.trim();

    // 3. (Optional) Remove any text before the first '{' or after the last '}'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      // Ensure we are slicing correctly even if there is trailing garbage
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return cleaned;
  }

  private cleanJsonArray(text: string): string {
    // 1. Remove Markdown Code Blocks
    let cleaned = text.replace(/```json/g, "").replace(/```/g, "");

    // 2. Trim whitespace
    cleaned = cleaned.trim();

    // 3. Find Array bounds (robustness)
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }

    return cleaned;
  }
}
