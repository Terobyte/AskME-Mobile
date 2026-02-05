/**
 * Chunked Streaming Audio Player with Gapless Playback
 * 
 * Implements "Chunked Files" strategy with AudioQueue for seamless playback.
 * Creates multiple mini WAV files and plays them with preloading for zero gaps.
 * 
 * Strategy:
 * - Accumulate 5-7 chunks (~200-300ms of audio)
 * - Create WAV file and save to cache
 * - PRELOAD into AudioQueue (not playing yet)
 * - Play first file after minimum buffer
 * - While playing chunk N, chunk N+1 is already loaded
 * - Instant transition between chunks (< 10ms gap)
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import {
    StreamingPlayerState,
    StreamingPlayerConfig,
    AudioChunk,
    StreamingMetrics,
    WordTimestamp,
    SentenceChunk
} from '../types';
import {
    createWavFile,
    arrayBufferToBase64,
    calculateAudioDuration,
    mergePCMChunks
} from '../utils/audio-conversion';
import { STREAMING_CONFIG } from '../config/streaming-config';
import { SentenceChunker } from '../utils/sentence-chunker';
import { cartesiaStreamingService } from './cartesia-streaming-service';

/**
 * Audio Queue for gapless playback
 * Preloads next chunk while current chunk is playing
 */
class AudioQueue {
    private queue: {
        sound: Audio.Sound;
        filepath: string;
        isPreloaded: boolean;
    }[] = [];

    private currentIndex: number = 0;
    private _isPlaying: boolean = false;
    private lastTransitionTime: number = 0;
    private completionPromise: Promise<void> | null = null;
    private completionResolve: (() => void) | null = null;
    // NEW: Cross-fade settings
    private readonly CROSSFADE_MS = 50; // 50ms overlap (increased for reliability)

    /**
     * Enqueue a sound file (preload it)
     */
    async enqueue(filepath: string): Promise<void> {
        console.log(`📦 [AudioQueue] Preloading: ${filepath}`);

        const { sound } = await Audio.Sound.createAsync(
            { uri: filepath },
            { shouldPlay: false, volume: 1.0 }  // Don't play yet!
        );

        this.queue.push({
            sound,
            filepath,
            isPreloaded: true
        });

        console.log(`✅ [AudioQueue] Enqueued (total: ${this.queue.length})`);
    }

    /**
     * Start playback of the queue
     */
    async start(): Promise<void> {
        if (this.queue.length === 0) {
            console.warn('⚠️ [AudioQueue] Cannot start - queue is empty');
            return;
        }

        if (this._isPlaying) {
            console.warn('⚠️ [AudioQueue] Already playing');
            return;
        }

        console.log('🎵 [AudioQueue] Starting playback queue...');
        this._isPlaying = true;
        this.currentIndex = 0;
        this.lastTransitionTime = Date.now();

        // Create completion promise
        this.completionPromise = new Promise<void>((resolve) => {
            this.completionResolve = resolve;
        });

        // Start playing current
        await this.playCurrent();
    }

