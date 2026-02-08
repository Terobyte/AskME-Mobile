/**
 * Deepgram Streaming Player - Streaming Audio Engine
 *
 * TRUE streaming audio player using react-native-audio-api.
 * Plays chunks as they arrive - NO accumulation of all chunks!
 *
 * Architecture:
 * Deepgram WebSocket (PCM16)
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

import { deepgramStreamingService } from '../deepgram-streaming-service';
import { Int16ToFloat32Converter } from '../../utils/audio/Int16ToFloat32Converter';
import { FIFOQueue } from '../../utils/audio/FIFOQueue';
import { JitterBuffer, BufferState, UnderrunStrategy } from '../../utils/audio/JitterBuffer';
import { ZeroCrossingAligner, AlignmentMode } from '../../utils/audio/ZeroCrossingAligner';
import { AudioContextManager } from '../../utils/audio/AudioContextManager';
import { AudioChunk, DeepgramStreamingOptions, DeepgramVoice } from '../../types';

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
export interface DeepgramPlayerConfig {
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
 * HIGH-PERFORMANCE CONFIGURATION (matched to Cartesia working config):
 * - sampleRate: 16000 (matches Deepgram output)
 * - chunkSize: 2048 samples (~128ms at 16kHz) - larger for stability, prevents scheduling lag
 * - preBufferThreshold: 500ms (balance between latency and stability)
 * - processingInterval: 50ms (20Hz processing ticks) - less frequent to reduce CPU load
 *
 * WHY chunkSize=2048 instead of 320:
 * - 320 samples = 20ms. With 20ms processing interval, scheduling can't keep up → negative latency
 * - 2048 samples = 128ms. With 50ms processing interval, plenty of time for smooth scheduling
 * - Larger chunks mask JavaScript/Web Audio scheduling overhead
 */
const DEFAULT_CONFIG: Required<DeepgramPlayerConfig> = {
  sampleRate: 16000,
  preBufferThreshold: 500,  // 500ms pre-buffer (in milliseconds) - matches Cartesia
  maxBufferSize: 5,         // 5 seconds max buffer
  underrunStrategy: UnderrunStrategy.SILENCE,
  initialGain: 1.0,
  useZeroCrossing: true,
  chunkSize: 2048,          // ~128ms at 16kHz - matched to Cartesia for stability
  fifoMaxSize: 500,
  processingInterval: 50,   // 20Hz processing - matched to Cartesia
};

/**
 * Deepgram Streaming Player Class
 *
 * The real streaming engine that plays audio chunks as they arrive.
 */
export class DeepgramStreamingPlayer {
  // Components
  private converter: Int16ToFloat32Converter;
  private fifoQueue: FIFOQueue<AudioChunk>;
  private jitterBuffer: JitterBuffer;
  private audioContext: AudioContextManager;
  private zeroCrossingAligner: ZeroCrossingAligner;

  // State
  private state: PlayerState = PlayerState.IDLE;
  private config: Required<DeepgramPlayerConfig>;
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

  // Track cumulative scheduled time to prevent chunks playing simultaneously
  private nextScheduledTime: number = 0;

  // Track if 'done' event was already emitted to prevent duplicates
  private doneEmitted: boolean = false;

