import { InterviewTopic } from "../types";
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

  async startInterview(agenda: InterviewTopic[], resume: string, role: string) {
    this.agenda = agenda;
    this.currentTopicIndex = 0; // Reset index

    // 1. Build System Context with RAW JSON
    this.systemInstruction = `You are AskME, a professional AI Interviewer.
    
    CONTEXT DATA:
    - Candidate Resume: "${resume.substring(0, 1500)}..."
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

  async sendUserResponse(userText: string) {
    if (!userText) return null;

    // Add User Message to History
    this.history.push({ role: "user", parts: [{ text: userText }] });

    // Construct Payload
    // Note: Gemini REST API expects 'contents' array with history
    const payload = {
      contents: this.history,
      systemInstruction: { parts: [{ text: this.systemInstruction }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
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

            // Extract Text
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (aiText) {
                // Add AI Response to History so it remembers context
                this.history.push({ role: "model", parts: [{ text: aiText }] });
                
                // Increment Topic Index
                if (this.currentTopicIndex < this.agenda.length) {
                    this.currentTopicIndex++;
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
