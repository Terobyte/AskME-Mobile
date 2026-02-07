/**
 * PCM16 Resampler for audio format conversion
 *
 * Converts between different sample rates using linear interpolation.
 * Primary use: OpenAI TTS outputs 24kHz PCM16, our pipeline uses 16kHz.
 *
 * @example
 * // OpenAI 24kHz → 16kHz
 * const resampled = PCM16Resampler.openaiToPipeline(inputInt16Array);
 */

/**
 * Resampling result with metadata
 */
export interface ResampleResult {
  data: Int16Array;
  inputSamples: number;
  outputSamples: number;
  ratio: number;
}

/**
 * PCM16 Resampler using linear interpolation
 *
 * Linear interpolation provides good quality for speech audio
 * with minimal computational overhead.
 */
export class PCM16Resampler {
  /**
   * Resample PCM16 from source sample rate to target sample rate
   *
   * Uses linear interpolation to maintain audio quality while
   * changing the sample rate. Formula:
   *   output[i] = input[floor(i/ratio)] * (1-t) + input[ceil(i/ratio)] * t
   *   where t = (i/ratio) - floor(i/ratio)
   *
   * @param input - Input PCM16 data as Int16Array
   * @param fromSampleRate - Source sample rate (e.g., 24000 for OpenAI)
   * @param toSampleRate - Target sample rate (e.g., 16000 for pipeline)
   * @returns Resampled Int16Array
   */
  static resample(
    input: Int16Array,
    fromSampleRate: number,
    toSampleRate: number
  ): Int16Array {
    // Handle edge cases
    if (fromSampleRate === toSampleRate) {
      return input; // No resampling needed
    }

    if (input.length === 0) {
      return new Int16Array(0);
    }

    const ratio = toSampleRate / fromSampleRate;
    const outputLength = Math.floor(input.length * ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
      const t = srcIndex - srcIndexFloor; // Fractional part

      // Linear interpolation
      const sample0 = input[srcIndexFloor];
      const sample1 = input[srcIndexCeil];
      output[i] = Math.round(sample0 * (1 - t) + sample1 * t);
    }

    return output;
  }

  /**
   * Resample with detailed result metadata
   *
   * @param input - Input PCM16 data
   * @param fromSampleRate - Source sample rate
   * @param toSampleRate - Target sample rate
   * @returns ResampleResult with data and metadata
   */
  static resampleWithMetrics(
    input: Int16Array,
    fromSampleRate: number,
    toSampleRate: number
  ): ResampleResult {
    const data = PCM16Resampler.resample(input, fromSampleRate, toSampleRate);

    return {
      data,
      inputSamples: input.length,
      outputSamples: data.length,
      ratio: toSampleRate / fromSampleRate,
    };
  }

  /**
   * Convenience method for OpenAI 24kHz → 16kHz conversion
   *
   * OpenAI TTS API returns 24kHz PCM16 audio.
   * Our audio pipeline is optimized for 16kHz.
   *
   * @param input - 24kHz PCM16 data from OpenAI
   * @returns 16kHz PCM16 data for pipeline
   */
  static openaiToPipeline(input: Int16Array): Int16Array {
    const result = PCM16Resampler.resampleWithMetrics(input, 24000, 16000);

    console.log(
      `[PCM16Resampler] 24kHz → 16kHz: ${result.inputSamples} samples → ${result.outputSamples} samples ` +
      `(${((1 - result.ratio) * 100).toFixed(1)}% reduction)`
    );

    return result.data;
  }

  /**
   * Convert Uint8Array (PCM16 bytes) to Int16Array
   *
   * Useful when receiving PCM data from fetch streams.
   *
   * @param bytes - PCM16 data as Uint8Array (little-endian)
   * @returns PCM16 data as Int16Array
   */
  static uint8ToInt16(bytes: Uint8Array): Int16Array {
    return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  }

  /**
   * Convert Int16Array to Uint8Array (PCM16 bytes)
   *
   * Useful for sending PCM data to APIs expecting Uint8Array.
   *
   * @param samples - PCM16 data as Int16Array
   * @returns PCM16 data as Uint8Array (little-endian)
   */
  static int16ToUint8(samples: Int16Array): Uint8Array {
    return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  }

  /**
   * Resample OpenAI stream chunk directly
   *
   * Handles the full conversion from OpenAI stream chunk
   * (Uint8Array @ 24kHz) to pipeline-ready Int16Array @ 16kHz.
   *
   * @param chunk - Raw chunk from OpenAI API (Uint8Array)
   * @returns Resampled Int16Array @ 16kHz
   */
  static openaiChunkToPipeline(chunk: Uint8Array): Int16Array {
    const int16Data = PCM16Resampler.uint8ToInt16(chunk);
    return PCM16Resampler.openaiToPipeline(int16Data);
  }
}

/**
 * Calculate duration of PCM16 audio in milliseconds
 *
 * @param samples - Number of samples
 * @param sampleRate - Sample rate in Hz
 * @returns Duration in milliseconds
 */
export function calculatePCMDuration(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}

/**
 * Calculate number of samples for a given duration
 *
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @returns Number of samples
 */
export function calculateSamplesForDuration(durationMs: number, sampleRate: number): number {
  return Math.floor((durationMs / 1000) * sampleRate);
}
