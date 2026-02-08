/**
 * OpenAI TTS Service
 *
 * Обычная загрузка (не streaming) для React Native совместимости.
 * Скачивает весь PCM файл, затем разбивает на chunks для pipeline.
 *
 * OpenAI PCM format: 24kHz, 16-bit signed, little-endian
 *
 * Updated 2025-02: Supports gpt-4o-mini-tts with 13 voices and instructions
 */

import { AudioChunk } from '../types';

// ============ TYPES ============

export type OpenAIVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'fable'
  | 'nova'
  | 'onyx'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'marin'   // Recommended - best quality
  | 'cedar';  // Recommended - best quality

export type OpenAITTSModel = 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';

export interface OpenAIStreamConfig {
  apiKey: string;
  model?: OpenAITTSModel;
  voiceId: OpenAIVoice;
  speed?: number;
  instructions?: string; // Only for gpt-4o-mini-tts
}

export interface OpenAIStreamOptions extends OpenAIStreamConfig {
  text: string;
  onFirstChunk?: (latency: number) => void;
  onChunk?: (chunk: AudioChunk) => void;
}

// ============ SERVICE ============

export class OpenAIStreamingService {
  private abortController: AbortController | null = null;
  private isGenerating: boolean = false;

  /**
   * Generate audio from OpenAI TTS API
   *
   * Downloads full audio as arrayBuffer, then yields in chunks
   * for consistent pipeline integration.
   */
  async *generateAudioStream(
    options: OpenAIStreamOptions
  ): AsyncGenerator<AudioChunk> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.isGenerating = true;

