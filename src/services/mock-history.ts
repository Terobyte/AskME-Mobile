/**
 * Mock History Service
 * Provides mock data for testing and fallback scenarios
 */

import { QuestionResult } from '../types';

/**
 * Get mock questions for Force Finish fallback
 * @param topicIndex Current topic index (0-based)
 * @returns Array of mock QuestionResult objects
 */
export const getForceFinishMock = async (
  topicIndex: number
): Promise<QuestionResult[]> => {
  console.log(`🎭 [MOCK] Generating mock data for topic ${topicIndex}`);
  
  const mockQuestions: QuestionResult[] = [
    {
      topic: 'Tell me about yourself',
      userAnswer: '[Interview was interrupted - no recorded answer]',
      score: 2.0,
      feedback: 'Interview was terminated early. This is a placeholder result to preserve the interview session.',
      metrics: {
        accuracy: 0.5,
        depth: 0.3,
        structure: 0.4,
        reasoning: 'Mock reasoning for testing purposes'
      }
    }
  ];
  
  console.log(`🎭 [MOCK] Generated ${mockQuestions.length} mock questions`);
  return mockQuestions;
};

/**
 * Get mock questions for general testing
 * @returns Array of mock QuestionResult objects
 */
export const getMockQuestions = async (): Promise<QuestionResult[]> => {
  console.log('🎭 [MOCK] Generating general mock questions');
  
  const mockQuestions: QuestionResult[] = [
    {
      topic: 'What are your greatest strengths?',
      userAnswer: 'I am a strong problem solver and work well in teams.',
      score: 3.5,
      feedback: 'Good response but could include more specific examples from your experience.',
      metrics: {
        accuracy: 0.8,
        depth: 0.6,
        structure: 0.7,
        reasoning: 'Mock reasoning - good answer structure but needs more specific examples'
      }
    },
    {
      topic: 'Describe a challenging project you worked on',
      userAnswer: 'I led a team project where we had tight deadlines and limited resources.',
      score: 4.0,
      feedback: 'Excellent answer with good context and challenge description.',
      metrics: {
        accuracy: 0.85,
        depth: 0.8,
        structure: 0.9,
        reasoning: 'Mock reasoning - excellent context and challenge description provided'
      }
    },
    {
      topic: 'How do you handle pressure?',
      userAnswer: 'I prioritize tasks and stay focused on what needs to be done.',
      score: 3.8,
      feedback: 'Solid approach, could mention specific stress management techniques.',
      metrics: {
        accuracy: 0.75,
        depth: 0.7,
        structure: 0.85,
        reasoning: 'Mock reasoning - solid approach but could expand on stress management techniques'
      }
    }
  ];
  
  console.log(`🎭 [MOCK] Generated ${mockQuestions.length} mock questions`);
  return mockQuestions;
};

/**
 * Get mock session for testing history functionality
 */
export const getMockSession = () => ({
  id: `mock_${Date.now()}`,
  role: 'Software Engineer',
  date: new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
  timestamp: Date.now(),
  totalScore: 3.5,
  overallSummary: 'This is a mock session for testing purposes.',
  questions: [
    {
      topic: 'Tell me about yourself',
      userAnswer: 'Mock answer for testing',
      score: 3.5,
      feedback: 'Mock feedback for testing',
    }
  ],
  isFavorite: false,
});