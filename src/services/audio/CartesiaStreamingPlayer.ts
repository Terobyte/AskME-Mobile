/**
 * Cartesia Streaming Player - The Real Streaming Engine
 *
 * TRUE streaming audio player using react-native-audio-api.
 * Plays chunks as they arrive - NO accumulation of all chunks!
 *
 * Architecture:
 * Cartesia WebSocket (PCM16)
 *    ↓
 * Int16ToFloat32Converter
 *    ↓
 * FIFOQueue (ordering)
 *    ↓
 * JitterBuffer (pre-buffer 300ms)
 *    ↓
 * ZeroCrossingAligner (artifact-free)
 *    ↓
 * AudioContextManager (playout)
 *
 * @depends react-native-audio-api
 */

import { cartesiaStreamingService } from '../cartesia-streaming-service';
import { Int16ToFloat32Converter } from '../../utils/audio/Int16ToFloat32Converter';
import { FIFOQueue } from '../../utils/audio/FIFOQueue';
import { JitterBuffer, BufferState, UnderrunStrategy } from '../../utils/audio/JitterBuffer';
import { ZeroCrossingAligner, AlignmentMode } from '../../utils/audio/ZeroCrossingAligner';
import { AudioContextManager } from '../../utils/audio/AudioContextManager';
import { AudioChunk, CartesiaStreamingOptions } from '../../types';

/**
 * Player state machine
 */
export enum PlayerState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  BUFFERING = 'buffering',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  DONE = 'done',
  ERROR = 'error',
}

/**
 * Player events for listeners
 */
export type PlayerEvent =
  | 'connecting'
  | 'connected'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'done'
  | 'underrun'
  | 'error'
  | 'metrics';

/**
 * Comprehensive player metrics
 */
export interface PlayerMetrics {
  /** Current player state */
  state: PlayerState;
  /** Buffer duration in milliseconds */
  bufferDuration: number;
  /** Pre-buffer threshold in milliseconds */
  thresholdDuration: number;
  /** Buffer fill percentage */
  bufferPercent: number;
  /** Number of samples queued in jitter buffer */
  samplesQueued: number;
  /** Playback position in samples */
  playbackPosition: number;
  /** Current latency in milliseconds (time to first chunk) */
  firstChunkLatency: number;
  /** Total playback latency (time to first sound) */
  playbackLatency: number;
  /** Number of chunks dropped from jitter buffer */
  droppedChunks: number;
  /** Number of buffer underruns */
  underrunCount: number;
  /** Current gain (volume) */
  gain: number;
  /** Total chunks received */
  chunksReceived: number;
  /** Total chunks played */
  chunksPlayed: number;
  /** Chunks per second rate */
  chunksPerSecond: number;
  /** FIFO queue size */
  fifoQueueSize: number;
  /** Is currently streaming */
  isStreaming: boolean;
}

/**
 * Player configuration
 */
export interface CartesiaPlayerConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Pre-buffer threshold in milliseconds */
  preBufferThreshold: number;
  /** Maximum buffer size in seconds */
  maxBufferSize: number;
  /** Underrun strategy */
  underrunStrategy: UnderrunStrategy;
  /** Initial gain (0.0 - 1.0) */
  initialGain: number;
  /** Whether to align to zero-crossing */
  useZeroCrossing: boolean;
  /** Playback chunk size in samples (320 = ~20ms at 16kHz) */
  chunkSize: number;
  /** FIFO queue max size */
  fifoMaxSize: number;
  /** Processing interval in ms (20 = 50Hz) */
  processingInterval: number;
}

/**
 * Event listener type
 */
export type EventListener = (data: any) => void;

/**
 * Default configuration
 *
 * HIGH-PERFORMANCE CONFIGURATION:
 * - sampleRate: 44100 (better quality than 16kHz)
 * - chunkSize: 4096 samples (~93ms at 44.1kHz) - reduces CPU overhead
 * - preBufferThreshold: 500ms (balance between latency and stability)
 * - processingInterval: 50ms (20Hz processing ticks)
 */
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 16000,
  preBufferThreshold: 500,  // 500ms pre-buffer (in milliseconds)
  maxBufferSize: 5,         // 5 seconds max buffer
  underrunStrategy: UnderrunStrategy.SILENCE,
  initialGain: 1.0,
  useZeroCrossing: true,
  chunkSize: 2048,          // ~128ms at 16kHz (increased for stability)
  fifoMaxSize: 500,         // Larger FIFO for stability
  processingInterval: 50,   // 50Hz processing
};

