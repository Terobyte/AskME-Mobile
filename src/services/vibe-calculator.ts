import { VibeConfig, VibeLabel, CartesiaEmotion, AnswerIssue, UserIntent } from '../types';

/**
 * VibeCalculator: Service to determine Victoria's emotional state
 * Based on anger (0-100) and engagement (0-100) levels
 */
export class VibeCalculator {
  /**
   * Determine Victoria's current vibe based on anger and engagement
   */
  static determineVibe(
    anger: number,
    engagement: number,
    specialContext?: { isAbsurdError?: boolean; intent?: string }
  ): VibeConfig {
    // PRIORITY 1: Special Intent Handling
    if (specialContext?.intent) {
      const intent = specialContext.intent;

      if (intent === 'CLARIFICATION') {
        return this.getVibeConfig('Professional');
      }

      if (intent === 'GIVE_UP') {
        if (anger < 30) {
          return this.getVibeConfig('Professional');
        } else {
          return this.getVibeConfig('Disappointed');
        }
      }

      if (intent === 'SHOW_ANSWER') {
        return this.getVibeConfig('Encouraging');
      }

      if (intent === 'NONSENSE') {
        if (specialContext.isAbsurdError && anger >= 30 && anger < 60) {
          return this.getVibeConfig('Amused');
        } else if (anger >= 60) {
          return this.getVibeConfig('Frustrated');
        } else {
          return this.getVibeConfig('Skeptical');
        }
      }
    }

    // PRIORITY 2: Anger-Based Zones
    
    // Zone 5 (Terminal Anger): 91-100
    if (anger >= 91) {
      return this.getVibeConfig('Furious');
    }

    // Zone 4 (Critical Anger): 71-90
    if (anger >= 71) {
      if (anger >= 86) {
        return this.getVibeConfig('Dismissive');
      } else {
        return this.getVibeConfig('Hostile');
      }
    }

    // Zone 3 (High Anger): 41-70
    if (anger >= 41) {
      if (anger >= 61) {
        return this.getVibeConfig('Frustrated');
      } else if (engagement >= 40) {
        return this.getVibeConfig('Skeptical');
      } else {
        return this.getVibeConfig('Irritated');
      }
    }

    // Zone 2 (Medium Anger): 26-40
    if (anger >= 26) {
      if (engagement >= 60) {
        return this.getVibeConfig('Curious');
      } else if (engagement >= 30) {
        return this.getVibeConfig('Concerned');
      } else {
        return this.getVibeConfig('Disappointed');
      }
    }

    // Zone 1 (Low Anger): 0-25
    if (anger <= 10 && engagement >= 80) {
      return this.getVibeConfig('Impressed');
    } else if (anger <= 10 && engagement >= 50) {
      return this.getVibeConfig('Encouraging');
    } else if (anger <= 25 && engagement >= 60) {
      return this.getVibeConfig('Professional');
    } else {
      return this.getVibeConfig('Neutral');
    }
  }

  /**
   * Get complete configuration for a specific vibe label
   */
  static getVibeConfig(label: VibeLabel): VibeConfig {
    const configs: Record<VibeLabel, VibeConfig> = {
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
        speed: 1.0,
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

    return configs[label] || configs['Neutral'];
  }

  /**
   * Calculate engagement delta based on answer quality
   */
  static calculateEngagementDelta(compositeScore: number, intent: string): number {
    // Special intents don't affect engagement
    if (['CLARIFICATION', 'GIVE_UP', 'SHOW_ANSWER'].includes(intent)) {
      return 0;
    }

    // Nonsense drops engagement significantly
    if (intent === 'NONSENSE') {
      return -20;
    }

    // Normal attempts: based on composite score
    if (compositeScore >= 9) {
      return 15; // Excellent
    } else if (compositeScore >= 7) {
      return 8; // Good
    } else if (compositeScore >= 5) {
      return 0; // Mediocre (no change)
    } else if (compositeScore >= 3) {
      return -10; // Poor
    } else {
      return -15; // Fail
    }
  }

  /**
   * Detect if the error is absurd/funny (for Amused state)
   */
  static detectAbsurdError(userText: string, issues: AnswerIssue[]): boolean {
    const lowerText = userText.toLowerCase();

    // Check for absurd keywords
    const absurdKeywords = [
      // Pop culture
      'bikini bottom', 'spongebob', 'naruto', 'pokemon', 'harry potter', 'star wars',
      'darth vader', 'pikachu', 'gandalf', 'batman', 'superman',
      
      // Food/drinks
      'pizza', 'taco', 'burrito', 'coffee', 'beer', 'sandwich', 'hamburger',
      
      // Other funny
      'unicorn', 'dragon', 'magic', 'wizard', 'fairy', 'zombie',
      'rick roll', 'rickroll', 'meme', 'yolo', 'swag'
    ];

    const hasAbsurdKeyword = absurdKeywords.some(keyword => lowerText.includes(keyword));
    const isOffTopic = issues.includes('OFF_TOPIC');

    return hasAbsurdKeyword || isOffTopic;
  }
}