import { InterviewTopic } from "../types";

const MODEL_ID = "gemini-2.5-flash";// ⛔️ DO NOT CHANGE THIS MODEL! 
// "gemini-2.5-flash" is the ONLY stable model for this API.
// Using "1.5" or others will BREAK the app.

// Constants for state-aware prompting
const MAX_RESUME_LENGTH = 1500; // Truncate resume to fit within token limits while preserving key information

// Types for Gemini API payload and responses
interface GeminiPayload {
  contents: any[];
  systemInstruction: { parts: { text: string }[] };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
  };
}

export interface EvaluationMetrics {
  accuracy: number;
  depth: number;
  structure: number;
  overall: number;
  reasoning: string;
}

export interface GeminiInterviewResponse {
  evaluation: EvaluationMetrics;
  state: {
    success: number;
    patience: number;
    anger: number;
  };
  decision: 'STAY' | 'NEXT_SUCCESS' | 'NEXT_FAIL' | 'NEXT_EXPLAIN' | 'TERMINATE';
  nextTopic: string | null;
  text: string;
  intent: 'ATTEMPT' | 'GIVE_UP' | 'SHOW_ANSWER' | 'CLARIFICATION' | 'NONSENSE';
}

export class GeminiAgentService {
  private apiKey: string;
  private history: any[] = [];
  private systemInstruction: string = "";
  private agenda: InterviewTopic[] = []; // Store agenda in class
  private currentTopicIndex: number = 0; // Track progress
  private resume: string = ""; // Store resume for state-aware prompts
  private baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
  constructor() {
    // Prefer environment variable
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || ""; 
    if (!this.apiKey) console.error("API Key missing! Check .env file.");
  }

  async startInterview(agenda: InterviewTopic[], resume: string, role: string) {
    this.agenda = agenda;
    this.resume = resume; // Store for later use in state-aware calls
    this.currentTopicIndex = 0; // Reset index

    // 1. Build System Context with RAW JSON
    this.systemInstruction = `You are AskME, a professional AI Interviewer.
    
    CONTEXT DATA:
    - Candidate Resume: "${resume.substring(0, MAX_RESUME_LENGTH)}..."
    - Interview Agenda (JSON): ${JSON.stringify(agenda)}
    
    PROTOCOL:
    1. ANALYZE HISTORY: Look at the conversation history to see which topics from the Agenda have already been covered.
    2. TRACK PROGRESS: Move strictly sequentially through the Agenda JSON list.
    3. NEXT TOPIC: Select the first topic that has NOT been discussed yet.
    4. INTERACTION:
       - Evaluate the previous answer (1 sentence feedback).
       - Ask a deep technical question about the Current Topic.
    5. STYLE: Warm, professional, concise. NO placeholders like "[Your Name]".`;

    // 2. Reset History
    this.history = [];

    // 3. Send First Trigger
    return await this.sendUserResponse("Start the interview. Introduce yourself as AskME and ask me to introduce myself.");
  }

  // Simple version for lobby/intro (legacy compatibility)
  async sendUserResponse(userText: string): Promise<string | null>;
  // State-aware version for interview phase
  async sendUserResponse(
    userText: string,
    currentState: { success: number; patience: number; anger: number },
    currentTopic: string,
    topicIndex: number,
    totalTopics: number
  ): Promise<string>;
  
