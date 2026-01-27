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

    // Send First Trigger (Uses Voice Generation logic for Intro)
    const introContext: VoiceGenerationContext = {
        currentTopic: initialContext.currentTopic,
        nextTopic: null,
        transitionMode: 'STAY' // Normal flow for intro
    };
    
    // Hack: We simulate the "Intro" prompt as a voice generation task
    return await this.generateVoiceResponse(introContext, "Start the interview. Introduce yourself as AskME and ask me to introduce myself.");
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
      
      INTENT CLASSIFICATION RULES:
      - "GIVE_UP": User says "I don't know", "Skip", "Next", "Pass".
      - "SHOW_ANSWER": User asks "Tell me the answer", "What is it?", "How would you answer?".
      - "CLARIFICATION": User asks "Can you repeat?", "Rephrase please?".
      - "READY_CONFIRM": User says "I'm ready", "Let's start", "Go ahead", "I am prepared".
      - "NONSENSE": The user is trolling, speaking gibberish, repeating words mindlessly (e.g., "blah blah", "yes yes yes"), or referencing pop culture/irrelevant topics (e.g., "I live in Bikini Bottom") that have nothing to do with the interview.
      - "ATTEMPT": User tries to answer (even if wrong).

      TASK:
      Evaluate the answer based on the ACTUAL QUESTION ASKED.
      If the question was a follow-up (e.g., about specific metrics), grade based on that, not the generic topic.
      
      SCORING (0-10):
      - 10: Perfect, deep, expert.
      - 1-4: Vague, wrong, or short.
      
      OUTPUT JSON SCHEMA:
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
      - For each valid Q&A pair, assign a score (0-10) and brief feedback.
      - Return a valid JSON array. Do NOT output trailing commas.
      
      OUTPUT JSON SCHEMA:
      [
        { "topic": "string", "userAnswer": "string", "score": number, "feedback": "string" },
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
      1. Evaluate the final interaction (Score 0-10 + Feedback).
      2. Review ALL results (Previous + Final) to generate a "comprehensive_summary" of the candidate's performance.
      
      OUTPUT JSON SCHEMA:
      {
        "finalQuestion": { "topic": "Final Topic", "userAnswer": "string", "score": number, "feedback": "string" },
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
              finalQuestion: { topic: "Final", userAnswer: "", score: 0, feedback: "Error" },
              overallSummary: "Failed to generate summary."
          };
      }
  }

  // --- 5. DEV TOOLS: SIMULATED CANDIDATE ---
  async generateSimulatedAnswer(topic: InterviewTopic, intentType: string, resumeText: string): Promise<string> {
      const prompt = `
      You are a candidate participating in a technical voice interview.

      **YOUR IDENTITY (Rooted in Resume):**
      ${resumeText}
      (Instruction: Extract the Name, Role, and Key Skills from the text above. Act as this person. If the resume is empty/mock, assume the persona of "Temirlan, a Senior React Native Developer with 5 years of experience".)

      **YOUR STYLE (Battle-Tested):**
      - Pragmatic, conversational, experienced.
      - Speak from experience ("In my last project...", "Honestly...").
      - Short sentences, natural flow. NO markdown, NO bullet points.
      - NO placeholders like "[Company]". Invent a realistic company name if needed.

      **CONTEXT:**
      Question: ${topic.topic}
      Context: ${topic.context}

      **TASK:** Generate a spoken answer based on the requested **Score Level** ('${intentType}'):

      * **10 (Expert):** Share a specific 'war story' or deep architectural insight. Mention specific libraries (e.g., MMKV vs AsyncStorage, FlashList vs FlatList, JSI, Reanimated). Explain *why* you chose X over Y. Show, don't just tell.
      * **8 (Strong):** Solid, correct technical answer with standard best practices. Good, but lacks a unique personal anecdote.
      * **5 (Average):** Use correct buzzwords but vaguely. Say "I would optimize performance" without saying *how*. Sound like a mid-level dev who knows the theory but not the internals.
      * **3 (Weak):** Focus on the wrong thing or suggest an outdated approach (e.g., "I just use console.log for debugging everything").
      * **0 (Fail):** "I honestly have no idea about that specific API."
      * **NONSENSE:** Talk about completely irrelevant things like your favorite anime, cooking recipes, or SpongeBob. Be funny but totally off-topic.
      * **CLARIFICATION:** "Wait, could you rephrase that? I didn't catch the nuance."
      * **GIVE_UP:** "I don't know the answer to this one. Let's move on."
      * **SHOW_ANSWER:** "I'm stuck. Can you tell me what the best approach would be?"

      **CONSTRAINT:** Keep it under 3-5 sentences. Be human.
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