    /**
     * Play current chunk with SCHEDULED volume-based cross-fade
     */
    private async playCurrent(): Promise<void> {
        if (this.currentIndex >= this.queue.length) {
            console.log('✅ [AudioQueue] Queue complete');
            this._isPlaying = false;

            if (this.completionResolve) {
                this.completionResolve();
            }

            return;
        }

        const current = this.queue[this.currentIndex];
        const next = this.queue[this.currentIndex + 1];

        console.log(`🔊 [AudioQueue] Playing chunk ${this.currentIndex + 1}/${this.queue.length}`);

        // Track if cross-fade was used
        let crossFadeStarted = false;
        let crossFadeTimeout: NodeJS.Timeout | null = null;

        // Setup completion handler
        current.sound.setOnPlaybackStatusUpdate(async (status) => {
            if (!status.isLoaded) return;

            if (status.didJustFinish) {
                const finishTime = Date.now();

                // Cancel scheduled cross-fade if exists
                if (crossFadeTimeout) {
                    clearTimeout(crossFadeTimeout);
                }

                // Calculate time since this chunk started
                const chunkDuration = finishTime - this.lastTransitionTime;
                console.log(`✅ [AudioQueue] Chunk ${this.currentIndex + 1} finished (duration: ${chunkDuration}ms)`);

                // UPDATE lastTransitionTime HERE (when chunk finishes)
                this.lastTransitionTime = finishTime;

                // Clear handler
                current.sound.setOnPlaybackStatusUpdate(null);

                // Move to next IMMEDIATELY
                this.currentIndex++;

                // If next is already playing from cross-fade, just continue
                if (next && crossFadeStarted) {
                    try {
                        const nextStatus = await next.sound.getStatusAsync();
                        if (nextStatus.isLoaded && nextStatus.isPlaying) {
                            console.log(`🎵 [AudioQueue] Seamless transition via cross-fade`);
                            // Ensure full volume
                            await next.sound.setVolumeAsync(1.0);
                            // Continue to next
                            this.playCurrent();
                            return;
                        }
                    } catch (error) {
                        console.warn('⚠️ [AudioQueue] Error checking next status:', error);
                    }
                }

                // Fallback: normal transition
                this.playCurrent();
            }
        });

        // Start playback and measure gap from previous finish
        try {
            const playStartTime = Date.now();

            if (this.currentIndex > 0 && this.lastTransitionTime > 0) {
                // Calculate REAL gap from last chunk finish to this chunk start
                const actualGap = playStartTime - this.lastTransitionTime;
                console.log(`⏱️ [AudioQueue] GAP: ${actualGap}ms (from previous finish to current start)`);

                if (actualGap > 50) {
                    console.warn(`⚠️ [AudioQueue] LARGE GAP DETECTED: ${actualGap}ms`);
                }
            }

            await current.sound.playAsync();
            const playLatency = Date.now() - playStartTime;
            console.log(`🎵 [AudioQueue] playAsync() latency: ${playLatency}ms`);

            // NEW: Schedule cross-fade based on duration
            if (next) {
                const status = await current.sound.getStatusAsync();
                if (status.isLoaded && status.durationMillis) {
                    const triggerTime = status.durationMillis - this.CROSSFADE_MS;

                    if (triggerTime > 0) {
                        console.log(`⏰ [AudioQueue] Scheduling cross-fade in ${triggerTime}ms`);

                        crossFadeTimeout = setTimeout(async () => {
                            if (!crossFadeStarted) {
                                crossFadeStarted = true;
                                console.log(`🔄 [AudioQueue] Starting SCHEDULED cross-fade`);

                                try {
                                    // Start fade-out of current + fade-in of next
                                    const fadeSteps = 10;
                                    const stepDuration = this.CROSSFADE_MS / fadeSteps;

                                    // Start next chunk at volume 0
                                    await next.sound.setVolumeAsync(0.0);
                                    await next.sound.playAsync();
                                    console.log(`▶️ [AudioQueue] Next chunk started at 0% volume`);

                                    // Simultaneous fade
                                    for (let i = 1; i <= fadeSteps; i++) {
                                        const progress = i / fadeSteps;

                                        // Fade current OUT, next IN
                                        await Promise.all([
                                            current.sound.setVolumeAsync(1.0 - progress),
                                            next.sound.setVolumeAsync(progress)
                                        ]);

                                        if (i < fadeSteps) {
                                            await new Promise(resolve => setTimeout(resolve, stepDuration));
                                        }
                                    }

                                    console.log(`✨ [AudioQueue] Cross-fade complete!`);
                                } catch (error) {
                                    console.error('❌ [AudioQueue] Cross-fade error:', error);
                                }
                            }
                        }, triggerTime);
                    }
                }
            }

        } catch (error) {
            console.error('❌ [AudioQueue] Playback error:', error);

            // Cancel scheduled cross-fade
            if (crossFadeTimeout) {
                clearTimeout(crossFadeTimeout);
            }

            this.currentIndex++;
            this.playCurrent();
        }
    }

    /**
     * Wait for queue to complete
     */
    async waitForCompletion(): Promise<void> {
        if (this.completionPromise) {
            await this.completionPromise;
        }
    }

    /**
     * Stop and cleanup
     */
    async stop(): Promise<void> {
        console.log('🛑 [AudioQueue] Stopping...');
        this._isPlaying = false;

        for (const item of this.queue) {
            try {
                await item.sound.stopAsync();
                await item.sound.unloadAsync();
            } catch (error) {
                // Ignore
            }
        }

        this.queue = [];
        this.currentIndex = 0;

        if (this.completionResolve) {
            this.completionResolve();
        }

        console.log('✅ [AudioQueue] Stopped and cleaned');
    }

    /**
     * Check if playing
     */
    get isPlaying(): boolean {
        return this._isPlaying;
    }

    /**
     * Get queue length
     */
    get length(): number {
        return this.queue.length;
    }
}

/**
 * Chunked streaming player implementation with gapless playback
 */
class ChunkedStreamingPlayer {
    private state: StreamingPlayerState = 'idle';
    private chunkFiles: string[] = [];
    private audioQueue: AudioQueue = new AudioQueue();
    private config: StreamingPlayerConfig;
    private metrics: Partial<StreamingMetrics>;

    // NEW: Sentence chunking state
    private accumulatedPcmData: ArrayBuffer[] = [];
    private currentContextId: string | null = null;
    private originalText: string = '';

