/**
 * Minimal Cartesia Audio Adapter - Version 1
 *
 * Simplified adapter to get Victoria playing ASAP.
 * Flow:
 * 1. Get stream from cartesiaStreamingService
 * 2. Convert PCM16 -> Float32
 * 3. Play chunks as they arrive (no buffering)
 */

import { cartesiaStreamingService } from '../cartesia-streaming-service';
import { AudioContextManager } from '../../utils/audio/AudioContextManager';
import { Int16ToFloat32Converter } from '../../utils/audio/Int16ToFloat32Converter';

export type AdapterState = 'IDLE' | 'CONNECTING' | 'BUFFERING' | 'PLAYING' | 'DONE' | 'ERROR';

export interface AdapterOptions {
  voiceId?: string;
  emotion?: string[];
  speed?: 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest';
}

export interface AdapterMetrics {
  state: AdapterState;
  chunksReceived: number;
  chunksPlayed: number;
  totalDurationMs: number;
  latencyMs: number;
}

/**
 * Cartesia Audio Adapter Class
 *
 * Manages the flow from Cartesia WebSocket stream to audio playback.
 */
export class CartesiaAudioAdapter {
  private audioContext: AudioContextManager;
  private converter: Int16ToFloat32Converter;

  // State
  private state: AdapterState = 'IDLE';
  private stateListeners: Set<(state: AdapterState) => void> = new Set();
  private metricsListeners: Set<(metrics: AdapterMetrics) => void> = new Set();

  // Playback tracking
  private chunksReceived = 0;
  private chunksPlayed = 0;
  private totalDurationMs = 0;
  private startTime = 0;
  private abortController: AbortController | null = null;

  // Audio scheduling
  private scheduledTime: number = 0;
  private firstChunkScheduled = false;

  constructor() {
    this.audioContext = AudioContextManager.getInstance({
      sampleRate: 16000,
      initialGain: 1.0,
    });
    this.converter = new Int16ToFloat32Converter({ sampleRate: 16000 });
  }

  /**
   * Speak text with Victoria's voice
   */
  async speak(text: string, options?: AdapterOptions): Promise<void> {
    // Cleanup previous
    this.stop();

    // Setup abort
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Reset state
    this.chunksReceived = 0;
    this.chunksPlayed = 0;
    this.totalDurationMs = 0;
    this.startTime = Date.now();
    this.scheduledTime = 0;
    this.firstChunkScheduled = false;

    try {
      this.setState('CONNECTING');

      // Get stream from Cartesia
      const stream = cartesiaStreamingService.generateAudioStream({
        text,
        voiceId: options?.voiceId || process.env.EXPO_PUBLIC_CARTESIA_VOICE_ID,
        emotion: options?.emotion,
        speed: options?.speed,
        onFirstChunk: (latency) => {
          console.log(`[CartesiaAdapter] First chunk latency: ${latency}ms`);
        },
      });

      this.setState('BUFFERING');

      // Initialize audio context
      if (!this.audioContext.isReady()) {
        await this.audioContext.initialize();
      }

      // Accumulate audio data for smoother playback
      let accumulatedData: Float32Array[] = [];

      for await (const audioChunk of stream) {
        if (signal.aborted) break;

        this.chunksReceived++;

        // Convert PCM16 -> Float32
        const result = this.converter.convert(audioChunk.data);
        this.totalDurationMs += result.durationMs;

        // Accumulate chunks
        accumulatedData.push(result.data);
      }

      // Stream complete - play accumulated data
      if (accumulatedData.length > 0 && !signal.aborted) {
        this.setState('PLAYING');

        // Combine all chunks into one buffer
        const totalSamples = accumulatedData.reduce((sum, arr) => sum + arr.length, 0);
        const combinedData = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of accumulatedData) {
          combinedData.set(chunk, offset);
          offset += chunk.length;
        }

        // Create buffer and play
        const buffer = this.audioContext.createBuffer(combinedData);
        this.audioContext.scheduleBuffer(buffer);

        this.chunksPlayed = this.chunksReceived;

        // Estimate completion time and set DONE state
        const durationSec = totalSamples / 16000;
        setTimeout(() => {
          if (!signal.aborted) {
            this.setState('DONE');
          }
        }, durationSec * 1000 + 100); // Add 100ms buffer
      } else {
        this.setState('DONE');
      }

    } catch (error) {
      console.error('[CartesiaAdapter] Error:', error);
      this.setState('ERROR');
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  stop(): void {
    this.abortController?.abort();
    this.audioContext.stopAll();
    this.setState('IDLE');
  }

  /**
   * Set volume
   */
  setVolume(level: number): void {
    this.audioContext.setGain(Math.max(0, Math.min(1, level)));
  }

  /**
   * Get current metrics
   */
  getMetrics(): AdapterMetrics {
    return {
      state: this.state,
      chunksReceived: this.chunksReceived,
      chunksPlayed: this.chunksPlayed,
      totalDurationMs: this.totalDurationMs,
      latencyMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: (state: AdapterState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  /**
   * Subscribe to metrics updates
   */
  onMetrics(callback: (metrics: AdapterMetrics) => void): () => void {
    this.metricsListeners.add(callback);
    return () => this.metricsListeners.delete(callback);
  }

  private setState(state: AdapterState): void {
    this.state = state;
    this.stateListeners.forEach(cb => cb(state));
    this.emitMetrics();
  }

  private emitMetrics(): void {
    const metrics = this.getMetrics();
    this.metricsListeners.forEach(cb => cb(metrics));
  }
}

// Singleton
export const cartesiaAudioAdapter = new CartesiaAudioAdapter();
