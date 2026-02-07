/**
 * Circular Buffer (Ring Buffer) for Audio Streaming
 *
 * A circular buffer implementation optimized for audio streaming with:
 * - O(1) write and read operations
 * - Automatic wrap-around (circular behavior)
 * - TypedArray-based for performance
 * - Thread-safe read/write position tracking
 *
 * @format Float32 samples
 * @usage Jitter buffering for streaming audio
 */

/**
 * Buffer configuration
 */
export interface CircularBufferConfig {
  /** Buffer size in seconds */
  bufferSizeSeconds: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of channels (default: 1 for mono) */
  channels: number;
}

/**
 * Buffer health metrics
 */
export interface BufferHealth {
  /** Total capacity in samples */
  capacity: number;
  /** Current available samples to read */
  availableSamples: number;
  /** Available samples as percentage */
  availablePercent: number;
  /** Buffer duration in milliseconds */
  durationMs: number;
  /** Write position */
  writePosition: number;
  /** Read position */
  readPosition: number;
  /** Whether buffer is empty */
  isEmpty: boolean;
  /** Whether buffer is full */
  isFull: boolean;
}

/**
 * Read result
 */
export interface ReadResult {
  /** Data read from buffer */
  data: Float32Array;
  /** Number of samples actually read */
  samplesRead: number;
  /** Whether end of available data was reached */
  partial: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<CircularBufferConfig> = {
  bufferSizeSeconds: 5,
  sampleRate: 44100,
  channels: 1,
};

/**
 * Circular Buffer Class
 *
 * Implements a ring buffer for efficient audio streaming.
 * Data is written at the write position and read from the read position.
 * When either pointer reaches the end, it wraps to the beginning.
 */
export class CircularBuffer {
  private buffer: Float32Array;
  private writePos: number = 0;
  private readPos: number = 0;
  private availableSamples: number = 0;
  private config: Required<CircularBufferConfig>;
  private readonly capacity: number;

  constructor(config?: CircularBufferConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Calculate total capacity (samples * channels)
    this.capacity =
      this.config.bufferSizeSeconds * this.config.sampleRate * this.config.channels;

    // Initialize buffer with zeros
    this.buffer = new Float32Array(this.capacity);
  }

  /**
   * Write data to the buffer
   *
   * Data is written starting at writePos, wrapping around if necessary.
   * If buffer would overflow, oldest data is overwritten.
   *
   * @param data - Float32Array to write
   * @returns Number of samples actually written
   */
  write(data: Float32Array): number {
    const dataLength = data.length;
    const samplesToWrite = Math.min(dataLength, this.capacity);

    // Calculate available space before wrap
    const spaceUntilEnd = this.capacity - this.writePos;
    const canWriteWithoutWrap = Math.min(samplesToWrite, spaceUntilEnd);

    // Write first segment (until wrap point or end of data)
    this.buffer.set(data.subarray(0, canWriteWithoutWrap), this.writePos);

    // Write second segment if we wrapped
    if (samplesToWrite > canWriteWithoutWrap) {
      const remaining = samplesToWrite - canWriteWithoutWrap;
      this.buffer.set(data.subarray(canWriteWithoutWrap, samplesToWrite), 0);
      this.writePos = remaining;
    } else {
      this.writePos += samplesToWrite;
      if (this.writePos >= this.capacity) {
        this.writePos = 0;
      }
    }

    // Update available samples
    this.availableSamples = Math.min(
      this.availableSamples + samplesToWrite,
      this.capacity
    );

    return samplesToWrite;
  }

  /**
   * Read data from the buffer
   *
   * @param numSamples - Number of samples to read
   * @returns ReadResult with data and metadata
   */
  read(numSamples: number): ReadResult {
    const samplesAvailable = Math.min(numSamples, this.availableSamples);
    const partial = samplesAvailable < numSamples;

    // Allocate result buffer
    const result = new Float32Array(samplesAvailable);

    if (samplesAvailable === 0) {
      return {
        data: result,
        samplesRead: 0,
        partial: true,
      };
    }

    // Calculate data available until wrap
    const dataUntilEnd = this.capacity - this.readPos;
    const canReadWithoutWrap = Math.min(samplesAvailable, dataUntilEnd);

    // Read first segment
    result.set(
      this.buffer.subarray(this.readPos, this.readPos + canReadWithoutWrap),
      0
    );

    // Read second segment if we wrapped
    if (samplesAvailable > canReadWithoutWrap) {
      const remaining = samplesAvailable - canReadWithoutWrap;
      result.set(this.buffer.subarray(0, remaining), canReadWithoutWrap);
      this.readPos = remaining;
    } else {
      this.readPos += samplesAvailable;
      if (this.readPos >= this.capacity) {
        this.readPos = 0;
      }
    }

    // Update available samples
    this.availableSamples -= samplesAvailable;

    return {
      data: result,
      samplesRead: samplesAvailable,
      partial,
    };
  }

  /**
   * Peek at data without advancing read position
   *
   * @param numSamples - Number of samples to peek
   * @returns Copy of data (without modifying buffer state)
   */
  peek(numSamples: number): Float32Array {
    const samplesAvailable = Math.min(numSamples, this.availableSamples);
    const result = new Float32Array(samplesAvailable);

    if (samplesAvailable === 0) {
      return result;
    }

    // Save current read position
    const originalReadPos = this.readPos;

    // Temporarily read
    const readResult = this.read(samplesAvailable);
    result.set(readResult.data);

    // Restore read position
    this.readPos = originalReadPos;
    this.availableSamples += readResult.samplesRead;

    return result;
  }

  /**
   * Get number of samples available for reading
   */
  getAvailableSamples(): number {
    return this.availableSamples;
  }

  /**
   * Get buffer capacity in samples
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get buffer duration in milliseconds
   */
  getBufferDuration(): number {
    return (this.availableSamples / this.config.sampleRate) * 1000;
  }

  /**
   * Get total buffer capacity in milliseconds
   */
  getTotalDuration(): number {
    return (this.capacity / this.config.sampleRate) * 1000;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer.fill(0);
    this.writePos = 0;
    this.readPos = 0;
    this.availableSamples = 0;
  }

  /**
   * Get buffer health metrics
   */
  getHealth(): BufferHealth {
    const availablePercent = (this.availableSamples / this.capacity) * 100;

    return {
      capacity: this.capacity,
      availableSamples: this.availableSamples,
      availablePercent,
      durationMs: this.getBufferDuration(),
      writePosition: this.writePos,
      readPosition: this.readPos,
      isEmpty: this.availableSamples === 0,
      isFull: this.availableSamples >= this.capacity - 1,
    };
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.availableSamples === 0;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.availableSamples >= this.capacity - 1;
  }

  /**
   * Get write position
   */
  getWritePosition(): number {
    return this.writePos;
  }

  /**
   * Get read position
   */
  getReadPosition(): number {
    return this.readPos;
  }

  /**
   * Get underlying buffer (use with caution)
   *
   * Direct access to internal buffer. Use only for optimization
   * when you understand the circular behavior.
   */
  getBuffer(): Float32Array {
    return this.buffer;
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<CircularBufferConfig>> {
    return { ...this.config };
  }
}

/**
 * Create a circular buffer with default settings
 *
 * @param bufferSizeSeconds - Buffer size in seconds (default: 5)
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @returns New CircularBuffer instance
 */
export function createCircularBuffer(
  bufferSizeSeconds: number = 5,
  sampleRate: number = 16000
): CircularBuffer {
  return new CircularBuffer({
    bufferSizeSeconds,
    sampleRate,
    channels: 1,
  });
}
