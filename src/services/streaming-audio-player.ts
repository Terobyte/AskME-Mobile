/**
 * Sentence-Aware Streaming Audio Player with Gapless Playback
 * 
 * Implements hybrid chunking strategy for zero artifacts and low latency:
 * 
 * **FAST_START Mode (first ~1.6s):**
 * - Fixed-size chunks (25 chunks ~1250ms each)
 * - Low latency playback start (< 200ms)
 * - 2 files for initial buffer
 * 
 * **SENTENCE_MODE (main playback):**
 * - Dynamic file creation on sentence boundaries (. ! ?)
 * - Real-time timestamp processing from Cartesia API
 * - Min duration: 500ms, Max: 2.5s
 * - Sub-sentence splitting for long sentences (commas, semicolons)
 * 
 * **FALLBACK Mode (no timestamps):**
 * - Large fixed chunks (~1s) as safety fallback
 * 
 * **Features:**
 * - Gapless playback with AudioQueue preloading
 * - 120ms crossfade between files
 * - Automatic mode switching based on timestamp availability
 * - Real-time sentence boundary detection
 * - Zero mid-sentence artifacts
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
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
    mergePCMChunks,
    applySoftEdges,
    alignPCMToZeroCrossing
} from '../utils/audio-conversion';
import { STREAMING_CONFIG } from '../config/streaming-config';
import { SentenceChunker } from '../utils/sentence-chunker';
import { SentenceDetector } from '../utils/sentence-detector';  // PHASE 3: Sentence detection
import { cartesiaStreamingService } from './cartesia-streaming-service';
import { ArtifactTracker, TransitionMetrics } from '../utils/artifact-tracker';  // DEBUG: Artifact tracking

/**
 * Audio Queue for gapless playback
 * Preloads next chunk while current chunk is playing
 */
class AudioQueue {
    private queue: {
        sound: Audio.Sound;
        filepath: string;
        isPreloaded: boolean;
        sentenceChunk?: SentenceChunk;  // PHASE 1: Store sentence metadata
        durationMs?: number;             // PHASE 2: Store chunk duration
    }[] = [];

    private currentIndex: number = 0;
    private _isPlaying: boolean = false;
    private lastTransitionTime: number = 0;
    private completionPromise: Promise<void> | null = null;
    private completionResolve: (() => void) | null = null;

    // FIX: Race condition prevention flags
    private _isTransitioning: boolean = false;      // Prevents concurrent transitions
    private playCurrentPromise: Promise<void> | null = null;  // Ensures sequential playback

    // FIX: Safety timeout for final chunk
    private finalChunkSafetyTimeout: NodeJS.Timeout | null = null;
    private readonly FINAL_CHUNK_SAFETY_MS = 500; // Safety timeout after expected finish

    // PHASE 2: Adaptive cross-fade settings
    private readonly CROSSFADE_LONG = 120;   // 120ms for long chunks (>2s)
    private readonly CROSSFADE_SHORT = 40;   // 40ms for short chunks (<1s)

    // TOTAL GAPLESS: iOS-specific settings
    private readonly isIOS = Platform.OS === 'ios';

    // Diagnostic logging state
    private lastChunkFinishTime: number = 0;
    private lastChunkStartTime: number = 0;
    private chunkTransitionCount: number = 0;

    // DEBUG: Artifact tracking
    private artifactTracker = new ArtifactTracker();
    private lastCrossfadeScheduledTime: number = 0;
    private currentCrossfadeDuration: number = 0;

    /**
     * Enqueue a sound file (preload it)
     * PHASE 1: Now accepts optional sentence metadata and duration
     * TOTAL GAPLESS: Added diagnostic logging for iOS gap detection
     */
    async enqueue(
        filepath: string,
        sentenceChunk?: SentenceChunk,
        durationMs?: number
    ): Promise<void> {
        const enqueueStart = Date.now();
        console.log(`📦 [AudioQueue] Preloading: ${filepath}`);

        const { sound } = await Audio.Sound.createAsync(
            { uri: filepath },
            { shouldPlay: false, volume: 1.0 }  // Don't play yet!
        );

        this.queue.push({
            sound,
            filepath,
            isPreloaded: true,
            sentenceChunk,
            durationMs
        });

        const enqueueDuration = Date.now() - enqueueStart;
        console.log(`✅ [AudioQueue] Enqueued (total: ${this.queue.length}, preload time: ${enqueueDuration}ms)`);

        // iOS diagnostic: Log if preload is slow
        if (this.isIOS && enqueueDuration > 50) {
            console.warn(`⚠️ [iOS] Slow preload detected: ${enqueueDuration}ms`);
        }
    }

    /**
     * PHASE 2.1: Check if current chunk ends with natural pause (punctuation)
     * Returns true for sentence boundaries, false for word boundaries
     */
    private hasNaturalPause(currentIndex: number): boolean {
        const current = this.queue[currentIndex];

        // Safety: No metadata → assume no pause (force flush case)
        if (!current.sentenceChunk) {
            console.log('⚠️ [SmartCrossfade] No sentence metadata (force flush)');
            return false;
        }

        // Get last word of current chunk
        const sentence = current.sentenceChunk.sentence.trim();
        const lastWord = sentence.split(' ').pop() || '';

        // Check for punctuation (natural pause)
        const hasPunctuation = /[.!?,;:]$/.test(lastWord);

        if (hasPunctuation) {
            console.log(`✅ [SmartCrossfade] Natural pause detected ("${lastWord}")`);
        } else {
            console.log(`🔗 [SmartCrossfade] Word boundary detected ("${lastWord}")`);
        }

        return hasPunctuation;
    }

