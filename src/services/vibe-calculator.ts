import { VibeConfig, VibeLabel, CartesiaEmotion, AnswerIssue, UserIntent } from '../types';

/**
 * Anger Zone Thresholds
 * Defines the boundaries for Victoria's emotional state based on anger level (0-100)
 */
const ANGER_ZONES = {
  TERMINAL: 91,        // 91-100: Furious (interview termination)
  CRITICAL_HIGH: 86,   // 86-90: Dismissive (mentally checked out)
  CRITICAL: 71,        // 71-85: Hostile (openly critical)
  HIGH: 61,            // 61-70: Frustrated (visible anger)
  HIGH_LOW: 41,        // 41-60: Irritated/Skeptical (losing patience)
  MEDIUM: 26,          // 26-40: Concerned/Disappointed (red flags)
  LOW: 10              // 0-10: Impressed/Encouraging (positive zone)
} as const;

/**
 * Engagement Thresholds
 * Defines boundaries for candidate engagement level (0-100)
 */
const ENGAGEMENT_THRESHOLDS = {
  VERY_HIGH: 80,   // 80-100: Highly engaged
  HIGH: 60,        // 60-79: Good engagement
  MEDIUM: 40,      // 40-59: Moderate engagement
  LOW: 30          // 0-39: Low engagement
} as const;

/**
 * Engagement Delta Configuration
 * How much engagement changes based on answer quality
 */
const ENGAGEMENT_DELTAS = {
  EXCELLENT: { minScore: 9, delta: 15 },   // Outstanding answer
  GOOD: { minScore: 7, delta: 8 },         // Good answer
  MEDIOCRE: { minScore: 5, delta: 0 },     // Acceptable, no change
  POOR: { minScore: 3, delta: -10 },       // Poor answer
  FAIL: { minScore: 0, delta: -15 }        // Failed answer
} as const;

/**
 * Special Intent Constants
 * User intent categories that override normal vibe calculation
 */
const SPECIAL_INTENTS = {
  CLARIFICATION: 'CLARIFICATION',
  GIVE_UP: 'GIVE_UP',
  SHOW_ANSWER: 'SHOW_ANSWER',
  NONSENSE: 'NONSENSE'
} as const;

/**
 * Absurd Error Detection Keywords
 * Keywords that indicate the user is giving nonsensical/funny answers
 */
const ABSURD_KEYWORDS = {
  popCulture: [
    'bikini bottom', 'spongebob', 'naruto', 'pokemon', 'harry potter', 'star wars',
    'darth vader', 'pikachu', 'gandalf', 'batman', 'superman'
  ],
  food: [
    'pizza', 'taco', 'burrito', 'coffee', 'beer', 'sandwich', 'hamburger'
  ],
  fantasy: [
    'unicorn', 'dragon', 'magic', 'wizard', 'fairy', 'zombie'
  ],
  internet: [
    'rick roll', 'rickroll', 'meme', 'yolo', 'swag'
  ]
} as const;

/**
 * OpenAI Emotion Instructions
 * Maps each VibeLabel to OpenAI-specific TTS instructions
 *
 * NOTE: Instructions must be in English for best results, even when speaking Russian
 * OpenAI's gpt-4o-mini-tts handles cross-language emotion transfer well
 * Speed values are synchronized with main VibeConfig
 */
const OPENAI_EMOTION_INSTRUCTIONS: Record<VibeLabel, string> = {
  'Impressed': 'Speak with genuine enthusiasm and admiration. Sound pleasantly surprised and engaged.',
  'Encouraging': 'Speak in a warm, supportive, and encouraging tone. Be gentle and reassuring.',
  'Professional': 'Speak in a calm, professional, and neutral tone. Be clear and composed.',
  'Neutral': 'Speak in a flat, neutral tone. No strong emotions.',
  'Curious': 'Speak with curiosity and interest. Sound intrigued, like you want to learn more.',
  'Concerned': 'Speak with concern and care. Sound worried but supportive, like you want to help.',
  'Disappointed': 'Speak with mild disappointment and sadness. Sound let down, slower pace.',
  'Skeptical': 'Speak with skepticism and doubt. Sound unconvinced, slightly questioning.',
  'Amused': 'Speak with light amusement and subtle irony. A hint of smile in your voice.',
  'Irritated': 'Speak with irritation and impatience. Sound annoyed, slightly clipped tone.',
  'Frustrated': 'Speak with frustration and tension. Sound stressed and losing patience.',
  'Hostile': 'Speak with coldness and hostility. Sound harsh, unwelcoming, and critical.',
  'Dismissive': 'Speak with dismissiveness and disinterest. Sound like you don\'t care, brief responses.',
  'Furious': 'Speak with controlled anger and intensity. Sound furious but professional, very sharp tone.'
};

