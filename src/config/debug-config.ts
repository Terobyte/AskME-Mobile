/**
 * Debug configuration for controlling console logging verbosity.
 *
 * Set flags to true to enable verbose logging for specific subsystems.
 * Most production logs are disabled to keep terminal output clean.
 *
 * Critical logs (gap detection, crossfade tracking, errors) are kept enabled
 * for debugging audio artifacts.
 */
export const DEBUG_CONFIG = {
  /** Audio player queue management logs */
  AUDIO: false,

  /** Cartesia WebSocket connection logs */
  CARTESIA: false,

  /** Deepgram WebSocket connection logs */
  DEEPGRAM: true,

  /** Gap detection between chunks (CRITICAL for audio artifacts) */
  GAP_DETECT: true,

  /** Crossfade tracking (CRITICAL for smooth audio) */
  CROSSFADE: true,

  /** Smart crossfade decision logic */
  SMART_CROSSFADE: false,

  /** Sentence chunking logs */
  CHUNKING: false,

  /** Audio conversion utilities */
  AUDIO_CONVERSION: false,

  /** Always log errors */
  ERRORS: true,
} as const;

/**
 * Conditional logger that only logs when the given flag is enabled.
 */
export function debugLog(flag: keyof typeof DEBUG_CONFIG, ...args: unknown[]): void {
  if (DEBUG_CONFIG[flag]) {
    console.log(...args);
  }
}

/**
 * Always logs errors regardless of config.
 */
export function debugError(...args: unknown[]): void {
  if (DEBUG_CONFIG.ERRORS) {
    console.error(...args);
  }
}

/**
 * Logs warnings regardless of config (useful for critical issues).
 */
export function debugWarn(...args: unknown[]): void {
  if (DEBUG_CONFIG.ERRORS) {
    console.warn(...args);
  }
}
