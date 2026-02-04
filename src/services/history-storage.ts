/**
 * History Storage Service
 * Persists interview sessions using expo-file-system v19
 * Uses new File API and Directory API
 */

import { File, Paths } from 'expo-file-system';
import { QuestionResult } from '../types';
import * as Clipboard from 'expo-clipboard';

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
 * Get history file object using Paths API
 */
const getHistoryFile = (): File => {
    const file = new File(Paths.document, HISTORY_FILENAME);
    return file;
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
    console.log('🔍 [HISTORY_STORAGE] getHistory() called');
    try {
        const file = getHistoryFile();
        console.log('📁 [HISTORY_STORAGE] File URI:', file.uri);

        const info = file.info();
        console.log('📁 [HISTORY_STORAGE] File exists:', info.exists);

        if (!info.exists) {
            console.log('⚠️ [HISTORY_STORAGE] No file, returning []');
            return [];
        }

        const content = await file.text();
        console.log('📄 [HISTORY_STORAGE] Content length:', content?.length);

        const history = safeParseJSON(content);
        console.log('✅ [HISTORY_STORAGE] Parsed sessions:', history.length);

        // Sort by timestamp (newest first)
        history.sort((a, b) => b.timestamp - a.timestamp);

        return history;
    } catch (error) {
        console.error('❌ [HISTORY_STORAGE] Error:', error);
        return [];
    }
};

/**
 * Save a new interview session to history
 */
export const saveSession = async (
    role: string,
    totalScore: number,
    overallSummary: string,
    questions: QuestionResult[]
): Promise<InterviewSession> => {
    const timestamp = Date.now();

    console.log('💾 [HISTORY_STORAGE] saveSession() called');
    console.log('   Role:', role, '| Score:', totalScore, '| Questions:', questions.length);
    console.log(`   Summary length: ${overallSummary?.length || 0}`);

    // Check for empty questions
    if (questions.length === 0) {
        console.warn('⚠️ [HISTORY_STORAGE] Saving session with EMPTY questions array!');
        console.warn('This may indicate Force Finish was called with empty results');
        console.warn('Or evaluateBatch() returned empty array');
        
        // Add placeholder question
        questions = [{
            topic: 'No Data Available',
            userAnswer: 'No data available - interview may have terminated early',
            score: totalScore || 1,
            feedback: 'Interview terminated before evaluation could complete',
            metrics: {
                accuracy: 0,
                depth: 0,
                structure: 0,
                reasoning: 'Interview terminated early - no evaluation data available'
            }
        }];
        console.log('✅ [HISTORY_STORAGE] Added placeholder question');
    }

    // Check for zero score
    if (totalScore === 0 && questions.length > 0) {
        console.warn('⚠️ [HISTORY_STORAGE] Total score is 0 but questions exist - may indicate Force Finish');
    }
    if (totalScore === 0 && questions.length === 0) {
        console.warn('⚠️ [HISTORY_STORAGE] Both score and questions are 0 - empty session detected');
        // Set minimum score to indicate it's not an error
        totalScore = 1.0;
        console.log('✅ [HISTORY_STORAGE] Set minimum score to 1.0');
    }

    // Log first 2-3 questions for diagnostics
    questions.slice(0, 3).forEach((q, i) => {
        console.log(`   Question ${i + 1}: ${q.topic} (score: ${q.score})`);
    });

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
        const file = getHistoryFile();
        const history = await getHistory();

        // Add new session at the beginning
        history.unshift(newSession);

        // Save to file
        const jsonString = JSON.stringify(history, null, 2);
        
        console.log(`📝 [HISTORY_STORAGE] Writing to file...`);
        console.log(`📝 [HISTORY_STORAGE] JSON size:`, jsonString.length, 'chars');
        
        file.write(jsonString);
        
        // Verify the file was written
        const info = file.info();
        console.log(`✅ [HISTORY_STORAGE] File exists:`, info.exists);
        console.log(`✅ [HISTORY_STORAGE] File size:`, info.size, 'bytes');

        if (!info.exists || (info.size !== undefined && info.size <= 0)) {
            console.error('❌ [HISTORY_STORAGE] Verify failed - file not written properly');
        } else {
            console.log('✅ [HISTORY_STORAGE] Verify successful');
        }

        console.log(`✅ [HISTORY_STORAGE] Session saved:`, newSession.id);
        console.log(`📊 [HISTORY_STORAGE] Role: ${role}, Score: ${totalScore}`);
        console.log(`📚 [HISTORY_STORAGE] Total sessions:`, history.length);

        return newSession;
    } catch (error) {
        console.error('❌ [HISTORY] Failed to save session:', error);
        if (error instanceof Error) {
          console.error('❌ [HISTORY] Error message:', error.message);
          console.error('❌ [HISTORY] Error stack:', error.stack);
        }
        throw error;
    }
};

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
    const file = getHistoryFile();
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
    file.write(JSON.stringify(history, null, 2));
    console.log(`✅ [ADVICE] Successfully updated advice for "${topicName}"`);
    
    return true;
  } catch (error) {
    console.error('❌ [ADVICE] Error updating advice:', error);
    return false;
  }
};

