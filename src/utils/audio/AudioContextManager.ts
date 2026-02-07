/**
 * Audio Context Manager for react-native-audio-api
 *
 * Manages AudioContext, buffer sources, and gain nodes for streaming playback.
 * Provides a singleton interface for audio resource management.
 *
 * @depends react-native-audio-api
 */

import type {
  AudioContext,
  AudioBuffer,
  AudioBufferSourceNode,
  GainNode,
  AudioParam,
  AudioNode,
} from 'react-native-audio-api';

/**
 * Playback metrics
 */
export interface PlaybackMetrics {
  /** Current playback time in seconds */
  currentTime: number;
  /** Sample rate */
  sampleRate: number;
  /** Audio context state */
  state: string;
  /** Number of active sources */
  activeSources: number;
  /** Current gain value */
  gain: number;
}

/**
 * Audio context configuration
 */
export interface AudioContextConfig {
  /** Sample rate (null = use device default) */
  sampleRate: number | null;
  /** Initial gain value */
  initialGain: number;
  /** Latency hint (not supported in all implementations) */
  latencyHint: 'interactive' | 'balanced' | 'playback';
}

/**
 * Default configuration
 *
 * NOTE: sampleRate is forced to 16000Hz to match Cartesia API request.
 * This prevents sample rate mismatch that causes "monster voice" distortion.
 */
const DEFAULT_CONFIG: AudioContextConfig = {
  sampleRate: 16000,  // Force 16kHz to match Cartesia API
  initialGain: 1.0,
  latencyHint: 'interactive',
};

/**
 * Audio Context Manager Class
 *
 * Singleton pattern for managing audio resources.
 */
export class AudioContextManager {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private config: AudioContextConfig;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isInitialized: boolean = false;
  private isDestroyed: boolean = false;

  private static instance: AudioContextManager | null = null;

  private constructor(config?: Partial<AudioContextConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<AudioContextConfig>): AudioContextManager {
    if (!AudioContextManager.instance) {
      AudioContextManager.instance = new AudioContextManager(config);
    }
    return AudioContextManager.instance;
  }

