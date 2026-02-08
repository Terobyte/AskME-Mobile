/**
 * OpenAI Streaming Player - Streaming Audio Engine with Resampling
 *
 * TRUE streaming audio player using react-native-audio-api.
 * Plays chunks as they arrive - NO accumulation of all chunks!
 *
 * Architecture:
 * OpenAI Fetch API (PCM16 @ 24kHz)
 *    ↓
 * PCM16Resampler (24kHz → 16kHz)
 *    ↓
 * FIFOQueue (ordering)
 *    ↓
 * JitterBuffer (pre-buffer 500ms)
 *    ↓
 * ZeroCrossingAligner (artifact-free)
 *    ↓
 * AudioContextManager (playout @ 16kHz)
 *
 * @depends react-native-audio-api
 */

import { getOpenAIStreamingService, OpenAIVoice } from '../openai-streaming-service';
import { PCM16Resampler } from '../../utils/audio/PCM16Resampler';
import { FIFOQueue } from '../../utils/audio/FIFOQueue';
import { JitterBuffer, BufferState, UnderrunStrategy } from '../../utils/audio/JitterBuffer';
import { ZeroCrossingAligner, AlignmentMode } from '../../utils/audio/ZeroCrossingAligner';
import { AudioContextManager } from '../../utils/audio/AudioContextManager';
import { AudioChunk } from '../../types';

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
  /** Source sample rate (OpenAI: 24000) */
  sourceSampleRate: number;
}

/**
 * Player configuration
 */
export interface OpenAIPlayerConfig {
  /** Sample rate in Hz (pipeline rate, after resampling) */
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
  /** Playback chunk size in samples */
  chunkSize: number;
  /** FIFO queue max size */
  fifoMaxSize: number;
  /** Processing interval in ms */
  processingInterval: number;
}

/**
 * Event listener type
 */
export type EventListener = (data: any) => void;

/**
 * Default configuration
 *
 * MATCHED TO CARTESIA/DEEPGRAM for consistency:
 * - sampleRate: 16000 (after resampling from 24000)
 * - chunkSize: 2048 samples (~128ms at 16kHz)
 * - preBufferThreshold: 500ms
 * - processingInterval: 50ms (20Hz processing)
 */
const DEFAULT_CONFIG: Required<OpenAIPlayerConfig> = {
  sampleRate: 16000,
  preBufferThreshold: 500,  // 500ms pre-buffer
  maxBufferSize: 5,         // 5 seconds max buffer
  underrunStrategy: UnderrunStrategy.SILENCE,
  initialGain: 1.0,
  useZeroCrossing: true,
  chunkSize: 2048,          // ~128ms at 16kHz
  fifoMaxSize: 500,
  processingInterval: 50,   // 20Hz processing
};

/**
 * OpenAI Streaming Player Class
 *
 * The real streaming engine that plays audio chunks as they arrive.
 * Includes automatic resampling from OpenAI's 24kHz to pipeline's 16kHz.
 */
export class OpenAIStreamingPlayer {
  // Components
  private fifoQueue: FIFOQueue<ArrayBuffer>;  // ⚠️ FIX: Store ArrayBuffer directly
  private jitterBuffer: JitterBuffer;
  private audioContext: AudioContextManager;
  private zeroCrossingAligner: ZeroCrossingAligner;

  // State
  private state: PlayerState = PlayerState.IDLE;
  private config: Required<OpenAIPlayerConfig>;
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
  private currentGenerator: AsyncGenerator<AudioChunk> | null = null;

  // Playback scheduling
  private scheduledSources: Set<any> = new Set();

  // Track cumulative scheduled time
  private nextScheduledTime: number = 0;

  // Track if 'done' event was already emitted
  private doneEmitted: boolean = false;

  // OpenAI service
  private openaiService = getOpenAIStreamingService();

  // API Key
  private apiKey: string;

  // Debounce timer to prevent rapid restart issues
  private lastStopTime: number = 0;
  private static readonly MIN_RESTART_DELAY_MS = 200; // Minimum delay before restart