/**
 * Toggle favorite status for a session
 */
export const toggleSessionFavorite = async (sessionId: string): Promise<boolean> => {
    try {
        const file = getHistoryFile();
        const history = await getHistory();
        const session = history.find(s => s.id === sessionId);

        if (!session) {
            console.warn(`⚠️ [HISTORY] Session not found: ${sessionId}`);
            return false;
        }

        session.isFavorite = !session.isFavorite;

        // Save updated history
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
        const file = getHistoryFile();
        const history = await getHistory();
        const index = history.findIndex(s => s.id === sessionId);

        if (index === -1) {
            console.warn(`⚠️ [HISTORY] Session not found: ${sessionId}`);
            return false;
        }

        history.splice(index, 1);

        // Save updated history
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
    console.log('📤 [EXPORT] Starting export...');
    
    const history = await getHistory();
    console.log('📤 [EXPORT] Found', history.length, 'sessions');
    
    // Check for empty history - RETURN EARLY
    if (history.length === 0) {
        console.warn('⚠️ [EXPORT] No sessions to export!');
        const { Alert } = await import('react-native');
        Alert.alert(
            'No History to Export',
            'No interview history to export. Complete an interview first.'
        );
        return;
    }
    
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
    console.log('📤 [EXPORT] JSON size:', jsonString.length, 'chars');
    
    const timestamp = Date.now();
    const filename = `interview_history_${timestamp}.json`;
    const file = new File(Paths.cache, filename);
    console.log('📤 [EXPORT] File URI:', file.uri);

    try {
        // Static imports
        const Sharing = await import('expo-sharing');
        const { Alert } = await import('react-native');

        // Save to cache directory
        file.write(jsonString);
        console.log('📤 [EXPORT] File written successfully');
        
        // Verify file was created
        const info = file.info();
        console.log('📤 [EXPORT] File exists:', info.exists);
        console.log('📤 [EXPORT] File size:', info.size, 'bytes');
        
        if (!info.exists) {
            console.error('❌ [EXPORT] File was not created!');
            Alert.alert('Export Error', 'Failed to create export file');
            return;
        }

        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();
        console.log('📤 [EXPORT] Sharing available:', isAvailable);
        
        if (isAvailable) {
            await Sharing.shareAsync(info.uri || file.uri, {
                mimeType: 'application/json',
                dialogTitle: 'Export Interview History',
                UTI: 'public.json'
            });
            console.log('✅ [EXPORT] History shared successfully');
        } else {
            // Fallback: copy to clipboard
            await Clipboard.setStringAsync(jsonString);
            Alert.alert(
                'Export Complete',
                `History copied to clipboard (${history.length} sessions). Sharing not available on this device.`
            );
        }
    } catch (error) {
        console.error('❌ [EXPORT] Failed:', error);
        if (error instanceof Error) {
            console.error('❌ [EXPORT] Error message:', error.message);
            console.error('❌ [EXPORT] Error stack:', error.stack);
        }
        
        // Fallback: copy to clipboard
        try {
            const { Alert } = await import('react-native');
            await Clipboard.setStringAsync(jsonString);
            Alert.alert('Export Error', 'History copied to clipboard as fallback');
        } catch (e) {
            console.error('❌ [EXPORT] Clipboard fallback failed:', e);
            const { Alert } = await import('react-native');
            Alert.alert('Export Failed', 'Could not export or copy to clipboard. Please try again.');
        }
    }
};