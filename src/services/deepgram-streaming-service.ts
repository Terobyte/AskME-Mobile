/**
 * Deepgram WebSocket Streaming Service
 *
 * Manages WebSocket connection to Deepgram API for real-time audio streaming.
 * Uses Sec-WebSocket-Protocol header for authentication (supported by React Native).
 *
 * Reference: https://developers.deepgram.com/docs/tts-websocket-streaming
 * Reference: https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
 *
 * Features:
 * - Sec-WebSocket-Protocol authentication (token + API key)
 * - Real-time PCM16 audio streaming
 * - Multiple concurrent streams support
 * - Comprehensive error handling
 */

import {
    AudioChunk,
    DeepgramStreamingOptions,
    DeepgramVoice
} from '../types';
import { DEBUG_CONFIG, debugLog, debugError, debugWarn } from '../config/debug-config';

/**
 * WebSocket connection state
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Deepgram request message types
 * Reference: https://developers.deepgram.com/docs/streaming-text-to-speech
 */
interface DeepgramSpeakMessage {
    type: 'Speak';
    text: string;
}

interface DeepgramFlushMessage {
    type: 'Flush';
}

interface DeepgramCloseMessage {
    type: 'Close';
}

/**
 * Deepgram response message types
 */
interface DeepgramMetadataMessage {
    type: 'Metadata';
    [key: string]: any;
}

interface DeepgramFlushedMessage {
    type: 'Flushed';
    [key: string]: any;
}

interface DeepgramCloseResponseMessage {
    type: 'Close';
    [key: string]: any;
}

type DeepgramResponseMessage = DeepgramMetadataMessage | DeepgramFlushedMessage | DeepgramCloseResponseMessage;

/**
 * Main WebSocket service class for Deepgram TTS
 */
class DeepgramStreamingService {
    // WebSocket connection
    private ws: WebSocket | null = null;
    private connectionState: ConnectionState = 'disconnected';

    // Reconnection
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;

    // Keep-alive
    private pingInterval: NodeJS.Timeout | null = null;

    // Message routing - map of streamId to message handler
    private messageHandlers: Map<string, (data: ArrayBuffer) => void> = new Map();

    // Active streams
    private activeStreamIds: Set<string> = new Set();

    // Pending chunks queue for each stream
    private chunkQueues: Map<string, AudioChunk[]> = new Map();

    // Configuration
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly maxRetries: number;
    private readonly reconnectBackoffMs: number;
    private readonly pingIntervalMs: number;
    private currentVoiceId: DeepgramVoice | null = null;

    constructor() {
        this.apiKey = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY || '';
        this.baseUrl = 'wss://api.deepgram.com/v1/speak';
        this.maxRetries = 3;
        this.reconnectBackoffMs = 1000;
        this.pingIntervalMs = 30000;

        if (!this.apiKey) {
            debugError('❌ [Deepgram WS] API key not configured');
        }
    }

    // ========================
    // CONNECTION MANAGEMENT
    // ========================