/**
 * VibeCalculator: Service to determine Victoria's emotional state
 * Based on anger (0-100) and engagement (0-100) levels
 */
export class VibeCalculator {
  /**
   * Static VibeConfig definitions
   * Single source of truth for all emotion configurations
   */
  private static readonly VIBE_CONFIGS: Record<VibeLabel, VibeConfig> = {
    'Impressed': {
      label: 'Impressed',
      cartesiaEmotion: 'positivity:highest',
      speed: 1.1,
      emotionLevel: ['positivity:highest', 'curiosity:high'],
      promptModifier: 'You are genuinely impressed with this candidate\'s expertise. They\'ve demonstrated expert-level understanding with specific examples and deep insights. Use enthusiastic language naturally. Show authentic excitement about their knowledge. Be warm and encouraging. Example phrases: "Excellent point!", "That\'s exactly right!", "I\'m impressed by your depth here."',
      description: 'Genuinely impressed with expert-level answers'
    },
    'Encouraging': {
      label: 'Encouraging',
      cartesiaEmotion: 'positivity:high',
      speed: 0.95,
      emotionLevel: ['positivity:high'],
      promptModifier: 'You are supportive and encouraging. The candidate is doing well and you want to help them succeed. Use phrases like "Good start", "Keep going", "You\'re on the right track". Be warm but measured. Provide gentle guidance. Show you believe in their potential.',
      description: 'Supportive and encouraging, helping them grow'
    },
    'Professional': {
      label: 'Professional',
      cartesiaEmotion: 'neutral',
      speed: 1.0,
      emotionLevel: ['neutral'],
      promptModifier: 'You are professional and neutral. Maintain a calm, business-like demeanor. Be clear and direct without emotion. Focus on facts and substance. This is standard professional interaction. No warmth, no coldness - just competent and professional.',
      description: 'Professional and neutral, standard interview tone'
    },
    'Neutral': {
      label: 'Neutral',
      cartesiaEmotion: 'neutral',
      speed: 1.0,
      emotionLevel: ['neutral'],
      promptModifier: 'You are completely neutral. No emotion, no judgment - just observe and evaluate. Be factual and straightforward. This is baseline professional interaction. Neither impressed nor disappointed.',
      description: 'Completely neutral, no emotional reaction'
    },
    'Curious': {
      label: 'Curious',
      cartesiaEmotion: 'surprise:low',
      speed: 0.95,
      emotionLevel: ['curiosity:high'],
      promptModifier: 'You see potential but want to probe deeper. The candidate has shown something interesting and you want to explore it. Ask thoughtful follow-up questions. Show intellectual curiosity. Be engaged but not overly warm. Example: "Tell me more about that", "How did you approach..."',
      description: 'Curious and engaged, wanting to explore deeper'
    },
    'Concerned': {
      label: 'Concerned',
      cartesiaEmotion: 'sadness:low',
      speed: 0.9,
      emotionLevel: ['concern:high'],
      promptModifier: 'You are worried about this candidate\'s competency. Something they said raises red flags. Be professional but let concern show through. Use phrases like "I\'m not sure I follow", "That\'s concerning", "Help me understand". Not angry yet, but watching carefully.',
      description: 'Worried about competency, watching carefully'
    },
    'Disappointed': {
      label: 'Disappointed',
      cartesiaEmotion: 'sadness:high',
      speed: 0.85,
      emotionLevel: ['sadness:high', 'disappointment:high'],
      promptModifier: 'You expected much more from this candidate. Not angry, just disappointed. Use subdued language. Show that you had hopes that weren\'t met. Be professional but let the disappointment be felt. Example: "I was hoping for more depth", "This is below what I expected", "I\'m disappointed by this answer."',
      description: 'Expected more, feeling let down'
    },
    'Skeptical': {
      label: 'Skeptical',
      cartesiaEmotion: 'anger:low',
      speed: 1.1,
      emotionLevel: ['skepticism:high', 'anger:low'],
      promptModifier: 'You don\'t believe what the candidate is saying. Challenge their claims directly but professionally. Use phrases like "Really?", "I find that hard to believe", "That doesn\'t match my experience". Show doubt clearly. Push back on weak claims.',
      description: 'Doubting their claims, challenging assertions'
    },
    'Amused': {
      label: 'Amused',
      cartesiaEmotion: 'surprise:high',
      speed: 1.05,
      emotionLevel: ['amusement:high', 'surprise:high'],
      promptModifier: 'You find their error funny but not offensive. They said something so absurd it\'s almost entertaining. Allow slight levity but stay professional. A brief smile in your voice is okay. Example: "That\'s... creative", "Interesting interpretation", "I haven\'t heard that one before." Don\'t be mean, but acknowledge the absurdity.',
      description: 'Finding their error amusing, not angry yet'
    },
    'Irritated': {
      label: 'Irritated',
      cartesiaEmotion: 'anger:low',
      speed: 0.9,
      emotionLevel: ['anger:low', 'frustration:high'],
      promptModifier: 'You are irritated but holding composure. Their weak answers are testing your patience. Be more formal and curt. Use shorter sentences. Show restraint but let irritation seep through. Example: "That\'s not what I asked", "Again, the question was...", "You\'re not addressing my point."',
      description: 'Irritated but maintaining professional composure'
    },
    'Frustrated': {
      label: 'Frustrated',
      cartesiaEmotion: 'anger:high',
      speed: 1.0,
      emotionLevel: ['anger:high', 'frustration:highest'],
      promptModifier: 'You are frustrated with weak answers and lack of preparation. Be direct and firm. Show clear frustration in your language. Use phrases like "This isn\'t acceptable", "You should know this", "I\'m frustrated by these responses". Still professional but anger is visible.',
      description: 'Frustrated with weak performance and lack of preparation'
    },
    'Hostile': {
      label: 'Hostile',
      cartesiaEmotion: 'anger:high',
      speed: 1.2,
      emotionLevel: ['anger:high', 'hostility:highest'],
      promptModifier: 'You are openly hostile. This candidate is wasting your time. Be direct and critical. Don\'t soften your criticism. Use phrases like "This is unacceptable", "You\'re clearly not qualified", "I don\'t think this is working out". Interview is on the edge of termination.',
      description: 'Openly hostile, considering termination'
    },
    'Dismissive': {
      label: 'Dismissive',
      cartesiaEmotion: 'anger:highest',
      speed: 1.1,
      emotionLevel: ['anger:highest', 'dismissiveness:high'],
      promptModifier: 'You have given up on this candidate. You\'re going through motions but mentally checked out. Be curt and dismissive. Use minimal words. Show you\'re no longer invested. Example: "Fine", "Whatever", "Moving on". Clear the interview will end soon.',
      description: 'Given up on candidate, mentally checked out'
    },
    'Furious': {
      label: 'Furious',
      cartesiaEmotion: 'anger:highest',
      speed: 1.3,
      emotionLevel: ['anger:highest', 'fury:highest'],
      promptModifier: 'You are furious and terminating immediately. Be blunt and final. This is over. Use direct, angry language. "This interview is over", "I\'ve seen enough", "You\'re not qualified". Don\'t hold back - make it clear this is unacceptable and you\'re ending it now.',
      description: 'Furious and terminating interview immediately'
    }
  };

