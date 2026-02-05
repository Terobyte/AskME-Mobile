import { WordTimestamp, SentenceChunk, SentenceBoundary } from '../types';

/**
 * Sentence Chunker: Splits PCM audio data by sentences using word timestamps
 * 
 * Strategy:
 * 1. Split text into sentences (by . ! ?)
 * 2. Find sentence boundaries in word timestamps
 * 3. Extract corresponding PCM data for each sentence
 */
export class SentenceChunker {

    /**
     * Main method: chunk PCM data by sentences
     */
    static chunkBySentences(
        fullPcmData: ArrayBuffer,
        timestamps: WordTimestamp[],
        originalText: string,
        sampleRate: number = 16000
    ): SentenceChunk[] {
        console.log('📝 [Sentence Chunker] Starting sentence chunking...');
        console.log(`📝 [Sentence Chunker] PCM size: ${fullPcmData.byteLength} bytes`);
        console.log(`📝 [Sentence Chunker] Timestamps: ${timestamps.length} words`);
        console.log(`📝 [Sentence Chunker] Text: "${originalText.substring(0, 100)}..."`);

        // Validation
        if (timestamps.length === 0) {
            console.warn('⚠️ [Sentence Chunker] No timestamps, returning full PCM as single chunk');
            return [{
                pcmData: fullPcmData,
                sentence: originalText,
                startTimeSeconds: 0,
                endTimeSeconds: 0,
                durationMs: 0,
                wordCount: 0
            }];
        }

        if (!originalText || originalText.trim().length === 0) {
            console.warn('⚠️ [Sentence Chunker] No original text, cannot split sentences');
            return [{
                pcmData: fullPcmData,
                sentence: '',
                startTimeSeconds: 0,
                endTimeSeconds: timestamps[timestamps.length - 1]?.end || 0,
                durationMs: Math.round((timestamps[timestamps.length - 1]?.end || 0) * 1000),
                wordCount: timestamps.length
            }];
        }

        // 1. Split text into sentences
        const sentences = this.splitIntoSentences(originalText);
        console.log(`📝 [Sentence Chunker] Found ${sentences.length} sentences:`);
        sentences.forEach((s, i) => {
            const preview = s.length > 50 ? s.substring(0, 50) + '...' : s;
            console.log(`  ${i + 1}. "${preview}"`);
        });

        // 2. Find sentence boundaries in timestamps
        const sentenceBoundaries = this.findSentenceBoundaries(timestamps, sentences, originalText);
        console.log(`📝 [Sentence Chunker] Found ${sentenceBoundaries.length} boundaries`);

        // 3. Extract PCM data for each sentence
        const chunks = this.extractPCMChunks(fullPcmData, sentenceBoundaries, sampleRate);

        console.log(`✅ [Sentence Chunker] Created ${chunks.length} sentence chunks`);
        return chunks;
    }

    /**
     * Split text into sentences
     */
    private static splitIntoSentences(text: string): string[] {
        // Normalize text
        const normalized = text.trim();

        // Split by . ! ? (but not abbreviations like Mr. Mrs. Dr.)
        // Simple heuristic: if after period comes capital letter or end of string
        const sentences: string[] = [];
        let currentSentence = '';

        for (let i = 0; i < normalized.length; i++) {
            const char = normalized[i];
            currentSentence += char;

            // Check for sentence end
            if (char === '.' || char === '!' || char === '?') {
                // Look ahead
                const nextChar = normalized[i + 1];
                const nextNextChar = normalized[i + 2];

                // End of sentence if:
                // - End of string
                // - After space comes capital letter
                // - Multiple punctuation marks (e.g. "!!")
                if (!nextChar ||
                    (nextChar === ' ' && nextNextChar && nextNextChar === nextNextChar.toUpperCase() && /[A-Z]/.test(nextNextChar)) ||
                    (nextChar === '!' || nextChar === '?' || nextChar === '.')) {

                    sentences.push(currentSentence.trim());
                    currentSentence = '';

                    // Skip spaces after sentence
                    while (i + 1 < normalized.length && normalized[i + 1] === ' ') {
                        i++;
                    }
                }
            }
        }

        // Add remaining if any
        if (currentSentence.trim().length > 0) {
            sentences.push(currentSentence.trim());
        }

        return sentences.filter(s => s.length > 0);
    }