    /**
     * PHASE 2.2: Get crossfade duration based on punctuation
     * TOTAL GAPLESS: True zero-crossing for word boundaries (no crossfade)
     * - Natural pause (punctuation): 50ms (smooth but eliminates iOS echo)
     * - Word boundary: 0ms (atomic switch, zero-crossing only, prevents ANY artifacts)
     */
    private getCrossfadeDuration(
        durationMs: number,
        hasPunctuation: boolean
    ): { duration: number; isAtomicSwitch: boolean } {
        if (hasPunctuation) {
            // ⭐ FIXED: Single 50ms crossfade for all phrase endings (eliminates iOS echo)
            return { duration: 50, isAtomicSwitch: false };
        } else {
            // TOTAL GAPLESS: Word boundary - true atomic switch with 0ms crossfade
            // Zero-crossing alignment in audio-conversion.ts handles the clean splice
            return { duration: 0, isAtomicSwitch: true };
        }
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
     * FIX: Added race condition prevention and proper synchronization
     */
    private async playCurrent(): Promise<void> {
        // FIX: Wait for previous playCurrent to complete (prevents double calls)
        if (this.playCurrentPromise) {
            console.log('⏸️ [AudioQueue] Waiting for previous playCurrent to finish...');
            await this.playCurrentPromise;
            return;
        }

        // Create new promise for this playback
        this.playCurrentPromise = (async () => {
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
            const isFinalChunk = !next;

            console.log(`🔊 [AudioQueue] Playing chunk ${this.currentIndex + 1}/${this.queue.length}${isFinalChunk ? ' [FINAL]' : ''}`);

            // Track if cross-fade was used
            let crossFadeStarted = false;
            let crossFadeCompleted = false;
            let crossFadeTimeout: NodeJS.Timeout | null = null;
            let didFinishHandled = false; // FIX: Track if didJustFinish was processed

            // Setup completion handler
            current.sound.setOnPlaybackStatusUpdate(async (status) => {
                if (!status.isLoaded) return;

                if (status.didJustFinish) {
                    // FIX: Prevent duplicate handling
                    if (didFinishHandled) {
                        console.log('⏭️ [AudioQueue] didJustFinish already handled, skipping');
                        return;
                    }
                    didFinishHandled = true;

                    // FIX: Clear safety timeout if it exists
                    if (this.finalChunkSafetyTimeout) {
                        clearTimeout(this.finalChunkSafetyTimeout);
                        this.finalChunkSafetyTimeout = null;
                        console.log('✅ [AudioQueue] Safety timeout cancelled (normal finish)');
                    }

                    const finishTime = Date.now();
                    this.lastChunkFinishTime = finishTime;
                    this.chunkTransitionCount++;

                    // TOTAL GAPLESS: iOS gap detection
                    const currentChunkInfo = this.queue[this.currentIndex - 1]; // Just finished chunk
                    if (this.lastChunkStartTime > 0) {
                        const actualDuration = finishTime - this.lastChunkStartTime;
                        const chunkInfo = currentChunkInfo?.durationMs
                            ? `${currentChunkInfo.durationMs}ms`
                            : 'unknown';

                        console.log(`⏱️ [GapDetect] Chunk ${this.chunkTransitionCount} finished:`);
                        console.log(`   Duration: ${actualDuration}ms (expected: ${chunkInfo})`);
                        console.log(`   End time: ${finishTime}`);

                        // Detect abnormal gaps (iOS-specific artifacts)
                        if (this.lastTransitionTime > 0) {
                            const timeSinceLastTransition = finishTime - this.lastTransitionTime;
                            if (timeSinceLastTransition > 150) {
                                console.warn(`⚠️ [iOS] ABNORMAL GAP DETECTED: ${timeSinceLastTransition}ms`);
                                console.warn(`   This may indicate iOS audio buffer underrun!`);
                            }

                            // DEBUG: Record in artifact tracker
                            const actualGap = finishTime - this.lastTransitionTime;
                            console.log(`⏱️ [GapDetect] Chunk ${this.chunkTransitionCount} gap: ${actualGap}ms`);

                            this.artifactTracker.record({
                                fromChunk: this.chunkTransitionCount - 1,
                                toChunk: this.chunkTransitionCount,
                                gapMs: actualGap,
                                hasCrossfade: crossFadeCompleted,
                                crossfadeDurationMs: this.currentCrossfadeDuration,
                                hasSentenceBoundary: !!this.queue[this.currentIndex - 1]?.sentenceChunk,
                                zeroCrossingSuccess: true, // Will be updated from audio-conversion
                                setTimeoutDrift: 0 // Will be tracked in crossfade
                            });
                        }
                    }

                    // FIX: More precise transition check
                    // Skip ONLY if cross-fade is IN PROGRESS (started but not completed)
                    if (this._isTransitioning && crossFadeStarted && !crossFadeCompleted) {
                        console.log('⏭️ [AudioQueue] Cross-fade in progress, skipping didJustFinish');
                        didFinishHandled = false; // Reset flag - cross-fade will handle it
                        return;
                    }

                    // If cross-fade completed, we should continue normally
                    if (crossFadeCompleted) {
                        console.log('✅ [AudioQueue] Cross-fade was completed, processing didJustFinish normally');
                    }

                    // Set transition flag
                    this._isTransitioning = true;

                    // Cancel scheduled cross-fade if it hasn't started yet
                    if (crossFadeTimeout && !crossFadeStarted) {
                        console.log('🚫 [AudioQueue] Cancelling scheduled crossfade (file finished first)');
                        clearTimeout(crossFadeTimeout);
                        crossFadeTimeout = null;
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

                    // If crossfade was completed, next is already playing
                    if (crossFadeCompleted && next) {
                        try {
                            const nextStatus = await next.sound.getStatusAsync();
                            if (nextStatus.isLoaded && nextStatus.isPlaying) {
                                console.log(`🎵 [AudioQueue] Seamless transition via completed cross-fade`);
                                // Ensure full volume
                                await next.sound.setVolumeAsync(1.0);

                                // Reset transition flag
                                this._isTransitioning = false;

                                // FIX: Clear promise BEFORE recursive call
                                this.playCurrentPromise = null;

                                // Continue to next
                                this.playCurrent();
                                return;
                            }
                        } catch (error) {
                            console.warn('⚠️ [AudioQueue] Error checking next status:', error);
                        }
                    }

                    // PHASE 3: Gapless transition - NO artificial pauses
                    // Modern iOS audio handles gapless transitions without needing micro-pauses
                    const usedCrossfade = crossFadeCompleted || crossFadeStarted;

                    if (!usedCrossfade && next) {
                        console.log(`🔗 [AudioQueue] Gapless transition`);
                    }

                    // Reset transition flag before continuing
                    this._isTransitioning = false;

                    // FIX: Clear promise BEFORE recursive call
                    this.playCurrentPromise = null;

                    // Fallback: normal transition
                    this.playCurrent();
                }
            });

            // Start playback and measure gap from previous finish
            try {
                const playStartTime = Date.now();
                this.lastChunkStartTime = playStartTime;

                if (this.currentIndex > 0 && this.lastTransitionTime > 0) {
                    // Calculate REAL gap from last chunk finish to this chunk start
                    const actualGap = playStartTime - this.lastTransitionTime;

                    // TOTAL GAPLESS: Enhanced iOS gap detection
                    const gapEmoji = actualGap > 100 ? '⚠️' : actualGap > 50 ? '⏱️' : '✅';
                    console.log(`${gapEmoji} [GapDetect] Transition gap: ${actualGap}ms`);

                    if (this.isIOS && actualGap > 50) {
                        console.warn(`⚠️ [iOS] LARGE GAP DETECTED: ${actualGap}ms`);
                        console.warn(`   This may cause perceptible pause in audio!`);
                    }

                    // Log gap severity
                    if (actualGap > 150) {
                        console.error(`🚨 [CRITICAL] Gap > 150ms: ${actualGap}ms - Severe audio artifact!`);
                    }
                }

                // FIX: Check if chunk is already playing (from cross-fade)
                const statusBefore = await current.sound.getStatusAsync();
                if (statusBefore.isLoaded && statusBefore.isPlaying) {
                    console.log(`🎵 [AudioQueue] Chunk ${this.currentIndex + 1} already playing (from cross-fade), skipping playAsync`);
                } else {
                    // Start playback normally
                    await current.sound.playAsync();
                    const playLatency = Date.now() - playStartTime;
                    console.log(`🎵 [AudioQueue] playAsync() latency: ${playLatency}ms`);

                    // iOS-specific: Warn about slow playAsync
                    if (this.isIOS && playLatency > 30) {
                        console.warn(`⚠️ [iOS] Slow playAsync: ${playLatency}ms (expected < 30ms)`);
                    }
                }

                // FIX: Safety timeout for final chunk - if didJustFinish never fires
                if (isFinalChunk) {
                    const status = await current.sound.getStatusAsync();
                    if (status.isLoaded && status.durationMillis) {
                        const expectedDuration = status.durationMillis;
                        const safetyDelay = expectedDuration + this.FINAL_CHUNK_SAFETY_MS;

                        console.log(`⏰ [AudioQueue] Setting safety timeout for final chunk: ${safetyDelay}ms (duration: ${expectedDuration}ms)`);

                        this.finalChunkSafetyTimeout = setTimeout(async () => {
                            if (!didFinishHandled && this._isPlaying) {
                                console.warn('⚠️ [AudioQueue] SAFETY TIMEOUT fired for final chunk!');
                                console.warn('   didJustFinish never fired - forcing completion...');

                                // Force cleanup
                                didFinishHandled = true;
                                current.sound.setOnPlaybackStatusUpdate(null);
                                this._isPlaying = false;
                                this.playCurrentPromise = null;
                                this._isTransitioning = false;

                                if (this.completionResolve) {
                                    console.log('✅ [AudioQueue] Forced completion via safety timeout');
                                    this.completionResolve();
                                }
                            }
                        }, safetyDelay);
                    }
                }

                // PHASE 2.3: ALWAYS schedule cross-fade (different types: Natural vs Micro)
                if (next) {
                    const status = await current.sound.getStatusAsync();
                    if (status.isLoaded && status.durationMillis) {
                        // Determine transition type
                        const hasPunctuation = this.hasNaturalPause(this.currentIndex);
                        const { duration: crossfadeDuration, isAtomicSwitch } = this.getCrossfadeDuration(
                            status.durationMillis,
                            hasPunctuation
                        );
                        const triggerTime = status.durationMillis - crossfadeDuration;

                        const fadeType = hasPunctuation ? "Natural" : "Atomic";
                        console.log(`⏰ [SmartCrossfade] Scheduling ${fadeType} Fade in ${triggerTime}ms (${crossfadeDuration}ms, atomic: ${isAtomicSwitch})`);

                        // TOTAL GAPLESS: For atomic switch (0ms), just let chunk finish naturally
                        // Zero-crossing alignment in createChunkFile handles the clean splice
                        if (triggerTime > 0 && !isAtomicSwitch) {
                            console.log(`⏰ [AudioQueue] Scheduling cross-fade in ${triggerTime}ms (duration: ${crossfadeDuration}ms)`);

                            // DEBUG: Track scheduled time for drift detection
                            this.lastCrossfadeScheduledTime = Date.now() + triggerTime;
                            this.currentCrossfadeDuration = crossfadeDuration;

                            crossFadeTimeout = setTimeout(async () => {
                                // DEBUG: Track setTimeout drift
                                const actualTime = Date.now();
                                const drift = actualTime - this.lastCrossfadeScheduledTime;

                                console.log(`🎯 [Crossfade] Fired at ${actualTime}, scheduled for ${this.lastCrossfadeScheduledTime}, drift: ${drift}ms`);
                                if (Math.abs(drift) > 10) {
                                    console.warn(`⚠️ [Crossfade] Large setTimeout drift: ${drift}ms`);
                                }

                                // FIX: Check if already transitioning via didJustFinish
                                if (this._isTransitioning) {
                                    console.log('⏭️ [AudioQueue] File already finished, skipping crossfade');
                                    return;
                                }

                                // Set transition flag
                                this._isTransitioning = true;
                                crossFadeStarted = true;

                                console.log(`🔄 [AudioQueue] Starting SCHEDULED cross-fade (${crossfadeDuration}ms)`);

                                try {
                                    // TOTAL GAPLESS: True atomic switch for word boundaries (0ms)
                                    if (isAtomicSwitch || crossfadeDuration <= 10) {
                                        // Atomic switch - zero delay transition
                                        // Zero-crossing alignment ensures clean splice
                                        await next.sound.setVolumeAsync(1.0);
                                        await next.sound.playAsync();
                                        await current.sound.setVolumeAsync(0.0);
                                        console.log(`⚡ [AudioQueue] Atomic switch complete (0ms crossfade)`);
                                    } else {
                                        // Standard multi-step fade for 40-120ms
                                        const fadeSteps = 10;
                                        const stepDuration = crossfadeDuration / fadeSteps;

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
                                    }
                                    crossFadeCompleted = true;

                                    // Reset transition flag
                                    this._isTransitioning = false;

                                    // FIX: Manually trigger transition to next chunk
                                    // (because didJustFinish was skipped)
                                    console.log(`🔄 [AudioQueue] Manually transitioning to next chunk after cross-fade`);

                                    // Clear current chunk's handler (it already finished during cross-fade)
                                    current.sound.setOnPlaybackStatusUpdate(null);

                                    // Move to next
                                    this.currentIndex++;
                                    this.lastTransitionTime = Date.now();

                                    // Clear promise and call playCurrent
                                    this.playCurrentPromise = null;
                                    this.playCurrent();

                                } catch (error) {
                                    console.error('❌ [AudioQueue] Cross-fade error:', error);
                                    this._isTransitioning = false;
                                }
                            }, triggerTime);
                        } else if (isAtomicSwitch) {
                            // TOTAL GAPLESS: For atomic switch, let chunk finish naturally
                            // Zero-crossing alignment in createChunkFile ensures clean splice
                            console.log(`⚡ [AudioQueue] Atomic switch mode - no scheduled crossfade (gapless via zero-crossing)`);
                        }
                    }
                }

            } catch (error) {
                console.error('❌ [AudioQueue] Playback error:', error);

                // Cancel scheduled cross-fade
                if (crossFadeTimeout) {
                    clearTimeout(crossFadeTimeout);
                }

                // Reset flags
                this._isTransitioning = false;

                this.currentIndex++;

                // FIX: Clear promise BEFORE recursive call
                this.playCurrentPromise = null;

                this.playCurrent();
            }
        })();

        await this.playCurrentPromise;
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

        // FIX: Clear safety timeout
        if (this.finalChunkSafetyTimeout) {
            clearTimeout(this.finalChunkSafetyTimeout);
            this.finalChunkSafetyTimeout = null;
        }

        // FIX: Reset synchronization flags
        this._isTransitioning = false;
        this.playCurrentPromise = null;

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

        // DEBUG: Reset artifact tracker
        this.artifactTracker.reset();
        this.lastCrossfadeScheduledTime = 0;
        this.currentCrossfadeDuration = 0;

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

    /**
     * DEBUG: Get artifact tracking report
     */
    getArtifactReport(): string {
        return this.artifactTracker.getReport();
    }

    /**
     * DEBUG: Reset artifact tracker
     */
    resetArtifactTracker(): void {
        this.artifactTracker.reset();
    }
}

/**
 * Chunking modes for adaptive streaming
 */
enum ChunkingMode {
    FAST_START = 'fast_start',      // First 2 files for low latency
    SENTENCE_MODE = 'sentence',      // Sentence-based chunking with timestamps
    FALLBACK = 'fallback'            // Time-based fallback if no timestamps
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

    // TOTAL GAPLESS: iOS-specific settings
    private readonly isIOS = Platform.OS === 'ios';

    // NEW: Sentence chunking state
    private accumulatedPcmData: ArrayBuffer[] = [];
    private currentContextId: string | null = null;
    private originalText: string = '';

    // PHASE 1: Adaptive chunking state
    private chunkingMode: ChunkingMode = ChunkingMode.FAST_START;
    private fastStartFilesCreated: number = 0;
    private hasReceivedTimestamps: boolean = false;

    // Timestamp accumulation
    private incomingTimestamps: WordTimestamp[] = [];

    // FIX: Track audio offset for FAST_START → SENTENCE_MODE sync
    private fastStartAudioOffsetMs: number = 0;  // Total audio created in FAST_START mode
    private lastProcessedTimestampIndex: number = 0;

    // Audio offset tracking
    private totalAudioDurationMs: number = 0;

    // PHASE 6: Centralized configuration for easy tuning
    private readonly CONFIG = {
        FAST_START: {
            CHUNKS_PER_FILE: 25,        // ~1250ms per file at 16kHz
            MAX_FILES: 2,               // Switch to SENTENCE_MODE after 2 files
        },
        SENTENCE: {
            MIN_DURATION_MS: 1000,      // Minimum sentence file duration (increased from 500ms)
            MAX_DURATION_MS: 3500,      // Maximum before force flush (increased from 2500ms)
            LONG_SENTENCE_MS: 3000,     // Try sub-sentence split at this threshold
        },
        FALLBACK: {
            CHUNKS_PER_FILE: 20,        // ~1000ms per file (no timestamps)
        },
        CROSSFADE: {
            FAST_START_MS: 100,         // Crossfade for fast-start files
            SENTENCE_MS: 120,           // Crossfade for sentence-based files
            FALLBACK_MS: 100,           // Crossfade for fallback files
        },
        FEATURES: {
            USE_SENTENCE_CHUNKING: true,  // Master feature flag
            VERBOSE_LOGGING: true,         // PHASE 6: Detailed logs (set false for production)
        },
        // TOTAL GAPLESS: iOS-specific settings
        IOS: {
            PRELOAD_AHEAD: 3,           // Preload 3 chunks ahead on iOS (prevents underruns)
            MIN_BUFFER_MS: 300,         // Larger buffer for iOS
            GAP_WARNING_THRESHOLD: 50,  // Warn if gap > 50ms
            GAP_CRITICAL_THRESHOLD: 150, // Critical if gap > 150ms
        },
        ANDROID: {
            PRELOAD_AHEAD: 2,           // Preload 2 chunks ahead on Android
            MIN_BUFFER_MS: 200,         // Standard buffer for Android
        }
    };

    // Backward compatibility
    private get CHUNKS_PER_FILE() { return this.CONFIG.FAST_START.CHUNKS_PER_FILE; }
    private get USE_SENTENCE_CHUNKING() { return this.CONFIG.FEATURES.USE_SENTENCE_CHUNKING; }

    // PHASE 6: Conditional logging helper
    private log(message: string, ...args: any[]): void {
        if (this.CONFIG.FEATURES.VERBOSE_LOGGING) {
            console.log(message, ...args);
        }
    }

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
     * PHASE 2-3: Receive timestamps from Cartesia service in real-time
     * Called directly by TTS service when timestamps arrive
     */
    public receiveTimestamps(timestamps: WordTimestamp[]): void {
        console.log(`📝 [Player] Received ${timestamps.length} timestamps`);

        // Accumulate timestamps
        this.incomingTimestamps.push(...timestamps);
        this.hasReceivedTimestamps = true;

        console.log(`   Total timestamps: ${this.incomingTimestamps.length} words`);
        console.log(`   Mode: ${this.chunkingMode}, Fast-start files: ${this.fastStartFilesCreated}`);

        // PHASE 3: Detect sentence boundaries in real-time
        if (this.chunkingMode === ChunkingMode.SENTENCE_MODE ||
            this.chunkingMode === ChunkingMode.FAST_START) {

            const boundaries = SentenceDetector.findCompletedSentences(
                this.incomingTimestamps,
                this.lastProcessedTimestampIndex
            );

            if (boundaries.length > 0) {
                console.log(`✨ [Player] Detected ${boundaries.length} sentence boundaries:`);
                boundaries.forEach((b, i) => {
                    const duration = SentenceDetector.getSentenceDuration(
                        this.incomingTimestamps,
                        b,
                        this.lastProcessedTimestampIndex
                    );
                    console.log(`   ${i + 1}. "${b.sentence.substring(0, 50)}..." (${duration.toFixed(0)}ms)`);
                });
            }
        }

        // Trigger mode switch if ready (after 2 fast-start files)
        if (this.chunkingMode === ChunkingMode.FAST_START &&
            this.fastStartFilesCreated >= 2) {
            this.switchToSentenceMode();
        }
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
            // TOTAL GAPLESS: iOS-specific audio session configuration
            // iOS requires staysActiveInBackground to prevent audio interruptions
            const audioModeConfig = {
                playsInSilentModeIOS: true,
                staysActiveInBackground: this.isIOS,  // iOS: Keep active in background
                shouldDuckAndroid: true,
                allowsRecordingIOS: true,  // iOS: Allow recording + playback
            };

            // iOS-specific: Disable ducking to prevent volume dips
            if (this.isIOS) {
                console.log('🔧 [iOS] Configuring audio session for gapless playback');
                console.log('   - staysActiveInBackground: true');
                console.log('   - allowsRecordingIOS: true');
            }

            await Audio.setAudioModeAsync(audioModeConfig);

            // PHASE 4: Process chunks with adaptive mode-based chunking
            for await (const chunk of chunkGenerator) {
                this.metrics.totalChunks = (this.metrics.totalChunks || 0) + 1;
                this.metrics.totalBytes = (this.metrics.totalBytes || 0) + chunk.sizeBytes;

                // Track first chunk
                if (this.metrics.firstChunkTime === null) {
                    this.metrics.firstChunkTime = Date.now();
                    const latency = this.metrics.firstChunkTime - (this.metrics.generationStart || 0);
                    console.log(`🎯 [Chunked Player] First chunk in ${latency}ms`);
                }

                // Accumulate PCM data for sentence chunking
                if (enableSentenceChunking) {
                    this.accumulatedPcmData.push(chunk.data);
                }

                accumulatedChunks.push(chunk);

                // Track audio duration
                const chunkDuration = calculateAudioDuration(chunk.sizeBytes);
                this.totalAudioDurationMs += chunkDuration;

                // --- FAST_START MODE: Word-boundary aware chunks for low latency ---
                if (this.chunkingMode === ChunkingMode.FAST_START) {
                    // ⭐ SMART FAST_START: Use word boundaries when timestamps available
                    const minChunksReached = accumulatedChunks.length >= this.CHUNKS_PER_FILE;

                    // Check if we should create a file
                    let shouldCreateFile = false;
                    let lastWordBoundary: string | null = null;

                    if (minChunksReached) {
                        if (this.hasReceivedTimestamps && this.incomingTimestamps.length > 0) {
                            // ⭐ SMART MODE: Find word boundary based on accumulated audio duration
                            // Current audio duration tells us where we are in the timestamps
                            const currentAudioTimeSeconds = this.totalAudioDurationMs / 1000;

                            // Find the last complete word before or at current position
                            let lastCompleteWordIndex = -1;
                            for (let i = 0; i < this.incomingTimestamps.length; i++) {
                                if (this.incomingTimestamps[i].end <= currentAudioTimeSeconds + 0.1) { // 100ms tolerance
                                    lastCompleteWordIndex = i;
                                }
                            }

                            if (lastCompleteWordIndex >= 0) {
                                const lastWord = this.incomingTimestamps[lastCompleteWordIndex];
                                lastWordBoundary = lastWord.word;

                                // Check if this word ends with punctuation (natural break point)
                                const hasPunctuation = /[.!?,;:]$/.test(lastWord.word);

                                // Always cut at word boundaries to avoid mid-word artifacts
                                shouldCreateFile = true;

                                // ⭐ FIX: Sync timestamp index so SENTENCE_MODE continues from here
                                this.lastProcessedTimestampIndex = lastCompleteWordIndex + 1;

                                console.log(`🎯 [FAST_START] Word boundary: "${lastWord.word}" at ${lastWord.end.toFixed(2)}s (punctuation: ${hasPunctuation}, syncIdx: ${this.lastProcessedTimestampIndex})`);
                            } else {
                                // No complete word yet, continue accumulating
                                console.log(`⏳ [FAST_START] Waiting for word boundary (audio: ${currentAudioTimeSeconds.toFixed(2)}s)`);
                            }
                        } else {
                            // Legacy mode: no timestamps, cut by chunk count
                            shouldCreateFile = true;
                            console.log(`⚠️ [FAST_START] No timestamps, using legacy chunk-count mode`);
                        }
                    }

                    if (shouldCreateFile) {
                        const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                        fileIndex++;
                        this.fastStartFilesCreated++;

                        const duration = calculateAudioDuration(
                            accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                        );

                        const boundaryInfo = lastWordBoundary ? ` [→"${lastWordBoundary}"]` : '';
                        console.log(`📦 [FAST_START] File #${fileIndex}: ${duration.toFixed(0)}ms (${this.fastStartFilesCreated}/2)${boundaryInfo}`);

                        // ⭐ NEW: Create pseudo-sentence metadata for better crossfade decisions
                        let sentenceChunk: SentenceChunk | undefined = undefined;
                        if (lastWordBoundary) {
                            sentenceChunk = {
                                pcmData: new ArrayBuffer(0),
                                sentence: `...${lastWordBoundary}`, // Mark as partial with last word
                                startTimeSeconds: 0,
                                endTimeSeconds: this.totalAudioDurationMs / 1000,
                                durationMs: duration,
                                wordCount: 1
                            };
                        }

                        await this.audioQueue.enqueue(filepath, sentenceChunk, duration);

                        // Start playback after first file
                        if (!playbackStarted) {
                            console.log(`✅ [Player] Starting playback (latency: ${Date.now() - (this.metrics.generationStart || 0)}ms)`);
                            this.state = 'playing';
                            this.metrics.firstPlayTime = Date.now();
                            await this.audioQueue.start();
                            playbackStarted = true;
                        }

                        // FIX: Track total audio offset from FAST_START for SENTENCE_MODE sync
                        this.fastStartAudioOffsetMs += this.totalAudioDurationMs;
                        console.log(`📊 [FAST_START] Audio offset updated: ${this.fastStartAudioOffsetMs}ms`);

                        accumulatedChunks = [];
                        this.totalAudioDurationMs = 0;

                        // PHASE 5: Switch to SENTENCE_MODE or FALLBACK after 2 fast-start files
                        if (this.fastStartFilesCreated >= this.CONFIG.FAST_START.MAX_FILES) {
                            if (this.hasReceivedTimestamps) {
                                this.switchToSentenceMode();
                            } else {
                                // No timestamps received, use fallback mode
                                this.switchToFallbackMode();
                            }
                        }
                    }
                }

                // --- SENTENCE MODE: Create files on sentence boundaries ---
                else if (this.chunkingMode === ChunkingMode.SENTENCE_MODE) {
                    // PHASE 5: Safety check - ensure we have timestamps
                    if (this.incomingTimestamps.length === 0) {
                        console.warn('⚠️ [SENTENCE] No timestamps available, switching to FALLBACK');
                        this.switchToFallbackMode();
                        continue; // Re-process this chunk in FALLBACK mode
                    }

                    // Check for completed sentences
                    const boundaries = SentenceDetector.findCompletedSentences(
                        this.incomingTimestamps,
                        this.lastProcessedTimestampIndex
                    );

                    if (boundaries.length > 0) {
                        const lastBoundary = boundaries[boundaries.length - 1];

                        // Create file if we have enough audio (min duration)
                        if (this.totalAudioDurationMs >= this.CONFIG.SENTENCE.MIN_DURATION_MS) {
                            const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                            fileIndex++;

                            console.log(`📦 [SENTENCE] File #${fileIndex}: "${lastBoundary.sentence.substring(0, 40)}..." (${this.totalAudioDurationMs.toFixed(0)}ms)`);

                            // PHASE 1: Create SentenceChunk metadata for intelligent crossfade
                            const startTimeSeconds = this.incomingTimestamps[this.lastProcessedTimestampIndex]?.start || 0;
                            const wordCount = lastBoundary.wordIndex - this.lastProcessedTimestampIndex + 1;

                            const sentenceChunk: SentenceChunk = {
                                pcmData: new ArrayBuffer(0), // Not needed for crossfade logic
                                sentence: lastBoundary.sentence,
                                startTimeSeconds: startTimeSeconds,
                                endTimeSeconds: lastBoundary.endTimeSeconds,
                                durationMs: this.totalAudioDurationMs,
                                wordCount: wordCount
                            };

                            await this.audioQueue.enqueue(filepath, sentenceChunk, this.totalAudioDurationMs);

                            // Reset for next sentence
                            accumulatedChunks = [];
                            this.totalAudioDurationMs = 0;
                            this.lastProcessedTimestampIndex = lastBoundary.wordIndex + 1;
                        }
                    }
                    // PHASE 5: Try sub-sentence splitting for long sentences (> 3s)
                    else if (this.totalAudioDurationMs >= this.CONFIG.SENTENCE.LONG_SENTENCE_MS && boundaries.length === 0) {
                        // Try splitting at commas, semicolons, or dashes
                        const subBoundaries = SentenceDetector.findSubSentenceBoundaries(
                            this.incomingTimestamps,
                            this.lastProcessedTimestampIndex
                        );

                        if (subBoundaries.length > 0) {
                            const lastSubBoundary = subBoundaries[subBoundaries.length - 1];

                            console.log(`✂️ [SENTENCE] Splitting long sentence at comma/dash (${this.totalAudioDurationMs.toFixed(0)}ms)`);

                            const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                            fileIndex++;

                            // PHASE 1: Create SentenceChunk for sub-sentence boundary
                            const startTimeSeconds = this.incomingTimestamps[this.lastProcessedTimestampIndex]?.start || 0;
                            const wordCount = lastSubBoundary.wordIndex - this.lastProcessedTimestampIndex + 1;

                            const sentenceChunk: SentenceChunk = {
                                pcmData: new ArrayBuffer(0),
                                sentence: lastSubBoundary.sentence,
                                startTimeSeconds: startTimeSeconds,
                                endTimeSeconds: lastSubBoundary.endTimeSeconds,
                                durationMs: this.totalAudioDurationMs,
                                wordCount: wordCount
                            };

                            await this.audioQueue.enqueue(filepath, sentenceChunk, this.totalAudioDurationMs);

                            // Reset for next segment
                            accumulatedChunks = [];
                            this.totalAudioDurationMs = 0;
                            this.lastProcessedTimestampIndex = lastSubBoundary.wordIndex + 1;
                        }
                    }
                    // ⭐ Step 3 Fix: Force flush with word-boundary detection
                    else if (this.totalAudioDurationMs >= this.CONFIG.SENTENCE.MAX_DURATION_MS) {
                        // Check if we're mid-word before force-flushing
                        const lastWord = this.incomingTimestamps[this.lastProcessedTimestampIndex];
                        const nextWord = this.incomingTimestamps[this.lastProcessedTimestampIndex + 1];

                        const currentAudioTimeSeconds = this.totalAudioDurationMs / 1000;
                        const isMidWord = lastWord && nextWord &&
                                          !/[.!?;,]/.test(lastWord.word) &&
                                          lastWord.end > (currentAudioTimeSeconds - 0.5);

                        if (isMidWord && this.totalAudioDurationMs < 4500) {
                            // Extend buffer by ~500ms to complete the word
                            console.log(`⏳ [SENTENCE] Mid-word detected, extending buffer (current: ${this.totalAudioDurationMs.toFixed(0)}ms, last: "${lastWord.word}")`);
                            // Don't flush - continue accumulating to complete the word
                        } else {
                            // Safe to flush - either not mid-word or exceeded hard limit
                            console.warn(`⚠️ [SENTENCE] Force flush (max duration: ${this.totalAudioDurationMs.toFixed(0)}ms)`);

                            const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                            fileIndex++;

                            // No sentence metadata for force flush (no natural boundary)
                            await this.audioQueue.enqueue(filepath, undefined, this.totalAudioDurationMs);

                            accumulatedChunks = [];
                            this.totalAudioDurationMs = 0;
                        }
                    }
                }

                // --- FALLBACK MODE: Large fixed chunks (no timestamps) ---
                else if (this.chunkingMode === ChunkingMode.FALLBACK) {
                    if (accumulatedChunks.length >= this.CONFIG.FALLBACK.CHUNKS_PER_FILE) {
                        const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                        fileIndex++;

                        console.log(`📦 [FALLBACK] File #${fileIndex}: ${this.totalAudioDurationMs.toFixed(0)}ms`);

                        // PHASE 2: Pass duration for adaptive crossfade (no sentence metadata in fallback)
                        await this.audioQueue.enqueue(filepath, undefined, this.totalAudioDurationMs);

                        accumulatedChunks = [];
                        this.totalAudioDurationMs = 0;
                    }
                }
            }

            // Handle remaining chunks - but ONLY if there's meaningful audio
            if (accumulatedChunks.length > 0) {
                // Calculate duration FIRST to check if it's worth creating
                const finalDuration = calculateAudioDuration(
                    accumulatedChunks.reduce((sum, c) => sum + c.sizeBytes, 0)
                );

                // ⭐ FIX: Skip very short final chunks (<50ms) - they cause playback issues
                const MIN_FINAL_DURATION_MS = 50;

                if (finalDuration >= MIN_FINAL_DURATION_MS) {
                    const filepath = await this.createChunkFile(accumulatedChunks, fileIndex);
                    console.log(`📦 [Chunked Player] Created final file (${finalDuration.toFixed(0)}ms)`);

                    await this.audioQueue.enqueue(filepath, undefined, finalDuration);

                    if (!playbackStarted) {
                        this.state = 'playing';
                        this.metrics.firstPlayTime = Date.now();
                        await this.audioQueue.start();
                    }
                } else {
                    console.log(`⚠️ [Chunked Player] Skipping final file (too short: ${finalDuration.toFixed(0)}ms < ${MIN_FINAL_DURATION_MS}ms)`);
                }
            }

            // Wait for queue to complete
            console.log(`⏳ [Chunked Player] Waiting for playback completion (${this.audioQueue.length} files)...`);
            await this.audioQueue.waitForCompletion();

            this.state = 'completed';
            console.log('✅ [Chunked Player] Playback completed (gapless!)');

            // DEBUG: Log artifact report
            console.log(this.audioQueue.getArtifactReport());

            // PHASE 5: Enhanced statistics logging
            console.log('📊 [Player] Playback Statistics:');
            console.log(`  Total files created: ${fileIndex}`);
            console.log(`  Fast-start files: ${this.fastStartFilesCreated}`);
            console.log(`  Sentence/Fallback files: ${fileIndex - this.fastStartFilesCreated}`);
            console.log(`  Final mode: ${this.chunkingMode}`);
            console.log(`  Timestamps received: ${this.incomingTimestamps.length} words`);
            console.log(`  Sentences processed: ${this.lastProcessedTimestampIndex} words`);

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
     * Create WAV file from chunks with zero-crossing alignment and soft edges applied
     * ⭐ Zero-Crossing Fix: Align PCM to zero-crossing points BEFORE soft edges
     */
    private async createChunkFile(
        chunks: AudioChunk[],
        index: number
    ): Promise<string> {
        const pcmBuffers = chunks.map(c => c.data);

        // Step 1: Merge all PCM chunks
        const mergedPCM = mergePCMChunks(pcmBuffers);
        const int16PCM = new Int16Array(mergedPCM);

        // Step 2: Zero-crossing alignment (BEFORE soft edges) - Prevents clicks at boundaries
        const zeroCrossingResult = alignPCMToZeroCrossing(int16PCM, 16000, 20);

        // Step 3: Apply soft edges to ALIGNED data - Additional smoothing
        // Convert Int16Array.buffer (ArrayBufferLike) to ArrayBuffer
        const alignedBuffer = new ArrayBuffer(zeroCrossingResult.alignedData.byteLength);
        new Uint8Array(alignedBuffer).set(new Uint8Array(zeroCrossingResult.alignedData.buffer));
        const pcmWithEdges = applySoftEdges(alignedBuffer, 20, 20, 16000);

        const wavBuffer = createWavFile([pcmWithEdges], this.config.chunkSampleRate);
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
     * PHASE 1: Switch to sentence-based chunking mode
     */
    private switchToSentenceMode(): void {
        console.log('🔄 [Player] Switching to SENTENCE_MODE');
        console.log(`   Fast-start files created: ${this.fastStartFilesCreated}`);
        console.log(`   Fast-start audio offset: ${this.fastStartAudioOffsetMs}ms`);
        console.log(`   Timestamps received: ${this.incomingTimestamps.length} words`);
        console.log(`   Starting from timestamp index: ${this.lastProcessedTimestampIndex}`);

        // Debug: show which word we're starting from
        if (this.incomingTimestamps[this.lastProcessedTimestampIndex]) {
            const startWord = this.incomingTimestamps[this.lastProcessedTimestampIndex];
            console.log(`   Starting at word: "${startWord.word}" (${startWord.start.toFixed(2)}s)`);
        }

        this.chunkingMode = ChunkingMode.SENTENCE_MODE;
    }

    /**
     * PHASE 1: Switch to fallback mode (no timestamps)
     */
    private switchToFallbackMode(): void {
        console.warn('⚠️ [Player] Switching to FALLBACK mode (no timestamps)');
        this.chunkingMode = ChunkingMode.FALLBACK;
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

        // PHASE 1: Clear adaptive chunking state
        this.chunkingMode = ChunkingMode.FAST_START;
        this.fastStartFilesCreated = 0;
        this.hasReceivedTimestamps = false;
        this.incomingTimestamps = [];
        this.lastProcessedTimestampIndex = 0;
        this.totalAudioDurationMs = 0;
        this.fastStartAudioOffsetMs = 0;  // FIX: Reset audio offset

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