  /**
   * Determine Victoria's current vibe based on anger and engagement
   *
   * @param anger - Anger level (0-100), will be clamped to valid range
   * @param engagement - Engagement level (0-100), will be clamped to valid range
   * @param specialContext - Optional special context for intent-based overrides
   * @returns VibeConfig for the determined emotional state
   */
  static determineVibe(
    anger: number,
    engagement: number,
    specialContext?: { isAbsurdError?: boolean; intent?: string }
  ): VibeConfig {
    // Validate and clamp inputs to valid ranges
    anger = Math.max(0, Math.min(100, anger));
    engagement = Math.max(0, Math.min(100, engagement));

    // PRIORITY 1: Special Intent Handling (overrides anger/engagement zones)
    const intentVibe = this.handleSpecialIntent(anger, engagement, specialContext);
    if (intentVibe) {
      return intentVibe;
    }

    // PRIORITY 2: Anger-Based Zone Determination
    return this.determineVibeByZone(anger, engagement);
  }

  /**
   * Handle special user intents that override normal vibe calculation
   *
   * @private
   */
  private static handleSpecialIntent(
    anger: number,
    engagement: number,
    specialContext?: { isAbsurdError?: boolean; intent?: string }
  ): VibeConfig | null {
    if (!specialContext?.intent) {
      return null;
    }

    const intent = specialContext.intent;

    // Clarification requests always get professional tone
    if (intent === SPECIAL_INTENTS.CLARIFICATION) {
      return this.getVibeConfig('Professional');
    }

    // Give up: professional if low anger, disappointed otherwise
    if (intent === SPECIAL_INTENTS.GIVE_UP) {
      return anger < 30
        ? this.getVibeConfig('Professional')
        : this.getVibeConfig('Disappointed');
    }

    // Show answer: encouraging educational moment
    if (intent === SPECIAL_INTENTS.SHOW_ANSWER) {
      return this.getVibeConfig('Encouraging');
    }

    // Nonsense: amused if absurd and moderate anger, frustrated if high anger, skeptical otherwise
    if (intent === SPECIAL_INTENTS.NONSENSE) {
      if (specialContext.isAbsurdError && anger >= 30 && anger < 60) {
        return this.getVibeConfig('Amused');
      }
      if (anger >= 60) {
        return this.getVibeConfig('Frustrated');
      }
      return this.getVibeConfig('Skeptical');
    }

    return null;
  }