    /**
     * Connect to WebSocket server
     * Uses Sec-WebSocket-Protocol for authentication: ['token', API_KEY]
     *
     * @param voiceId - Optional voice ID to include in the WebSocket URL
     */
    async connect(voiceId?: DeepgramVoice): Promise<void> {
        if (this.connectionState === 'connected') {
            debugLog('DEEPGRAM', 'ℹ️ [Deepgram WS] Already connected');
            return;
        }

        if (this.connectionState === 'connecting') {
            debugLog('DEEPGRAM', 'ℹ️ [Deepgram WS] Connection already in progress');
            return;
        }

        // Store voice ID for URL construction
        if (voiceId) {
            this.currentVoiceId = voiceId;
        }

        return new Promise((resolve, reject) => {
            try {
                debugLog('DEEPGRAM', '🔌 [Deepgram WS] Connecting...');
                this.connectionState = 'connecting';

                // Build WebSocket URL with model parameter
                const voice = this.currentVoiceId || 'aura-2-thalia-en';
                const wsUrl = `${this.baseUrl}?encoding=linear16&sample_rate=16000&model=${voice}`;

                // CRITICAL: Use Sec-WebSocket-Protocol for authentication
                // React Native supports this WebSocket subprotocol
                // Format: ['token', API_KEY]
                this.ws = new WebSocket(wsUrl, ['token', this.apiKey]);

                // Connection opened
                this.ws.onopen = () => {
                    debugLog('DEEPGRAM', '✅ [Deepgram WS] Connected');
                    this.connectionState = 'connected';
                    this.reconnectAttempts = 0;
                    this.startPingInterval();
                    resolve();
                };

                // Error occurred
                this.ws.onerror = (error: any) => {
                    debugError('❌ [Deepgram WS] Error:', error);
                    this.connectionState = 'error';

                    if (this.ws?.readyState !== WebSocket.OPEN) {
                        reject(new Error('WebSocket connection failed'));
                    }
                };

                // Connection closed
                this.ws.onclose = (event: any) => {
                    debugLog('DEEPGRAM', `🔌 [Deepgram WS] Closed: ${event.code} ${event.reason || ''}`);
                    this.connectionState = 'disconnected';
                    this.stopPingInterval();

                    // Auto-reconnect if unexpected close and we have active streams
                    if (event.code !== 1000 && this.activeStreamIds.size > 0) {
                        this.handleReconnect();
                    }
                };

                // Message received (string or binary)
                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                // Connection timeout (10 seconds)
                setTimeout(() => {
                    if (this.connectionState !== 'connected') {
                        debugError('❌ [Deepgram WS] Connection timeout');
                        this.ws?.close();
                        this.connectionState = 'error';
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

            } catch (error) {
                debugError('❌ [Deepgram WS] Connect error:', error);
                this.connectionState = 'error';
                reject(error);
            }
        });
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        debugLog('DEEPGRAM', '🔌 [Deepgram WS] Disconnecting...');

        // Clear reconnection timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Stop ping
        this.stopPingInterval();

        // Clear handlers
        this.messageHandlers.clear();
        this.chunkQueues.clear();
        this.activeStreamIds.clear();

        // Close WebSocket
        if (this.ws) {
            this.ws.close(1000, 'Normal closure');
            this.ws = null;
        }

        this.connectionState = 'disconnected';
        this.reconnectAttempts = 0;
    }

    /**
     * Handle reconnection with exponential backoff
     */
    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.maxRetries) {
            debugError('❌ [Deepgram WS] Max reconnection attempts reached');
            this.connectionState = 'error';

            // Notify all active handlers about error
            const error = new Error('Connection lost and max reconnection attempts reached');
            this.messageHandlers.forEach(handler => {
                // Convert error to ArrayBuffer for compatibility (though this is an error case)
                handler(new ArrayBuffer(0));
            });

            return;
        }

        this.reconnectAttempts++;
        const backoff = this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts - 1);

        debugLog('DEEPGRAM', `🔄 [Deepgram WS] Reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                debugError('❌ [Deepgram WS] Reconnection failed:', error);
                this.handleReconnect(); // Try again
            });
        }, backoff);
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Get current connection state
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    // ========================
    // KEEP-ALIVE (PING/PONG)
    // ========================

    /**
     * Start ping interval
     */
    private startPingInterval(): void {
        this.stopPingInterval();

        this.pingInterval = setInterval(() => {
            if (this.isConnected()) {
                // Deepgram doesn't require explicit pings, but this helps detect dead connections
                try {
                    this.ws?.send(JSON.stringify({ type: 'ping' }));
                } catch (error) {
                    debugError('❌ [Deepgram WS] Ping failed:', error);
                }
            }
        }, this.pingIntervalMs);
    }

    /**
     * Stop ping interval
     */
    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    // ========================
    // MESSAGE HANDLING
    // ========================

    /**
     * Handle incoming WebSocket message (can be string JSON or binary audio)
     * Deepgram sends mixed message types:
     * - string: JSON control messages (Metadata, Flushed, Close)
     * - ArrayBuffer: Binary PCM16 audio data
     *
     * Reference: https://developers.deepgram.com/docs/streaming-text-to-speech
     */
    private handleMessage(data: ArrayBuffer | string): void {
        if (typeof data === 'string') {
            this.handleControlMessage(data);
            return;
        }

        // Process binary audio data
        this.handleBinaryMessage(data);
    }

    /**
     * Handle JSON control messages from Deepgram
     */
    private handleControlMessage(data: string): void {
        try {
            const msg: DeepgramResponseMessage = JSON.parse(data);

            if (msg.type === 'Flushed') {
                // Audio generation complete - mark all active streams as complete
                for (const streamId of this.activeStreamIds) {
                    const queue = this.chunkQueues.get(streamId);
                    if (queue) {
                        // Mark completion with sentinel
                        queue.push({
                            data: new ArrayBuffer(0),
                            timestamp: Date.now(),
                            sequence: -1,
                            sizeBytes: 0
                        });
                    }
                }
                debugLog('DEEPGRAM', '✅ [Deepgram WS] Flushed - stream complete');
                return;
            }

            if (msg.type === 'Metadata') {
                debugLog('DEEPGRAM', `[Deepgram WS] Metadata: ${JSON.stringify(msg).substring(0, 150)}...`);
                return;
            }

            if (msg.type === 'Close') {
                debugLog('DEEPGRAM', '[Deepgram WS] Close received');
                return;
            }

            // Log any other control messages
            debugLog('DEEPGRAM', `[Deepgram WS] Control message: ${data.substring(0, 100)}`);
        } catch (e) {
            // Not JSON - log and skip
            debugLog('DEEPGRAM', `[Deepgram WS] Non-JSON string: ${data.substring(0, 100)}`);
        }
    }

    /**
     * Handle incoming binary WebSocket message (audio data)
     * Deepgram sends raw PCM16 audio data directly
     */
    private handleBinaryMessage(data: ArrayBuffer): void {
        try {
            // Deepgram doesn't use message routing like Cartesia
            // All incoming data is audio chunks for the current stream
            // We distribute to all active streams (typically only one)
            if (this.activeStreamIds.size === 0) {
                debugWarn('⚠️ [Deepgram WS] Received data but no active streams');
                return;
            }

            // Log chunk size for debugging
            debugLog('DEEPGRAM', `[Deepgram WS] Audio chunk: ${data.byteLength} bytes`);

            // Add chunk to all active stream queues (usually just one)
            for (const streamId of this.activeStreamIds) {
                const queue = this.chunkQueues.get(streamId);
                if (queue) {
                    const chunk: AudioChunk = {
                        data: data,
                        timestamp: Date.now(),
                        sequence: queue.length,
                        sizeBytes: data.byteLength
                    };
                    queue.push(chunk);
                }
            }

        } catch (error) {
            debugError('❌ [Deepgram WS] Message handling error:', error);
        }
    }

    // ========================
    // AUDIO GENERATION
    // ========================

    /**
     * Generate audio stream using AsyncGenerator
     *
     * Usage:
     * ```
     * const stream = service.generateAudioStream({ text: "Hello", voiceId: "aura-2-thalia-en" });
     * for await (const chunk of stream) {
     *   console.log('Received chunk:', chunk);
     * }
     * ```
     */
    async* generateAudioStream(
        options: DeepgramStreamingOptions
    ): AsyncGenerator<AudioChunk, void, unknown> {
        // Ensure connected (with voice ID in URL)
        if (!this.isConnected()) {
            debugLog('DEEPGRAM', '🔌 [Deepgram WS] Not connected, connecting...');
            await this.connect(options.voiceId);
        }

        // Generate unique stream ID
        const streamId = `deepgram-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.activeStreamIds.add(streamId);
        this.chunkQueues.set(streamId, []);

        debugLog('DEEPGRAM', `🎙️ [Deepgram WS] Starting generation`);
        debugLog('DEEPGRAM', `🆔 [Deepgram WS] Stream: ${streamId}`);
        debugLog('DEEPGRAM', `📝 [Deepgram WS] Text: "${options.text.substring(0, 50)}${options.text.length > 50 ? '...' : ''}"`);
        debugLog('DEEPGRAM', `🎤 [Deepgram WS] Voice: ${options.voiceId}`);

        const chunkQueue = this.chunkQueues.get(streamId)!;
        let isGenerating = true;
        let generationError: Error | null = null;
        const generationStart = Date.now();

        try {
            // CRITICAL: Deepgram requires a Speak message with text,
            // followed by a Flush message to trigger audio generation
            // Reference: https://developers.deepgram.com/docs/streaming-text-to-speech

            // Step 1: Send Speak message
            const speakMsg: DeepgramSpeakMessage = {
                type: 'Speak',
                text: options.text
            };
            this.ws?.send(JSON.stringify(speakMsg));
            debugLog('DEEPGRAM', '📤 [Deepgram WS] Speak message sent');

            // Step 2: Send Flush message to trigger audio generation
            const flushMsg: DeepgramFlushMessage = {
                type: 'Flush'
            };
            this.ws?.send(JSON.stringify(flushMsg));
            debugLog('DEEPGRAM', '📤 [Deepgram WS] Flush message sent');

            // Yield chunks as they arrive
            let chunkSequence = 0;
            let firstChunkReceived = false;

            while (isGenerating) {
                if (chunkQueue.length > 0) {
                    const chunk = chunkQueue.shift()!;

                    // Check for completion sentinel (sequence: -1 from done message)
                    if (chunk.sequence === -1) {
                        debugLog('DEEPGRAM', '✅ [Deepgram WS] Stream complete, ending generation');
                        isGenerating = false;
                        break;
                    }

                    chunk.sequence = chunkSequence++;

                    // Call onChunk callback
                    if (options.onChunk) {
                        options.onChunk(chunk);
                    }

                    // Call onFirstChunk callback
                    if (!firstChunkReceived) {
                        firstChunkReceived = true;
                        const latency = Date.now() - generationStart;
                        if (options.onFirstChunk) {
                            options.onFirstChunk(latency);
                        }
                        debugLog('DEEPGRAM', `🎯 [Deepgram WS] First chunk in ${latency}ms`);
                    }

                    yield chunk;
                } else {
                    // Wait for next chunk (10ms polling)
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                // Check for errors
                if (generationError) {
                    throw generationError;
                }
            }

            if (options.onComplete) {
                options.onComplete();
            }

        } catch (error) {
            debugError('❌ [Deepgram WS] Generation error:', error);
            generationError = error instanceof Error ? error : new Error('Unknown generation error');

            if (options.onError) {
                options.onError(generationError);
            }
        } finally {
            // Cleanup
            this.messageHandlers.delete(streamId);
            this.chunkQueues.delete(streamId);
            this.activeStreamIds.delete(streamId);

            debugLog('DEEPGRAM', `🧹 [Deepgram WS] Cleanup complete for ${streamId}`);
        }
    }

    /**
     * Cancel ongoing generation
     */
    cancelGeneration(streamId: string): void {
        if (!this.activeStreamIds.has(streamId)) {
            debugLog('DEEPGRAM', `ℹ️ [Deepgram WS] No active generation for ${streamId}`);
            return;
        }

        debugLog('DEEPGRAM', `🛑 [Deepgram WS] Canceling generation: ${streamId}`);

        // Remove handlers
        this.messageHandlers.delete(streamId);
        this.chunkQueues.delete(streamId);
        this.activeStreamIds.delete(streamId);
    }

    /**
     * Cancel all ongoing generations
     */
    cancelAll(): void {
        debugLog('DEEPGRAM', `🛑 [Deepgram WS] Canceling all generations (${this.activeStreamIds.size})`);

        const streamIds = Array.from(this.activeStreamIds);
        streamIds.forEach(id => this.cancelGeneration(id));
    }

    /**
     * Get number of active streams
     */
    getActiveStreamCount(): number {
        return this.activeStreamIds.size;
    }
}

// Singleton instance
export const deepgramStreamingService = new DeepgramStreamingService();

// Export class for testing
export { DeepgramStreamingService };
