/**
 * Audio Debugger - Collects diagnostic data for troubleshooting
 *
 * Captures audio pipeline events for debugging "monster sound" issues.
 * Use this to identify sample rate mismatches, conversion errors, and buffer issues.
 */

/**
 * Debug event with timestamp
 */
export interface DebugEvent {
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Event category for filtering */
  category: string;
  /** Event data */
  data: any;
}

/**
 * Audio Debugger Class
 *
 * Singleton that collects diagnostic data throughout the audio pipeline.
 * Useful for identifying issues like sample rate mismatches and conversion errors.
 */
export class AudioDebugger {
  private events: DebugEvent[] = [];
  private maxEvents = 500;
  private startTime: number = Date.now();

  /**
   * Log a debug event
   *
   * @param category - Event category (e.g., 'conversion', 'buffer', 'scheduling')
   * @param data - Event data to log
   */
  log(category: string, data: any): void {
    const event: DebugEvent = {
      timestamp: Date.now() - this.startTime,
      category,
      data,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(`[AudioDebug:${category}]`, JSON.stringify(data));
  }

  /**
   * Export all events as JSON string
   *
   * @returns JSON string of all events
   */
  export(): string {
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Get all captured events
   *
   * @returns Array of debug events
   */
  getEvents(): DebugEvent[] {
    return [...this.events];
  }

  /**
   * Get events filtered by category
   *
   * @param category - Category to filter by
   * @returns Filtered events
   */
  getEventsByCategory(category: string): DebugEvent[] {
    return this.events.filter(e => e.category === category);
  }

  /**
   * Clear all events and reset timer
   */
  clear(): void {
    this.events = [];
    this.startTime = Date.now();
  }

  /**
   * Get summary statistics
   *
   * @returns Summary of captured events
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const event of this.events) {
      summary[event.category] = (summary[event.category] || 0) + 1;
    }
    return summary;
  }

  /**
   * Print a formatted report to console
   */
  printReport(): void {
    console.log('╔════════════════════════════════════════╗');
    console.log('║       AUDIO DEBUGGER REPORT            ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Total Events:     ${String(this.events.length).padEnd(20)} ║`);
    console.log(`║ Session Duration: ${String(((Date.now() - this.startTime) / 1000).toFixed(1) + 's').padEnd(20)} ║`);
    console.log('╠════════════════════════════════════════╣');

    const summary = this.getSummary();
    for (const [category, count] of Object.entries(summary)) {
      console.log(`║ ${category.padEnd(18)} ${String(count).padEnd(17)} ║`);
    }
    console.log('╚════════════════════════════════════════╝');
  }
}

/**
 * Singleton instance for convenient access
 */
export const audioDebugger = new AudioDebugger();

/**
 * Helper function to log audio conversion details
 *
 * @param inputBytes - Input buffer size in bytes
 * @param outputSamples - Output sample count
 * @param inputRange - [min, max] of input Int16 values
 * @param outputRange - [min, max] of output Float32 values
 * @param sampleRate - Sample rate in Hz
 */
export function logConversion(
  inputBytes: number,
  outputSamples: number,
  inputRange: [number, number],
  outputRange: [number, number],
  sampleRate: number
): void {
  audioDebugger.log('conversion', {
    inputBytes,
    outputSamples,
    inputRange,
    outputRange,
    sampleRate,
    durationMs: (outputSamples / sampleRate) * 1000,
    expectedOutputRange: [-1.0, 1.0],
    rangeMatch: outputRange[0] >= -1.0 && outputRange[1] <= 1.0,
  });
}

/**
 * Helper function to log buffer scheduling
 *
 * @param samples - Number of samples scheduled
 * @param latency - Scheduling latency in seconds
 * @param offset - Buffer offset
 * @param sampleRate - Sample rate in Hz
 */
export function logScheduling(
  samples: number,
  latency: number,
  offset: number,
  sampleRate: number
): void {
  audioDebugger.log('scheduling', {
    samples,
    latency,
    offset,
    sampleRate,
    durationMs: (samples / sampleRate) * 1000,
  });
}

/**
 * Helper function to log buffer health
 *
 * @param currentDuration - Current buffer duration in ms
 * @param threshold - Pre-buffer threshold in ms
 * @param availableSamples - Samples available
 * @param state - Buffer state
 */
export function logBufferHealth(
  currentDuration: number,
  threshold: number,
  availableSamples: number,
  state: string
): void {
  audioDebugger.log('buffer', {
    currentDuration,
    threshold,
    thresholdPercent: (currentDuration / threshold) * 100,
    availableSamples,
    state,
    isReady: currentDuration >= threshold,
  });
}

/**
 * Helper function to log sample rate information
 *
 * @param component - Component name (e.g., 'Player', 'Converter', 'AudioContext')
 * @param requested - Requested sample rate
 * @param actual - Actual sample rate (if different)
 */
export function logSampleRate(
  component: string,
  requested: number,
  actual?: number
): void {
  audioDebugger.log('sampleRate', {
    component,
    requested,
    actual: actual ?? requested,
    mismatch: actual !== undefined && actual !== requested,
  });
}