  async sendUserResponse(
    userText: string,
    currentState?: { success: number; patience: number; anger: number },
    currentTopic?: string,
    topicIndex?: number,
    totalTopics?: number
  ): Promise<string | null> {
    if (!userText) return null;

    // Determine if this is a state-aware call (interview phase)
    const isStateAware = currentState !== undefined && currentTopic !== undefined;

    // Add User Message to History
    this.history.push({ role: "user", parts: [{ text: userText }] });

    let systemPrompt = this.systemInstruction;
    let maxTokens = 250;
    let responseFormat: string | undefined = undefined;

    // Build state-aware prompt if we're in interview phase
    if (isStateAware && currentState && currentTopic !== undefined && topicIndex !== undefined && totalTopics !== undefined) {
      maxTokens = 800;
      responseFormat = "application/json";
      
      const nextTopicIndex = topicIndex + 1;
      const nextTopic = nextTopicIndex < this.agenda.length ? this.agenda[nextTopicIndex].topic : null;
      
      systemPrompt = `You are Victoria, a strict but fair technical interviewer conducting a live voice interview.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 CONTEXT (Dynamic)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Candidate Resume: "${this.resume.substring(0, MAX_RESUME_LENGTH)}..."

Interview Agenda: ${JSON.stringify(this.agenda)}

Current Topic: ${currentTopic}
Topic Index: ${topicIndex + 1} / ${totalTopics}

Current State:
  - Success: ${currentState.success}/100
  - Patience: ${currentState.patience}/100
  - Anger: ${currentState.anger}/100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 YOUR MISSION (Single Response)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return a JSON object containing:
1. Evaluation of answer (accuracy, depth, structure)
2. New state values after applying formulas
3. Transition decision
4. Spoken response text

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STEP 1: EVALUATE ANSWER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rate on three dimensions (0-10):
- Accuracy: Correctness of technical facts
- Depth: Level of detail and understanding
- Structure: Clarity and organization

Overall = (Accuracy + Depth + Structure) / 3

Intent Detection:
- Nonsense/trolling → "NONSENSE", Overall = 0
- "I don't know"/"Skip"/"Give up" → "GIVE_UP"
- "What's the answer?"/"Explain" → "SHOW_ANSWER"
- Asks clarification → "CLARIFICATION"
- Otherwise → "ATTEMPT"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧮 STEP 2: CALCULATE NEW STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start with:
  newSuccess = ${currentState.success}
  newPatience = ${currentState.patience}
  newAnger = ${currentState.anger}

Apply formulas:

A. If intent = "GIVE_UP":
   newPatience = 110

B. If intent = "SHOW_ANSWER":
   newPatience = 110

C. If intent = "CLARIFICATION":
   No state changes

D. If intent = "NONSENSE" OR Overall = 0:
   newPatience += 50
   newAnger += 35

E. If intent = "ATTEMPT" and Overall < 5:
   newPatience += ((10 - Overall) × 7)

F. If intent = "ATTEMPT" and Overall >= 5 and Overall < 7:
   newSuccess += (Overall × 7)
   newPatience += 10

G. If intent = "ATTEMPT" and Overall >= 7 and Overall <= 8:
   newSuccess += (Overall × 13)
   newPatience -= (Overall × 3)

H. If intent = "ATTEMPT" and Overall > 8:
   newSuccess += (Overall × 13)
   newPatience -= (Overall × 3)
   newAnger -= 5

Clamp all values to 0-100:
  newSuccess = max(0, min(100, newSuccess))
  newPatience = max(0, min(100, newPatience))
  newAnger = max(0, min(100, newAnger))

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ STEP 3: DECIDE TRANSITION (Priority Order - CRITICAL!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ⛔ IMMEDIATE TERMINATION (Highest Priority)
   If newAnger >= 100:
     decision = "TERMINATE"
     nextTopic = null
     text = "That's it. This interview is over. Your performance was completely unacceptable."

2. ✅ SUCCESS TRANSITION
   Else if newSuccess >= 100:
     decision = "NEXT_SUCCESS"
     nextTopic = "${nextTopic || 'end'}"
     Reset: newSuccess = 0, newPatience = 0
     newAnger -= 5 (bonus)
     text = "Excellent work on ${currentTopic}. You clearly understand [brief praise]. Now let's discuss ${nextTopic || 'wrapping up'}."

3. 😤 PATIENCE LIMIT (WITH PRE-FLIGHT CHECK!)
   Else if newPatience >= 100:
   
     A. If intent = "SHOW_ANSWER":
        decision = "NEXT_EXPLAIN"
        nextTopic = "${nextTopic || 'end'}"
        Reset: newSuccess = 0, newPatience = 0
        Don't add anger (mercy rule)
        text = "Alright, here's the answer: [brief 1-sentence]. Let's move to ${nextTopic || 'the next topic'}."
     
     B. Else (regular fail):
        ⚠️ PRE-FLIGHT CHECK:
        tempAnger = newAnger + 35
        
        If tempAnger >= 100:
          ⚠️ ABORT TRANSITION!
          decision = "TERMINATE"
          nextTopic = null
          newAnger = 100
          text = "I've completely lost my patience with these vague answers. This interview is over."
        
        Else:
          decision = "NEXT_FAIL"
          nextTopic = "${nextTopic || 'end'}"
          newAnger += 35
          Reset: newSuccess = 0, newPatience = 0
          text = "Let's move on to ${nextTopic || 'the next topic'}. I hope you're better prepared." (disappointed tone)

4. 🔄 STAY ON CURRENT TOPIC
   Else:
     decision = "STAY"
     nextTopic = null
     
     Adjust tone based on anger:
     - If newAnger >= 90: "This is your last chance. [question]"
     - Else if newAnger >= 80: "I'm running out of patience. [question]"
     - Else if newAnger >= 60: "Okay, but [follow-up question]"
     - Else: "[neutral follow-up]"

5. 🤔 CLARIFICATION
   If intent = "CLARIFICATION":
     decision = "STAY"
     nextTopic = null
     No state changes
     text = "Let me rephrase. [clarify question]"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 VOICE RESPONSE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Maximum 2-3 sentences (voice interview)
- Match emotional tone to anger level
- Use actual topic names from agenda (no placeholders)
- Natural conversational language

Tone by Anger Level:
- 0-30: Professional, warm, encouraging
- 30-60: Neutral, slightly skeptical
- 60-80: Impatient, sarcastic
- 80-90: Harsh, dismissive
- 90-100: Final warning / termination

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 OUTPUT FORMAT (Strict JSON - No Markdown!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "evaluation": {
    "accuracy": 7,
    "depth": 6,
    "structure": 8,
    "overall": 7.0,
    "reasoning": "Good foundation but missed edge cases"
  },
  "state": {
    "success": 45,
    "patience": 25,
    "anger": 10
  },
  "decision": "STAY",
  "nextTopic": null,
  "text": "That's decent. Now explain how you'd handle race conditions.",
  "intent": "ATTEMPT"
}

⚠️ CRITICAL RULES:
1. ALWAYS return valid JSON (no markdown blocks)
2. ALWAYS apply formulas exactly as specified
3. ALWAYS check termination in priority order
4. ALWAYS perform pre-flight anger check before NEXT_FAIL
5. ALWAYS clamp state values to 0-100
6. ALWAYS keep text under 3 sentences
7. NEVER use placeholders - use actual names
8. ALWAYS match tone to anger level

Now analyze the user's response and return JSON.`;
    }

    // Construct Payload
    const payload: GeminiPayload = {
      contents: this.history,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxTokens,
      }
    };

