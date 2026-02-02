/**
 * History Storage Service
 * Persists interview sessions using expo-file-system
 */

import { File, Paths } from 'expo-file-system';
import { QuestionResult } from '../types';

const HISTORY_FILENAME = 'interview_history.json';

// ============================================
// TYPES
// ============================================

export interface InterviewSession {
    id: string;                      // Unique ID (timestamp-based)
    role: string;                    // Job role title
    date: string;                    // Formatted date string
    timestamp: number;               // Unix timestamp for sorting
    totalScore: number;              // Average score
    overallSummary: string;          // AI summary
    questions: SessionQuestion[];    // Array of questions with results
    isFavorite: boolean;             // Favorited session
}

export interface SessionQuestion {
    topic: string;
    userAnswer: string;
    score: number;
    feedback: string;
    advice?: string;  // NEW: Generated study advice
    metrics?: {
        accuracy: number;
        depth: number;
        structure: number;
        reasoning?: string;  // Optional reasoning for legacy compatibility
    };
    rawExchange?: Array<{  // NEW: For debug section
        speaker: 'Victoria' | 'User';
        text: string;
        timestamp?: number;
    }>;
}

// ============================================
// HELPERS
// ============================================

/**
 * Get the history file reference
 */
const getHistoryFile = (): File => {
    return new File(Paths.document, HISTORY_FILENAME);
};

/**
 * Safely parse JSON with validation
 */
const safeParseJSON = (content: string): InterviewSession[] => {
    try {
        if (!content || content.trim() === '') {
            return [];
        }
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            console.warn('⚠️ [HISTORY] Data is not an array, resetting');
            return [];
        }
        return parsed;
    } catch (error) {
        console.warn('⚠️ [HISTORY] Invalid JSON, resetting to empty array');
        return [];
    }
};

/**
 * Format date for display
 */
const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

/**
 * Generate unique session ID
 */
const generateSessionId = (): string => {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// ============================================
// API
// ============================================

/**
 * Get all saved sessions (sorted by date, newest first)
 */
export const getHistory = async (): Promise<InterviewSession[]> => {
    try {
        const file = getHistoryFile();

        if (!file.exists) {
            console.log('📂 [HISTORY] No history file exists yet');
            return [];
        }

        const content = file.text() as unknown as string;
        const history = safeParseJSON(content);

        // Sort by timestamp (newest first)
        history.sort((a, b) => b.timestamp - a.timestamp);

        console.log(`📚 [HISTORY] Loaded ${history.length} sessions`);
        return history;
    } catch (error) {
        console.error('❌ [HISTORY] Failed to load:', error);
        return [];
    }
};

/**
 * Save a new interview session to history
 */
/**
 * Update advice for a specific question in a session
 * @param sessionId The session ID
 * @param topicName The topic name to update
 * @param advice The generated advice text
 * @returns Success boolean
 */
export const updateQuestionAdvice = async (
  sessionId: string,
  topicName: string,
  advice: string
): Promise<boolean> => {
  try {
    console.log(`💾 [ADVICE] Updating advice for session ${sessionId}, topic "${topicName}"`);
    
    // Load existing history
    const history = await getHistory();
    
    // Find the session
    const sessionIndex = history.findIndex((s: InterviewSession) => s.id === sessionId);
    if (sessionIndex === -1) {
      console.error(`❌ [ADVICE] Session ${sessionId} not found`);
      return false;
    }
    
    // Find the question
    const questionIndex = history[sessionIndex].questions.findIndex(
      (q: SessionQuestion) => q.topic === topicName
    );
    if (questionIndex === -1) {
      console.error(`❌ [ADVICE] Question "${topicName}" not found in session`);
      return false;
    }
    
    // Update the advice
    history[sessionIndex].questions[questionIndex].advice = advice;
    
    // Save back to file
    const file = getHistoryFile();
    file.write(JSON.stringify(history, null, 2));
    console.log(`✅ [ADVICE] Successfully updated advice for "${topicName}"`);
    
    return true;
  } catch (error) {
    console.error('❌ [ADVICE] Error updating advice:', error);
    return false;
  }
};

export const saveSession = async (
    role: string,
    totalScore: number,
    overallSummary: string,
    questions: QuestionResult[]
): Promise<InterviewSession> => {
    const timestamp = Date.now();

    const newSession: InterviewSession = {
        id: generateSessionId(),
        role,
        date: formatDate(timestamp),
        timestamp,
        totalScore,
        overallSummary,
        questions: questions.map(q => ({
            topic: q.topic,
            userAnswer: q.userAnswer || '',
            score: q.score,
            feedback: q.feedback,
            metrics: (q as any).metrics,
        })),
        isFavorite: false,
    };

    try {
        const history = await getHistory();

        // Add new session at the beginning
        history.unshift(newSession);

        // Save to file
        const file = getHistoryFile();
        const jsonString = JSON.stringify(history, null, 2);
        file.write(jsonString);

        console.log(`💾 [HISTORY] Saved session: ${newSession.id}`);
        console.log(`📊 [HISTORY] Role: ${role}, Score: ${totalScore}`);
        console.log(`📚 [HISTORY] Total sessions: ${history.length}`);

        return newSession;
    } catch (error) {
        console.error('❌ [HISTORY] Failed to save session:', error);
        throw error;
    }
};

/**
 * Toggle favorite status for a session
 */
export const toggleSessionFavorite = async (sessionId: string): Promise<boolean> => {
    try {
        const history = await getHistory();
        const session = history.find(s => s.id === sessionId);

        if (!session) {
            console.warn(`⚠️ [HISTORY] Session not found: ${sessionId}`);
            return false;
        }

        session.isFavorite = !session.isFavorite;

        // Save updated history
        const file = getHistoryFile();
        file.write(JSON.stringify(history, null, 2));

        console.log(`⭐ [HISTORY] Session ${sessionId} favorite: ${session.isFavorite}`);
        return session.isFavorite;
    } catch (error) {
        console.error('❌ [HISTORY] Failed to toggle favorite:', error);
        return false;
    }
};

/**
 * Delete a session from history
 */
export const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
        const history = await getHistory();
        const index = history.findIndex(s => s.id === sessionId);

        if (index === -1) {
            console.warn(`⚠️ [HISTORY] Session not found: ${sessionId}`);
            return false;
        }

        history.splice(index, 1);

        // Save updated history
        const file = getHistoryFile();
        file.write(JSON.stringify(history, null, 2));

        console.log(`🗑️ [HISTORY] Deleted session: ${sessionId}`);
        return true;
    } catch (error) {
        console.error('❌ [HISTORY] Failed to delete session:', error);
        return false;
    }
};