  constructor(apiKey: string, config?: Partial<OpenAIPlayerConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // DEBUG: Detailed config logging
    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║     OpenAIStreamingPlayer Config       ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║ sampleRate:           ${String(this.config.sampleRate).padEnd(20)} ║`);
    console.log(`║ chunkSize:            ${String(this.config.chunkSize).padEnd(20)} ║`);
    console.log(`║ preBufferThreshold:   ${String(this.config.preBufferThreshold + 'ms').padEnd(20)} ║`);
    console.log(`║ processingInterval:   ${String(this.config.processingInterval + 'ms').padEnd(20)} ║`);
    console.log(`║ sourceSampleRate:     24000 (resampled to 16k) ║`);
    console.log(`╚════════════════════════════════════════╝`);

    // Initialize components
    // ⚠️ FIX: Store ArrayBuffer directly, not AudioChunk (to avoid double-wrapping)
    this.fifoQueue = new FIFOQueue<ArrayBuffer>({
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

    console.log('[OpenAIStreamingPlayer] Initialized with config:', this.config);
  }

  /**
   * Ensure AudioContext is valid, recreate if destroyed
   */
  private ensureAudioContextValid(): void {
    if (!this.audioContext.isValid()) {
      console.log('[OpenAIStreamingPlayer] AudioContext destroyed, recreating...');
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
   * @param options - OpenAI streaming options
   */
  async speak(text: string, options?: {
    voiceId?: OpenAIVoice;
    speed?: number;
    instructions?: string; // 🆕 Voice style instructions (gpt-4o-mini-tts only)
  }): Promise<void> {
    // Debounce: prevent rapid restart issues
    const now = Date.now();
    const timeSinceLastStop = now - this.lastStopTime;

    if (timeSinceLastStop < OpenAIStreamingPlayer.MIN_RESTART_DELAY_MS) {
      const delayMs = OpenAIStreamingPlayer.MIN_RESTART_DELAY_MS - timeSinceLastStop;
      console.log(`[OpenAIStreamingPlayer] Debouncing restart: waiting ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // ✅ Validate AudioContext BEFORE stopping
    this.ensureAudioContextValid();

    // Cleanup previous
    this.stop();

    // Reset done flag for new playback
    this.doneEmitted = false;

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
          console.log('[OpenAIStreamingPlayer] Audio context initialized');
        }
      } catch (error) {
        // If initialization fails with destroyed error, try recreating
        if (error instanceof Error && error.message.includes('destroyed')) {
          console.log('[OpenAIStreamingPlayer] Initialization failed, recreating AudioContext');
          this.ensureAudioContextValid();
          await this.audioContext.initialize();
        } else {
          throw error;
        }
      }

      // Get stream from OpenAI
      this.isStreaming = true;
      const stream = this.openaiService.generateAudioStream({
        apiKey: this.apiKey,
        text,
        voiceId: options?.voiceId || 'marin', // Changed default to marin (best quality)
        model: 'gpt-4o-mini-tts', // ✅ Updated model
        speed: options?.speed ?? 1.0,
        instructions: options?.instructions, // 🆕
        onFirstChunk: (latency) => {
          this.firstChunkTime = Date.now();
          console.log(`[OpenAIStreamingPlayer] First chunk latency: ${latency}ms`);
        },
        onChunk: (chunk) => {
          this.chunksReceived++;
        },
      });

      this.currentGenerator = stream;
      this.setState(PlayerState.BUFFERING);
      this.emit('connected', { text: text.substring(0, 50) + '...' });

      // Start the streaming loop
      await this.streamingLoop(stream);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[OpenAIStreamingPlayer] Error:', errorMsg);
      this.setState(PlayerState.ERROR);
      this.emit('error', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Main streaming loop - receives chunks and feeds the pipeline
   */
  private async streamingLoop(
    stream: AsyncGenerator<AudioChunk>
  ): Promise<void> {
    // Start processing timer
    this.startProcessing();

    let receivedFirstChunk = false;

    try {
      for await (const chunk of stream) {
        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          console.log('[OpenAIStreamingPlayer] First chunk received');

          // 🔍 DEBUG: Check chunk data when received
          console.log(`[OpenAIStreamingPlayer] First chunk DEBUG:`);
          console.log(`  chunk.data type: ${chunk.data?.constructor?.name || 'undefined'}`);
          console.log(`  chunk.data instanceof ArrayBuffer: ${chunk.data instanceof ArrayBuffer}`);
          console.log(`  chunk.data byteLength: ${chunk.data?.byteLength || 0}`);
          console.log(`  chunk.sizeBytes: ${chunk.sizeBytes}`);
          console.log(`  chunk.sequence: ${chunk.sequence}`);
          console.log(`  chunk keys:`, Object.keys(chunk));
        }

        // ⚠️ FIX: Enqueue only the ArrayBuffer, not the whole AudioChunk
        // This avoids double-wrapping (FIFO creates its own QueueEntry)
        this.fifoQueue.enqueue(chunk.data);

        // DEBUG: Check FIFO size after enqueue
        if (!receivedFirstChunk) {
          console.log(`[OpenAIStreamingPlayer] FIFO size after first enqueue: ${this.fifoQueue.size()}`);
        }
      }

      // Stream complete naturally
      console.log('[OpenAIStreamingPlayer] Stream complete, draining buffers...');
      this.isStreaming = false;

      // Wait for buffers to drain
      await this.drainBuffers();

      // Only emit 'done' if processCycle hasn't already done so
      if (!this.doneEmitted) {
        this.doneEmitted = true;
        this.setState(PlayerState.DONE);
        this.emit('done', this.getMetrics());
        console.log('[OpenAIStreamingPlayer] Stream complete - emitted done event');
      }

    } catch (error) {
      console.error('[OpenAIStreamingPlayer] Stream error:', error);
      throw error;
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

    console.log('[OpenAIStreamingPlayer] Starting processing loop');

    this.processingTimer = setInterval(() => {
      this.processCycle();
    }, this.config.processingInterval);

    // Add buffering timeout protection (3 seconds)
    const bufferingTimeout = setTimeout(() => {
      if (this.state === PlayerState.BUFFERING) {
        console.error('[OpenAIStreamingPlayer] BUFFERING TIMEOUT (3s)!');

        const health = this.jitterBuffer.getBufferHealth();
        console.error('[OpenAIStreamingPlayer] Debug info:', {
          fifoSize: this.fifoQueue.size(),
          bufferDuration: health.currentDuration,
          threshold: this.config.preBufferThreshold,
          samplesAvailable: health.availableSamples,
          chunksReceived: this.chunksReceived,
          isStreaming: this.isStreaming,
        });

        // Try to force start if we have ANY data
        if (health.availableSamples > 0) {
          console.warn('[OpenAIStreamingPlayer] Force starting with partial buffer');
          this.startPlayback();
        } else {
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

    const clearBufferingTimeout = () => {
      clearTimeout(bufferingTimeout);
      this.off('playing', clearBufferingTimeout);
    };
    this.on('playing', clearBufferingTimeout);

    // Start metrics timer
    this.metricsTimer = setInterval(() => {
      this.emit('metrics', this.getMetrics());

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
    const beforeFifo = this.fifoQueue.size();
    const beforeHealth = this.jitterBuffer.getBufferHealth();

    // Phase 1: Move chunks from FIFO to JitterBuffer with resampling
    this.fifoToJitterBuffer();

    const afterFifo = this.fifoQueue.size();
    const afterHealth = this.jitterBuffer.getBufferHealth();

    // Log state changes during buffering
    if (this.state === PlayerState.BUFFERING) {
      if (beforeFifo !== afterFifo || beforeHealth.currentDuration !== afterHealth.currentDuration) {
        const canStart = this.jitterBuffer.canStartPlayback();
        console.log(
          `[OpenAI ProcessCycle] FIFO: ${beforeFifo} → ${afterFifo}, ` +
          `Buffer: ${beforeHealth.currentDuration.toFixed(0)}ms → ${afterHealth.currentDuration.toFixed(0)}ms, ` +
          `Threshold: ${canStart ? 'READY' : `${afterHealth.currentDuration.toFixed(0)}/${this.config.preBufferThreshold}`}`
        );
      }
    }

    // Phase 2: Check if we can start playback
    if (!this.isPlaying && !this.isPaused && this.jitterBuffer.canStartPlayback()) {
      console.log('[OpenAI ProcessCycle] Threshold reached - starting playback!');
      this.startPlayback();
    }

    // Phase 3: Schedule next chunk if playing
    if (this.isPlaying && !this.isPaused) {
      const hasData = afterHealth.availableSamples > 0;

      if (this.isStreaming || hasData) {
        this.scheduleNextChunk();
      } else {
        // No more data and stream ended
        this.isPlaying = false;
        this.stopTimers();

        // Emit 'done' event
        if (!this.doneEmitted) {
          this.doneEmitted = true;
          this.setState(PlayerState.DONE);
          this.emit('done', this.getMetrics());
          console.log('[OpenAI ProcessCycle] Playback complete - emitted done event');
        }
      }
    }

    // Phase 4: Check for underrun
    if (this.isPlaying && this.isStreaming && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
      this.emit('underrun', this.getMetrics());
      console.warn('[OpenAI ProcessCycle] Buffer underrun!');
    }
  }

  /**
   * Stop all timers
   */
  private stopTimers(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Move chunks from FIFO queue to jitter buffer WITH RESAMPLING
   *
   * KEY DIFFERENCE FROM DEEPGRAM: Resamples 24kHz → 16kHz
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
          console.log(`[OpenAI fifoToJitterBuffer] Buffer limit reached at ${health.currentDuration.toFixed(0)}ms`);
        }
        break;
      }

      const entry = this.fifoQueue.dequeue();
      if (!entry) break;

      try {
        // 🔍 DEBUG: Check chunk data before conversion
        if (drained === 0) {
          console.log(`[OpenAI fifoToJitterBuffer] Dequeued entry DEBUG:`);
          console.log(`  entry.data type: ${entry.data?.constructor?.name || 'undefined'}`);
          console.log(`  entry.data instanceof ArrayBuffer: ${entry.data instanceof ArrayBuffer}`);
          console.log(`  entry.data byteLength: ${entry.data?.byteLength || 0}`);
          console.log(`  entry.size: ${entry.size}`);
          console.log(`  entry.sequence: ${entry.sequence}`);
        }

        // ✅ entry.data is now directly an ArrayBuffer (no double-wrapping!)
        const arrayBuffer = entry.data;

        // Validate
        if (!(arrayBuffer instanceof ArrayBuffer)) {
          console.error(`[OpenAI fifoToJitterBuffer] Expected ArrayBuffer, got ${arrayBuffer?.constructor?.name}`);
          continue;
        }

        if (arrayBuffer.byteLength === 0) {
          console.warn(`[OpenAI fifoToJitterBuffer] Skipping empty chunk (0 bytes)`);
          continue;
        }

        // ✅ RESAMPLE: OpenAI 24kHz → 16kHz
        // arrayBuffer is a proper ArrayBuffer, convert to Int16Array
        const inputSamples = new Int16Array(arrayBuffer);
        const resampled = PCM16Resampler.openaiToPipeline(inputSamples);

        // ✅ CONVERT: Int16 → Float32 for JitterBuffer
        // JitterBuffer expects Float32Array, but resampler returns Int16Array
        const float32Data = new Float32Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          float32Data[i] = resampled[i] / 32768.0; // Normalize to [-1.0, 1.0]
        }

        const success = this.jitterBuffer.addChunk(float32Data);

        if (this.chunksPlayed === 0 && drained === 0) {
          console.log(`[OpenAI fifoToJitterBuffer] First chunk conversion:`);
          console.log(`  Input: ${inputSamples.length} samples @ 24kHz (Int16)`);
          console.log(`  Resampled: ${resampled.length} samples @ 16kHz (Int16)`);
          console.log(`  Output: ${float32Data.length} samples @ 16kHz (Float32)`);
          console.log(`  Duration: ${(float32Data.length / 16000 * 1000).toFixed(1)}ms`);
        }

        if (!success) {
          console.warn('[OpenAI fifoToJitterBuffer] JitterBuffer rejected chunk (full?)');
          break;
        }

        drained++;
      } catch (error) {
        console.error('[OpenAI fifoToJitterBuffer] Conversion error:', error);
      }
    }

    if (isBuffering && drained > 0) {
      const health = this.jitterBuffer.getBufferHealth();
      const progress = (health.currentDuration / threshold) * 100;
      console.log(
        `[OpenAI fifoToJitterBuffer] Drained ${drained} chunks → ` +
        `${health.currentDuration.toFixed(0)}ms / ${threshold}ms (${progress.toFixed(0)}%)`
      );
    }
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    console.log('[OpenAIStreamingPlayer] Starting playback');

    this.isPlaying = true;
    this.isPaused = false;

    if (this.firstSoundTime === 0) {
      this.firstSoundTime = Date.now();
      const latency = this.firstSoundTime - this.startTime;
      console.log(`[OpenAIStreamingPlayer] First sound latency: ${latency}ms`);
    }

    // Initialize cumulative scheduled time
    const now = this.audioContext.getPlaybackTime();
    this.nextScheduledTime = now + 0.05;
    console.log(`[OpenAIStreamingPlayer] Initial schedule time: ${this.nextScheduledTime.toFixed(3)}s`);

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

    // Apply zero-crossing alignment to first chunk
    if (this.config.useZeroCrossing && this.chunksPlayed === 0) {
      const aligned = this.zeroCrossingAligner.align(data, AlignmentMode.START);
      data = aligned.data;
      console.log(`[OpenAIStreamingPlayer] Applied zero-crossing alignment: trimmed ${aligned.totalTrimmed} samples`);
    }

    try {
      const buffer = this.audioContext.createBuffer(data, this.config.sampleRate);
      const source = this.audioContext.scheduleBuffer(buffer, this.nextScheduledTime);

      const chunkDuration = data.length / this.config.sampleRate;
      const previousTime = this.nextScheduledTime;
      this.nextScheduledTime += chunkDuration;

      console.log(
        `[OpenAI scheduleNextChunk] Chunk #${this.chunksPlayed + 1}: ` +
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
      console.error('[OpenAIStreamingPlayer] Schedule error:', error);
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
          this.stopTimers();
          this.isPlaying = false;
          console.log('[OpenAIStreamingPlayer] Buffers drained, all audio sources finished');
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
          this.stopTimers();
          this.isPlaying = false;

          // ✅ FIX: Emit 'done' event even on timeout to unlock microphone
          if (!this.doneEmitted) {
            this.doneEmitted = true;
            this.setState(PlayerState.DONE);
            this.emit('done', this.getMetrics());
          }

          console.log('[OpenAIStreamingPlayer] Drain timeout, emitted done event');
          resolve();
        }
      }, 60000); // ← Increased from 5000 to 60000 for long audio

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
    console.log('[OpenAIStreamingPlayer] Stopping');

    // ✅ FIX: Remember if we were playing to emit 'done' for mic unlock
    const wasPlaying = this.isPlaying;
    const hadNotEmittedDone = !this.doneEmitted;

    // Record stop time for debouncing
    this.lastStopTime = Date.now();

    this.openaiService.stop();
    this.currentGenerator = null;
    this.stopTimers();

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
      console.log('[OpenAIStreamingPlayer] Emitted done event on stop');
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    console.log('[OpenAIStreamingPlayer] Pausing');

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

    console.log('[OpenAIStreamingPlayer] Resuming');

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
      sourceSampleRate: 24000,
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
   * Remove event listener
   */
  off(event: PlayerEvent, listener: EventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Remove all event listeners
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
          console.error(`[OpenAIStreamingPlayer] Error in ${event} listener:`, error);
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
      console.log(`[OpenAIStreamingPlayer] State: ${oldState} → ${state}`);
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    console.log('[OpenAIStreamingPlayer] Disposing');

    this.stop();

    // Don't dispose shared AudioContext singleton
    // (Other players might still need it)
    console.log('[OpenAIStreamingPlayer] Skipping AudioContext disposal (shared singleton)');

    this.eventListeners.clear();
    this.scheduledSources.clear();
  }
}

/**
 * Singleton management
 */
let singletonInstance: OpenAIStreamingPlayer | null = null;

export function getOpenAIStreamingPlayer(
  apiKey: string,
  config?: Partial<OpenAIPlayerConfig>
): OpenAIStreamingPlayer {
  // Check if instance exists and has valid AudioContext
  const needsRecreation = singletonInstance && !singletonInstance['audioContext'].isValid();

  if (needsRecreation) {
    console.log('[OpenAI Singleton] AudioContext destroyed, recreating player');
    // Don't dispose - just recreate (disposal would destroy shared AudioContext)
    singletonInstance = null;
  }

  if (!singletonInstance) {
    console.log('[OpenAI Singleton] Creating new player instance');
    singletonInstance = new OpenAIStreamingPlayer(apiKey, config);
  }

  return singletonInstance;
}

export function resetOpenAIStreamingPlayer(): void {
  if (singletonInstance) {
    singletonInstance.dispose();
    singletonInstance = null;
  }
}