    // Add JSON format requirement for state-aware calls
    if (responseFormat) {
      payload.generationConfig.responseMimeType = responseFormat;
    }

    const MAX_RETRIES = 3;
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
        try {
            console.log(`DEBUG: Sending Fetch Request to Gemini (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
            
            // Log payload only on first attempt to avoid clutter
            if (retryCount === 0) {
                console.log("\n🔵 ================= GEMINI REQUEST START ================= 🔵"); 
                console.log(JSON.stringify(payload, null, 2)); 
                console.log("🔵 ================= GEMINI REQUEST END =================== 🔵\n");
            }

            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            // Handle Rate Limits (429)
            if (data.error && data.error.code === 429) {
                console.warn(`⚠️ Rate Limit Hit (429). Retrying...`);
                retryCount++;
                if (retryCount > MAX_RETRIES) {
                    return "AI is currently overloaded. Please wait a moment and try again.";
                }
                
                // Exponential Backoff: 2s, 4s, 8s...
                const waitTime = Math.pow(2, retryCount) * 1000;
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue; // Retry loop
            }

            if (data.error) {
                console.error("Gemini API Error:", data.error);
                return "AI Error: " + (data.error.message || "Unknown error");
            }

            // Extract Text
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (aiText) {
                // Add AI Response to History so it remembers context
                this.history.push({ role: "model", parts: [{ text: aiText }] });
                
                // Only increment topic index for non-state-aware calls (legacy lobby flow)
                if (!isStateAware) {
                  if (this.currentTopicIndex < this.agenda.length) {
                      this.currentTopicIndex++;
                  }
                }

                // --- 📊 HUMAN READABLE DASHBOARD 📊 --- 
                console.log("\n" + "=".repeat(60)); 
                console.log("📊 INTERVIEW PROGRESS DASHBOARD"); 
                console.log("=".repeat(60)); 
                
                if (isStateAware && currentState) {
                  console.log("\n📈 STATE TRACKING:");
                  console.log(`   Success: ${currentState.success}/100`);
                  console.log(`   Patience: ${currentState.patience}/100`);
                  console.log(`   Anger: ${currentState.anger}/100`);
                }
                
                console.log("\n📋 PLAN (Agenda):"); 
                if (this.agenda && this.agenda.length > 0) { 
                    this.agenda.forEach((item, index) => { 
                    let statusIcon = "[⏳ Pending]"; 
                    if (isStateAware && topicIndex !== undefined) {
                      if (index < topicIndex) statusIcon = "[✅ Passed]"; 
                      if (index === topicIndex) statusIcon = "[🔄 IN PROCESS]"; 
                    } else {
                      if (index < this.currentTopicIndex) statusIcon = "[✅ Passed]"; 
                      if (index === this.currentTopicIndex) statusIcon = "[🔄 IN PROCESS]"; 
                    }
                    
                    console.log(`   ${statusIcon} ${item.topic} (${item.category || 'General'})`); 
                    }); 
                } else { 
                    console.log("   (No Agenda Loaded)"); 
                } 
                
                console.log("\n✅ HISTORY (Last 3 Turns):"); 
                const recentHistory = this.history.slice(-3); 
                recentHistory.forEach((msg, idx) => { 
                    const roleIcon = msg.role === 'user' ? '👤' : '🤖'; 
                    const textSnippet = msg.parts[0].text.replace(/\n/g, " ").substring(0, 50); 
                    console.log(`   ${roleIcon} ${textSnippet}...`); 
                }); 
                console.log("=".repeat(60) + "\n"); 
                // ----------------------------------------

                return aiText;
            }
            
            return "No response from AI.";

        } catch (e) {
            console.error("Network Error:", e);
            return "Connection failed. Please check your internet.";
        }
    }
    return "AI Error: Request timed out after retries.";
  }
}
