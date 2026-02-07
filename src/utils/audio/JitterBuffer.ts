/**
 * Jitter Buffer for Streaming Audio
 *
 * Manages pre-buffering and smooth playback for streaming audio.
 * Handles buffer underruns and provides health metrics.
 *
 * @format Float32 samples
 * @usage Pre-buffering before starting audio playback
 */

import { CircularBuffer, BufferHealth } from './CircularBuffer';

/**
 * Buffer state
 */
export enum BufferState {
  /** Initial state, no data */
  IDLE = 'idle',
  /** Accumulating data to reach threshold */
  BUFFERING = 'buffering',
  /** Ready to start playback */
  READY = 'ready',
  /** Currently playing */
  PLAYING = 'playing',
  /** Buffer underrun occurred */
  UNDERRUN = 'underrun',
  /** Error occurred */
  ERROR = 'error',
}

/**
 * Underrun strategy
 */
export enum UnderrunStrategy {
  /** Pause playback and wait for more data */
  PAUSE = 'pause',
  /** Fill with silence */
  SILENCE = 'silence',
  /** Repeat last chunk (loop) */
  REPEAT = 'repeat',
}

/**
 * Buffer configuration
 */
export interface JitterBufferConfig {
  /** Pre-buffer threshold in milliseconds */
  preBufferThreshold: number;
  /** Maximum buffer size in seconds */
  maxBufferSize: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Strategy when buffer underruns */
  underrunStrategy: UnderrunStrategy;
  /** Minimum samples to consider as having data */
  minSamples: number;
}

/**
 * Buffer health report
 */
export interface JitterBufferHealth {
  /** Current state */
  state: BufferState;
  /** Buffer duration in milliseconds */
  currentDuration: number;
  /** Threshold duration in milliseconds */
  thresholdDuration: number;
  /** Percentage of threshold filled */
  thresholdPercent: number;
  /** Whether buffer is ready */
  isReady: boolean;
  /** Total samples available */
  availableSamples: number;
  /** Playback position in samples */
  playbackPosition: number;
  /** Number of dropped chunks due to overflow */
  droppedChunks: number;
  /** Number of underruns that occurred */
  underrunCount: number;
  /** Last underrun time */
  lastUnderrunTime: number | null;
}

/**
 * Chunk read result
 */
export interface ChunkReadResult {
  /** Audio data */
  data: Float32Array;
  /** Number of samples read */
  samplesRead: number;
  /** Whether this was a partial read (underrun) */
  partial: boolean;
  /** Whether silence was inserted */
  silenceInserted: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<JitterBufferConfig> = {
  preBufferThreshold: 300, // 300ms
  maxBufferSize: 5,
  sampleRate: 16000,
  underrunStrategy: UnderrunStrategy.SILENCE,
  minSamples: 100,
};

/**
 * Jitter Buffer Class
 *
 * Manages audio buffering for smooth streaming playback.
 * Implements pre-buffering threshold and underrun handling.
 */
export class JitterBuffer {
  private buffer: CircularBuffer;
  private config: Required<JitterBufferConfig>;
  private state: BufferState = BufferState.IDLE;
  private playbackPosition: number = 0;
  private droppedChunks: number = 0;
  private underrunCount: number = 0;
  private lastUnderrunTime: number | null = null;
  private lastChunk: Float32Array | null = null;

  constructor(config?: Partial<JitterBufferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = new CircularBuffer({
      bufferSizeSeconds: this.config.maxBufferSize,
      sampleRate: this.config.sampleRate,
      channels: 1,
    });
  }

  /**
   * Add a chunk to the buffer
   *
   * @param data - Float32Array audio data
   * @returns Whether the chunk was added
   */
  addChunk(data: Float32Array): boolean {
    // Check minimum size
    if (data.length < this.config.minSamples) {
      return false;
    }

    // Check if buffer would overflow
    const availableBefore = this.buffer.getAvailableSamples();
    const capacity = this.buffer.getCapacity();
    const wouldOverflow = availableBefore + data.length > capacity;

    // NEW: Reject chunks if buffer is too full (> 80% capacity)
    // This prevents audio distortion from overwriting data while reading
    const maxBufferMs = 2000; // 2 seconds hard limit
    const currentDurationMs = (availableBefore / this.config.sampleRate) * 1000;

    if (currentDurationMs > maxBufferMs) {
      // Drop this chunk instead of overwriting (prevents distortion)
      this.droppedChunks++;
      console.warn(`[JitterBuffer] Dropping chunk - buffer full (${currentDurationMs.toFixed(0)}ms)`);
      return false;
    }

    if (wouldOverflow) {
      this.droppedChunks++;
      // Still write (will overwrite oldest)
    }

    this.buffer.write(data);

    // Store for repeat strategy
    this.lastChunk = data;

    // Update state based on buffer level
    this.updateState();

    return true;
  }

  /**
   * Check if playback can start
   *
   * @returns Whether buffer has reached threshold
   */
  canStartPlayback(): boolean {
    const duration = this.buffer.getBufferDuration();
    return duration >= this.config.preBufferThreshold;
  }

