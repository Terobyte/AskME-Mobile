/**
 * Zero-Crossing Aligner for Audio Chunk Boundaries
 *
 * Aligns audio chunks to zero-crossing points to prevent clicks and pops
 * at chunk boundaries during playback.
 *
 * @format Float32 samples
 * @usage Pre-processing chunks before scheduling playback
 */

/**
 * Alignment mode
 */
export enum AlignmentMode {
  /** Align the start of the chunk */
  START = 'start',
  /** Align the end of the chunk */
  END = 'end',
  /** Align both start and end */
  BOTH = 'both',
}

/**
 * Alignment result
 */
export interface AlignmentResult {
  /** Aligned audio data */
  data: Float32Array;
  /** Number of samples trimmed from start */
  startTrim: number;
  /** Number of samples trimmed from end */
  endTrim: number;
  /** Whether zero-crossing was found at start */
  foundStart: boolean;
  /** Whether zero-crossing was found at end */
  foundEnd: boolean;
  /** Total samples trimmed */
  totalTrimmed: number;
  /** Whether alignment was successful */
  success: boolean;
}

/**
 * Alignment configuration
 */
export interface ZeroCrossingConfig {
  /** Maximum window size for zero-crossing search (in samples) */
  maxWindowSamples: number;
  /** Maximum percentage of buffer that can be trimmed */
  maxTrimPercent: number;
  /** Minimum buffer size to process */
  minBufferSize: number;
  /** Threshold for considering a value as "near zero" */
  nearZeroThreshold: number;
  /** Whether to use fallback if no zero-crossing found */
  useFallback: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ZeroCrossingConfig> = {
  maxWindowSamples: 320, // ~20ms at 16kHz
  maxTrimPercent: 25,
  minBufferSize: 100,
  nearZeroThreshold: 0.001,
  useFallback: true,
};

/**
 * Zero-Crossing Aligner Class
 *
 * Finds and aligns audio to zero-crossing points to prevent clicks.
 */
export class ZeroCrossingAligner {
  private config: Required<ZeroCrossingConfig>;