/**
 * Cartesia Streaming Player Class
 *
 * The real streaming engine that plays audio chunks as they arrive.
 */
export class CartesiaStreamingPlayer {
  // Components
  private converter: Int16ToFloat32Converter;
  private fifoQueue: FIFOQueue<AudioChunk>;
  private jitterBuffer: JitterBuffer;
  private audioContext: AudioContextManager;
  private zeroCrossingAligner: ZeroCrossingAligner;

  // State
  private state: PlayerState = PlayerState.IDLE;
  private config: Required<CartesiaPlayerConfig>;
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private isStreaming: boolean = false;

  // Timers
  private processingTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;

  // Event listeners
  private eventListeners: Map<PlayerEvent, Set<EventListener>> = new Map();

  // Metrics tracking
  private startTime: number = 0;
  private firstChunkTime: number = 0;
  private firstSoundTime: number = 0;
  private chunksReceived: number = 0;
  private chunksReceivedLastSecond: number = 0;
  private chunksPlayed: number = 0;
  private lastChunksPerSecondCheck: number = 0;

  // Abort control
  private abortController: AbortController | null = null;
  private currentGenerator: AsyncGenerator<AudioChunk> | null = null;

  // Playback scheduling
  private scheduledSources: Set<any> = new Set();

  // ✨ NEW: Track cumulative scheduled time to prevent chunks playing simultaneously
  private nextScheduledTime: number = 0;

  // Track if 'done' event was already emitted to prevent duplicates
  private doneEmitted: boolean = false;