  /**
   * Get next chunk for playback
   *
   * @param numSamples - Number of samples to read
   * @returns Chunk read result
   */
  getNextChunk(numSamples: number): ChunkReadResult {
    const result = this.buffer.read(numSamples);
    this.playbackPosition += result.samplesRead;

    let silenceInserted = false;

    // Handle underrun
    if (result.partial) {
      this.underrunCount++;
      this.lastUnderrunTime = Date.now();

      // Update state to underrun
      if (this.state === BufferState.PLAYING) {
        this.state = BufferState.UNDERRUN;
      }

      // Apply underrun strategy
      switch (this.config.underrunStrategy) {
        case UnderrunStrategy.SILENCE:
          // Fill remaining with silence
          if (result.data.length < numSamples) {
            const silence = new Float32Array(numSamples - result.data.length);
            const combined = new Float32Array(numSamples);
            combined.set(result.data);
            combined.set(silence, result.data.length);
            result.data = combined;
            result.samplesRead = numSamples;
            silenceInserted = true;
          }
          break;

        case UnderrunStrategy.REPEAT:
          // Repeat last chunk if available
          if (this.lastChunk && this.lastChunk.length > 0) {
            const needed = numSamples - result.data.length;
            const repeatCount = Math.ceil(needed / this.lastChunk.length);
            const repeated = new Float32Array(needed);
            for (let i = 0; i < repeatCount; i++) {
              const copyLength = Math.min(
                this.lastChunk.length,
                needed - i * this.lastChunk.length
              );
              repeated.set(
                this.lastChunk.subarray(0, copyLength),
                i * this.lastChunk.length
              );
            }
            const combined = new Float32Array(numSamples);
            combined.set(result.data);
            combined.set(repeated, result.data.length);
            result.data = combined;
            result.samplesRead = numSamples;
          }
          break;

        case UnderrunStrategy.PAUSE:
          // Just return partial, caller should pause
          break;
      }
    } else {
      // No underrun, update state
      if (this.state === BufferState.UNDERRUN || this.state === BufferState.BUFFERING) {
        if (this.canStartPlayback()) {
          this.state = BufferState.READY;
        }
      }
    }

    return {
      data: result.data,
      samplesRead: result.samplesRead,
      partial: result.partial,
      silenceInserted,
    };
  }

  /**
   * Update buffer state based on current level
   */
  private updateState(): void {
    const duration = this.buffer.getBufferDuration();

    switch (this.state) {
      case BufferState.IDLE:
        if (duration > 0) {
          this.state = BufferState.BUFFERING;
        }
        break;

      case BufferState.BUFFERING:
        if (this.canStartPlayback()) {
          this.state = BufferState.READY;
        }
        break;

      case BufferState.READY:
        if (duration < this.config.preBufferThreshold * 0.5) {
          this.state = BufferState.UNDERRUN;
        }
        break;

      case BufferState.PLAYING:
        if (duration === 0) {
          this.state = BufferState.UNDERRUN;
        }
        break;

      case BufferState.UNDERRUN:
        if (this.canStartPlayback()) {
          this.state = BufferState.READY;
        }
        break;
    }
  }

  /**
   * Set the buffer state manually
   *
   * @param state - New state
   */
  setState(state: BufferState): void {
    this.state = state;
  }

  /**
   * Get current buffer state
   */
  getState(): BufferState {
    return this.state;
  }

  /**
   * Get buffer health report
   */
  getBufferHealth(): JitterBufferHealth {
    const duration = this.buffer.getBufferDuration();
    const thresholdPercent =
      (duration / this.config.preBufferThreshold) * 100;

    return {
      state: this.state,
      currentDuration: duration,
      thresholdDuration: this.config.preBufferThreshold,
      thresholdPercent: Math.min(thresholdPercent, 100),
      isReady: this.canStartPlayback(),
      availableSamples: this.buffer.getAvailableSamples(),
      playbackPosition: this.playbackPosition,
      droppedChunks: this.droppedChunks,
      underrunCount: this.underrunCount,
      lastUnderrunTime: this.lastUnderrunTime,
    };
  }

  /**
   * Reset the buffer
   */
  reset(): void {
    this.buffer.clear();
    this.state = BufferState.IDLE;
    this.playbackPosition = 0;
    this.droppedChunks = 0;
    this.underrunCount = 0;
    this.lastUnderrunTime = null;
    this.lastChunk = null;
  }

  /**
   * Clear the buffer (keeps counters)
   */
  clear(): void {
    this.buffer.clear();
  }

  /**
   * Get underlying circular buffer
   */
  getBuffer(): CircularBuffer {
    return this.buffer;
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<JitterBufferConfig>> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<JitterBufferConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate buffer if size changed
    if (config.maxBufferSize !== undefined) {
      const oldBuffer = this.buffer;
      this.buffer = new CircularBuffer({
        bufferSizeSeconds: this.config.maxBufferSize,
        sampleRate: this.config.sampleRate,
        channels: 1,
      });
      // Note: Old buffer data is lost
    }
  }
}

/**
 * Create a jitter buffer with default settings
 *
 * @param preBufferThreshold - Pre-buffer threshold in ms (default: 300)
 * @param maxBufferSize - Max buffer size in seconds (default: 5)
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @returns New JitterBuffer instance
 */
export function createJitterBuffer(
  preBufferThreshold: number = 300,
  maxBufferSize: number = 5,
  sampleRate: number = 16000
): JitterBuffer {
  return new JitterBuffer({
    preBufferThreshold,
    maxBufferSize,
    sampleRate,
    underrunStrategy: UnderrunStrategy.SILENCE,
  });
}