  constructor(config?: Partial<DeepgramPlayerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // DEBUG: Detailed config logging
    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║   DeepgramStreamingPlayer Config        ║`);
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

    console.log('[DeepgramStreamingPlayer] Initialized with config:', this.config);
  }

  /**
   * Ensure AudioContext is valid, recreate if destroyed
   */
  private ensureAudioContextValid(): void {
    if (!this.audioContext.isValid()) {
      console.log('[DeepgramStreamingPlayer] AudioContext destroyed, recreating...');
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
   * @param options - Deepgram streaming options
   */
  async speak(text: string, options?: { voiceId?: DeepgramVoice }): Promise<void> {
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
          console.log('[DeepgramStreamingPlayer] Audio context initialized');
        }
      } catch (error) {
        // If initialization fails with destroyed error, try recreating
        if (error instanceof Error && error.message.includes('destroyed')) {
          console.log('[DeepgramStreamingPlayer] Initialization failed, recreating AudioContext');
          this.ensureAudioContextValid();
          await this.audioContext.initialize();
        } else {
          throw error;
        }
      }

      // Get stream from Deepgram
      this.isStreaming = true;
      const stream = deepgramStreamingService.generateAudioStream({
        text,
        voiceId: options?.voiceId || 'aura-2-thalia-en',
        encoding: 'linear16',
        sampleRate: 16000,
        onFirstChunk: (latency) => {
          this.firstChunkTime = Date.now();
          console.log(`[DeepgramStreamingPlayer] First chunk latency: ${latency}ms`);
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
      console.error('[DeepgramStreamingPlayer] Error:', errorMsg);
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
          console.log('[DeepgramStreamingPlayer] Stream aborted');
          break;
        }

        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          console.log('[DeepgramStreamingPlayer] First chunk received');
        }

        // Add to FIFO queue for processing
        this.fifoQueue.enqueue(chunk);
      }

      // Stream complete naturally
      if (!signal.aborted) {
        console.log('[DeepgramStreamingPlayer] Stream complete, draining buffers...');
        this.isStreaming = false;

        // Wait for buffers to drain (may have already completed via processCycle)
        await this.drainBuffers();

        // Only emit 'done' if processCycle hasn't already done so
        if (!this.doneEmitted) {
          this.doneEmitted = true;
          this.setState(PlayerState.DONE);
          this.emit('done', this.getMetrics());
          console.log('[DeepgramStreamingPlayer] Stream complete - emitted done event');
        }
      }

    } catch (error) {
      if (!signal.aborted) {
        console.error('[DeepgramStreamingPlayer] Stream error:', error);
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

    console.log('[DeepgramStreamingPlayer] Starting processing loop');

    this.processingTimer = setInterval(() => {
      this.processCycle();
    }, this.config.processingInterval);

    // Add buffering timeout protection (3 seconds)
    const bufferingTimeout = setTimeout(() => {
      if (this.state === PlayerState.BUFFERING) {
        console.error('[DeepgramStreamingPlayer] BUFFERING TIMEOUT (3s)!');

        const health = this.jitterBuffer.getBufferHealth();
        console.error('[DeepgramStreamingPlayer] Debug info:', {
          fifoSize: this.fifoQueue.size(),
          bufferDuration: health.currentDuration,
          threshold: this.config.preBufferThreshold,
          samplesAvailable: health.availableSamples,
          chunksReceived: this.chunksReceived,
          isStreaming: this.isStreaming,
        });

        // Try to force start if we have ANY data
        if (health.availableSamples > 0) {
          console.warn('[DeepgramStreamingPlayer] Force starting with partial buffer');
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
    }, 3000);

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
          `[Deepgram ProcessCycle] FIFO: ${beforeFifo} → ${afterFifo}, ` +
          `Buffer: ${beforeHealth.currentDuration.toFixed(0)}ms → ${afterHealth.currentDuration.toFixed(0)}ms, ` +
          `Threshold: ${canStart ? 'READY' : `${afterHealth.currentDuration.toFixed(0)}/${this.config.preBufferThreshold}`}`
        );
      }
    }

    // Phase 2: Check if we can start playback
    if (!this.isPlaying && !this.isPaused && this.jitterBuffer.canStartPlayback()) {
      console.log('[Deepgram ProcessCycle] Threshold reached - starting playback!');
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
          console.log('[Deepgram ProcessCycle] Playback complete - emitted done event');
        }
      }
    }

    // Phase 4: Check for underrun (only during active playback with active stream)
    if (this.isPlaying && this.isStreaming && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
      this.emit('underrun', this.getMetrics());
      console.warn('[Deepgram ProcessCycle] Buffer underrun!');
    }
  }

  /**
   * Move chunks from FIFO queue to jitter buffer
   */
  private fifoToJitterBuffer(): void {
    const isBuffering = !this.isPlaying && !this.isPaused;
    const currentDuration = this.jitterBuffer.getBufferHealth().currentDuration;
    const threshold = this.config.preBufferThreshold;

    let maxBufferMs: number;
    if (isBuffering && currentDuration < threshold) {
      maxBufferMs = threshold + 200;
    } else {
      maxBufferMs = 1000;
    }

    let drained = 0;
    while (!this.fifoQueue.isEmpty()) {
      const health = this.jitterBuffer.getBufferHealth();

      if (health.currentDuration > maxBufferMs) {
        if (drained > 0) {
          console.log(`[Deepgram fifoToJitterBuffer] Buffer limit reached at ${health.currentDuration.toFixed(0)}ms`);
        }
        break;
      }

      const entry = this.fifoQueue.dequeue();
      if (!entry) break;

      try {
        const result = this.converter.convert(entry.data.data);
        const success = this.jitterBuffer.addChunk(result.data);

        if (this.chunksPlayed === 0 && drained === 0) {
          console.log(`[Deepgram fifoToJitterBuffer] First chunk conversion:`);
          console.log(`  Input: ${entry.data.data.byteLength} bytes`);
          console.log(`  Output: ${result.data.length} samples`);
          console.log(`  Duration: ${result.durationMs.toFixed(1)}ms @ ${this.config.sampleRate}Hz`);
        }

        if (!success) {
          console.warn('[Deepgram fifoToJitterBuffer] JitterBuffer rejected chunk (full?)');
          break;
        }

        drained++;
      } catch (error) {
        console.error('[Deepgram fifoToJitterBuffer] Conversion error:', error);
      }
    }

    if (isBuffering && drained > 0) {
      const health = this.jitterBuffer.getBufferHealth();
      const progress = (health.currentDuration / threshold) * 100;
      console.log(
        `[Deepgram fifoToJitterBuffer] Drained ${drained} chunks → ` +
        `${health.currentDuration.toFixed(0)}ms / ${threshold}ms (${progress.toFixed(0)}%)`
      );
    }
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    console.log('[DeepgramStreamingPlayer] Starting playback');

    this.isPlaying = true;
    this.isPaused = false;

    if (this.firstSoundTime === 0) {
      this.firstSoundTime = Date.now();
      const latency = this.firstSoundTime - this.startTime;
      console.log(`[DeepgramStreamingPlayer] First sound latency: ${latency}ms`);
    }

    // Initialize cumulative scheduled time
    const now = this.audioContext.getPlaybackTime();
    this.nextScheduledTime = now + 0.05;
    console.log(`[DeepgramStreamingPlayer] Initial schedule time: ${this.nextScheduledTime.toFixed(3)}s`);

    this.jitterBuffer.setState(BufferState.PLAYING);
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());
  }

  /**
   * Schedule next audio chunk for playback
   */
  private scheduleNextChunk(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    const result = this.jitterBuffer.getNextChunk(this.config.chunkSize);

    if (result.samplesRead === 0) {
      return;
    }

    let data = result.data;

    if (this.config.useZeroCrossing && this.chunksPlayed === 0) {
      const aligned = this.zeroCrossingAligner.align(data, AlignmentMode.START);
      data = aligned.data;
      console.log(`[DeepgramStreamingPlayer] Applied zero-crossing alignment: trimmed ${aligned.totalTrimmed} samples`);
    }

    try {
      const buffer = this.audioContext.createBuffer(data, this.config.sampleRate);
      const source = this.audioContext.scheduleBuffer(buffer, this.nextScheduledTime);

      const chunkDuration = data.length / this.config.sampleRate;
      const previousTime = this.nextScheduledTime;
      this.nextScheduledTime += chunkDuration;

      console.log(
        `[Deepgram scheduleNextChunk] Chunk #${this.chunksPlayed + 1}: ` +
        `${data.length} samples (${(chunkDuration * 1000).toFixed(1)}ms) ` +
        `scheduled at ${previousTime.toFixed(3)}s → ${this.nextScheduledTime.toFixed(3)}s`
      );

