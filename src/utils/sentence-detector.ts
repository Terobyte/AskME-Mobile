import { WordTimestamp } from '../types';

/**
 * Sentence boundary information
 */
export interface SentenceBoundary {
    wordIndex: number;        // Index of the last word in the sentence
    endTimeSeconds: number;   // End time of the sentence in seconds
    sentence: string;         // Full sentence text (for logging)
}

/**
 * PHASE 3: Real-time sentence boundary detection
 * Analyzes word timestamps to find sentence endings
 */
export class SentenceDetector {
    private static readonly SENTENCE_ENDINGS = ['.', '!', '?'];
    private static readonly SUB_SENTENCE_SPLITS = [',', ';', '—', ' -', ' –'];

    /**
     * Find all completed sentences in the given timestamps
     * @param timestamps Array of word timestamps
     * @param fromIndex Start searching from this index (for incremental detection)
     * @returns Array of sentence boundaries found
     */
    static findCompletedSentences(
        timestamps: WordTimestamp[],
        fromIndex: number = 0
    ): SentenceBoundary[] {
        const boundaries: SentenceBoundary[] = [];
        let sentenceStart = fromIndex;

        for (let i = fromIndex; i < timestamps.length; i++) {
            const word = timestamps[i].word;
            const lastChar = word[word.length - 1];

            // Check if this word ends a sentence
            if (this.SENTENCE_ENDINGS.includes(lastChar)) {
                const sentence = this.extractSentence(timestamps, sentenceStart, i);

                boundaries.push({
                    wordIndex: i,
                    endTimeSeconds: timestamps[i].end,
                    sentence: sentence
                });

                sentenceStart = i + 1;
            }
        }

        return boundaries;
    }

    /**
     * Find sub-sentence boundaries (commas, semicolons) for splitting long sentences
     * Used as fallback when sentence is too long
     */
    static findSubSentenceBoundaries(
        timestamps: WordTimestamp[],
        fromIndex: number,
        splitCharacters: string[] = this.SUB_SENTENCE_SPLITS
    ): SentenceBoundary[] {
        const boundaries: SentenceBoundary[] = [];
        let segmentStart = fromIndex;

        for (let i = fromIndex; i < timestamps.length; i++) {
            const word = timestamps[i].word;
            const lastChar = word[word.length - 1];

            // Check for sub-sentence split characters
            if (splitCharacters.includes(lastChar) || splitCharacters.some(char => word.endsWith(char))) {
                const segment = this.extractSentence(timestamps, segmentStart, i);

                boundaries.push({
                    wordIndex: i,
                    endTimeSeconds: timestamps[i].end,
                    sentence: segment
                });

                segmentStart = i + 1;
            }
        }

        return boundaries;
    }

    /**
     * Extract sentence text from timestamps range
     */
    private static extractSentence(
        timestamps: WordTimestamp[],
        startIndex: number,
        endIndex: number
    ): string {
        if (startIndex > endIndex || startIndex >= timestamps.length) {
            return '';
        }

        return timestamps
            .slice(startIndex, endIndex + 1)
            .map(t => t.word)
            .join(' ');
    }

    /**
     * Calculate audio duration from word timestamps
     */
    static calculateDuration(timestamps: WordTimestamp[]): number {
        if (timestamps.length === 0) return 0;

        const firstWord = timestamps[0];
        const lastWord = timestamps[timestamps.length - 1];

        return (lastWord.end - firstWord.start) * 1000; // Convert to ms
    }

    /**
     * Get audio duration for a specific sentence boundary
     */
    static getSentenceDuration(
        timestamps: WordTimestamp[],
        boundary: SentenceBoundary,
        previousBoundaryIndex: number = 0
    ): number {
        const startTime = timestamps[previousBoundaryIndex]?.start || 0;
        const endTime = timestamps[boundary.wordIndex]?.end || 0;

        return (endTime - startTime) * 1000; // Convert to ms
    }
}