    const {
      apiKey,
      text,
      voiceId,
      model = 'gpt-4o-mini-tts',
      speed = 1.0,
      instructions,
      onFirstChunk,
      onChunk,
    } = options;

    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║         OpenAI TTS Service              ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║ Model:              ${String(model).padEnd(24)} ║`);
    console.log(`║ Voice:              ${String(voiceId).padEnd(24)} ║`);
    console.log(`║ Speed:              ${String(speed.toFixed(2)).padEnd(24)} ║`);
    if (instructions) {
      console.log(`║ Instructions:      ${String(instructions.substring(0, 20) + '...').padEnd(24)} ║`);
    }
    console.log(`║ Text length:        ${String(text.length + ' chars').padEnd(24)} ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`[OpenAI TTS] Requesting: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

    // Build request body
    const requestBody: Record<string, unknown> = {
      model,
      input: text,
      voice: voiceId,
      response_format: 'pcm',
      speed,
    };

    // Add instructions only for gpt-4o-mini-tts
    if (instructions && model === 'gpt-4o-mini-tts') {
      requestBody.instructions = instructions;
    }

    try {
      // ===== FETCH =====
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      // ===== ERROR HANDLING =====
      if (!response.ok) {
        let errorMsg = `OpenAI API error: ${response.status}`;

        try {
          const errorText = await response.text();
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error?.message || errorMsg;

          // Specific errors
          if (response.status === 401) {
            errorMsg = 'Invalid OpenAI API key';
          } else if (response.status === 429) {
            errorMsg = 'Rate limit exceeded. Please wait and try again.';
          } else if (response.status === 400) {
            errorMsg = `Bad request: ${errorJson.error?.message || 'Unknown'}`;
          }
        } catch (e) {
          // JSON parse failed, use default message
        }

        throw new Error(errorMsg);
      }

      // ===== DOWNLOAD FULL AUDIO =====
      const arrayBuffer = await response.arrayBuffer();
      const downloadTime = Date.now() - startTime;

      console.log(`[OpenAI TTS] Downloaded ${arrayBuffer.byteLength} bytes in ${downloadTime}ms`);

      // First chunk callback (download complete = first data available)
      if (onFirstChunk) {
        onFirstChunk(downloadTime);
      }

      // ===== CONVERT TO INT16 =====
      const fullPcmData = new Int16Array(arrayBuffer);
      const durationSec = fullPcmData.length / 24000;

      console.log(`[OpenAI TTS] Total: ${fullPcmData.length} samples (${durationSec.toFixed(2)}s @ 24kHz)`);

      // ===== CHUNK AND YIELD =====
      // Chunk size: ~100ms of audio at 24kHz = 2400 samples
      const CHUNK_SIZE = 2400;
      let chunkIndex = 0;

      for (let offset = 0; offset < fullPcmData.length; offset += CHUNK_SIZE) {
        // Check abort
        if (this.abortController?.signal.aborted || !this.isGenerating) {
          console.log('[OpenAI TTS] Aborted during chunking');
          break;
        }

        // Extract chunk - direct buffer slice (no intermediate TypedArray)
        const end = Math.min(offset + CHUNK_SIZE, fullPcmData.length);
        const byteOffset = offset * 2;  // Int16 = 2 bytes per sample
        const byteLength = (end - offset) * 2;

        // ⚠️ CRITICAL FIX: Account for TypedArray's byteOffset
        // If fullPcmData is a view, we need to add its byteOffset to get the correct position
        const actualByteOffset = fullPcmData.byteOffset + byteOffset;
        const chunkBuffer = fullPcmData.buffer.slice(actualByteOffset, actualByteOffset + byteLength);

        // Validate chunk (log first 3 + any zero-byte chunks)
        if (chunkIndex < 3 || chunkBuffer.byteLength === 0) {
          const samples = chunkBuffer.byteLength / 2;
          console.log(
            `[OpenAI TTS] Chunk ${chunkIndex}: ${samples} samples (${chunkBuffer.byteLength} bytes) ` +
            `[offset ${offset}-${end}, byteOffset=${actualByteOffset}/${fullPcmData.buffer.byteLength}]`
          );

          // Debug info for first chunk
          if (chunkIndex === 0) {
            console.log(`[OpenAI TTS] fullPcmData.byteOffset: ${fullPcmData.byteOffset}`);
            console.log(`[OpenAI TTS] fullPcmData.buffer.byteLength: ${fullPcmData.buffer.byteLength}`);
            console.log(`[OpenAI TTS] Calculated byteOffset: ${byteOffset} + ${fullPcmData.byteOffset} = ${actualByteOffset}`);
          }

          if (chunkBuffer.byteLength === 0) {
            console.error(`[OpenAI TTS] ❌ ZERO-BYTE CHUNK at offset ${offset}!`);
            console.error(`[OpenAI TTS] Debug: byteOffset=${byteOffset}, byteLength=${byteLength}, actualByteOffset=${actualByteOffset}`);
          }
        }

        const chunk: AudioChunk = {
          data: chunkBuffer,
          timestamp: Date.now(),
          sequence: chunkIndex,
          sizeBytes: chunkBuffer.byteLength,
        };

        if (onChunk) {
          onChunk(chunk);
        }

        yield chunk;

        chunkIndex++;  // ✅ INCREMENT CHUNK INDEX

        // Small delay to prevent blocking UI and simulate streaming
        // This allows the pipeline to process chunks gradually
        if (chunkIndex % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      console.log(`[OpenAI TTS] Complete: yielded ${chunkIndex} chunks`);

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[OpenAI TTS] Request aborted');
        return;
      }

      console.error('[OpenAI TTS] Error:', error);
      throw error;
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Stop current generation
   */
  stop(): void {
    console.log('[OpenAI TTS] Stop called');

    this.isGenerating = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Check if currently generating
   */
  isActive(): boolean {
    return this.isGenerating;
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.stop();
  }
}

// ============ SINGLETON ============

let singletonInstance: OpenAIStreamingService | null = null;

export function getOpenAIStreamingService(): OpenAIStreamingService {
  if (!singletonInstance) {
    singletonInstance = new OpenAIStreamingService();
  }
  return singletonInstance;
}

export function resetOpenAIStreamingService(): void {
  if (singletonInstance) {
    singletonInstance.reset();
    singletonInstance = null;
  }
}
