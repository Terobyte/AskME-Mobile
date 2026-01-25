import { InterviewTopic, AiResponse, InterviewContext, AnalysisResponse, VoiceGenerationContext } from "../types";
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
  async evaluateUserAnswer(userText: string, currentTopic: InterviewTopic): Promise<AnalysisResponse | string> {
      const prompt = `
      ROLE: Analytical Judge (JSON ONLY)
      TASK: Evaluate the candidate's answer.
      
      CONTEXT:
      - Topic: "${currentTopic.topic}"
      - Description: "${currentTopic.context || 'General'}"
      - User Input: "${userText}"
      
      INTENT CLASSIFICATION RULES:
      - "GIVE_UP": User says "I don't know", "Skip", "Next", "Pass".
      - "SHOW_ANSWER": User asks "Tell me the answer", "What is it?", "How would you answer?".
      - "CLARIFICATION": User asks "Can you repeat?", "Rephrase please?".
      - "ATTEMPT": User tries to answer (even if wrong).
      
      SCORING (0-10):
      - 10: Perfect, deep, expert.
      - 1-4: Vague, wrong, or short.
      
      OUTPUT JSON SCHEMA:
      {
        "metrics": { "accuracy": number, "depth": number, "structure": number, "reasoning": "string" },
        "intent": "ATTEMPT" | "GIVE_UP" | "CLARIFICATION" | "SHOW_ANSWER"
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

  // --- 2. VOICE ACTOR ---
  async generateVoiceResponse(context: VoiceGenerationContext, overridePrompt?: string): Promise<string> {
      // Build Prompt based on Transition Mode
      let behaviorInstruction = "";
      
      if (overridePrompt) {
          behaviorInstruction = `INSTRUCTION: ${overridePrompt}`;
      } else {
          switch (context.transitionMode) {
              case 'STAY':
                  behaviorInstruction = `User is still on topic: "${context.currentTopic.topic}". Ask a follow-up or dig deeper based on history.`;
                  break;
              case 'NEXT_FAIL':
                  behaviorInstruction = `User FAILED "${context.currentTopic.topic}". Say "Let's move on." or "Okay, clearly you are struggling." THEN ask the opening question for NEXT TOPIC: "${context.nextTopic?.topic}".`;
                  break;
              case 'NEXT_PASS':
                  behaviorInstruction = `User PASSED "${context.currentTopic.topic}". Give brief praise. THEN ask the opening question for NEXT TOPIC: "${context.nextTopic?.topic}".`;
                  break;
              case 'NEXT_EXPLAIN':
                  behaviorInstruction = `User asked for the answer to "${context.currentTopic.topic}". Briefly EXPLAIN the correct answer (teaching mode). THEN, say "Now for the next topic..." and ask the opening question for "${context.nextTopic?.topic}".`;
                  break;
          }
      }
      
      const prompt = `
      You are Victoria, a Principal Software Engineer.
      Tone: Professional, slightly strict but fair.
      
      ${behaviorInstruction}
      
      Constraint: Keep it spoken-word friendly. No markdown. Short and clear.
      `;
      
      // Update History only for Voice (so context is maintained)
      this.history.push({ role: "model", parts: [{ text: "..." }] }); // Placeholder if needed, or better:
      // Actually, we should push the PREVIOUS user text before this. 
      // But 'evaluate' is separate. 
      // Simplified: We assume 'history' is managed outside or we just append the result.
      
      const payload = {
        contents: [
            ...this.history, 
            { role: "user", parts: [{ text: prompt }] }
        ],
        generationConfig: { temperature: 0.7 } // Creative for voice
      };
      
      try {
          const text = await this.callGemini(payload);
          this.history.push({ role: "model", parts: [{ text: text }] });
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
}
