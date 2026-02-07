/**
 * OpenAI TTS Streaming Service
 *
 * Provides streaming text-to-speech using OpenAI's API.
 * Uses fetch API with streaming response for real-time audio generation.
 *
 * Audio format: PCM16 @ 24kHz (requires resampling to 16kHz for our pipeline)
 *
 * Updated 2025-02: Now supports gpt-4o-mini-tts with 13 voices and instructions
 *
 * @see https://platform.openai.com/docs/api-reference/audio/createSpeech
 */

import { AudioChunk, OpenAIVoice, OpenAITTSModel, OpenAIStreamConfig } from '../types';

/**
 * Stream options with callbacks
 */
export interface OpenAIStreamOptions extends OpenAIStreamConfig {
  text: string;
  onFirstChunk?: (latency: number) => void;
  onChunk?: (chunk: AudioChunk) => void;
}

/**
 * OpenAI Streaming Service Class
 *
 * Generates streaming audio using OpenAI's TTS API.
 */
export class OpenAIStreamingService {
  private abortController: AbortController | null = null;
  private isStreaming: boolean = false;
  private pendingBytes: Uint8Array = new Uint8Array(0); // 🆕 Byte alignment

  /**
   * Generate audio stream from OpenAI TTS API
   *
   * @param options - Stream options including text, voice, and callbacks
   * @returns AsyncGenerator of AudioChunk
   */
  async *generateAudioStream(
    options: OpenAIStreamOptions
  ): AsyncGenerator<AudioChunk> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.isStreaming = true;
    this.pendingBytes = new Uint8Array(0); // Reset

    const {
      apiKey,
      text,
      voiceId,
      model = 'gpt-4o-mini-tts', // ✅ Updated default
      speed = 1.0,
      instructions, // 🆕
      onFirstChunk,
      onChunk,
    } = options;

    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║      OpenAI Streaming Service           ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║ Model:              ${String(model).padEnd(24)} ║`);
    console.log(`║ Voice:              ${String(voiceId).padEnd(24)} ║`);
    console.log(`║ Speed:              ${String(speed.toFixed(2)).padEnd(24)} ║`);
    if (instructions) {
      console.log(`║ Instructions:      ${String(instructions.substring(0, 20) + '...').padEnd(24)} ║`);
    }
    console.log(`║ Text length:        ${String(text.length + ' chars').padEnd(24)} ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`[OpenAI Streaming] Requesting stream for "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

    try {
      const requestBody: Record<string, unknown> = {
        model,
        input: text,
        voice: voiceId,
        response_format: 'pcm',
        speed,
      };

      // 🆕 Add instructions only for gpt-4o-mini-tts
      if (instructions && model === 'gpt-4o-mini-tts') {
        requestBody.instructions = instructions;
      }

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from OpenAI API');
      }

      const reader = response.body.getReader();
      let chunkIndex = 0;
      let firstChunk = true;
      let totalBytes = 0;

      console.log('[OpenAI Streaming] Stream connected, reading chunks...');

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.isStreaming = false;
          console.log(`[OpenAI Streaming] Stream complete: ${chunkIndex} chunks, ${totalBytes} bytes total`);

          // 🆕 Handle remaining bytes
          if (this.pendingBytes.length >= 2) {
            const remaining = Math.floor(this.pendingBytes.length / 2) * 2;
            if (remaining > 0) {
              const pcmData = new Int16Array(
                this.pendingBytes.buffer,
                this.pendingBytes.byteOffset,
                remaining / 2
              );
              yield {
                data: { data: pcmData, format: 'pcm16', sampleRate: 24000 },
                index: chunkIndex++,
                timestamp: Date.now(),
              };
            }
          }
          break;
        }

        if (value) {
          // 🆕 Byte alignment handling - combine with pending bytes
          const combined = new Uint8Array(this.pendingBytes.length + value.length);
          combined.set(this.pendingBytes);
          combined.set(value, this.pendingBytes.length);

          // Only process complete PCM16 samples (2 bytes per sample)
          const completeBytes = Math.floor(combined.length / 2) * 2;
          this.pendingBytes = combined.slice(completeBytes);

          if (completeBytes > 0) {
            totalBytes += completeBytes;

            const pcmData = new Int16Array(
              combined.buffer,
              combined.byteOffset,
              completeBytes / 2
            );

            const chunk: AudioChunk = {
              data: {
                data: pcmData,
                format: 'pcm16',
                sampleRate: 24000,
              },
              index: chunkIndex++,
              timestamp: Date.now(),
            };

            if (firstChunk && onFirstChunk) {
              const latency = Date.now() - startTime;
              onFirstChunk(latency);
              console.log(`[OpenAI Streaming] First chunk received: ${latency}ms latency`);
              firstChunk = false;
            }

            if (onChunk) {
              onChunk(chunk);
            }

            yield chunk;
          }
        }
      }

    } catch (error) {
      this.isStreaming = false;

      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[OpenAI Streaming] Stream aborted');
        return;
      }

      console.error('[OpenAI Streaming] Error:', error);
      throw error;
    }
  }

  /**
   * Check if currently streaming
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Stop the current stream
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.isStreaming = false;
      this.pendingBytes = new Uint8Array(0); // Reset
      console.log('[OpenAI Streaming] Stopped');
    }
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.stop();
  }
}

/**
 * Singleton instance
 */
let singletonInstance: OpenAIStreamingService | null = null;

/**
 * Get the singleton OpenAI streaming service instance
 *
 * @returns OpenAIStreamingService instance
 */
export function getOpenAIStreamingService(): OpenAIStreamingService {
  if (!singletonInstance) {
    singletonInstance = new OpenAIStreamingService();
  }
  return singletonInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetOpenAIStreamingService(): void {
  if (singletonInstance) {
    singletonInstance.reset();
    singletonInstance = null;
  }
}