  /**
   * Initialize audio context
   *
   * @param config - Optional configuration
   * @returns Promise that resolves when context is ready
   */
  async initialize(config?: Partial<AudioContextConfig>): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('AudioContextManager has been destroyed');
    }

    if (this.isInitialized && this.context) {
      // Resume if suspended
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return;
    }

    // Update config if provided
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Dynamically import react-native-audio-api
    try {
      const { AudioContext } = await import('react-native-audio-api');

      // Create context - explicitly pass sampleRate to override device default
      this.context = new AudioContext({
        sampleRate: this.config.sampleRate ?? 16000,
      });

      // DEBUG: Log what we actually got
      console.log(`[AudioContextManager] Initialized:`);
      console.log(`[AudioContextManager]   Requested sampleRate: ${this.config.sampleRate}`);
      console.log(`[AudioContextManager]   Actual sampleRate: ${this.context.sampleRate}Hz`);
      console.log(`[AudioContextManager]   State: ${this.context.state}`);
      console.log(`[AudioContextManager]   CurrentTime: ${this.context.currentTime}s`);

      // Create gain node
      this.gainNode = this.context.createGain();
      this.gainNode.gain.value = this.config.initialGain;

      // Connect gain to destination
      this.gainNode.connect(this.context.destination);

      // Resume if suspended
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize AudioContext: ${error}`);
    }
  }

  /**
   * Create an audio buffer
   *
   * @param data - Float32Array audio data
   * @param sampleRate - Sample rate (default: context sample rate)
   * @returns AudioBuffer
   */
  createBuffer(data: Float32Array, sampleRate?: number): AudioBuffer {
    if (!this.context) {
      throw new Error('AudioContext not initialized');
    }

    const sr = sampleRate ?? this.context.sampleRate;

    // DEBUG: Log buffer creation
    console.log(`[AudioContextManager] createBuffer: ${data.length} samples @ ${sr}Hz (${(data.length / sr * 1000).toFixed(1)}ms)`);

    const buffer = this.context.createBuffer(1, data.length, sr);
    const channelData = buffer.getChannelData(0);
    channelData.set(data);

    // DEBUG: Check first samples
    const samplesToLog = Math.min(5, data.length);
    const firstSamples = Array.from({ length: samplesToLog }, (_, i) => channelData[i].toFixed(4)).join(', ');
    console.log(`[AudioContextManager] First ${samplesToLog} samples: [${firstSamples}]`);

    return buffer;
  }

  /**
   * Create and configure a buffer source
   *
   * @param buffer - AudioBuffer to play
   * @returns Configured AudioBufferSourceNode
   */
  createBufferSource(buffer: AudioBuffer): AudioBufferSourceNode {
    if (!this.context) {
      throw new Error('AudioContext not initialized');
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;

    // Connect to gain node
    if (!this.gainNode) {
      throw new Error('GainNode not initialized');
    }
    source.connect(this.gainNode);

    // Track active source
    this.activeSources.add(source);

    // Auto-remove from tracking when ended
    source.onEnded = () => {
      this.activeSources.delete(source);
    };

    return source;
  }

  /**
   * Schedule buffer playback
   *
   * @param buffer - AudioBuffer to play
   * @param startTime - Start time (default: as soon as possible)
   * @param offset - Offset into buffer (default: 0)
   * @returns AudioBufferSourceNode
   */
  scheduleBuffer(
    buffer: AudioBuffer,
    startTime?: number,
    offset: number = 0
  ): AudioBufferSourceNode {
    const source = this.createBufferSource(buffer);

    // ✅ CHANGE: Use provided startTime or calculate
    const now = this.context?.currentTime ?? 0;
    const start = startTime ?? now;

    // ✨ NEW: Detailed debug log for scheduling
    const latency = start - now;
    console.log(
      `[AudioContextManager] scheduleBuffer: ` +
      `now=${now.toFixed(3)}s, ` +
      `start=${start.toFixed(3)}s, ` +
      `latency=${latency.toFixed(3)}s, ` +
      `offset=${offset}`
    );

    source.start(start, offset);

    return source;
  }

  /**
   * Schedule buffer with crossfade
   *
   * @param buffer - AudioBuffer to play
   * @param previousSource - Previous source to crossfade from
   * @param crossfadeDuration - Crossfade duration in seconds
   * @returns AudioBufferSourceNode
   */
  scheduleWithCrossfade(
    buffer: AudioBuffer,
    previousSource: AudioBufferSourceNode | null,
    crossfadeDuration: number = 0.05
  ): AudioBufferSourceNode {
    if (!this.gainNode) {
      throw new Error('GainNode not initialized');
    }

    const now = this.context?.currentTime ?? 0;
    const source = this.createBufferSource(buffer);

    if (previousSource && this.activeSources.has(previousSource)) {
      // Fade out previous
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + crossfadeDuration);

      // Stop previous after crossfade
      setTimeout(() => {
        try {
          previousSource.stop();
        } catch {
          // Already stopped
        }
      }, crossfadeDuration * 1000);

      // Fade in new after slight delay
      source.start(now + crossfadeDuration * 0.5);

      // Ramp gain back up
      this.gainNode.gain.setValueAtTime(0, now + crossfadeDuration);
      this.gainNode.gain.linearRampToValueAtTime(1, now + crossfadeDuration * 2);
    } else {
      // No crossfade, start immediately
      source.start(now);
    }

    return source;
  }

  /**
   * Set gain (volume)
   *
   * @param value - Gain value (0.0 to 1.0)
   * @param rampTime - Optional ramp time in seconds
   */
  setGain(value: number, rampTime?: number): void {
    if (!this.gainNode) {
      return;
    }

    const clampedValue = Math.max(0, Math.min(1, value));
    const now = this.context?.currentTime ?? 0;

    if (rampTime && rampTime > 0) {
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(clampedValue, now + rampTime);
    } else {
      this.gainNode.gain.value = clampedValue;
    }
  }

  /**
   * Get current gain value
   */
  getGain(): number {
    return this.gainNode?.gain.value ?? 1.0;
  }

  /**
   * Get current playback time
   */
  getPlaybackTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Get playback metrics
   */
  getMetrics(): PlaybackMetrics {
    return {
      currentTime: this.context?.currentTime ?? 0,
      sampleRate: this.context?.sampleRate ?? 16000,  // Default to Cartesia API rate
      state: this.context?.state ?? 'uninitialized',
      activeSources: this.activeSources.size,
      gain: this.gainNode?.gain.value ?? 1.0,
    };
  }

  /**
   * Stop all active sources
   */
  stopAll(): void {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    });
    this.activeSources.clear();
  }

  /**
   * Resume audio context if suspended
   */
  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  /**
   * Suspend audio context
   */
  async suspend(): Promise<void> {
    if (this.context?.state === 'running') {
      await this.context.suspend();
    }
  }

  /**
   * Check if context is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.context?.state === 'running';
  }

  /**
   * Dispose of audio resources
   */
  async dispose(): Promise<void> {
    this.stopAll();

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Already closed
      }
      this.context = null;
    }

    this.gainNode = null;
    this.isInitialized = false;
    this.isDestroyed = true;
  }

  /**
   * Reset the singleton instance
   */
  static resetInstance(): void {
    if (AudioContextManager.instance) {
      AudioContextManager.instance.dispose();
      AudioContextManager.instance = null;
    }
  }
}

/**
 * Create a new audio context manager
 *
 * @param config - Optional configuration
 * @returns New AudioContextManager instance
 */
export function createAudioContextManager(
  config?: Partial<AudioContextConfig>
): AudioContextManager {
  return AudioContextManager.getInstance(config);
}

/**
 * Get the singleton audio context manager
 */
export function getAudioContextManager(): AudioContextManager {
  return AudioContextManager.getInstance();
}
