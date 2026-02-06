/**
 * FIFO Queue for Audio Chunk Ordering
 *
 * A simple First-In-First-Out queue for ordering WebSocket chunks.
 * Ensures audio chunks are processed in the correct sequence.
 *
 * @usage Buffering WebSocket audio chunks before jitter buffer
 */

/**
 * Queue entry with metadata
 */
export interface QueueEntry<T> {
  /** The data payload (typically ArrayBuffer) */
  data: T;
  /** Timestamp when entry was enqueued */
  timestamp: number;
  /** Optional sequence number */
  sequence?: number;
  /** Entry size in bytes (for data = ArrayBuffer) */
  size?: number;
}

/**
 * Queue configuration
 */
export interface FIFOQueueConfig {
  /** Maximum number of entries (0 = unlimited) */
  maxSize: number;
  /** Maximum total size in bytes (0 = unlimited) */
  maxBytes: number;
  /** Whether to drop oldest when full */
  dropOldest: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<FIFOQueueConfig> = {
  maxSize: 0, // Unlimited
  maxBytes: 0, // Unlimited
  dropOldest: true,
};

/**
 * FIFO Queue Class
 *
 * Generic queue implementation for audio chunk ordering.
 * Thread-safe for single producer, single consumer.
 */
export class FIFOQueue<T = ArrayBuffer> {
  private entries: QueueEntry<T>[] = [];
  private config: Required<FIFOQueueConfig>;
  private totalBytes: number = 0;
  private nextSequence: number = 0;

  constructor(config?: Partial<FIFOQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add an entry to the queue
   *
   * @param data - Data to enqueue
   * @param sequence - Optional sequence number (auto-generated if not provided)
   * @returns The queue entry that was created
   */
  enqueue(data: T, sequence?: number): QueueEntry<T> {
    const entry: QueueEntry<T> = {
      data,
      timestamp: Date.now(),
      sequence: sequence ?? this.nextSequence++,
    };

    // Calculate size for ArrayBuffer
    if (data instanceof ArrayBuffer) {
      entry.size = data.byteLength;
    }

    // Check if we need to drop entries
    this.checkCapacity();

    // Add to queue
    this.entries.push(entry);
    this.totalBytes += entry.size ?? 0;

    return entry;
  }

  /**
   * Remove and return the first entry
   *
   * @returns The first entry, or null if queue is empty
   */
  dequeue(): QueueEntry<T> | null {
    if (this.entries.length === 0) {
      return null;
    }

    const entry = this.entries.shift()!;
    this.totalBytes -= entry.size ?? 0;

    return entry;
  }

  /**
   * Look at the first entry without removing it
   *
   * @returns The first entry, or null if queue is empty
   */
  peek(): QueueEntry<T> | null {
    if (this.entries.length === 0) {
      return null;
    }

    return this.entries[0];
  }

  /**
   * Get all entries without removing them
   *
   * @returns Copy of entries array
   */
  peekAll(): QueueEntry<T>[] {
    return [...this.entries];
  }

  /**
   * Get the number of entries in the queue
   */
  size(): number {
    return this.entries.length;
  }

  /**
   * Get total bytes in queue
   */
  getTotalBytes(): number {
    return this.totalBytes;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /**
   * Clear all entries from the queue
   */
  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }

  /**
   * Check capacity and drop oldest if needed
   */
  private checkCapacity(): void {
    // Check max size
    if (this.config.maxSize > 0 && this.entries.length >= this.config.maxSize) {
      if (this.config.dropOldest) {
        const removed = this.entries.shift();
        this.totalBytes -= removed?.size ?? 0;
      } else {
        throw new Error(`FIFO queue is full (maxSize: ${this.config.maxSize})`);
      }
    }

    // Check max bytes
    if (this.config.maxBytes > 0 && this.totalBytes >= this.config.maxBytes) {
      if (this.config.dropOldest) {
        while (this.totalBytes >= this.config.maxBytes && this.entries.length > 0) {
          const removed = this.entries.shift();
          this.totalBytes -= removed?.size ?? 0;
        }
      } else {
        throw new Error(`FIFO queue is full (maxBytes: ${this.config.maxBytes})`);
      }
    }
  }

  /**
   * Get the oldest entry's timestamp
   */
  getOldestTimestamp(): number | null {
    if (this.entries.length === 0) {
      return null;
    }
    return this.entries[0].timestamp;
  }

  /**
   * Get the newest entry's timestamp
   */
  getNewestTimestamp(): number | null {
    if (this.entries.length === 0) {
      return null;
    }
    return this.entries[this.entries.length - 1].timestamp;
  }

  /**
   * Get age of oldest entry in milliseconds
   */
  getOldestAge(): number | null {
    const oldest = this.getOldestTimestamp();
    if (oldest === null) {
      return null;
    }
    return Date.now() - oldest;
  }

  /**
   * Remove entries older than specified age
   *
   * @param maxAgeMs - Maximum age in milliseconds
   * @returns Number of entries removed
   */
  removeOlderThan(maxAgeMs: number): number {
    const now = Date.now();
    let removed = 0;

    while (
      this.entries.length > 0 &&
      now - this.entries[0].timestamp > maxAgeMs
    ) {
      const entry = this.entries.shift()!;
      this.totalBytes -= entry.size ?? 0;
      removed++;
    }

    return removed;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      size: this.entries.length,
      totalBytes: this.totalBytes,
      oldestTimestamp: this.getOldestTimestamp(),
      newestTimestamp: this.getNewestTimestamp(),
      oldestAge: this.getOldestAge(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FIFOQueueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<FIFOQueueConfig>> {
    return { ...this.config };
  }

  /**
   * Reset sequence number counter
   */
  resetSequence(): void {
    this.nextSequence = 0;
  }
}

/**
 * Create a FIFO queue with default settings
 *
 * @param maxSize - Maximum number of entries (0 = unlimited)
 * @param maxBytes - Maximum total bytes (0 = unlimited)
 * @returns New FIFOQueue instance
 */
export function createFIFOQueue<T = ArrayBuffer>(
  maxSize: number = 0,
  maxBytes: number = 0
): FIFOQueue<T> {
  return new FIFOQueue<T>({
    maxSize,
    maxBytes,
    dropOldest: true,
  });
}
