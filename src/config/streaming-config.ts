/**
 * Streaming TTS Configuration
 *
 * Centralizes all environment variables and configuration for WebSocket streaming.
 * Based on PoC results and production requirements.
 */

export const STREAMING_CONFIG = {
    // Feature flag
    enabled: process.env.EXPO_PUBLIC_CARTESIA_STREAMING_ENABLED === 'true',

    // WebSocket connection
    wsUrl: process.env.EXPO_PUBLIC_CARTESIA_WS_URL || 'wss://api.cartesia.ai/tts/websocket',

    // Buffer configuration (from PoC)
    minBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_MIN_BUFFER_MS || '200'),
    targetBufferMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_STREAMING_TARGET_BUFFER_MS || '1000'),

    // Playback strategy (from PoC results)
    strategy: (process.env.EXPO_PUBLIC_CARTESIA_STREAMING_STRATEGY || 'chunked') as 'hybrid' | 'chunked',

    // Connection management
    pingIntervalMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_PING_INTERVAL_MS || '30000'),
    maxRetries: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_RECONNECT_MAX_RETRIES || '3'),
    reconnectBackoffMs: parseInt(process.env.EXPO_PUBLIC_CARTESIA_WS_RECONNECT_BACKOFF_MS || '1000'),

    // Audio format
    sampleRate: 16000,
    numChannels: 1,
    bitsPerSample: 16,
} as const;

/**
 * Deepgram Streaming Configuration
 */
export const DEEPGRAM_CONFIG = {
    // WebSocket URL (includes encoding and sample rate)
    wsUrl: 'wss://api.deepgram.com/v1/speak',
    defaultModel: 'aura-2-thalia-en',
    defaultEncoding: 'linear16' as const,
    defaultSampleRate: 16000,

    // Buffer configuration (same as Cartesia for consistency)
    preBufferThreshold: 500,  // 500ms pre-buffer (in milliseconds)
    maxBufferSize: 5,         // 5 seconds max buffer
    chunkSize: 2048,          // ~128ms at 16kHz

    // Connection management
    pingIntervalMs: 30000,
    maxRetries: 3,
    reconnectBackoffMs: 1000,
} as const;

/**
 * Validate configuration on load
 */
function validateConfig() {
    const { enabled, minBufferMs, targetBufferMs, strategy } = STREAMING_CONFIG;

    if (!enabled) {
        console.log('ℹ️ [Streaming Config] Streaming TTS is disabled');
        return;
    }

    // Check Cartesia API key
    if (!process.env.EXPO_PUBLIC_CARTESIA_API_KEY) {
        console.warn('⚠️ [Streaming Config] EXPO_PUBLIC_CARTESIA_API_KEY not set');
    }

    // Validate buffer sizes
    if (minBufferMs < 100 || minBufferMs > 2000) {
        console.warn(`⚠️ [Streaming Config] minBufferMs out of recommended range: ${minBufferMs}ms (recommended: 100-2000ms)`);
    }

    if (targetBufferMs < minBufferMs) {
        console.error(`❌ [Streaming Config] targetBufferMs (${targetBufferMs}ms) must be >= minBufferMs (${minBufferMs}ms)`);
    }

    if (targetBufferMs > 5000) {
        console.warn(`⚠️ [Streaming Config] targetBufferMs very high: ${targetBufferMs}ms (may increase latency)`);
    }

    // Validate strategy
    if (strategy !== 'chunked' && strategy !== 'hybrid') {
        console.error(`❌ [Streaming Config] Invalid strategy: ${strategy} (must be 'chunked' or 'hybrid')`);
    }

    // Check Deepgram API key
    if (!process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY) {
        console.warn('⚠️ [Streaming Config] EXPO_PUBLIC_DEEPGRAM_API_KEY not set');
    }

    console.log('✅ [Streaming Config] Configuration validated:', {
        enabled,
        strategy,
        minBufferMs,
        targetBufferMs,
        deepgramSupported: !!process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY,
    });
}

// Run validation on import
validateConfig();
