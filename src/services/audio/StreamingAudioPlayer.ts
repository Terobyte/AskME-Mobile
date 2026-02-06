/**
 * Streaming Audio Player
 *
 * Main orchestrator for streaming audio playback using react-native-audio-api.
 * Integrates all audio components for gapless, low-latency playback.
 *
 * @architecture WebSocket → Converter → FIFO → JitterBuffer → AudioContext
 */

import { Int16ToFloat32Converter } from '../utils/audio/Int16ToFloat32Converter';
import { FIFOQueue, QueueEntry } from '../utils/audio/FIFOQueue';
import { JitterBuffer, BufferState, UnderrunStrategy } from '../utils/audio/JitterBuffer';
import { ZeroCrossingAligner, AlignmentMode } from '../utils/audio/ZeroCrossingAligner';
import { AudioContextManager } from '../utils/audio/AudioContextManager';

/**
 * Player state
 */
export enum PlayerState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  BUFFERING = 'buffering',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/**
 * Player events
 */
export type PlayerEvent =
  | 'connecting'
  | 'connected'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'underrun'
  | 'error'
  | 'metrics';

/**
 * Player metrics
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
  /** Number of samples queued */
  samplesQueued: number;
  /** Playback position in samples */
  playbackPosition: number;
  /** Current latency in milliseconds */
  latency: number;
  /** Number of chunks dropped */
  droppedChunks: number;
  /** Number of underruns */
  underrunCount: number;
  /** Current gain (volume) */
  gain: number;
}

/**
 * Player configuration
 */
export interface StreamingPlayerConfig {
  /** WebSocket URL */
  url?: string;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Pre-buffer threshold in milliseconds */
  preBufferThreshold: number;
  /** Maximum buffer size in seconds */
  maxBufferSize: number;
  /** Underrun strategy */
  underrunStrategy: UnderrunStrategy;
  /** Crossfade duration in seconds */
  crossfadeDuration: number;
  /** Initial gain (0.0 - 1.0) */
  initialGain: number;
  /** Whether to align to zero-crossing */
  useZeroCrossing: boolean;
  /** Number of channels (1 = mono, 2 = stereo) */
  channels: number;
}

/**
 * Event listener type
 */
export type EventListener = (data: any) => void;

/**
 * Streaming Audio Player Class
 */
export class StreamingAudioPlayer {
  // Components
  private converter: Int16ToFloat32Converter;
  private fifoQueue: FIFOQueue<ArrayBuffer>;
  private jitterBuffer: JitterBuffer;
  private audioContext: AudioContextManager;
  private zeroCrossingAligner: ZeroCrossingAligner;

  // State
  private state: PlayerState = PlayerState.IDLE;
  private config: StreamingPlayerConfig;
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private playbackTimer: NodeJS.Timeout | null = null;

  // WebSocket
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;

  // Event listeners
  private eventListeners: Map<PlayerEvent, Set<EventListener>> = new Map();

  // Metrics tracking
  private startTime: number = 0;
  private chunksReceived: number = 0;
  private chunksPlayed: number = 0;

