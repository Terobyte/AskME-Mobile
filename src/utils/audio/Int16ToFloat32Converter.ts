/**
 * Int16 to Float32 Converter
 *
 * Converts PCM16 audio data (Int16) to Float32 format required by Web Audio API.
 * Normalizes values from Int16 range [-32768, 32767] to Float32 range [-1.0, 1.0].
 *
 * @format Int16 (PCM16)
 * @channels 1 (mono)
 * @sampleRate 44100 Hz (Cartesia API default)
 */

/**
 * Conversion result with metadata
 */
export interface ConversionResult {
  /** Converted audio data in Float32 format */
  data: Float32Array;
  /** Number of samples converted */
  samples: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the input data is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Expected byte count for the sample count */
  expectedBytes?: number;
  /** Actual byte count */
  actualBytes?: number;
}

/**
 * Configuration for the converter
 */
export interface ConverterConfig {
  /** Target sample rate for duration calculation */
  sampleRate: number;
  /** Whether to validate input data */
  validate: boolean;
  /** Whether to clamp values to [-1, 1] range */
  clamp: boolean;
}

/**
 * Default configuration
 *
 * NOTE: sampleRate: 16000 matches Cartesia API request (cartesia-streaming-service.ts:437)
 */
const DEFAULT_CONFIG: ConverterConfig = {
  sampleRate: 16000,  // Match Cartesia API request
  validate: true,
  clamp: true,
};

/**
 * Int16 to Float32 Converter Class
 *
 * Provides high-performance conversion with validation and error handling.
 * Uses TypedArrays for optimal performance on mobile devices.
 */
export class Int16ToFloat32Converter {
  private config: ConverterConfig;
  private readonly INT16_MAX = 32767;
  private readonly INT16_MIN = -32768;
  private readonly NORMALIZATION_FACTOR = 32768;

