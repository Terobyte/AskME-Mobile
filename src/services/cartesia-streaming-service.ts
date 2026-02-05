/**
 * Cartesia WebSocket Streaming Service
 * 
 * Manages WebSocket connection to Cartesia API for real-time audio streaming.
 * Provides AsyncGenerator interface for consuming audio chunks.
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Keep-alive ping/pong mechanism
 * - Multiple concurrent streams support
 * - Comprehensive error handling
 */

import { STREAMING_CONFIG } from '../config/streaming-config';
import {
    AudioChunk,
    CartesiaStreamingOptions,
    WordTimestamp,
    CartesiaMessage,
    CartesiaChunkMessage,
    CartesiaTimestampsMessage,
    CartesiaDoneMessage,
    CartesiaErrorMessage
} from '../types';
import { base64ToArrayBuffer } from '../utils/audio-conversion';

/**
 * WebSocket connection state
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Main WebSocket service class
 */
class CartesiaStreamingService {
    // WebSocket connection
    private ws: WebSocket | null = null;
    private connectionState: ConnectionState = 'disconnected';

    // Reconnection
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;

    // Keep-alive
    private pingInterval: NodeJS.Timeout | null = null;

    // Message routing
    private messageHandlers: Map<string, (message: any) => void> = new Map();

    // Active streams
    private activeContextIds: Set<string> = new Set();

    // NEW: Timestamps storage
    private timestampsStorage: Map<string, WordTimestamp[]> = new Map();

    // Configuration
    private readonly apiKey: string;
    private readonly wsUrl: string;
    private readonly maxRetries: number;
    private readonly reconnectBackoffMs: number;
    private readonly pingIntervalMs: number;

    constructor() {
        this.apiKey = process.env.EXPO_PUBLIC_CARTESIA_API_KEY || '';
        this.wsUrl = STREAMING_CONFIG.wsUrl;
        this.maxRetries = STREAMING_CONFIG.maxRetries;
        this.reconnectBackoffMs = STREAMING_CONFIG.reconnectBackoffMs;
        this.pingIntervalMs = STREAMING_CONFIG.pingIntervalMs;

        if (!this.apiKey) {
            console.error('❌ [Cartesia WS] API key not configured');
        }
    }

    // ========================
    // CONNECTION MANAGEMENT
    // ========================

