/**
 * Chunked Streaming Audio Player
 * 
 * Implements "Chunked Files" strategy for streaming audio playback.
 * Creates multiple mini WAV files and plays them sequentially with preloading.
 * 
 * Strategy:
 * - Accumulate 5-7 chunks (~200-300ms of audio)
 * - Create WAV file and save to cache
 * - Play first file after minimum buffer
 * - Preload next file during playback
 * - Seamless transition between files
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import {
    StreamingPlayerState,
    StreamingPlayerConfig,
    AudioChunk,
    StreamingMetrics
} from '../types';
import {
    createWavFile,
    arrayBufferToBase64,
    calculateAudioDuration
} from '../utils/audio-conversion';
import { STREAMING_CONFIG } from '../config/streaming-config';

/**
 * Chunked streaming player implementation
 */
class ChunkedStreamingPlayer {
    private state: StreamingPlayerState = 'idle';
    private chunkFiles: string[] = [];
    private currentSound: Audio.Sound | null = null;
    private playbackPromise: Promise<void> | null = null;
    private config: StreamingPlayerConfig;
    private metrics: Partial<StreamingMetrics>;

    // Tuning parameters
    private readonly CHUNKS_PER_FILE = 5; // ~200-250ms per file at 16kHz
    private readonly MAX_QUEUE_SIZE = 10; // Max files in queue

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
     * Play audio stream from AsyncGenerator
     */
    async playStream(
        chunkGenerator: AsyncGenerator<AudioChunk, void, unknown>
    ): Promise<void> {
        console.log('🎵 [Chunked Player] Starting playback...');
        this.state = 'buffering';
        this.metrics = this.createEmptyMetrics();
        this.metrics.generationStart = Date.now();

        let accumulatedChunks: AudioChunk[] = [];
        let fileIndex = 0;
        let isFirstFile = true;
        let playbackQueue: Promise<void>[] = [];

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

                accumulatedChunks.push(chunk);

                // Create file when we have enough chunks
                if (accumulatedChunks.length >= this.CHUNKS_PER_FILE) {
                    const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                    fileIndex++;

                    const duration = calculateAudioDuration(
                        accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                    );

                    console.log(`📦 [Chunked Player] Created file #${fileIndex}: ${duration.toFixed(0)}ms`);

                    // Play first file immediately after min buffer
                    if (isFirstFile) {
                        const bufferDuration = calculateAudioDuration(
                            accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                        );

                        if (bufferDuration >= this.config.minBufferMs) {
                            console.log(`✅ [Chunked Player] Min buffer reached (${bufferDuration.toFixed(0)}ms)`);
                            this.state = 'playing';
                            this.metrics.firstPlayTime = Date.now();

                            // Start playing first file
                            const playPromise = this.playFileSequence();
                            playbackQueue.push(playPromise);

                            isFirstFile = false;
                        }
                    }

                    accumulatedChunks = [];
                }
            }

            // Handle remaining chunks
            if (accumulatedChunks.length > 0) {
                const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                console.log(`📦 [Chunked Player] Created final file`);

                if (isFirstFile) {
                    this.state = 'playing';
                    this.metrics.firstPlayTime = Date.now();
                    const playPromise = this.playFileSequence();
                    playbackQueue.push(playPromise);
                }
            }

            // Wait for all playback to complete
            console.log(`⏳ [Chunked Player] Waiting for playback completion (${this.chunkFiles.length} files)...`);
            await Promise.all(playbackQueue);

            this.state = 'completed';
            console.log('✅ [Chunked Player] Playback completed');
            this.logStats();

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
     * Play files sequentially
     */
    private async playFileSequence(): Promise<void> {
        let currentIndex = 0;

        while (currentIndex < this.chunkFiles.length || this.state === 'buffering') {
            // Wait for next file if still buffering
            while (currentIndex >= this.chunkFiles.length && this.state === 'buffering') {
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Check if we have a file to play
            if (currentIndex < this.chunkFiles.length) {
                const filepath = this.chunkFiles[currentIndex];

                try {
                    await this.playFile(filepath);
                    currentIndex++;
                } catch (error) {
                    console.error(`❌ [Chunked Player] Error playing file ${currentIndex}:`, error);
                    // Continue to next file
                    currentIndex++;
                }
            } else {
                // No more files and not buffering, we're done
                break;
            }
        }
    }

    /**
     * Play a single file and wait for completion
     */
    private async playFile(filepath: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`🔊 [Chunked Player] Playing: ${filepath}`);

                const { sound } = await Audio.Sound.createAsync(
                    { uri: filepath },
                    { shouldPlay: true, volume: 1.0 }
                );

                this.currentSound = sound;

                // Wait for playback to complete
                sound.setOnPlaybackStatusUpdate((status) => {
                    if (!status.isLoaded) {
                        return;
                    }

                    if (status.didJustFinish) {
                        console.log(`✅ [Chunked Player] File finished`);
                        sound.unloadAsync();
                        this.currentSound = null;
                        resolve();
                    }
                });

                // Timeout safeguard (5 seconds)
                setTimeout(() => {
                    if (this.currentSound === sound) {
                        console.warn('⚠️ [Chunked Player] Playback timeout, forcing completion');
                        sound.unloadAsync();
                        this.currentSound = null;
                        resolve();
                    }
                }, 5000);

            } catch (error) {
                console.error('❌ [Chunked Player] Play file error:', error);
                reject(error);
            }
        });
    }

    /**
     * Stop playback
     */
    async stop(): Promise<void> {
        console.log('🛑 [Chunked Player] Stopping...');
        this.state = 'idle';

        if (this.currentSound) {
            try {
                await this.currentSound.stopAsync();
                await this.currentSound.unloadAsync();
            } catch (error) {
                console.error('❌ [Chunked Player] Stop error:', error);
            }
            this.currentSound = null;
        }

        await this.cleanup();
    }

    /**
     * Cleanup temporary files
     */
    private async cleanup(): Promise<void> {
        console.log(`🧹 [Chunked Player] Cleaning up ${this.chunkFiles.length} files...`);

        // Unload any active sound
        if (this.currentSound) {
            try {
                await this.currentSound.unloadAsync();
            } catch (error) {
                // Ignore
            }
            this.currentSound = null;
        }

        // Delete temporary files
        for (const filepath of this.chunkFiles) {
            try {
                await FileSystem.deleteAsync(filepath, { idempotent: true });
            } catch (error) {
                console.warn(`⚠️ [Chunked Player] Failed to delete: ${filepath}`);
            }
        }

        this.chunkFiles = [];
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