  constructor(config?: Partial<CartesiaPlayerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // DEBUG: Detailed config logging
    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║   CartesiaStreamingPlayer Config        ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║ sampleRate:           ${String(this.config.sampleRate).padEnd(20)} ║`);
    console.log(`║ chunkSize:            ${String(this.config.chunkSize).padEnd(20)} ║`);
    console.log(`║ preBufferThreshold:   ${String(this.config.preBufferThreshold + 'ms').padEnd(20)} ║`);
    console.log(`║ processingInterval:   ${String(this.config.processingInterval + 'ms').padEnd(20)} ║`);
    console.log(`║ fifoMaxSize:          ${String(this.config.fifoMaxSize).padEnd(20)} ║`);
    console.log(`╚════════════════════════════════════════╝`);

    // Initialize components
    this.converter = new Int16ToFloat32Converter({
      sampleRate: this.config.sampleRate,
      validate: true,
      clamp: true,
    });

    this.fifoQueue = new FIFOQueue<AudioChunk>({
      maxSize: this.config.fifoMaxSize,
      maxBytes: 5 * 1024 * 1024, // 5MB
      dropOldest: true,
    });

    this.jitterBuffer = new JitterBuffer({
      preBufferThreshold: this.config.preBufferThreshold,
      maxBufferSize: this.config.maxBufferSize,
      sampleRate: this.config.sampleRate,
      underrunStrategy: this.config.underrunStrategy,
    });

    this.audioContext = AudioContextManager.getInstance({
      sampleRate: this.config.sampleRate,
      initialGain: this.config.initialGain,
    });

    this.zeroCrossingAligner = new ZeroCrossingAligner();

    console.log('[CartesiaStreamingPlayer] Initialized with config:', this.config);
  }

  /**
   * Ensure AudioContext is valid, recreate if destroyed
   */
  private ensureAudioContextValid(): void {
    if (!this.audioContext.isValid()) {
      console.log('[CartesiaStreamingPlayer] AudioContext destroyed, recreating...');
      this.audioContext = AudioContextManager.getInstance({
        sampleRate: this.config.sampleRate,
        initialGain: this.config.initialGain,
      });
    }
  }

  /**
   * Speak text with streaming playback
   *
   * @param text - Text to speak
   * @param options - Cartesia streaming options
   */
  async speak(text: string, options?: Partial<CartesiaStreamingOptions>): Promise<void> {
    // ✅ Validate AudioContext BEFORE stopping
    this.ensureAudioContextValid();

    // Cleanup previous
    this.stop();

    // Reset done flag for new playback
    this.doneEmitted = false;

    // Setup abort
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Reset metrics
    this.startTime = Date.now();
    this.firstChunkTime = 0;
    this.firstSoundTime = 0;
    this.chunksReceived = 0;
    this.chunksReceivedLastSecond = 0;
    this.chunksPlayed = 0;
    this.lastChunksPerSecondCheck = Date.now();

    // Clear buffers
    this.fifoQueue.clear();
    this.jitterBuffer.reset();

    try {
      this.setState(PlayerState.CONNECTING);
      this.emit('connecting', { text: text.substring(0, 50) + '...' });

      // ✅ Validate AudioContext again after stop() (defensive)
      this.ensureAudioContextValid();

      // Initialize audio context
      try {
        if (!this.audioContext.isReady()) {
          await this.audioContext.initialize();
          console.log('[CartesiaStreamingPlayer] Audio context initialized');
        }
      } catch (error) {
        // If initialization fails with destroyed error, try recreating
        if (error instanceof Error && error.message.includes('destroyed')) {
          console.log('[CartesiaStreamingPlayer] Initialization failed, recreating AudioContext');
          this.ensureAudioContextValid();
          await this.audioContext.initialize();
        } else {
          throw error;
        }
      }

      // Get stream from Cartesia
      this.isStreaming = true;
      const stream = cartesiaStreamingService.generateAudioStream({
        text,
        voiceId: options?.voiceId || process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID,
        emotion: options?.emotion,
        speed: options?.speed,
        onFirstChunk: (latency) => {
          this.firstChunkTime = Date.now();
          console.log(`[CartesiaStreamingPlayer] First chunk latency: ${latency}ms`);
        },
        onChunk: (chunk) => {
          this.chunksReceived++;
        },
      });

      this.currentGenerator = stream;
      this.emit('connected', { text: text.substring(0, 50) + '...' });
      this.setState(PlayerState.BUFFERING);
      this.emit('buffering', { timestamp: Date.now() });

      // Start the streaming loop
      await this.streamingLoop(stream, signal);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CartesiaStreamingPlayer] Error:', errorMsg);
      this.setState(PlayerState.ERROR);
      this.emit('error', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Main streaming loop - receives chunks and feeds the pipeline
   */
  private async streamingLoop(
    stream: AsyncGenerator<AudioChunk>,
    signal: AbortSignal
  ): Promise<void> {
    // Start processing timer
    this.startProcessing();

    // Track if we received the first chunk
    let receivedFirstChunk = false;

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          console.log('[CartesiaStreamingPlayer] Stream aborted');
          break;
        }

        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          console.log('[CartesiaStreamingPlayer] First chunk received');
        }

        // Add to FIFO queue for processing
        this.fifoQueue.enqueue(chunk);
      }

      // Stream complete naturally
      if (!signal.aborted) {
        console.log('[CartesiaStreamingPlayer] Stream complete, draining buffers...');
        this.isStreaming = false;

        // Wait for buffers to drain (may have already completed via processCycle)
        await this.drainBuffers();

        // Only emit 'done' if processCycle hasn't already done so
        if (!this.doneEmitted) {
          this.doneEmitted = true;
          this.setState(PlayerState.DONE);
          this.emit('done', this.getMetrics());
          console.log('[CartesiaStreamingPlayer] ✅ Stream complete - emitted done event');
        }
      }

    } catch (error) {
      if (!signal.aborted) {
        console.error('[CartesiaStreamingPlayer] Stream error:', error);
        throw error;
      }
    } finally {
      this.currentGenerator = null;
      this.isStreaming = false;
    }
  }

  /**
   * Start processing chunks from FIFO to jitter buffer to audio
   */
  private startProcessing(): void {
    if (this.processingTimer) {
      return;
    }

    console.log('[CartesiaStreamingPlayer] Starting processing loop');

    this.processingTimer = setInterval(() => {
      this.processCycle();
    }, this.config.processingInterval);

    // ✨ NEW: Add buffering timeout protection (3 seconds)
    const bufferingTimeout = setTimeout(() => {
      if (this.state === PlayerState.BUFFERING) {
        console.error('[CartesiaStreamingPlayer] ⚠️ BUFFERING TIMEOUT (3s)!');

        const health = this.jitterBuffer.getBufferHealth();
        console.error('[CartesiaStreamingPlayer] Debug info:', {
          fifoSize: this.fifoQueue.size(),
          bufferDuration: health.currentDuration,
          threshold: this.config.preBufferThreshold,
          samplesAvailable: health.availableSamples,
          chunksReceived: this.chunksReceived,
          isStreaming: this.isStreaming,
        });

        // Try to force start if we have ANY data
        if (health.availableSamples > 0) {
          console.warn('[CartesiaStreamingPlayer] 🚨 Force starting with partial buffer');
          this.startPlayback();
        } else {
          // No data at all - something is wrong
          this.setState(PlayerState.ERROR);
          this.emit('error', {
            error: 'Buffering timeout - no data received',
            debug: {
              fifoSize: this.fifoQueue.size(),
              chunksReceived: this.chunksReceived,
              isStreaming: this.isStreaming,
            }
          });
        }
      }
    }, 3000); // 3 second timeout

    // Clear timeout when playback starts successfully
    const clearBufferingTimeout = () => {
      clearTimeout(bufferingTimeout);
      this.off('playing', clearBufferingTimeout);
    };
    this.on('playing', clearBufferingTimeout);

    // Start metrics timer (every 100ms)
    this.metricsTimer = setInterval(() => {
      this.emit('metrics', this.getMetrics());

      // Calculate chunks per second
      const now = Date.now();
      if (now - this.lastChunksPerSecondCheck >= 1000) {
        this.lastChunksPerSecondCheck = now;
        this.chunksReceivedLastSecond = this.chunksReceived;
      }
    }, 100);
  }

  /**
   * Single processing cycle - moves data through the pipeline
   */
  private processCycle(): void {
    // Snapshot state before processing
    const beforeFifo = this.fifoQueue.size();
    const beforeHealth = this.jitterBuffer.getBufferHealth();

    // Phase 1: Move chunks from FIFO to JitterBuffer
    this.fifoToJitterBuffer();

    // Snapshot state after processing
    const afterFifo = this.fifoQueue.size();
    const afterHealth = this.jitterBuffer.getBufferHealth();

    // Log state changes (only during buffering for clarity)
    if (this.state === PlayerState.BUFFERING) {
      if (beforeFifo !== afterFifo || beforeHealth.currentDuration !== afterHealth.currentDuration) {
        const canStart = this.jitterBuffer.canStartPlayback();
        console.log(
          `[ProcessCycle] FIFO: ${beforeFifo} → ${afterFifo}, ` +
          `Buffer: ${beforeHealth.currentDuration.toFixed(0)}ms → ${afterHealth.currentDuration.toFixed(0)}ms, ` +
          `Threshold: ${canStart ? '✅ READY' : `❌ ${afterHealth.currentDuration.toFixed(0)}/${this.config.preBufferThreshold}`}`
        );
      }
    }

    // Phase 2: Check if we can start playback
    if (!this.isPlaying && !this.isPaused && this.jitterBuffer.canStartPlayback()) {
      console.log('[ProcessCycle] ✅ Threshold reached - starting playback!');
      this.startPlayback();
    }

    // Phase 3: Schedule next chunk if playing
    if (this.isPlaying && !this.isPaused) {
      const hasData = afterHealth.availableSamples > 0;

      if (this.isStreaming || hasData) {
        this.scheduleNextChunk();
      } else {
        // No more data and stream ended - emit done event
        this.isPlaying = false;
        if (this.processingTimer) {
          clearInterval(this.processingTimer);
          this.processingTimer = null;
        }
        if (this.metricsTimer) {
          clearInterval(this.metricsTimer);
          this.metricsTimer = null;
        }

        // Emit 'done' event to signal playback completion
        if (!this.doneEmitted) {
          this.doneEmitted = true;
          this.setState(PlayerState.DONE);
          this.emit('done', this.getMetrics());
          console.log('[ProcessCycle] ✅ Playback complete - emitted done event');
        }
      }
    }

    // Phase 4: Check for underrun (only during active playback with active stream)
    if (this.isPlaying && this.isStreaming && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
      this.emit('underrun', this.getMetrics());
      console.warn('[ProcessCycle] ⚠️ Buffer underrun!');
    }
  }

  /**
   * Move chunks from FIFO queue to jitter buffer
   *
   * Implements flow control to prevent buffer overflow:
   * - During buffering: aggressive draining to reach threshold ASAP
   * - During playback: conservative draining to maintain stable buffer
   * - Stops transferring if buffer exceeds limit (leaves rest in FIFO)
   */
  private fifoToJitterBuffer(): void {
    // Adaptive flow control based on state
    const isBuffering = !this.isPlaying && !this.isPaused;
    const currentDuration = this.jitterBuffer.getBufferHealth().currentDuration;
    const threshold = this.config.preBufferThreshold;

    // During buffering: aggressive draining to reach threshold ASAP
    // During playback: conservative draining to maintain stable buffer
    let maxBufferMs: number;
    if (isBuffering && currentDuration < threshold) {
      // AGGRESSIVE: Fill to threshold + safety margin
      maxBufferMs = threshold + 200; // e.g., 500ms
      console.log(`[fifoToJitterBuffer] 🚀 AGGRESSIVE MODE - draining to ${maxBufferMs}ms`);
    } else {
      // CONSERVATIVE: Maintain healthy buffer during playback
      maxBufferMs = 1000;
    }

    let drained = 0;
    while (!this.fifoQueue.isEmpty()) {
      const health = this.jitterBuffer.getBufferHealth();

      // Stop if buffer would exceed limit
      if (health.currentDuration > maxBufferMs) {
        if (drained > 0) {
          console.log(`[fifoToJitterBuffer] Buffer limit reached at ${health.currentDuration.toFixed(0)}ms`);
        }
        break;
      }

      const entry = this.fifoQueue.dequeue();
      if (!entry) break;

      try {
        const result = this.converter.convert(entry.data.data);
        const success = this.jitterBuffer.addChunk(result.data);

        // DEBUG: Log first chunk conversion in detail
        if (this.chunksPlayed === 0 && drained === 0) {
          console.log(`[fifoToJitterBuffer] First chunk conversion:`);
          console.log(`  Input: ${entry.data.data.byteLength} bytes`);
          console.log(`  Output: ${result.data.length} samples`);
          console.log(`  Duration: ${result.durationMs.toFixed(1)}ms @ ${this.config.sampleRate}Hz`);
        }

        if (!success) {
          console.warn('[fifoToJitterBuffer] JitterBuffer rejected chunk (full?)');
          break;
        }

        drained++;
      } catch (error) {
        console.error('[fifoToJitterBuffer] Conversion error:', error);
      }
    }

    // Log progress during buffering
    if (isBuffering && drained > 0) {
      const health = this.jitterBuffer.getBufferHealth();
      const progress = (health.currentDuration / threshold) * 100;
      console.log(
        `[fifoToJitterBuffer] Drained ${drained} chunks → ` +
        `${health.currentDuration.toFixed(0)}ms / ${threshold}ms (${progress.toFixed(0)}%)`
      );
    }
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    console.log('[CartesiaStreamingPlayer] 🎵 Starting playback');

    // Update flags
    this.isPlaying = true;
    this.isPaused = false;

    // Track first sound latency
    if (this.firstSoundTime === 0) {
      this.firstSoundTime = Date.now();
      const latency = this.firstSoundTime - this.startTime;
      console.log(`[CartesiaStreamingPlayer] ⏱️ First sound latency: ${latency}ms`);
    }

    // ✨ NEW: Initialize cumulative scheduled time
    const now = this.audioContext.getPlaybackTime();
    this.nextScheduledTime = now + 0.05; // Start 50ms in future for buffer
    console.log(`[CartesiaStreamingPlayer] Initial schedule time: ${this.nextScheduledTime.toFixed(3)}s`);

    // Update buffer state
    this.jitterBuffer.setState(BufferState.PLAYING);

    // Update player state
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());

    // ✅ DON'T schedule here - let processCycle() handle it in next tick
    // This prevents double-scheduling bug
  }

  /**
   * Schedule next audio chunk for playback
   */
  private scheduleNextChunk(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    // Read from jitter buffer
    const result = this.jitterBuffer.getNextChunk(this.config.chunkSize);

    if (result.samplesRead === 0) {
      // No data available - might be underrun
      return;
    }

    let data = result.data;

    // Apply zero-crossing alignment for first chunk only
    if (this.config.useZeroCrossing && this.chunksPlayed === 0) {
      const aligned = this.zeroCrossingAligner.align(data, AlignmentMode.START);
      data = aligned.data;
      console.log(`[CartesiaStreamingPlayer] Applied zero-crossing alignment: trimmed ${aligned.totalTrimmed} samples`);
    }

    // Create buffer and schedule
    try {
      // CRITICAL: Pass sampleRate explicitly to ensure buffer plays at correct speed
      // Without this, AudioContext uses device sampleRate causing pitch/speed issues
      const buffer = this.audioContext.createBuffer(data, this.config.sampleRate);

      // ✨ NEW: Schedule at cumulative time to prevent chunks playing simultaneously
      const source = this.audioContext.scheduleBuffer(buffer, this.nextScheduledTime);

      // ✨ NEW: Calculate when this chunk ends and update nextScheduledTime
      const chunkDuration = data.length / this.config.sampleRate;
      const previousTime = this.nextScheduledTime;
      this.nextScheduledTime += chunkDuration;

      console.log(
        `[scheduleNextChunk] Chunk #${this.chunksPlayed + 1}: ` +
        `${data.length} samples (${(chunkDuration * 1000).toFixed(1)}ms) ` +
        `scheduled at ${previousTime.toFixed(3)}s → ${this.nextScheduledTime.toFixed(3)}s`
      );

