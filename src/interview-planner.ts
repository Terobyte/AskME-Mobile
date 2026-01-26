import { GoogleGenAI } from "@google/genai";
import { softSkillsDB } from "./soft-skills-db";
import { InterviewMode, InterviewPlan, InterviewTopic, GeminiAnalysisResult } from "./types";

// USE ENV VAR
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || ""; 
if (!GEMINI_API_KEY) console.warn("Gemini API Key missing in .env");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export async function generateInterviewPlan(resume: string, jd: string, mode: InterviewMode, previousQuestionIds: string[] = []): Promise<InterviewPlan> {
  // Logic Step 1: Gemini Prompt Update - DYNAMIC CATEGORIZATION & ROLE EXTRACTION
  const prompt = `Analyze this Resume vs JD. 
  
  First, extract the "Job Role" from the JD (e.g. "Senior React Developer", "System Administrator").
  
  Then, extract: 
  1. matches: Top 10 matching skills (Strong points).
  2. gaps: Top 5 missing skills (Critical gaps to defend).
  3. cool_skills: Top 2 unique/impressive skills from the Resume that stand out.
  4. soft_skills: Top 5 leadership/behavioral skills RELEVANT to the role (e.g. "Stakeholder Management" for PM).
  
  For EACH item in ALL lists:
  - Assign a concise technical "category". Do NOT use generic terms like "Backend" or "Frontend" unless strictly accurate. Group them into natural technical domains.
  - Assign a "Relevance Score" (1-10) based on how critical it is for the extracted Job Role. (e.g. Docker=10 for DevOps, Word=1 for DevOps).
  - GENERATE "question_script": A highly specific, role-based scenario question for this skill.
    - For Technical Skills: Create a debugging scenario or architecture challenge. (e.g. "Your React app has a memory leak in a large list. How do you debug it?")
    - For Soft Skills: Create a conflict/leadership scenario. (e.g. "A stakeholder wants to release a feature you know is buggy. How do you handle it?")
  
  Resume: ${resume}
  JD: ${jd}
  
  Return strictly raw JSON with keys: job_role, matches, gaps, cool_skills, soft_skills. 
  Each skill array must contain objects: { "skill": "Skill Name", "category": "Specific Domain", "score": number, "question_script": "The generated question" }.
  Do not use Markdown formatting.`;

  // Helper: Call Gemini with Retry Logic
  async function callGeminiWithRetry(promptText: string): Promise<string> {
    const maxRetries = 3;
    const delays = [2000, 4000]; // 2s, 4s

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",  //dont touch this model! it is only working dont change to 1.5
            contents: [{ role: "user", parts: [{ text: promptText }] }],
        });
        
        // Google GenAI SDK (v0.1.0+) structure check
        if (response && response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                 return candidate.content.parts[0].text || "";
            }
        }
        return "";
      } catch (error: any) {
        console.warn(`Gemini API Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt === maxRetries - 1) throw error;

        const waitTime = delays[attempt] || 4000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
      }
    }
    return ""; 
  }

  let analysis: GeminiAnalysisResult = { matches: [], gaps: [], cool_skills: [], transferable_skills: [], soft_skills: [] };
  let jobRole = "Senior Technical Lead"; 

  try {
    const text = await callGeminiWithRetry(prompt);
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);
    analysis = result;
    if (result.job_role) jobRole = result.job_role;
  } catch (error) {
    console.error("Error analyzing with Gemini:", error);
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
  let technicalLimit = 3;
  let softLimit = 2;
  
  if (mode === 'medium') {
      technicalLimit = 6;
      softLimit = 4;
  } else if (mode === 'freestyle') {
      technicalLimit = 10;
      softLimit = 5;
  }

  // Build Final Agenda (Topics Only)
  let finalQueue: InterviewTopic[] = [];

  // 1. Intro (Always First)
  finalQueue.push({
      id: 'intro',
      type: 'Intro',
      topic: 'Introduction', // Topic Name
      category: 'Introduction',
      context: 'The user is introducing themselves. Ask them to describe their background and experience briefly.',
      estimated_time: '5m'
  });

  // 2. Add Technical Topics (Matches + Gaps + Cool)
  const technicalPool = [
      ...matches.slice(0, 10).map(m => ({ type: 'Match', ...m })),
      ...gaps.slice(0, 5).map(g => ({ type: 'Gap', ...g })),
      ...coolSkills.slice(0, 2).map(c => ({ type: 'CoolSkill', ...c }))
  ];
  // Sort by score
  technicalPool.sort((a, b) => (b.score || 0) - (a.score || 0));
  
  // Take top N technical
  let techCount = 0;
  for (const item of technicalPool) {
      if (techCount >= technicalLimit) break;
      finalQueue.push({
          id: `${item.type.toLowerCase()}_${techCount}`,
          type: item.type as any,
          topic: item.skill,
          category: item.category,
          context: item.question_script || `Tell me about your experience with ${item.skill}.`, // Use Pre-Generated Script
          estimated_time: '5m',
          score: item.score
      });
      techCount++;
  }

  // 3. Add Soft Skills (Now using PRO-generated list)
  let softCount = 0;
  const softSkillsFromAI = sanitizeAndFilter(analysis.soft_skills, "Soft Skills");
  
  // Fallback if AI failed to generate soft skills
  if (softSkillsFromAI.length === 0) {
      // Use DB fallback
      const poolSoftSkills: { skill: string, category: string, score: number, question_script: string }[] = [];
      const softSkillCategories = Object.keys(softSkillsDB);
      for (let i = 0; i < 5; i++) {
          const cat = softSkillCategories[Math.floor(Math.random() * softSkillCategories.length)];
          // @ts-ignore
          const skill = softSkillsDB[cat][Math.floor(Math.random() * softSkillsDB[cat].length)];
          poolSoftSkills.push({ 
              skill, 
              category: "Soft Skills", 
              score: 5, 
              question_script: `Tell me about a time you demonstrated ${skill} in a professional setting.` 
          });
      }
      softSkillsFromAI.push(...poolSoftSkills);
  }

  for (const item of softSkillsFromAI) {
      if (softCount >= softLimit) break;
      finalQueue.push({
          id: `soft_${softCount}`,
          type: 'SoftSkill',
          topic: item.skill,
          category: item.category,
          context: item.question_script || `Tell me about a time you used ${item.skill}.`,
          estimated_time: '5m',
          score: item.score
      });
      softCount++;
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