  constructor(config?: Partial<StreamingPlayerConfig>) {
    // Default configuration
    this.config = {
      sampleRate: 16000,
      preBufferThreshold: 300,
      maxBufferSize: 5,
      underrunStrategy: UnderrunStrategy.SILENCE,
      crossfadeDuration: 0.05,
      initialGain: 1.0,
      useZeroCrossing: true,
      channels: 1,
      ...config,
    };

    // Initialize components
    this.converter = new Int16ToFloat32Converter({
      sampleRate: this.config.sampleRate,
      validate: true,
      clamp: true,
    });

    this.fifoQueue = new FIFOQueue<ArrayBuffer>({
      maxSize: 100,
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
  }

  /**
   * Connect to WebSocket server
   *
   * @param url - WebSocket URL
   */
  async connect(url: string): Promise<void> {
    if (this.state === PlayerState.CONNECTING || this.state === PlayerState.PLAYING) {
      throw new Error(`Cannot connect while ${this.state}`);
    }

    this.setState(PlayerState.CONNECTING);
    this.emit('connecting', { url });

    this.wsUrl = url;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this.setState(PlayerState.BUFFERING);
          this.emit('connected', { url });
          this.startProcessing();
          resolve();
        };

        this.ws.onerror = (error) => {
          const err = new Error(`WebSocket error: ${error}`);
          this.setState(PlayerState.ERROR);
          this.emit('error', { error: err });
          reject(err);
        };

        this.ws.onclose = () => {
          if (this.state !== PlayerState.STOPPED) {
            this.stop();
          }
        };

        this.ws.onmessage = (event) => {
          this.handleChunk(event.data as ArrayBuffer);
        };

        // Connection timeout
        setTimeout(() => {
          if (this.state === PlayerState.CONNECTING) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming audio chunk
   */
  private handleChunk(data: ArrayBuffer): void {
    try {
      // Add to FIFO queue
      this.fifoQueue.enqueue(data);
      this.chunksReceived++;
    } catch (error) {
      console.error('[StreamingPlayer] Error handling chunk:', error);
    }
  }

  /**
   * Start processing chunks from FIFO to jitter buffer
   */
  private startProcessing(): void {
    // Process FIFO queue periodically
    const processInterval = setInterval(() => {
      if (this.state === PlayerState.STOPPED) {
        clearInterval(processInterval);
        return;
      }

      // Move chunks from FIFO to jitter buffer
      while (!this.fifoQueue.isEmpty()) {
        const entry = this.fifoQueue.dequeue();
        if (entry) {
          try {
            const result = this.converter.convert(entry.data);
            this.jitterBuffer.addChunk(result.data);
          } catch (error) {
            console.error('[StreamingPlayer] Conversion error:', error);
          }
        }
      }

      // Update metrics
      this.emit('metrics', this.getMetrics());

      // Check if we can start playback
      if (
        !this.isPlaying &&
        !this.isPaused &&
        this.jitterBuffer.canStartPlayback()
      ) {
        this.startPlayback();
      }

      // Handle underrun
      if (this.isPlaying && this.jitterBuffer.getState() === BufferState.UNDERRUN) {
        this.emit('underrun', this.getMetrics());
      }
    }, 20); // 50Hz processing
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    if (!this.audioContext.isReady()) {
      await this.audioContext.initialize();
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());

    // Start playback loop
    this.scheduleNextChunk();
  }

  /**
   * Schedule next audio chunk
   */
  private scheduleNextChunk(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    // Read from jitter buffer
    const chunkSize = 320; // ~20ms at 16kHz
    const result = this.jitterBuffer.getNextChunk(chunkSize);

    if (result.samplesRead === 0) {
      // No data available
      return;
    }

    let data = result.data;

    // Apply zero-crossing alignment
    if (this.config.useZeroCrossing && this.chunksPlayed === 0) {
      const aligned = this.zeroCrossingAligner.align(data, AlignmentMode.START);
      data = aligned.data;
    }

    // Create buffer and schedule
    const buffer = this.audioContext.createBuffer(data);
    this.audioContext.scheduleBuffer(buffer);

    this.chunksPlayed++;

    // Schedule next chunk
    const durationMs = (data.length / this.config.sampleRate) * 1000;
    const scheduleAhead = Math.max(0, durationMs - 10); // Schedule 10ms before end

    setTimeout(() => {
      this.scheduleNextChunk();
    }, scheduleAhead);
  }

  /**
   * Start playback (public method)
   */
  start(): void {
    if (this.state === PlayerState.PAUSED) {
      this.resume();
      return;
    }

    if (this.state === PlayerState.IDLE || this.state === PlayerState.BUFFERING) {
      // Will start when buffer is ready
      this.startProcessing();
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.isPlaying = false;
    this.isPaused = false;
    this.audioContext.stopAll();
    this.jitterBuffer.clear();
    this.fifoQueue.clear();
    this.chunksPlayed = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState(PlayerState.STOPPED);
    this.emit('stopped', this.getMetrics());
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.isPlaying) {
      return;
    }

    this.isPaused = true;
    this.audioContext.suspend();
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

    this.isPaused = false;
    this.audioContext.resume();
    this.setState(PlayerState.PLAYING);
    this.emit('playing', this.getMetrics());
    this.scheduleNextChunk();
  }

  /**
   * Set volume
   *
   * @param level - Volume level (0.0 - 1.0)
   * @param rampTime - Optional ramp time in seconds
   */
  setVolume(level: number, rampTime?: number): void {
    this.audioContext.setGain(level, rampTime);
    this.config.initialGain = level;
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
      latency: Date.now() - this.startTime,
      droppedChunks: health.droppedChunks,
      underrunCount: health.underrunCount,
      gain: audioMetrics.gain,
    };
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
   * Emit event to listeners
   */
  private emit(event: PlayerEvent, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[StreamingPlayer] Error in ${event} listener:`, error);
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
      console.log(`[StreamingPlayer] State: ${oldState} → ${state}`);
    }
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    this.stop();
    await this.audioContext.dispose();
    this.eventListeners.clear();
  }
}

/**
 * Create a new streaming audio player
 *
 * @param config - Optional configuration
 * @returns New StreamingAudioPlayer instance
 */
export function createStreamingAudioPlayer(
  config?: Partial<StreamingPlayerConfig>
): StreamingAudioPlayer {
  return new StreamingAudioPlayer(config);
}