      // Track source
      this.scheduledSources.add(source);

      // Auto-remove when done (react-native-audio-api uses onEnded, not onended)
      if (source && typeof (source as any).onEnded !== 'undefined') {
        source.onEnded = () => {
          this.scheduledSources.delete(source);
        };
      }

      this.chunksPlayed++;
    } catch (error) {
      console.error('[CartesiaStreamingPlayer] Schedule error:', error);
    }
  }

  /**
   * Drain remaining buffers after stream completes
   * ✅ FIX: Now waits for AudioContext to actually finish playing all audio
   */
  private async drainBuffers(): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;

      const drainInterval = setInterval(() => {
        // Move remaining chunks from FIFO to JitterBuffer
        this.fifoToJitterBuffer();

        // Check if buffers are empty
        const fifoEmpty = this.fifoQueue.isEmpty();
        const jitterEmpty = this.jitterBuffer.getBufferHealth().availableSamples === 0;

        // ✅ FIX: Use activeSources instead of nextScheduledTime
        // AudioContextManager tracks all playing sources and removes them on 'onEnded'
        const audioMetrics = this.audioContext.getMetrics();
        const audioFinished = audioMetrics.activeSources === 0;

        if (fifoEmpty && jitterEmpty && audioFinished) {
          // All buffers empty AND all audio sources finished playing
          clearInterval(drainInterval);

          // Stop timers to prevent underrun spam
          if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
          }
          if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
          }

          this.isPlaying = false;
          console.log('[CartesiaStreamingPlayer] Buffers drained, all audio sources finished');
          resolved = true;
          resolve();
        }

        // Only schedule if we have data in jitter buffer
        if (this.isPlaying && !jitterEmpty) {
          this.scheduleNextChunk();
        }
      }, 50);

      // ✅ FIX: Increased timeout to 60 seconds for long audio files
      const drainTimeout = setTimeout(() => {
        if (!resolved) {
          clearInterval(drainInterval);

          // Also stop timers on timeout
          if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
          }
          if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
          }

          this.isPlaying = false;

          // ✅ FIX: Emit 'done' event even on timeout to unlock microphone
          if (!this.doneEmitted) {
            this.doneEmitted = true;
            this.setState(PlayerState.DONE);
            this.emit('done', this.getMetrics());
          }

          console.log('[CartesiaStreamingPlayer] Drain timeout, emitted done event');
          resolve();
        }
      }, 60000); // ← Increased from 5000 to 60000

      // Clear timeout when resolved successfully
      const originalResolve = resolve;
      resolve = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(drainTimeout);
          originalResolve();
        }
      };
    });
  }

  /**
   * Stop playback and cleanup
   */
  stop(): void {
    console.log('[CartesiaStreamingPlayer] Stopping');

    // ✅ FIX: Remember if we were playing to emit 'done' for mic unlock
    const wasPlaying = this.isPlaying;
    const hadNotEmittedDone = !this.doneEmitted;

    // Abort current stream
    this.abortController?.abort();
    this.currentGenerator = null;

    // Stop processing
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // Stop audio
    this.isPlaying = false;
    this.isPaused = false;
    this.isStreaming = false;
    this.audioContext.stopAll();
    this.scheduledSources.clear();

    // ✨ NEW: Reset scheduled time
    this.nextScheduledTime = 0;

    // Clear buffers
    this.fifoQueue.clear();
    this.jitterBuffer.reset();

    this.setState(PlayerState.STOPPED);
    this.emit('stopped', this.getMetrics());

    // ✅ FIX: Also emit 'done' event if playback was in progress (to unlock microphone)
    if (wasPlaying && hadNotEmittedDone) {
      this.doneEmitted = true;
      this.emit('done', this.getMetrics());
      console.log('[CartesiaStreamingPlayer] Emitted done event on stop');
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    console.log('[CartesiaStreamingPlayer] Pausing');

    this.isPaused = true;
    this.audioContext.suspend();

    this.jitterBuffer.setState(BufferState.IDLE);
    this.setState(PlayerState.PAUSED);
    this.emit('paused', this.getMetrics());
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (!this.isPaused) {
      return;
    }

    console.log('[CartesiaStreamingPlayer] Resuming');

    this.isPaused = false;
    this.audioContext.resume();

    this.jitterBuffer.setState(BufferState.PLAYING);
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());

    // Schedule next chunk
    this.scheduleNextChunk();
  }

  /**
   * Set volume
   *
   * @param level - Volume level (0.0 - 1.0)
   * @param rampTime - Optional ramp time in seconds
   */
  setVolume(level: number, rampTime?: number): void {
    const clampedLevel = Math.max(0, Math.min(1, level));
    this.audioContext.setGain(clampedLevel, rampTime);
    this.config.initialGain = clampedLevel;
  }

  /**
   * Get current metrics
   */
  getMetrics(): PlayerMetrics {
    const health = this.jitterBuffer.getBufferHealth();
    const audioMetrics = this.audioContext.getMetrics();

    return {
      state: this.state,
      bufferDuration: health.currentDuration,
      thresholdDuration: health.thresholdDuration,
      bufferPercent: health.thresholdPercent,
      samplesQueued: health.availableSamples,
      playbackPosition: health.playbackPosition,
      firstChunkLatency: this.firstChunkTime > 0 ? this.firstChunkTime - this.startTime : 0,
      playbackLatency: this.firstSoundTime > 0 ? this.firstSoundTime - this.startTime : 0,
      droppedChunks: health.droppedChunks,
      underrunCount: health.underrunCount,
      gain: audioMetrics.gain,
      chunksReceived: this.chunksReceived,
      chunksPlayed: this.chunksPlayed,
      chunksPerSecond: this.chunksReceivedLastSecond,
      fifoQueueSize: this.fifoQueue.size(),
      isStreaming: this.isStreaming,
    };
  }

  /**
   * Get current state
   */
  getState(): PlayerState {
    return this.state;
  }

  /**
   * Debug helper - print current player state
   * @internal Use only for debugging
   */
  public debugState(): void {
    const metrics = this.getMetrics();
    const health = this.jitterBuffer.getBufferHealth();

    console.log('╔════════════════════════════════════════╗');
    console.log('║     CARTESIA PLAYER DEBUG STATE        ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ State:           ${this.state.padEnd(20)} ║`);
    console.log(`║ Is Playing:      ${String(this.isPlaying).padEnd(20)} ║`);
    console.log(`║ Is Paused:       ${String(this.isPaused).padEnd(20)} ║`);
    console.log(`║ Is Streaming:    ${String(this.isStreaming).padEnd(20)} ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ FIFO Queue:      ${String(this.fifoQueue.size()).padEnd(20)} ║`);
    console.log(`║ Buffer Duration: ${health.currentDuration.toFixed(0).padEnd(20)} ms ║`);
    console.log(`║ Threshold:       ${String(this.config.preBufferThreshold).padEnd(20)} ms ║`);
    console.log(`║ Can Start?:      ${String(this.jitterBuffer.canStartPlayback()).padEnd(20)} ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Chunks Received: ${String(this.chunksReceived).padEnd(20)} ║`);
    console.log(`║ Chunks Played:   ${String(this.chunksPlayed).padEnd(20)} ║`);
    console.log(`║ Underruns:       ${String(health.underrunCount).padEnd(20)} ║`);
    console.log(`║ Dropped:         ${String(health.droppedChunks).padEnd(20)} ║`);
    console.log('╚════════════════════════════════════════╝');
  }

  /**
   * Check if currently playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying && !this.isPaused;
  }

  /**
   * Check if currently streaming
   */
  isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Add event listener
   *
   * @param event - Event name
   * @param listener - Callback function
   */
  on(event: PlayerEvent, listener: EventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Add event listener that fires only once
   *
   * @param event - Event name
   * @param listener - Callback function
   */
  once(event: PlayerEvent, listener: EventListener): void {
    const onceListener: EventListener = (data: any) => {
      listener(data);
      this.off(event, onceListener);
    };
    this.on(event, onceListener);
  }

  /**
   * Remove event listener
   *
   * @param event - Event name
   * @param listener - Callback function
   */
  off(event: PlayerEvent, listener: EventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Remove all event listeners for an event
   */
  removeAllListeners(event?: PlayerEvent): void {
    if (event) {
      this.eventListeners.delete(event);
    } else {
      this.eventListeners.clear();
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: PlayerEvent, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[CartesiaStreamingPlayer] Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Set player state
   */
  private setState(state: PlayerState): void {
    const oldState = this.state;
    this.state = state;

    if (oldState !== state) {
      console.log(`[CartesiaStreamingPlayer] State: ${oldState} → ${state}`);
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    console.log('[CartesiaStreamingPlayer] Disposing');

    this.stop();

    // Don't dispose shared AudioContext singleton
    // (Other players might still need it)
    console.log('[CartesiaStreamingPlayer] Skipping AudioContext disposal (shared singleton)');

    this.eventListeners.clear();
    this.scheduledSources.clear();
  }
}

/**
 * Create a new Cartesia streaming player
 *
 * @param config - Optional configuration
 * @returns New CartesiaStreamingPlayer instance
 */
export function createCartesiaStreamingPlayer(
  config?: Partial<CartesiaPlayerConfig>
): CartesiaStreamingPlayer {
  return new CartesiaStreamingPlayer(config);
}

/**
 * Singleton instance (for convenience)
 */
let singletonInstance: CartesiaStreamingPlayer | null = null;

export function getCartesiaStreamingPlayer(
  config?: Partial<CartesiaPlayerConfig>
): CartesiaStreamingPlayer {
  // Check if instance exists and has valid AudioContext
  const needsRecreation = singletonInstance && !singletonInstance['audioContext'].isValid();

  if (needsRecreation) {
    console.log('[Cartesia Singleton] AudioContext destroyed, recreating player');
    // Don't dispose - just recreate (disposal would destroy shared AudioContext)
    singletonInstance = null;
  }

  if (!singletonInstance) {
    console.log('[Cartesia Singleton] Creating new player instance');
    singletonInstance = new CartesiaStreamingPlayer(config);
  }

  return singletonInstance;
}

export function resetCartesiaStreamingPlayer(): void {
  if (singletonInstance) {
    singletonInstance.dispose();
    singletonInstance = null;
  }
}