    // Tuning parameters
    private readonly CHUNKS_PER_FILE = 5; // ~200-250ms per file at 16kHz
    private readonly USE_SENTENCE_CHUNKING = true; // Feature flag

    constructor(config?: Partial<StreamingPlayerConfig>) {
        this.config = {
            minBufferMs: config?.minBufferMs || STREAMING_CONFIG.minBufferMs,
            targetBufferMs: config?.targetBufferMs || STREAMING_CONFIG.targetBufferMs,
            chunkSampleRate: 16000,
            maxRetries: 3,
            strategy: 'chunked'
        };

        this.metrics = this.createEmptyMetrics();
    }

    /**
     * Create empty metrics object
     */
    private createEmptyMetrics(): Partial<StreamingMetrics> {
        return {
            generationStart: 0,
            firstChunkTime: null,
            firstPlayTime: null,
            totalChunks: 0,
            totalBytes: 0,
            bufferUnderruns: 0,
            averageChunkSize: 0
        };
    }

    /**
     * Play audio stream from AsyncGenerator with optional sentence chunking
     */
    async playStream(
        chunkGenerator: AsyncGenerator<AudioChunk, void, unknown>,
        options?: {
            originalText?: string;
            contextId?: string;
            enableSentenceChunking?: boolean;
        }
    ): Promise<void> {
        console.log('🎵 [Chunked Player] Starting playback with gapless preloading...');

        const enableSentenceChunking = options?.enableSentenceChunking !== false && this.USE_SENTENCE_CHUNKING;

        if (enableSentenceChunking) {
            console.log('✨ [Chunked Player] Sentence chunking ENABLED');
        }

        this.state = 'buffering';
        this.metrics = this.createEmptyMetrics();
        this.metrics.generationStart = Date.now();
        this.originalText = options?.originalText || '';
        this.currentContextId = options?.contextId || null;

        // Reset accumulation
        this.accumulatedPcmData = [];

        let accumulatedChunks: AudioChunk[] = [];
        let fileIndex = 0;
        let playbackStarted = false;

        try {
            // Set audio mode for playback
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
            });

            // Process chunks from generator
            for await (const chunk of chunkGenerator) {
                this.metrics.totalChunks = (this.metrics.totalChunks || 0) + 1;
                this.metrics.totalBytes = (this.metrics.totalBytes || 0) + chunk.sizeBytes;

                // Track first chunk
                if (this.metrics.firstChunkTime === null) {
                    this.metrics.firstChunkTime = Date.now();
                    const latency = this.metrics.firstChunkTime - (this.metrics.generationStart || 0);
                    console.log(`🎯 [Chunked Player] First chunk in ${latency}ms`);
                }

                // NEW: Accumulate PCM data for sentence chunking
                if (enableSentenceChunking) {
                    this.accumulatedPcmData.push(chunk.data);
                }

                accumulatedChunks.push(chunk);

                // Create file when we have enough chunks
                if (accumulatedChunks.length >= this.CHUNKS_PER_FILE) {
                    const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                    fileIndex++;

                    const duration = calculateAudioDuration(
                        accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                    );

                    console.log(`📦 [Chunked Player] Created file #${fileIndex}: ${duration.toFixed(0)}ms`);

                    // PRELOAD into queue (не играем сразу!)
                    await this.audioQueue.enqueue(filepath);

                    // Start playback after min buffer
                    if (!playbackStarted) {
                        const bufferDuration = calculateAudioDuration(
                            accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                        );

                        if (bufferDuration >= this.config.minBufferMs) {
                            console.log(`✅ [Chunked Player] Min buffer reached (${bufferDuration.toFixed(0)}ms)`);
                            this.state = 'playing';
                            this.metrics.firstPlayTime = Date.now();

                            // START QUEUE PLAYBACK
                            await this.audioQueue.start();

                            playbackStarted = true;
                        }
                    }

                    accumulatedChunks = [];
                }
            }

            // Handle remaining chunks
            if (accumulatedChunks.length > 0) {
                const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                console.log(`📦 [Chunked Player] Created final file`);

                await this.audioQueue.enqueue(filepath);

                if (!playbackStarted) {
                    this.state = 'playing';
                    this.metrics.firstPlayTime = Date.now();
                    await this.audioQueue.start();
                }
            }

            // Wait for queue to complete
            console.log(`⏳ [Chunked Player] Waiting for playback completion (${this.audioQueue.length} files)...`);
            await this.audioQueue.waitForCompletion();

            this.state = 'completed';
            console.log('✅ [Chunked Player] Playback completed (gapless!)');
            this.logStats();

