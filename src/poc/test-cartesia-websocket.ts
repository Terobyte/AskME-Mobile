/**
 * PROOF OF CONCEPT: Cartesia WebSocket Streaming Test
 * 
 * This test validates:
 * - WebSocket connection speed
 * - First chunk latency
 * - Chunk streaming (not batch)
 * - Data decoding
 * 
 * Run this BEFORE implementing full streaming to verify technical feasibility.
 */

interface ChunkMetric {
    data: ArrayBuffer;  // ✅ ADDED: Store actual PCM data
    size: number;
    timestamp: number;
    sequence: number;
}

interface TestMetrics {
    connectionStart: number;
    connectionTime: number;
    firstChunkTime: number;
    totalChunks: number;
    chunks: ChunkMetric[];
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Main WebSocket test
 */
export async function testCartesiaWebSocket(): Promise<TestMetrics> {
    // ⚠️ HARDCODED for testing
    const API_KEY = "sk_car_8H5cHPGLMuZpaeXxqWNNve";
    const VOICE_ID = "e07c00bc-4134-4eae-9ea4-1a55fb45746b";
    const WS_URL = "wss://api.cartesia.ai/tts/websocket";

    console.log("🧪 [PoC] Starting WebSocket test...");
    console.log("🧪 [PoC] Target: First chunk < 300ms, Streaming mode (3+ chunks)");

    const metrics: TestMetrics = {
        connectionStart: Date.now(),
        connectionTime: 0,
        firstChunkTime: 0,
        totalChunks: 0,
        chunks: []
    };

    return new Promise((resolve, reject) => {
        console.log(`🔌 [PoC] Connecting to: ${WS_URL}`);
        console.log(`🔑 [PoC] API Key (first 15 chars): ${API_KEY.substring(0, 15)}...`);

        const fullUrl = `${WS_URL}?api_key=${API_KEY}&cartesia_version=2024-06-10`;
        console.log(`🔗 [PoC] Full URL length: ${fullUrl.length} chars`);

        const ws = new WebSocket(fullUrl);

        ws.onopen = () => {
            metrics.connectionTime = Date.now() - metrics.connectionStart;
            console.log(`✅ [PoC] Connected in ${metrics.connectionTime}ms`);

            // SUCCESS CRITERIA: Connection < 500ms
            if (metrics.connectionTime > 500) {
                console.warn(`⚠️ [PoC] SLOW CONNECTION: ${metrics.connectionTime}ms > 500ms`);
            }

            // Send generation request
            const request = {
                context_id: "poc-test-001",
                model_id: "sonic-3",
                transcript: "Hello world, this is a streaming test.",
                voice: {
                    mode: "id",
                    id: VOICE_ID
                },
                output_format: {
                    container: "raw",
                    encoding: "pcm_s16le",
                    sample_rate: 16000
                }
            };

            console.log("📤 [PoC] Sending request...");
            ws.send(JSON.stringify(request));
            console.log("📤 [PoC] Request sent successfully");
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'chunk') {
                    const chunkData = message.data; // base64 encoded PCM
                    const arrayBuffer = base64ToArrayBuffer(chunkData);

                    const chunk: ChunkMetric = {
                        data: arrayBuffer,  // ✅ STORE THE DATA
                        size: arrayBuffer.byteLength,
                        timestamp: Date.now(),
                        sequence: metrics.totalChunks
                    };

                    metrics.chunks.push(chunk);
                    metrics.totalChunks++;

                    if (metrics.totalChunks === 1) {
                        metrics.firstChunkTime = chunk.timestamp - metrics.connectionStart;
                        console.log(`🎯 [PoC] First chunk in ${metrics.firstChunkTime}ms`);

                        // SUCCESS CRITERIA: First chunk < 300ms
                        if (metrics.firstChunkTime < 300) {
                            console.log(`✅ [PoC] EXCELLENT latency: ${metrics.firstChunkTime}ms < 300ms`);
                        } else if (metrics.firstChunkTime < 1000) {
                            console.warn(`⚠️ [PoC] ACCEPTABLE latency: ${metrics.firstChunkTime}ms`);
                        } else {
                            console.error(`❌ [PoC] POOR latency: ${metrics.firstChunkTime}ms > 1000ms`);
                        }
                    }

                    // Calculate delta from previous chunk
                    const delta = metrics.totalChunks > 1
                        ? chunk.timestamp - metrics.chunks[metrics.totalChunks - 2].timestamp
                        : 0;

                    console.log(`📦 [PoC] Chunk #${chunk.sequence}: ${chunk.size} bytes at +${chunk.timestamp - metrics.connectionStart}ms (Δ${delta}ms)`);
                }

                if (message.type === 'done') {
                    console.log("✅ [PoC] Generation complete");

                    // Analyze results  
                    console.log("\n📊 [PoC] RESULTS:");
                    console.log(`   Connection time: ${metrics.connectionTime}ms`);
                    console.log(`   First chunk time: ${metrics.firstChunkTime}ms`);
                    console.log(`   Total chunks: ${metrics.totalChunks}`);
                    console.log(`   Total bytes: ${metrics.chunks.reduce((sum, c) => sum + c.size, 0)}`);

                    // Check streaming mode
                    if (metrics.totalChunks >= 3) {
                        const deltas = [];
                        for (let i = 1; i < metrics.chunks.length; i++) {
                            deltas.push(metrics.chunks[i].timestamp - metrics.chunks[i - 1].timestamp);
                        }
                        const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;

                        console.log(`   Avg chunk interval: ${avgDelta.toFixed(0)}ms`);

                        if (avgDelta < 100) {
                            console.log(`✅ [PoC] TRUE STREAMING: Chunks arriving continuously`);
                        } else {
                            console.warn(`⚠️ [PoC] BATCH MODE: Chunks arriving in bursts`);
                        }
                    } else {
                        console.error(`❌ [PoC] FAILURE: Only ${metrics.totalChunks} chunks (need 3+)`);
                    }

                    // Final verdict
                    const isSuccess =
                        metrics.connectionTime < 500 &&
                        metrics.firstChunkTime < 1000 &&
                        metrics.totalChunks >= 3;

                    if (isSuccess) {
                        console.log("\n✅ [PoC] TEST PASSED - Proceed to Phase 0.2");
                    } else {
                        console.log("\n❌ [PoC] TEST FAILED - Review metrics and retry");
                    }

                    ws.close();
                    resolve(metrics);
                }

            } catch (error) {
                console.error("❌ [PoC] Message parse error:", error);
            }
        };

        ws.onerror = (error: any) => {
            console.error("❌ [PoC] WebSocket ERROR event triggered");
            console.error("❌ [PoC] Error type:", typeof error);

            // Try to extract useful info
            if (error.message) {
                console.error("❌ [PoC] Error message:", error.message);
            }
            if (error.type) {
                console.error("❌ [PoC] Event type:", error.type);
            }
            if (error.target) {
                console.error("❌ [PoC] Target readyState:", error.target.readyState);
            }

            // Log all error properties
            try {
                const errorProps = Object.keys(error);
                console.error("❌ [PoC] Error properties:", errorProps);
                errorProps.forEach(prop => {
                    console.error(`❌ [PoC] ${prop}:`, (error as any)[prop]);
                });
            } catch (e) {
                console.error("❌ [PoC] Could not enumerate error properties");
            }

            // Create descriptive error
            const errorMsg = error.message || "WebSocket connection failed - check network and API key";
            reject(new Error(errorMsg));
        };

        ws.onclose = (event: any) => {
            console.log("🔌 [PoC] Connection closed");
            console.log("🔌 [PoC] Close code:", event.code);
            console.log("🔌 [PoC] Close reason:", event.reason || "(no reason provided)");
            console.log("🔌 [PoC] Was clean:", event.wasClean);

            // Common close codes:
            // 1000 = Normal closure
            // 1006 = Abnormal closure (no close frame)
            // 1008 = Policy violation (e.g., invalid API key)
            // 1011 = Server error

            if (event.code !== 1000) {
                console.warn(`⚠️ [PoC] Non-normal close code: ${event.code}`);
            }

            // If closed before onopen, it's a connection failure
            if (metrics.connectionTime === 0) {
                const reason = event.reason || `Connection failed with code ${event.code}`;
                reject(new Error(`Connection closed before opening. ${reason}`));
            }
        };

        // Timeout safety
        setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
                console.error("❌ [PoC] Timeout - closing connection");
                console.error("❌ [PoC] Current state:", ws.readyState);
                console.error("❌ [PoC] States: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3");
                ws.close();
                reject(new Error("Connection timeout after 10s"));
            }
        }, 10000);
    });
}

/**
 * Run test and return success/failure
 */
export async function runWebSocketTest(): Promise<boolean> {
    try {
        console.log("\n🧪 [PoC] === WebSocket Test Starting ===\n");
        const metrics = await testCartesiaWebSocket();

        // Evaluate success criteria
        const success =
            metrics.connectionTime < 500 &&
            metrics.firstChunkTime < 1000 &&
            metrics.totalChunks >= 3;

        return success;
    } catch (error: any) {
        console.error("\n❌ [PoC] === WebSocket Test FAILED ===");
        console.error("❌ [PoC] Error:", error);
        console.error("❌ [PoC] Error message:", error?.message || "Unknown error");
        console.error("❌ [PoC] Error stack:", error?.stack);
        return false;
    }
}
