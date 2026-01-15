import Groq from "groq-sdk";
import { softSkillsDB } from "./soft-skills-db";
import { InterviewMode, InterviewPlan, InterviewTopic, GeminiAnalysisResult } from "./types";

// USE ENV VAR
const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || ""; 
if (!GROQ_API_KEY) console.warn("Groq API Key missing in .env");

const groq = new Groq({ apiKey: GROQ_API_KEY, dangerouslyAllowBrowser: true });

export async function generateInterviewPlan(resume: string, jd: string, mode: InterviewMode, previousQuestionIds: string[] = []): Promise<InterviewPlan> {
  // Logic Step 1: Groq Prompt Update - DYNAMIC CATEGORIZATION & ROLE EXTRACTION
  const prompt = `Analyze this Resume vs JD. 
  
  First, extract the "Job Role" from the JD (e.g. "Senior React Developer", "System Administrator").
  
  Then, extract: 
  1. matches: Top 10 matching skills (Strong points).
  2. gaps: Top 5 missing skills (Critical gaps to defend).
  3. cool_skills: Top 2 unique/impressive skills from the Resume that stand out.
  
  For EACH item:
  - Assign a concise technical "category". Do NOT use generic terms like "Backend" or "Frontend" unless strictly accurate. Group them into natural technical domains.
  - Assign a "Relevance Score" (1-10) based on how critical it is for the extracted Job Role. (e.g. Docker=10 for DevOps, Word=1 for DevOps).
  
  Resume: ${resume}
  JD: ${jd}
  
  Return strictly raw JSON with keys: job_role, matches, gaps, cool_skills. 
  Each skill array must contain objects: { "skill": "Skill Name", "category": "Specific Domain", "score": number }.
  Do not use Markdown formatting.`;

  // Helper: Call Groq with Retry Logic
  async function callGroqWithRetry(promptText: string): Promise<string> {
    const maxRetries = 3;
    const delays = [2000, 4000]; // 2s, 4s

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: promptText }],
          model: "llama-3.3-70b-versatile",
        });
        return response.choices[0]?.message?.content || "";
      } catch (error: any) {
        console.warn(`Groq API Attempt ${attempt + 1} failed:`, error.message);
        
        // If it's the last attempt, rethrow to trigger fallback
        if (attempt === maxRetries - 1) throw error;

        // Check for specific error codes if available, or just general retry
        const isRetryable = error.status === 503 || error.status === 429 || error.message?.includes('Overloaded');
        
        if (isRetryable || true) { // Retry on most errors for robustness
           const waitTime = delays[attempt] || 4000;
           console.log(`Waiting ${waitTime}ms before retry...`);
           await delay(waitTime);
        } else {
            throw error; // Non-retryable
        }
      }
    }
    return ""; // Should not reach here
  }

  let analysis: GeminiAnalysisResult = { matches: [], gaps: [], cool_skills: [], transferable_skills: [], soft_skills: [] };
  let jobRole = "Senior Technical Lead"; // Default

  try {
    const text = await callGroqWithRetry(prompt);
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);
    analysis = result;
    if (result.job_role) jobRole = result.job_role;
  } catch (error) {
    console.error("Error analyzing with Groq:", error);
  }

  // --- PHASE 1: BUILD RAW POOL ---
  
  // Helpers to sanitize input and filter by relevance
  const sanitizeAndFilter = (list: any[], defaultCat: string) => {
      if (!list) return [];
      
      const seen = new Set<string>();
      
      return list
          .map(item => {
              if (typeof item === 'string') return { skill: item, category: defaultCat, score: 5 };
              return item;
          })
          .filter((item: any) => {
              // 1. Filter Low Relevance
              if ((item.score || 5) < 4) return false;
              
              // 2. Filter Generic Terms
              const skillName = item.skill.trim();
              if (skillName.toLowerCase() === "gap" || skillName.toLowerCase() === "match" || skillName.toLowerCase() === "technical skill") return false;
              
              // 3. Deduplicate
              if (seen.has(skillName.toLowerCase())) return false;
              seen.add(skillName.toLowerCase());
              
              return true;
          })
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0)); // Sort Descending
  };

  const matches = sanitizeAndFilter(analysis.matches, "Core Competency");
  while (matches.length < 5) matches.push({ skill: "Technical Skill", category: "General", score: 5 }); // Fallback if filtered too aggressively

  const gaps = sanitizeAndFilter(analysis.gaps, "Area for Growth");
  while (gaps.length < 3) gaps.push({ skill: "Gap", category: "General", score: 5 });

  const coolSkills = sanitizeAndFilter(analysis.cool_skills, "Unique Strength");
  while (coolSkills.length < 1) coolSkills.push({ skill: "Special Skill", category: "General", score: 5 });

  // Soft Skills (Random selection still okay, but we can assign arbitrary score 5)
  const softSkillCategories = Object.keys(softSkillsDB);
  const allSoftSkillsFlat: { skill: string, category: string, score: number }[] = [];
  softSkillCategories.forEach(cat => {
      // @ts-ignore
      softSkillsDB[cat].forEach(skill => allSoftSkillsFlat.push({ skill, category: "Soft Skills & Leadership", score: 6 }));
  });
  
  // Pick 5 random soft skills
  const poolSoftSkills: { skill: string, category: string, score: number }[] = [];
  for (let i = 0; i < 5; i++) {
      const random = allSoftSkillsFlat[Math.floor(Math.random() * allSoftSkillsFlat.length)];
      poolSoftSkills.push(random);
  }

  // Prepare Topics for Question Generation (NOW JUST TOPICS, NO PRE-GENERATED QUESTIONS)
  const poolItems = [
      ...matches.slice(0, 10).map(m => ({ type: 'Match', ...m })),
      ...gaps.slice(0, 5).map(g => ({ type: 'Gap', ...g })),
      ...coolSkills.slice(0, 2).map(c => ({ type: 'CoolSkill', ...c })),
      ...poolSoftSkills.map(s => ({ type: 'SoftSkill', ...s }))
  ];
  
  // Sort ALL items by Score Descending (Mix categories to prioritize importance)
  poolItems.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Determine Limit based on Mode
  let maxQuestions = 100; // Freestyle
  if (mode === 'short') maxQuestions = 5;
  if (mode === 'medium') maxQuestions = 10;

  // Build Final Agenda (Topics Only)
  let finalQueue: InterviewTopic[] = [];

  // 1. Intro (Always First)
  finalQueue.push({
      id: 'intro',
      type: 'Intro',
      topic: 'Introduction', // Topic Name
      category: 'Introduction',
      estimated_time: '5m'
  });

  // 2. Add Top Scored Topics
  let index = 0;
  for (const item of poolItems) {
      if (finalQueue.length >= maxQuestions) break;
      finalQueue.push({
          id: `${item.type.toLowerCase()}_${index}`, // Use simple index to ensure uniqueness
          type: item.type as any,
          topic: item.skill, // Just the Topic Name!
          category: item.category,
          estimated_time: '5m',
          score: item.score
      });
      index++;
  }

  return {
    meta: {
      mode,
      total_estimated_time: mode === 'short' ? '15m' : mode === 'medium' ? '30m' : 'Unlimited',
      new_question_ids: finalQueue.map(q => q.id)
    },
    queue: finalQueue
  };
}