    /**
     * Find sentence boundaries in timestamp array
     */
    private static findSentenceBoundaries(
        timestamps: WordTimestamp[],
        sentences: string[],
        originalText: string
    ): SentenceBoundary[] {
        const boundaries: SentenceBoundary[] = [];

        let currentSentenceIndex = 0;
        let sentenceWordIndex = 0;
        let sentenceStartTime: number | null = null;

        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const word = timestamp.word.toLowerCase().trim();

            // Start of sentence
            if (sentenceStartTime === null) {
                sentenceStartTime = timestamp.start;
                sentenceWordIndex = 0;
            }

            sentenceWordIndex++;

            // Check: end of sentence?
            const isLastWord = i === timestamps.length - 1;
            const isEndPunctuation = this.isSentenceEndWord(word);

            if (isEndPunctuation || isLastWord) {
                if (currentSentenceIndex < sentences.length) {
                    boundaries.push({
                        sentence: sentences[currentSentenceIndex],
                        startTime: sentenceStartTime,
                        endTime: timestamp.end,
                        wordCount: sentenceWordIndex
                    });

                    console.log(`✂️ [Sentence Chunker] Boundary ${boundaries.length}: "${sentences[currentSentenceIndex].substring(0, 30)}..." (${sentenceWordIndex} words, ${(timestamp.end - sentenceStartTime).toFixed(2)}s)`);

                    currentSentenceIndex++;
                    sentenceStartTime = null;
                    sentenceWordIndex = 0;
                }
            }
        }

        // Handle unprocessed sentences (fallback)
        if (currentSentenceIndex < sentences.length) {
            console.warn(`⚠️ [Sentence Chunker] ${sentences.length - currentSentenceIndex} sentences not matched to timestamps`);

            // Add last sentence with remaining data
            const lastTimestamp = timestamps[timestamps.length - 1];
            if (lastTimestamp && sentenceStartTime !== null) {
                boundaries.push({
                    sentence: sentences[currentSentenceIndex],
                    startTime: sentenceStartTime,
                    endTime: lastTimestamp.end,
                    wordCount: sentenceWordIndex
                });
            }
        }

        return boundaries;
    }

    /**
     * Extract PCM data for each sentence boundary
     */
    private static extractPCMChunks(
        fullPcmData: ArrayBuffer,
        boundaries: SentenceBoundary[],
        sampleRate: number
    ): SentenceChunk[] {
        const chunks: SentenceChunk[] = [];
        const bytesPerSample = 2; // 16-bit PCM

        for (let i = 0; i < boundaries.length; i++) {
            const boundary = boundaries[i];

            // Calculate byte positions
            const startSample = Math.floor(boundary.startTime * sampleRate);
            const endSample = Math.ceil(boundary.endTime * sampleRate);

            const startByte = startSample * bytesPerSample;
            const endByte = endSample * bytesPerSample;

            // Validate bounds
            if (startByte >= fullPcmData.byteLength) {
                console.warn(`⚠️ [Sentence Chunker] Sentence ${i + 1} start out of bounds (${startByte} >= ${fullPcmData.byteLength}), skipping`);
                continue;
            }

            const actualEndByte = Math.min(endByte, fullPcmData.byteLength);

            if (startByte >= actualEndByte) {
                console.warn(`⚠️ [Sentence Chunker] Sentence ${i + 1} invalid range (${startByte} >= ${actualEndByte}), skipping`);
                continue;
            }

            // Extract PCM data
            const sentencePcmData = fullPcmData.slice(startByte, actualEndByte);
            const durationMs = Math.round((boundary.endTime - boundary.startTime) * 1000);

            chunks.push({
                pcmData: sentencePcmData,
                sentence: boundary.sentence,
                startTimeSeconds: boundary.startTime,
                endTimeSeconds: boundary.endTime,
                durationMs: durationMs,
                wordCount: boundary.wordCount
            });

            console.log(`📦 [Sentence Chunker] Chunk ${i + 1}/${boundaries.length}: "${boundary.sentence.substring(0, 30)}..." (${durationMs}ms, ${sentencePcmData.byteLength} bytes)`);
        }

        return chunks;
    }

    /**
     * Check if word ends with sentence punctuation
     */
    private static isSentenceEndWord(word: string): boolean {
        const trimmed = word.trim();
        return /[.!?]+$/.test(trimmed);
    }
}
