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
 */
const DEFAULT_CONFIG: Required<CartesiaPlayerConfig> = {
  sampleRate: 16000,
  preBufferThreshold: 300,
  maxBufferSize: 5,
  underrunStrategy: UnderrunStrategy.SILENCE,
  initialGain: 1.0,
  useZeroCrossing: true,
  chunkSize: 320, // ~20ms at 16kHz
  fifoMaxSize: 100,
  processingInterval: 20, // 50Hz
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

  constructor(config?: Partial<CartesiaPlayerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

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
   * Speak text with streaming playback
   *
   * @param text - Text to speak
   * @param options - Cartesia streaming options
   */
  async speak(text: string, options?: Partial<CartesiaStreamingOptions>): Promise<void> {
    // Cleanup previous
    this.stop();

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

      // Initialize audio context
      if (!this.audioContext.isReady()) {
        await this.audioContext.initialize();
        console.log('[CartesiaStreamingPlayer] Audio context initialized');
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
      this.setState(PlayerState.BUFFERING);
      this.emit('connected', { text: text.substring(0, 50) + '...' });

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

        // Wait for buffers to drain
        await this.drainBuffers();

        this.setState(PlayerState.DONE);
        this.emit('done', this.getMetrics());
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
    // 1. Move chunks from FIFO to JitterBuffer
    this.fifoToJitterBuffer();

    // 2. Check if we can start playback
    if (
      !this.isPlaying &&
      !this.isPaused &&
      this.jitterBuffer.canStartPlayback()
    ) {
      this.startPlayback();
    }

    // 3. Schedule audio if playing
    if (this.isPlaying && !this.isPaused) {
      const hasData = this.jitterBuffer.getBufferHealth().availableSamples > 0;
      // Only schedule if we're still streaming OR we have data in buffers
      if (this.isStreaming || hasData) {
        this.scheduleNextChunk();
      } else {
        // No more data and stream ended - stop playback and timers
        this.isPlaying = false;
        if (this.processingTimer) {
          clearInterval(this.processingTimer);
          this.processingTimer = null;
        }
        if (this.metricsTimer) {
          clearInterval(this.metricsTimer);
          this.metricsTimer = null;
        }
        console.log('[CartesiaStreamingPlayer] Playback complete, timers stopped');
      }
    }

    // 4. Check for underrun (only during active streaming)
    if (this.isPlaying && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
      this.emit('underrun', this.getMetrics());
      console.warn('[CartesiaStreamingPlayer] Buffer underrun!');
    }
  }

  /**
   * Move chunks from FIFO queue to jitter buffer
   *
   * Implements flow control to prevent buffer overflow:
   * - Transfers chunks while FIFO has data AND buffer is healthy
   * - Stops transferring if buffer exceeds 1000ms (leaves rest in FIFO)
   * - This prevents both JitterBuffer overflow AND FIFO overflow
   */
  private fifoToJitterBuffer(): void {
    const maxBufferMs = 1000; // 1 second max - healthy level

    while (!this.fifoQueue.isEmpty()) {
      // Check buffer health BEFORE adding (Flow Control)
      const currentDuration = this.jitterBuffer.getBufferHealth().currentDuration;

      // Don't overfill! Stop if we have enough buffered audio
      if (currentDuration > maxBufferMs) {
        // Leave rest in FIFO for next cycle
        break;
      }

      const entry = this.fifoQueue.dequeue();
      if (!entry) break;

      try {
        // Convert PCM16 -> Float32
        const result = this.converter.convert(entry.data.data);

        // Log buffer health for debugging
        if (this.chunksReceived % 10 === 0) {
          console.log(`[CartesiaStreamingPlayer] Buffer: ${currentDuration.toFixed(0)}ms → adding ${result.data.length} samples`);
        }

        this.jitterBuffer.addChunk(result.data);
      } catch (error) {
        console.error('[CartesiaStreamingPlayer] Conversion error:', error);
      }
    }
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    console.log('[CartesiaStreamingPlayer] Starting playback');

    this.isPlaying = true;
    this.isPaused = false;

    // Track first sound time
    if (this.firstSoundTime === 0) {
      this.firstSoundTime = Date.now();
      const latency = this.firstSoundTime - this.startTime;
      console.log(`[CartesiaStreamingPlayer] First sound latency: ${latency}ms`);
    }

    this.jitterBuffer.setState(BufferState.PLAYING);
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());

    // Schedule first chunk immediately
    this.scheduleNextChunk();
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
      const buffer = this.audioContext.createBuffer(data);
      const source = this.audioContext.scheduleBuffer(buffer);

      // Track source
      this.scheduledSources.add(source);

      // Auto-remove when done
      if (source && typeof source.onended === 'function') {
        source.onended = () => {
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
   */
  private async drainBuffers(): Promise<void> {
    return new Promise<void>((resolve) => {
      const drainInterval = setInterval(() => {
        // Check if buffers are empty
        const fifoEmpty = this.fifoQueue.isEmpty();
        const jitterEmpty = this.jitterBuffer.getBufferHealth().availableSamples === 0;

        if (fifoEmpty && jitterEmpty) {
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
          console.log('[CartesiaStreamingPlayer] Buffers drained, timers stopped');
          resolve();
        }

        // Keep processing
        if (this.isPlaying) {
          this.scheduleNextChunk();
        }
      }, 50);

      // Timeout after 5 seconds
      setTimeout(() => {
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
        console.log('[CartesiaStreamingPlayer] Drain timeout, timers stopped');
        resolve();
      }, 5000);
    });
  }

  /**
   * Stop playback and cleanup
   */
  stop(): void {
    console.log('[CartesiaStreamingPlayer] Stopping');

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

    // Clear buffers
    this.fifoQueue.clear();
    this.jitterBuffer.reset();

    this.setState(PlayerState.STOPPED);
    this.emit('stopped', this.getMetrics());
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
    await this.audioContext.dispose();
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
  if (!singletonInstance) {
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
