import Groq from "groq-sdk";
import { InterviewMode, InterviewPlan, InterviewTopic } from "../types";

const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";
if (!GROQ_API_KEY) console.warn("Groq API Key missing in .env");

const groq = new Groq({ apiKey: GROQ_API_KEY, dangerouslyAllowBrowser: true });

export class CurriculumService {
  
  static async extractNameAndGreet(resumeText: string): Promise<{ name: string, greeting: string }> {
    console.log(`🟠 [GROQ] Request Start...`);
    const prompt = `
      Analyze this resume text.
      1. Identify the candidate's First Name (if unsure, use "Candidate").
      2. Return a JSON object strictly: { "name": "First Name", "greeting": "Hi [First Name], I'm Victoria. Let's start your interview." }
      Resume: ${resumeText.substring(0, 2000)}
    `;

    try {
      const response = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.6,
      });

      const rawText = response.choices[0]?.message?.content || "{}";
      const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(jsonStr);

      console.log(`🟠 [GROQ] Response Received...`);

      return {
          name: data.name || "Candidate",
          greeting: data.greeting || "Hi there! I'm Victoria. Let's start your interview."
      };
    } catch (error) {
      console.error(`🔴 [GROQ] ERROR:`, error);
      console.error("Name Extract Error:", error);
      return { name: "Candidate", greeting: "Hello! I'm Victoria. Let's begin." };
    }
  }
    
  static async generateInterviewPlan(resume: string, mode: InterviewMode): Promise<{
    candidateName: string;
    plan: InterviewTopic[];
    welcomeMessage: string;
  }> {
    console.log(`� [GROQ/PLAN] Generating Interview Plan...`);
    // ONE-SHOT PROMPT: Extract Name + Create Plan + Write Welcome
    const prompt = `
      You are an expert Technical Interview Planner.
      
      TASK:
      1. Analyze the candidate's Resume below.
      2. Extract their **First Name** (if not found, use "Candidate").
      3. Create a concise **Interview Agenda** (JSON Array) with exactly ${mode === 'short' ? 3 : 5} topics based on their strongest skills.
         - Each topic object: { "id": "topic_1", "topic": "React Hooks", "category": "Frontend", "score": 9 }
      4. Write a short, warm, spoken-style **Welcome Message** (max 2 sentences) addressing them by name.
         - Example: "Hi John! I'm Victoria. I see you're an expert in React, so let's dive into your experience with Hooks."
      
      RESUME:
      "${resume.substring(0, 2000)}..."
      
      OUTPUT FORMAT (Raw JSON only, no markdown):
      {
        "candidateName": "String",
        "plan": [Array of Topics],
        "welcomeMessage": "String"
      }
    `;

    try {
      const response = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.6,
      });

      const rawText = response.choices[0]?.message?.content || "{}";
      const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(jsonStr);

      console.log(`� [GROQ/PLAN] Plan Generated Successfully!`);

      // Validate Structure
      if (!data.plan || !Array.isArray(data.plan)) {
          // Fallback Plan
          data.plan = [
              { id: 't1', topic: 'Introduction', category: 'General', score: 10 },
              { id: 't2', topic: 'Technical Experience', category: 'Work History', score: 8 },
              { id: 't3', topic: 'System Design', category: 'Architecture', score: 7 }
          ];
      }
      
      if (!data.welcomeMessage) {
          data.welcomeMessage = "Hello! I'm Victoria. I've reviewed your profile, and I'm excited to start our interview.";
      }

      return {
          candidateName: data.candidateName || "Candidate",
          plan: data.plan,
          welcomeMessage: data.welcomeMessage
      };

    } catch (error) {
      console.error(`🔴 [GROQ] ERROR:`, error);
      console.error("Curriculum Gen Error:", error);
      // Fail Safe Return
      return {
          candidateName: "Candidate",
          plan: [
              { id: 'fallback_1', topic: 'Introduction', category: 'General', score: 10, type: 'Intro', estimated_time: '5m' },
              { id: 'fallback_2', topic: 'Experience', category: 'Technical', score: 8, type: 'Match', estimated_time: '5m' }
          ],
          welcomeMessage: "Hello! I'm Victoria. Let's start by discussing your background."
      };
    }
  }
}