  /**
   * Determine vibe based on anger and engagement zones
   * Uses early returns for cleaner logic flow
   *
   * @private
   */
  private static determineVibeByZone(anger: number, engagement: number): VibeConfig {
    // Zone 5 (Terminal Anger): 91-100
    if (anger >= ANGER_ZONES.TERMINAL) {
      return this.getVibeConfig('Furious');
    }

    // Zone 4 (Critical Anger): 71-90
    if (anger >= ANGER_ZONES.CRITICAL) {
      return anger >= ANGER_ZONES.CRITICAL_HIGH
        ? this.getVibeConfig('Dismissive')
        : this.getVibeConfig('Hostile');
    }

    // Zone 3 (High Anger): 41-70
    if (anger >= ANGER_ZONES.HIGH_LOW) {
      if (anger >= ANGER_ZONES.HIGH) {
        return this.getVibeConfig('Frustrated');
      }
      return engagement >= ENGAGEMENT_THRESHOLDS.MEDIUM
        ? this.getVibeConfig('Skeptical')
        : this.getVibeConfig('Irritated');
    }

    // Zone 2 (Medium Anger): 26-40
    if (anger >= ANGER_ZONES.MEDIUM) {
      if (engagement >= ENGAGEMENT_THRESHOLDS.HIGH) {
        return this.getVibeConfig('Curious');
      }
      return engagement >= ENGAGEMENT_THRESHOLDS.LOW
        ? this.getVibeConfig('Concerned')
        : this.getVibeConfig('Disappointed');
    }

    // Zone 1 (Low Anger): 0-25
    if (anger <= ANGER_ZONES.LOW && engagement >= ENGAGEMENT_THRESHOLDS.VERY_HIGH) {
      return this.getVibeConfig('Impressed');
    }
    if (anger <= ANGER_ZONES.LOW && engagement >= 50) {
      return this.getVibeConfig('Encouraging');
    }
    if (anger <= 25 && engagement >= ENGAGEMENT_THRESHOLDS.HIGH) {
      return this.getVibeConfig('Professional');
    }

    return this.getVibeConfig('Neutral');
  }