      this.scheduledSources.add(source);

      if (source && typeof (source as any).onEnded !== 'undefined') {
        source.onEnded = () => {
          this.scheduledSources.delete(source);
        };
      }

      this.chunksPlayed++;
    } catch (error) {
      console.error('[DeepgramStreamingPlayer] Schedule error:', error);
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
        this.fifoToJitterBuffer();

        const fifoEmpty = this.fifoQueue.isEmpty();
        const jitterEmpty = this.jitterBuffer.getBufferHealth().availableSamples === 0;

        // ✅ FIX: Use activeSources instead of nextScheduledTime
        // AudioContextManager tracks all playing sources and removes them on 'onEnded'
        const audioMetrics = this.audioContext.getMetrics();
        const audioFinished = audioMetrics.activeSources === 0;

        if (fifoEmpty && jitterEmpty && audioFinished) {
          // All buffers empty AND all audio sources finished playing
          clearInterval(drainInterval);

          if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
          }
          if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
          }

          this.isPlaying = false;
          console.log('[DeepgramStreamingPlayer] Buffers drained, all audio sources finished');
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

          console.log('[DeepgramStreamingPlayer] Drain timeout, emitted done event');
          resolve();
        }
      }, 60000); // ← Increased from 5000 to 60000

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
    console.log('[DeepgramStreamingPlayer] Stopping');

    // ✅ FIX: Remember if we were playing to emit 'done' for mic unlock
    const wasPlaying = this.isPlaying;
    const hadNotEmittedDone = !this.doneEmitted;

    this.abortController?.abort();
    this.currentGenerator = null;

    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    this.isPlaying = false;
    this.isPaused = false;
    this.isStreaming = false;
    this.audioContext.stopAll();
    this.scheduledSources.clear();

    this.nextScheduledTime = 0;

    this.fifoQueue.clear();
    this.jitterBuffer.reset();

    this.setState(PlayerState.STOPPED);
    this.emit('stopped', this.getMetrics());

    // ✅ FIX: Also emit 'done' event if playback was in progress (to unlock microphone)
    if (wasPlaying && hadNotEmittedDone) {
      this.doneEmitted = true;
      this.emit('done', this.getMetrics());
      console.log('[DeepgramStreamingPlayer] Emitted done event on stop');
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    console.log('[DeepgramStreamingPlayer] Pausing');

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

    console.log('[DeepgramStreamingPlayer] Resuming');

    this.isPaused = false;
    this.audioContext.resume();

    this.jitterBuffer.setState(BufferState.PLAYING);
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());

    this.scheduleNextChunk();
  }

  /**
   * Set volume
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
   */
  on(event: PlayerEvent, listener: EventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Add event listener that fires only once
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
          console.error(`[DeepgramStreamingPlayer] Error in ${event} listener:`, error);
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
      console.log(`[DeepgramStreamingPlayer] State: ${oldState} → ${state}`);
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    console.log('[DeepgramStreamingPlayer] Disposing');

    this.stop();

    // Don't dispose shared AudioContext singleton
    // (Other players might still need it)
    console.log('[DeepgramStreamingPlayer] Skipping AudioContext disposal (shared singleton)');

    this.eventListeners.clear();
    this.scheduledSources.clear();
  }
}

/**
 * Create a new Deepgram streaming player
 */
export function createDeepgramStreamingPlayer(
  config?: Partial<DeepgramPlayerConfig>
): DeepgramStreamingPlayer {
  return new DeepgramStreamingPlayer(config);
}

/**
 * Singleton instance (for convenience)
 */
let singletonInstance: DeepgramStreamingPlayer | null = null;

export function getDeepgramStreamingPlayer(
  config?: Partial<DeepgramPlayerConfig>
): DeepgramStreamingPlayer {
  // Check if instance exists and has valid AudioContext
  const needsRecreation = singletonInstance && !singletonInstance['audioContext'].isValid();

  if (needsRecreation) {
    console.log('[Deepgram Singleton] AudioContext destroyed, recreating player');
    // Don't dispose - just recreate (disposal would destroy shared AudioContext)
    singletonInstance = null;
  }

  if (!singletonInstance) {
    console.log('[Deepgram Singleton] Creating new player instance');
    singletonInstance = new DeepgramStreamingPlayer(config);
  }

  return singletonInstance;
}

export function resetDeepgramStreamingPlayer(): void {
  if (singletonInstance) {
    singletonInstance.dispose();
    singletonInstance = null;
  }
}