    /**
     * Connect to WebSocket server
     */
    async connect(): Promise<void> {
        if (this.connectionState === 'connected') {
            console.log('ℹ️ [Cartesia WS] Already connected');
            return;
        }

        if (this.connectionState === 'connecting') {
            console.log('ℹ️ [Cartesia WS] Connection already in progress');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                console.log('🔌 [Cartesia WS] Connecting...');
                this.connectionState = 'connecting';

                const url = `${this.wsUrl}?api_key=${this.apiKey}&cartesia_version=2024-06-10`;
                this.ws = new WebSocket(url);

                // Connection opened
                this.ws.onopen = () => {
                    console.log('✅ [Cartesia WS] Connected');
                    this.connectionState = 'connected';
                    this.reconnectAttempts = 0;
                    this.startPingInterval();
                    resolve();
                };

                // Error occurred
                this.ws.onerror = (error: any) => {
                    console.error('❌ [Cartesia WS] Error:', error);
                    this.connectionState = 'error';

                    if (this.ws?.readyState !== WebSocket.OPEN) {
                        reject(new Error('WebSocket connection failed'));
                    }
                };

                // Connection closed
                this.ws.onclose = (event: any) => {
                    console.log(`🔌 [Cartesia WS] Closed: ${event.code} ${event.reason || ''}`);
                    this.connectionState = 'disconnected';
                    this.stopPingInterval();

                    // Auto-reconnect if unexpected close and we have active streams
                    if (event.code !== 1000 && this.activeContextIds.size > 0) {
                        this.handleReconnect();
                    }
                };

                // Message received
                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                // Connection timeout (10 seconds)
                setTimeout(() => {
                    if (this.connectionState !== 'connected') {
                        console.error('❌ [Cartesia WS] Connection timeout');
                        this.ws?.close();
                        this.connectionState = 'error';
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

            } catch (error) {
                console.error('❌ [Cartesia WS] Connect error:', error);
                this.connectionState = 'error';
                reject(error);
            }
        });
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        console.log('🔌 [Cartesia WS] Disconnecting...');

        // Clear reconnection timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Stop ping
        this.stopPingInterval();

        // Clear handlers
        this.messageHandlers.clear();
        this.activeContextIds.clear();

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
            console.error('❌ [Cartesia WS] Max reconnection attempts reached');
            this.connectionState = 'error';

            // Notify all active handlers about error
            const error = new Error('Connection lost and max reconnection attempts reached');
            this.messageHandlers.forEach(handler => {
                handler({
                    context_id: '',
                    type: 'error',
                    error: error.message
                });
            });

            return;
        }

        this.reconnectAttempts++;
        const backoff = this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`🔄 [Cartesia WS] Reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                console.error('❌ [Cartesia WS] Reconnection failed:', error);
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
                // Send ping (Cartesia may not require explicit ping, but helps detect dead connections)
                try {
                    this.ws?.send(JSON.stringify({ type: 'ping' }));
                } catch (error) {
                    console.error('❌ [Cartesia WS] Ping failed:', error);
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
     * Handle incoming WebSocket message
     */
    private handleMessage(data: string): void {
        try {
            const message: CartesiaMessage = JSON.parse(data);

            // Route to appropriate handler
            const handler = this.messageHandlers.get(message.context_id);
            if (handler) {
                handler(message);
            } else {
                console.warn(`⚠️ [Cartesia WS] No handler for context: ${message.context_id}`);
            }

        } catch (error) {
            console.error('❌ [Cartesia WS] Message parse error:', error);
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
     * const stream = service.generateAudioStream({ text: "Hello", voiceId: "..." });
     * for await (const chunk of stream) {
     *   console.log('Received chunk:', chunk);
     * }
     * ```
     */
    async* generateAudioStream(
        options: CartesiaStreamingOptions
    ): AsyncGenerator<AudioChunk, void, unknown> {
        // Ensure connected
        if (!this.isConnected()) {
            console.log('🔌 [Cartesia WS] Not connected, connecting...');
            await this.connect();
        }

        // Generate unique context ID
        const contextId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.activeContextIds.add(contextId);

        console.log(`🎙️ [Cartesia WS] Starting generation`);
        console.log(`🆔 [Cartesia WS] Context: ${contextId}`);
        console.log(`📝 [Cartesia WS] Text: "${options.text.substring(0, 50)}${options.text.length > 50 ? '...' : ''}"`);

        // Chunk queue
        const chunkQueue: AudioChunk[] = [];
        let isGenerating = true;
        let generationError: Error | null = null;
        let chunkSequence = 0;
        const generationStart = Date.now();

        // Message handler for this stream
        const handler = (message: CartesiaMessage) => {
            if (message.context_id !== contextId) return;

            // Handle chunk
            if (message.type === 'chunk') {
                const chunkMsg = message as CartesiaChunkMessage;
                try {
                    const arrayBuffer = base64ToArrayBuffer(chunkMsg.data);
                    const chunk: AudioChunk = {
                        data: arrayBuffer,
                        timestamp: Date.now(),
                        sequence: chunkSequence++,
                        sizeBytes: arrayBuffer.byteLength
                    };

                    chunkQueue.push(chunk);

                    // Call onChunk callback
                    if (options.onChunk) {
                        options.onChunk(chunk);
                    }

                    // Call onFirstChunk callback
                    if (chunk.sequence === 0 && options.onFirstChunk) {
                        const latency = Date.now() - generationStart;
                        options.onFirstChunk(latency);
                        console.log(`🎯 [Cartesia WS] First chunk in ${latency}ms`);
                    }
                } catch (error) {
                    console.error('❌ [Cartesia WS] Chunk decode error:', error);
                }
            }

            // NEW: Handle timestamps
            if (message.type === 'timestamps') {
                const timestampsMsg = message as CartesiaTimestampsMessage;
                console.log(`🕐 [Cartesia WS] Received timestamps for ${timestampsMsg.word_timestamps.words.length} words`);

                // Convert to WordTimestamp[]
                const wordTimestamps: WordTimestamp[] = timestampsMsg.word_timestamps.words.map((word, i) => ({
                    word,
                    start: timestampsMsg.word_timestamps.start[i],
                    end: timestampsMsg.word_timestamps.end[i]
                }));

                // Store timestamps
                this.timestampsStorage.set(contextId, wordTimestamps);

                console.log(`📝 [Cartesia WS] Sample timestamps:`, wordTimestamps.slice(0, 3));
                console.log(`📝 [Cartesia WS] Total duration: ${wordTimestamps[wordTimestamps.length - 1]?.end}s`);

                // PHASE 2: Call real-time callback immediately
                if (options.onTimestampsReceived) {
                    options.onTimestampsReceived(wordTimestamps);
                    console.log(`✅ [Cartesia WS] Timestamps delivered to player`);
                }
            }

            // Handle completion
            if (message.type === 'done') {
                console.log(`✅ [Cartesia WS] Generation complete (${chunkSequence} chunks)`);
                isGenerating = false;

                if (options.onComplete) {
                    options.onComplete();
                }
            }

            // Handle error
            if (message.type === 'error') {
                const errorMsg = message as CartesiaErrorMessage;
                console.error('❌ [Cartesia WS] Generation error:', errorMsg.error);
                generationError = new Error(errorMsg.error || 'Unknown generation error');
                isGenerating = false;

                if (options.onError) {
                    options.onError(generationError);
                }
            }
        };

        // Register handler
        this.messageHandlers.set(contextId, handler);

        // Send generation request WITH add_timestamps
        const request = {
            context_id: contextId,
            model_id: 'sonic-3',
            transcript: options.text,
            voice: {
                mode: 'id' as const,
                id: options.voiceId,
                ...(options.emotion && {
                    __experimental_controls: {
                        emotion: options.emotion
                    }
                })
            },
            output_format: {
                container: 'raw' as const,
                encoding: 'pcm_s16le' as const,
                sample_rate: 16000
            },
            add_timestamps: true, // ⭐ ENABLE WORD TIMESTAMPS FOR SENTENCE CHUNKING
            ...(options.speed && { speed: options.speed })
        };

        try {
            this.ws?.send(JSON.stringify(request));
            console.log('📤 [Cartesia WS] Request sent');
        } catch (error) {
            console.error('❌ [Cartesia WS] Send error:', error);
            throw new Error('Failed to send generation request');
        }

        // Yield chunks as they arrive
        try {
            while (isGenerating || chunkQueue.length > 0) {
                if (chunkQueue.length > 0) {
                    yield chunkQueue.shift()!;
                } else {
                    // Wait for next chunk (10ms polling)
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                // Check for errors
                if (generationError) {
                    throw generationError;
                }
            }
        } finally {
            // Cleanup
            this.messageHandlers.delete(contextId);
            this.activeContextIds.delete(contextId);

            console.log(`🧹 [Cartesia WS] Cleanup complete for ${contextId}`);
        }
    }

    /**
     * Cancel ongoing generation
     */
    cancelGeneration(contextId: string): void {
        if (!this.activeContextIds.has(contextId)) {
            console.log(`ℹ️ [Cartesia WS] No active generation for ${contextId}`);
            return;
        }

        console.log(`🛑 [Cartesia WS] Canceling generation: ${contextId}`);

        // Send cancel message (if Cartesia supports it)
        try {
            this.ws?.send(JSON.stringify({
                context_id: contextId,
                type: 'cancel'
            }));
        } catch (error) {
            console.error('❌ [Cartesia WS] Cancel send error:', error);
        }

        // Remove handlers
        this.messageHandlers.delete(contextId);
        this.activeContextIds.delete(contextId);
    }

    /**
     * Cancel all ongoing generations
     */
    cancelAll(): void {
        console.log(`🛑 [Cartesia WS] Canceling all generations (${this.activeContextIds.size})`);

        const contextIds = Array.from(this.activeContextIds);
        contextIds.forEach(id => this.cancelGeneration(id));
    }

    /**
     * Get number of active streams
     */
    getActiveStreamCount(): number {
        return this.activeContextIds.size;
    }

    // ========================
    // TIMESTAMPS (NEW)
    // ========================

    /**
     * Get word timestamps for a context ID
     */
    getTimestamps(contextId: string): WordTimestamp[] | null {
        return this.timestampsStorage.get(contextId) || null;
    }

    /**
     * Clear timestamps for a context ID
     */
    clearTimestamps(contextId: string): void {
        this.timestampsStorage.delete(contextId);
        console.log(`🧹 [Cartesia WS] Cleared timestamps for ${contextId}`);
    }
}

// Singleton instance
export const cartesiaStreamingService = new CartesiaStreamingService();

// Export class for testing
export { CartesiaStreamingService };