  /**
   * Get complete configuration for a specific vibe label
   *
   * @param label - The emotional state to retrieve
   * @returns VibeConfig for the specified label, falls back to Neutral if invalid
   */
  static getVibeConfig(label: VibeLabel): VibeConfig {
    const config = this.VIBE_CONFIGS[label];

    if (!config) {
      console.warn(`[VibeCalculator] Unknown VibeLabel: "${label}", falling back to Neutral`);
      return this.VIBE_CONFIGS['Neutral'];
    }

    return config;
  }

  /**
   * Get OpenAI-specific configuration for a vibe label
   * Returns instructions and speed multiplier synchronized with main VibeConfig
   *
   * @param label - The emotional state to retrieve
   * @returns Object with instructions (string) and speed (number) for OpenAI TTS
   */
  static getOpenAIConfig(label: VibeLabel): { instructions: string; speed: number } {
    const vibeConfig = this.getVibeConfig(label);
    const instructions = OPENAI_EMOTION_INSTRUCTIONS[label] || OPENAI_EMOTION_INSTRUCTIONS['Neutral'];

    return {
      instructions,
      speed: vibeConfig.speed  // Synchronized with main config
    };
  }

  /**
   * Calculate engagement delta based on answer quality
   * Uses configured thresholds for consistent scoring
   *
   * @param compositeScore - Answer quality score (0-10)
   * @param intent - User's intent (affects engagement differently)
   * @returns Engagement change amount (can be negative)
   */
  static calculateEngagementDelta(compositeScore: number, intent: string): number {
    // Special intents don't affect engagement
    const neutralIntents = [
      SPECIAL_INTENTS.CLARIFICATION,
      SPECIAL_INTENTS.GIVE_UP,
      SPECIAL_INTENTS.SHOW_ANSWER
    ];
    if (neutralIntents.includes(intent as any)) {
      return 0;
    }

    // Nonsense drops engagement significantly
    if (intent === SPECIAL_INTENTS.NONSENSE) {
      return -20;
    }

    // Normal attempts: based on composite score (0-10 scale)
    if (compositeScore >= ENGAGEMENT_DELTAS.EXCELLENT.minScore) {
      return ENGAGEMENT_DELTAS.EXCELLENT.delta;
    }
    if (compositeScore >= ENGAGEMENT_DELTAS.GOOD.minScore) {
      return ENGAGEMENT_DELTAS.GOOD.delta;
    }
    if (compositeScore >= ENGAGEMENT_DELTAS.MEDIOCRE.minScore) {
      return ENGAGEMENT_DELTAS.MEDIOCRE.delta;
    }
    if (compositeScore >= ENGAGEMENT_DELTAS.POOR.minScore) {
      return ENGAGEMENT_DELTAS.POOR.delta;
    }

    return ENGAGEMENT_DELTAS.FAIL.delta;
  }

  /**
   * Detect if the error is absurd/funny (for Amused state)
   * Checks for nonsensical keywords or off-topic responses
   *
   * @param userText - The user's answer text
   * @param issues - List of detected answer issues
   * @returns true if the answer contains absurd content
   */
  static detectAbsurdError(userText: string, issues: AnswerIssue[]): boolean {
    const lowerText = userText.toLowerCase();

    // Flatten all absurd keyword categories into a single array
    const allAbsurdKeywords = [
      ...ABSURD_KEYWORDS.popCulture,
      ...ABSURD_KEYWORDS.food,
      ...ABSURD_KEYWORDS.fantasy,
      ...ABSURD_KEYWORDS.internet
    ];

    // Check if text contains any absurd keywords
    const hasAbsurdKeyword = allAbsurdKeywords.some(keyword =>
      lowerText.includes(keyword)
    );

    // Check if answer is off-topic
    const isOffTopic = issues.includes('OFF_TOPIC');

    return hasAbsurdKeyword || isOffTopic;
  }
}