  constructor(config?: Partial<ZeroCrossingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Align audio data to zero-crossing points
   *
   * @param data - Input Float32Array
   * @param mode - Alignment mode (start, end, or both)
   * @returns Alignment result
   */
  align(data: Float32Array, mode: AlignmentMode = AlignmentMode.BOTH): AlignmentResult {
    // Edge case: buffer too small
    if (data.length < this.config.minBufferSize) {
      return {
        data,
        startTrim: 0,
        endTrim: 0,
        foundStart: false,
        foundEnd: false,
        totalTrimmed: 0,
        success: false,
      };
    }

    let startTrim = 0;
    let endTrim = 0;
    let foundStart = false;
    let foundEnd = false;

    // Align start
    if (mode === AlignmentMode.START || mode === AlignmentMode.BOTH) {
      const startResult = this.findZeroCrossing(data, 0, 'forward');
      startTrim = startResult.position;
      foundStart = startResult.found;
    }

    // Align end
    if (mode === AlignmentMode.END || mode === AlignmentMode.BOTH) {
      const searchStart = Math.max(startTrim, data.length - this.config.maxWindowSamples);
      const endResult = this.findZeroCrossing(data, searchStart, 'backward');
      endTrim = data.length - endResult.position;
      foundEnd = endResult.found;
    }

    // Check if trim would be too much
    const totalTrim = startTrim + endTrim;
    const maxTrim = Math.floor(data.length * (this.config.maxTrimPercent / 100));

    if (totalTrim > maxTrim || totalTrim >= data.length) {
      // Trim would be too large, return original
      return {
        data,
        startTrim: 0,
        endTrim: 0,
        foundStart: false,
        foundEnd: false,
        totalTrimmed: 0,
        success: false,
      };
    }

    // Trim buffer
    const alignedLength = data.length - totalTrim;
    const aligned = new Float32Array(alignedLength);
    aligned.set(data.subarray(startTrim, data.length - endTrim));

    return {
      data: aligned,
      startTrim,
      endTrim,
      foundStart,
      foundEnd,
      totalTrimmed: totalTrim,
      success: foundStart || foundEnd,
    };
  }

  /**
   * Find zero-crossing point
   *
   * @param data - Audio data
   * @param startIndex - Position to start searching from
   * @param direction - 'forward' or 'backward'
   * @returns Position of zero-crossing and whether found
   */
  findZeroCrossing(
    data: Float32Array,
    startIndex: number = 0,
    direction: 'forward' | 'backward' = 'forward'
  ): { position: number; found: boolean } {
    const maxWindow = Math.min(
      this.config.maxWindowSamples,
      data.length - startIndex
    );

    if (direction === 'forward') {
      // Search forward from startIndex
      for (let i = startIndex; i < startIndex + maxWindow - 1; i++) {
        const current = data[i];
        const next = data[i + 1];

        // Check for sign change
        if ((current >= 0 && next < 0) || (current < 0 && next >= 0)) {
          return { position: i + 1, found: true };
        }

        // Check for near-zero
        if (Math.abs(current) < this.config.nearZeroThreshold) {
          return { position: i, found: true };
        }
      }

      // Fallback: find minimum amplitude
      if (this.config.useFallback) {
        return {
          position: this.findMinAmplitudeIndex(data, startIndex, startIndex + maxWindow),
          found: false,
        };
      }
    } else {
      // Search backward from startIndex
      const searchStart = Math.max(1, startIndex);
      const searchEnd = Math.max(1, startIndex - maxWindow);

      for (let i = searchStart; i >= searchEnd; i--) {
        const prev = data[i - 1];
        const current = data[i];

        // Check for sign change
        if ((prev >= 0 && current < 0) || (prev < 0 && current >= 0)) {
          return { position: i, found: true };
        }

        // Check for near-zero
        if (Math.abs(current) < this.config.nearZeroThreshold) {
          return { position: i, found: true };
        }
      }

      // Fallback: find minimum amplitude
      if (this.config.useFallback) {
        return {
          position: this.findMinAmplitudeIndex(data, searchEnd, searchStart),
          found: false,
        };
      }
    }

    return { position: startIndex, found: false };
  }

  /**
   * Find index with minimum amplitude in range
   *
   * @param data - Audio data
   * @param start - Start index
   * @param end - End index
   * @returns Index of minimum amplitude
   */
  private findMinAmplitudeIndex(
    data: Float32Array,
    start: number,
    end: number
  ): number {
    let minIndex = start;
    let minAmplitude = Math.abs(data[start]);

    for (let i = start + 1; i < end && i < data.length; i++) {
      const amplitude = Math.abs(data[i]);
      if (amplitude < minAmplitude) {
        minAmplitude = amplitude;
        minIndex = i;
      }
    }

    return minIndex;
  }

  /**
   * Trim buffer to zero-crossing at start
   *
   * @param data - Input buffer
   * @returns Trimmed buffer
   */
  trimToZeroCrossing(data: Float32Array): Float32Array {
    const result = this.align(data, AlignmentMode.START);
    return result.data;
  }

  /**
   * Check if buffer is effectively silent
   *
   * @param data - Audio data
   * @returns Whether buffer is silent
   */
  isSilent(data: Float32Array): boolean {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += Math.abs(data[i]);
    }
    const average = sum / data.length;
    return average < this.config.nearZeroThreshold;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ZeroCrossingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<ZeroCrossingConfig>> {
    return { ...this.config };
  }
}

/**
 * Singleton instance with default configuration
 */
export const zeroCrossingAligner = new ZeroCrossingAligner();

/**
 * Convenience function to align audio to zero-crossing
 *
 * @param data - Input Float32Array
 * @param mode - Alignment mode
 * @returns Aligned Float32Array
 */
export function alignToZeroCrossing(
  data: Float32Array,
  mode: AlignmentMode = AlignmentMode.BOTH
): Float32Array {
  const aligner = new ZeroCrossingAligner();
  return aligner.align(data, mode).data;
}

/**
 * Find zero-crossing position in audio data
 *
 * @param data - Audio data
 * @param startIndex - Position to start searching
 * @param direction - Search direction
 * @returns Position of zero-crossing
 */
export function findZeroCrossing(
  data: Float32Array,
  startIndex: number = 0,
  direction: 'forward' | 'backward' = 'forward'
): number {
  const aligner = new ZeroCrossingAligner();
  return aligner.findZeroCrossing(data, startIndex, direction).position;
}