/**
 * Clear all history
 */
export const clearHistory = async (): Promise<void> => {
    try {
        const file = getHistoryFile();
        file.write('[]');
        console.log('🗑️ [HISTORY] Cleared all history');
    } catch (error) {
        console.error('❌ [HISTORY] Failed to clear:', error);
    }
};

/**
 * Get favorite sessions only
 */
export const getFavoriteSessions = async (): Promise<InterviewSession[]> => {
    const history = await getHistory();
    return history.filter(s => s.isFavorite);
};

/**
 * Export all interview history as formatted JSON for debugging
 */
export const exportHistoryDebug = async (): Promise<void> => {
    const history = await getHistory();
    
    const debugData = history.map(session => ({
        id: session.id,
        role: session.role,
        date: session.date,
        timestamp: session.timestamp,
        totalScore: session.totalScore,
        overallSummary: session.overallSummary,
        questions: session.questions.map(q => ({
            topic: q.topic,
            score: q.score,
            metrics: q.metrics,
            feedback: q.feedback,
            advice: q.advice,
            userAnswer: q.userAnswer,
            rawExchange: q.rawExchange || [
                { speaker: "Victoria", text: `[Question about ${q.topic}]` },
                { speaker: "User", text: q.userAnswer },
                { speaker: "Victoria", text: q.feedback }
            ]
        }))
    }));

    const jsonString = JSON.stringify(debugData, null, 2);
    const timestamp = Date.now();
    const filename = `interview_history_${timestamp}.json`;

    try {
        // Dynamic import to avoid issues if sharing not available
        const Sharing = await import('expo-sharing');
        const Clipboard = await import('expo-clipboard');
        const { Alert } = await import('react-native');

        // Save to cache directory
        const file = new File(Paths.cache, filename);
        file.write(jsonString);

        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
            await Sharing.shareAsync(file.uri, {
                mimeType: 'application/json',
                dialogTitle: 'Export Interview History',
                UTI: 'public.json'
            });
            console.log('✅ [EXPORT] History shared successfully');
        } else {
            // Fallback: copy to clipboard
            await Clipboard.default.setStringAsync(jsonString);
            Alert.alert(
                'Export Complete',
                `History copied to clipboard (${history.length} sessions). Sharing not available on this device.`
            );
        }
    } catch (error) {
        console.error('❌ [EXPORT] Failed:', error);
        // Fallback: copy to clipboard
        try {
            const Clipboard = await import('expo-clipboard');
            const { Alert } = await import('react-native');
            await Clipboard.default.setStringAsync(jsonString);
            Alert.alert('Export Error', 'History copied to clipboard as fallback');
        } catch (e) {
            console.error('❌ [EXPORT] Clipboard fallback failed:', e);
        }
    }
};
