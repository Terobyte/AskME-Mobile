import { InterviewTopic, AiResponse } from "../types";
const MODEL_ID = "gemini-2.5-flash";// ⛔️ DO NOT CHANGE THIS MODEL! 
// "gemini-2.5-flash" is the ONLY stable model for this API.
// Using "1.5" or others will BREAK the app.
export class GeminiAgentService {
  private apiKey: string;
  private history: any[] = [];
  private systemInstruction: string = "";
  private agenda: InterviewTopic[] = []; // Store agenda in class
  private currentTopicIndex: number = 0; // Track progress
  private baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
  constructor() {
    // Prefer environment variable
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || ""; 
    if (!this.apiKey) console.error("API Key missing! Check .env file.");
  }

  async startInterview(agenda: InterviewTopic[], resume: string, role: string): Promise<AiResponse | string> {
    this.agenda = agenda;
    this.currentTopicIndex = 0; // Reset index

    // 1. Build System Context with RAW JSON
    this.systemInstruction = `
    You are Victoria, a Principal Software Engineer at a FAANG company. You are conducting a high-stakes technical interview.
            
    CONTEXT:
    - Candidate Resume Summary: "${resume.substring(0, 500)}..."
    - Position: ${role}
    - Agenda: ${JSON.stringify(agenda.map(p => p.topic))}
    
    SCORING RUBRIC (BE BRUTAL):
    You must evaluate the candidate's LAST answer against Senior-level expectations.
    - **10 (Perfect):** Deep internal knowledge, mentions trade-offs, edge cases, and modern alternatives. Rare.
    - **8-9 (Strong):** Correct, structured, good depth. What we expect from a Senior.
    - **5-7 (Mid/Junior):** Correct textbook definition, but shallow. Lacks "under the hood" details.
    - **1-4 (Fail):** Vague, wrong, short (1 sentence), or buzzword-heavy without substance.
    
    CRITICAL RULES:
    1. **Short Answers:** If the user answers in 1-2 short sentences, the 'Depth' score MUST be under 4.
    2. **Vague Answers:** If the user says "It depends" without explaining *what* it depends on, penalize heavily.
    3. **Accuracy:** Do not overlook small technical errors. Mention them in 'reasoning'.
    4. **Reasoning Field:** Be blunt and direct in the JSON 'reasoning' field (e.g., "Answer was too generic," "Failed to explain the lifecycle").
    
    PROTOCOL:
    - Continue moving through the Agenda sequentially.
    - Your spoken 'message' should remain professional and polite, but the 'metrics' in the JSON must be harsh and honest.
    `;

    // 2. Reset History
    this.history = [];

    // 3. Send First Trigger
    return await this.sendUserResponse("Start the interview. Introduce yourself as AskME and ask me to introduce myself.");
  }

  async sendUserResponse(userText: string): Promise<AiResponse | string> {
    if (!userText) return "Error: No text";

    // Add User Message to History
    this.history.push({ role: "user", parts: [{ text: userText }] });

    // Construct Payload
    // Note: Gemini REST API expects 'contents' array with history
    const payload = {
      contents: this.history,
      systemInstruction: { parts: [{ text: this.systemInstruction }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: {
            type: "OBJECT",
            properties: {
                message: { type: "STRING" },
                metrics: {
                    type: "OBJECT",
                    properties: {
                        accuracy: { type: "NUMBER" },
                        depth: { type: "NUMBER" },
                        structure: { type: "NUMBER" },
                        reasoning: { type: "STRING" }
                    },
                    required: ["accuracy", "depth", "structure", "reasoning"]
                }
            },
            required: ["message", "metrics"]
        }
      }
    };

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

            // Extract Text (which is now JSON string)
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (rawText) {
                // DEBUG LOGGING
                console.log("🟢 [GEMINI RAW RESPONSE]:", rawText);

                // Add AI Response to History so it remembers context
                // NOTE: We must store the RAW JSON string in history for the model to maintain context correctly
                this.history.push({ role: "model", parts: [{ text: rawText }] });
                
                // Increment Topic Index
                if (this.currentTopicIndex < this.agenda.length) {
                    this.currentTopicIndex++;
                }

                // Parse JSON for the App
                let parsedResponse: AiResponse;
                try {
                    // CLEAN JSON (Ironclad Parsing)
                    const cleanedJson = this.cleanJson(rawText);
                    parsedResponse = JSON.parse(cleanedJson);
                } catch (e) {
                    console.error("JSON Parse Error:", e);
                    
                    // FALLBACK: Graceful degradation instead of crashing
                    console.warn("⚠️ Returning FALLBACK object due to parse error.");
                    parsedResponse = {
                        message: "I encountered a processing error, but let's continue. Could you repeat that?",
                        metrics: {
                            accuracy: 5,
                            depth: 5,
                            structure: 5,
                            reasoning: "System error: Response truncation."
                        }
                    };
                }

                // --- 📊 HUMAN READABLE DASHBOARD 📊 --- 
                console.log("\n" + "=".repeat(60)); 
                console.log("📊 INTERVIEW PROGRESS DASHBOARD"); 
                console.log("=".repeat(60)); 
                
                console.log("\n📋 PLAN (Agenda):"); 
                if (this.agenda && this.agenda.length > 0) { 
                    this.agenda.forEach((item, index) => { 
                    let statusIcon = "[⏳ Pending]"; 
                    if (index < this.currentTopicIndex) statusIcon = "[✅ Passed]"; 
                    if (index === this.currentTopicIndex) statusIcon = "[🔄 IN PROCESS]"; 
                    
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

                return parsedResponse;
            }
            
            return "No response from AI.";

        } catch (e) {
            console.error("Network Error:", e);
            return "Connection failed. Please check your internet.";
        }
    }
    return "AI Error: Request timed out after retries.";
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
