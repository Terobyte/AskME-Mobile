export type InterviewMode = 'short' | 'medium' | 'long' | 'freestyle';

export interface CategorizedSkill {
  skill: string;
  category: string;
}

export interface GeminiAnalysisResult {
  matches: CategorizedSkill[];
  gaps: CategorizedSkill[];
  cool_skills: CategorizedSkill[];
  transferable_skills: CategorizedSkill[];
  soft_skills: string[];
}

export interface InterviewTopic {
  id: string;
  type: 'Match' | 'Gap' | 'SoftSkill' | 'CoolSkill' | 'Intro' | 'Outro';
  topic: string;
  category?: string; // Added for grouping
  context?: string;
  estimated_time: string;
  score?: number; // Added Relevance Score
}

export interface InterviewPlan {
  meta: {
    mode: InterviewMode;
    total_estimated_time: string;
    isInfinite?: boolean;
    new_question_ids?: string[];
  };
  queue: InterviewTopic[];
}

export interface EvaluationMetrics {
    accuracy: number;
    depth: number;
    structure: number;
    reasoning: string;
}

export interface AnalysisResponse {
    metrics: EvaluationMetrics;
    intent: 'ATTEMPT' | 'GIVE_UP' | 'CLARIFICATION' | 'SHOW_ANSWER';
}

export interface VoiceGenerationContext {
    currentTopic: InterviewTopic;
    nextTopic: InterviewTopic | null;
    transitionMode: 'STAY' | 'NEXT_FAIL' | 'NEXT_PASS' | 'NEXT_EXPLAIN';
}

export interface AiResponse {
    message: string;
    metrics: EvaluationMetrics;
}

export interface InterviewContext {
    currentTopic: InterviewTopic;
    previousResult: string | null;
    angerLevel: number;
    isLastTopic: boolean;
}