  constructor(config?: Partial<ConverterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate input ArrayBuffer
   *
   * @param buffer - Input buffer to validate
   * @returns Validation result
   */
  validate(buffer: ArrayBuffer): ValidationResult {
    // Check for empty buffer
    if (buffer.byteLength === 0) {
      return {
        valid: false,
        error: 'Buffer is empty',
        actualBytes: 0,
      };
    }

    // Check for odd byte count (Int16 = 2 bytes per sample)
    if (buffer.byteLength % 2 !== 0) {
      return {
        valid: false,
        error: `Buffer has odd byte count: ${buffer.byteLength} (must be even for Int16)`,
        actualBytes: buffer.byteLength,
        expectedBytes: buffer.byteLength - 1,
      };
    }

    // Check minimum size (at least 1 sample)
    if (buffer.byteLength < 2) {
      return {
        valid: false,
        error: `Buffer too small: ${buffer.byteLength} bytes (minimum 2 bytes for 1 Int16 sample)`,
        actualBytes: buffer.byteLength,
      };
    }

    return { valid: true };
  }

  /**
   * Convert Int16 ArrayBuffer to Float32Array
   *
   * @param buffer - Input buffer containing Int16 PCM data
   * @returns Conversion result with Float32 data and metadata
   * @throws Error if validation fails
   */
  convert(buffer: ArrayBuffer): ConversionResult {
    // Validate input if configured
    if (this.config.validate) {
      const validation = this.validate(buffer);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // Create views on the buffer
    const int16View = new Int16Array(buffer);
    const float32View = new Float32Array(int16View.length);

    // DEBUG: Log input range (first 1000 samples)
    let minInt16 = 0, maxInt16 = 0;
    const sampleCount = Math.min(int16View.length, 1000);
    for (let i = 0; i < sampleCount; i++) {
      minInt16 = Math.min(minInt16, int16View[i]);
      maxInt16 = Math.max(maxInt16, int16View[i]);
    }

    // Convert each sample
    for (let i = 0; i < int16View.length; i++) {
      const int16Value = int16View[i];

      // Normalize to [-1, 1] range
      let floatValue = int16Value / this.NORMALIZATION_FACTOR;

      // Clamp to valid range if configured
      if (this.config.clamp) {
        floatValue = Math.max(-1, Math.min(1, floatValue));
      }

      float32View[i] = floatValue;
    }

    // DEBUG: Log output range (first 1000 samples)
    let minFloat = 0, maxFloat = 0;
    for (let i = 0; i < sampleCount; i++) {
      minFloat = Math.min(minFloat, float32View[i]);
      maxFloat = Math.max(maxFloat, float32View[i]);
    }

    // Calculate metadata
    const samples = float32View.length;
    const durationMs = (samples / this.config.sampleRate) * 1000;

    // DEBUG: Detailed conversion log
    console.log(`[Int16ToFloat32Converter] Convert: ${buffer.byteLength} bytes → ${float32View.length} samples @ ${this.config.sampleRate}Hz`);
    console.log(`[Int16ToFloat32Converter] Input range: [${minInt16}, ${maxInt16}] → Output: [${minFloat.toFixed(4)}, ${maxFloat.toFixed(4)}]`);
    console.log(`[Int16ToFloat32Converter] Expected: Int16 [-32768, 32767] → Float32 [-1.0, 1.0]`);

    return {
      data: float32View,
      samples,
      durationMs,
    };
  }

  /**
   * Convert multiple buffers and concatenate results
   *
   * @param buffers - Array of input buffers
   * @returns Combined conversion result
   */
  convertMultiple(buffers: ArrayBuffer[]): ConversionResult {
    if (buffers.length === 0) {
      return {
        data: new Float32Array(0),
        samples: 0,
        durationMs: 0,
      };
    }

    // Calculate total size
    let totalSamples = 0;
    for (const buffer of buffers) {
      if (this.config.validate) {
        const validation = this.validate(buffer);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
      }
      totalSamples += buffer.byteLength / 2; // Int16 = 2 bytes
    }

    // Create combined result
    const combinedData = new Float32Array(totalSamples);
    let offset = 0;

    for (const buffer of buffers) {
      const result = this.convert(buffer);
      combinedData.set(result.data, offset);
      offset += result.data.length;
    }

    return {
      data: combinedData,
      samples: totalSamples,
      durationMs: (totalSamples / this.config.sampleRate) * 1000,
    };
  }

  /**
   * Convert in-place (reuses existing Float32Array)
   *
   * More efficient for repeated conversions with same buffer size.
   *
   * @param source - Source Int16 buffer
   * @param target - Target Float32Array (must be same length)
   */
  convertInPlace(source: ArrayBuffer, target: Float32Array): void {
    const int16View = new Int16Array(source);

    if (int16View.length !== target.length) {
      throw new Error(
        `Buffer size mismatch: source has ${int16View.length} samples, target has ${target.length}`
      );
    }

    for (let i = 0; i < int16View.length; i++) {
      let floatValue = int16View[i] / this.NORMALIZATION_FACTOR;
      if (this.config.clamp) {
        floatValue = Math.max(-1, Math.min(1, floatValue));
      }
      target[i] = floatValue;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ConverterConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConverterConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Singleton instance with default configuration
 */
export const int16ToFloat32Converter = new Int16ToFloat32Converter();

/**
 * Convenience function for one-shot conversion
 *
 * @param buffer - Input Int16 buffer
 * @param sampleRate - Sample rate for duration calculation (default: 16000)
 * @returns Float32Array with normalized audio data
 */
export function convertInt16ToFloat32(
  buffer: ArrayBuffer,
  sampleRate: number = 16000
): Float32Array {
  const converter = new Int16ToFloat32Converter({ sampleRate });
  return converter.convert(buffer).data;
}

/**
 * Convert Float32 back to Int16 (for testing or export)
 *
 * @param float32Data - Float32 audio data
 * @returns Int16 ArrayBuffer
 */
export function convertFloat32ToInt16(float32Data: Float32Array): ArrayBuffer {
  const int16Buffer = new ArrayBuffer(float32Data.length * 2);
  const int16View = new Int16Array(int16Buffer);

  for (let i = 0; i < float32Data.length; i++) {
    // Clamp to [-1, 1] before conversion
    const clampedValue = Math.max(-1, Math.min(1, float32Data[i]));
    int16View[i] = Math.round(clampedValue * 32767);
  }

  return int16Buffer;
}