            // NEW: Attempt sentence re-chunking (if enabled and have context)
            if (enableSentenceChunking && this.currentContextId) {
                await this.attemptSentenceRechunking();
            }

        } catch (error) {
            console.error('❌ [Chunked Player] Playback error:', error);
            this.state = 'error';
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Create WAV file from chunks
     */
    private async createChunkFile(
        chunks: AudioChunk[],
        index: number
    ): Promise<string> {
        const pcmBuffers = chunks.map(c => c.data);
        const wavBuffer = createWavFile(pcmBuffers, this.config.chunkSampleRate);
        const base64 = arrayBufferToBase64(wavBuffer);

        const filename = `stream_chunk_${Date.now()}_${index}.wav`;
        const filepath = `${FileSystem.cacheDirectory}${filename}`;

        await FileSystem.writeAsStringAsync(filepath, base64, {
            encoding: 'base64'
        });

        this.chunkFiles.push(filepath);
        return filepath;
    }

    /**
     * NEW: Attempt sentence re-chunking using timestamps
     */
    private async attemptSentenceRechunking(): Promise<void> {
        if (!this.currentContextId || !this.originalText) {
            console.log('ℹ️ [Chunked Player] Skipping sentence re-chunking (no context/text)');
            return;
        }

        // Get timestamps from service
        const timestamps = cartesiaStreamingService.getTimestamps(this.currentContextId);

        if (!timestamps || timestamps.length === 0) {
            console.warn('⚠️ [Chunked Player] No timestamps available for sentence chunking');
            return;
        }

        console.log(`📝 [Chunked Player] Attempting sentence re-chunking with ${timestamps.length} timestamps...`);

        try {
            // Merge all accumulated PCM data
            const fullPcmData = mergePCMChunks(this.accumulatedPcmData);

            console.log(`📦 [Chunked Player] Full PCM data: ${fullPcmData.byteLength} bytes`);

            // Apply sentence chunking
            const sentenceChunks = SentenceChunker.chunkBySentences(
                fullPcmData,
                timestamps,
                this.originalText,
                this.config.chunkSampleRate
            );

            console.log(`✅ [Chunked Player] Created ${sentenceChunks.length} sentence chunks`);

            // Log quality of chunking
            sentenceChunks.forEach((chunk, i) => {
                console.log(`  ${i + 1}. "${chunk.sentence.substring(0, 40)}..." (${chunk.durationMs}ms, ${chunk.wordCount} words)`);
            });

            // TODO: В будущем можно сохранить sentence chunks для next playback
            // (опционально можно кешировать для повторного использования)

            // Clear timestamps from storage
            cartesiaStreamingService.clearTimestamps(this.currentContextId);

        } catch (error) {
            console.error('❌ [Chunked Player] Sentence re-chunking failed:', error);
            // Non-critical error, just log
        }
    }

    /**
     * Stop playback
     */
    async stop(): Promise<void> {
        console.log('🛑 [Chunked Player] Stopping...');
        this.state = 'idle';

        // Stop audio queue
        await this.audioQueue.stop();

        await this.cleanup();
    }

    /**
     * Cleanup temporary files
     */
    private async cleanup(): Promise<void> {
        console.log(`🧹 [Chunked Player] Cleaning up ${this.chunkFiles.length} files...`);

        // Stop audio queue
        await this.audioQueue.stop();

        // Delete temporary files
        for (const filepath of this.chunkFiles) {
            try {
                await FileSystem.deleteAsync(filepath, { idempotent: true });
            } catch (error) {
                console.warn(`⚠️ [Chunked Player] Failed to delete: ${filepath}`);
            }
        }

        this.chunkFiles = [];

        // NEW: Clear sentence chunking state
        this.accumulatedPcmData = [];
        this.currentContextId = null;
        this.originalText = '';

        console.log('✅ [Chunked Player] Cleanup complete');
    }

    /**
     * Get current state
     */
    getState(): StreamingPlayerState {
        return this.state;
    }

    /**
     * Get playback metrics
     */
    getMetrics(): Partial<StreamingMetrics> {
        return { ...this.metrics };
    }

    /**
     * Log statistics
     */
    private logStats(): void {
        const stats = {
            totalChunks: this.metrics.totalChunks,
            totalBytes: this.metrics.totalBytes,
            totalFiles: this.chunkFiles.length,
            averageChunkSize: this.metrics.totalChunks
                ? Math.round((this.metrics.totalBytes || 0) / this.metrics.totalChunks)
                : 0,
            timeToFirstChunk: this.metrics.firstChunkTime
                ? this.metrics.firstChunkTime - (this.metrics.generationStart || 0)
                : null,
            timeToFirstPlay: this.metrics.firstPlayTime
                ? this.metrics.firstPlayTime - (this.metrics.generationStart || 0)
                : null,
        };

        console.log('📊 [Chunked Player] Stats:', stats);
    }
}

// Export singleton instance
export const chunkedStreamingPlayer = new ChunkedStreamingPlayer();

// Export class for testing
export { ChunkedStreamingPlayer };
