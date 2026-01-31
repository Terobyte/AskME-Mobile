import { InterviewTopic, AiResponse, InterviewContext, AnalysisResponse, VoiceGenerationContext, ChatMessage, QuestionResult, FinalInterviewReport } from "../types";
const MODEL_ID = "gemini-2.5-flash";// ⛔️ DO NOT CHANGE THIS MODEL! 
// "gemini-2.5-flash" is the ONLY stable model for this API.
// Using "1.5" or others will BREAK the app.
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

  // --- 5. DEV TOOLS: SIMULATED CANDIDATE ---
  async generateSimulatedAnswer(topic: InterviewTopic, intentType: string, resumeText: string): Promise<string> {
    // ✅ FIX BUG 2: Properly differentiate between score 0 (extremely poor but on-topic) and NONSENSE (gibberish)
    // Score 0 = Attempt but completely wrong/off-base (still trying to answer)
    // NONSENSE = Not even trying, off-topic, trolling

    let levelDescription = "";

    // Handle score-based intent levels
    if (intentType === '0' || intentType === 'poor_0') {
      levelDescription = `Score 0 (Complete Fail): 
        - Give an answer that shows you're TRYING to answer the question, but you're completely wrong.
        - Demonstrate fundamental misunderstanding of the concept.
        - Use incorrect terminology or confuse related concepts.
        - Example: If asked about React state, you might confuse it with CSS or talk about something unrelated to the question but still technical.
        - This is NOT nonsense - you're attempting to answer but failing badly.
        - Say something like "I think [wrong thing]..." or "From what I understand, [incorrect explanation]..."`;
    } else if (intentType === '1' || intentType === '2' || intentType === '3') {
      levelDescription = `Score ${intentType}/10 (Very Poor):
        - Show minimal understanding, mostly wrong.
        - Very vague, lacks any real substance.
        - May use correct buzzwords but in wrong context.`;
    } else if (intentType === '4' || intentType === '5' || intentType === '6') {
      levelDescription = `Score ${intentType}/10 (Mediocre):
        - Show basic but incomplete understanding.
        - Some correct points mixed with gaps or errors.
        - Generic textbook answer without personal insight.`;
    } else if (intentType === '7' || intentType === '8') {
      levelDescription = `Score ${intentType}/10 (Good):
        - Show solid understanding with good examples.
        - Mention relevant tools/libraries correctly.
        - Demonstrate practical experience.`;
    } else if (intentType === '9' || intentType === '10') {
      levelDescription = `Score ${intentType}/10 (Excellent):
        - Share a specific war story or deep architectural insight.
        - Mention specific libraries (MMKV, FlashList, JSI, Reanimated).
        - Explain WHY you chose X over Y. Show expertise.`;
    } else if (intentType.toUpperCase() === 'NONSENSE') {
      levelDescription = `NONSENSE/Trolling:
        - Talk about completely irrelevant things like SpongeBob, cooking, anime, or random gibberish.
        - Be funny but totally off-topic.
        - Make NO attempt to answer the actual question.
        - Example: "I live in Bikini Bottom and my favorite color is pizza."`;
    } else if (intentType.toUpperCase() === 'CLARIFICATION') {
      levelDescription = `CLARIFICATION Request:
        - Ask for the question to be rephrased or clarified.
        - Say something like "Could you rephrase that?" or "I didn't catch the nuance."`;
    } else if (intentType.toUpperCase() === 'GIVE_UP') {
      levelDescription = `GIVE_UP:
        - Say "I don't know the answer to this one. Let's move on."
        - Admit defeat politely.`;
    } else if (intentType.toUpperCase() === 'SHOW_ANSWER') {
      levelDescription = `SHOW_ANSWER Request:
        - Ask for the answer to be revealed.
        - Say "I'm stuck. Can you tell me what the best approach would be?"`;
    } else {
      // Default: treat as a generic attempt
      levelDescription = `Normal attempt - try to answer reasonably.`;
    }

    const prompt = `
      You are a candidate participating in a technical voice interview.

      **YOUR IDENTITY (Rooted in Resume):**
      ${resumeText.substring(0, 400)}
      (If the resume is empty/mock, assume the persona of "Temirlan, a Senior React Native Developer with 5 years of experience".)

      **YOUR STYLE:**
      - Pragmatic, conversational, experienced.
      - Speak from experience ("In my last project...", "Honestly...").
      - Short sentences, natural flow. NO markdown, NO bullet points.
      - NO placeholders like "[Company]". Invent a realistic company name if needed.

      **CONTEXT:**
      Question Topic: ${topic.topic}
      Question Context: ${topic.context}

      **TASK:** Generate a spoken answer at this quality level:
      ${levelDescription}

      **CONSTRAINT:** Keep it under 3-5 sentences. Be human and natural.
      Return ONLY the spoken answer (no explanations).
      `;

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9 } // High creativity for simulation
    };

    try {
      return await this.callGemini(payload);
    } catch (e) {
      return "Simulation Error: Could not generate answer.";
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
