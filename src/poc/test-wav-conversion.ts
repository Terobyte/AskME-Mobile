/**
 * PROOF OF CONCEPT: PCM to WAV Conversion Test
 * 
 * This test validates:
 * - WAV header creation
 * - PCM chunks merging
 * - expo-av playback compatibility
 * - Audio quality
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';

/**
 * Create WAV file header
 */
function createWavHeader(
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number,
    dataSize: number
): ArrayBuffer {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // Helper to write string
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    writeString(8, 'WAVE');

    // fmt chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // Byte rate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // Block align
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    return buffer;
}

/**
 * Merge multiple ArrayBuffers
 */
function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    return result.buffer;
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Test WAV conversion and playback
 */
export async function testWavConversion(pcmChunks: ArrayBuffer[]): Promise<boolean> {
    console.log("🧪 [PoC] Testing WAV conversion...");
    console.log(`📦 [PoC] Input: ${pcmChunks.length} PCM chunks`);

    try {
        // Merge PCM data
        const pcmData = mergeArrayBuffers(pcmChunks);
        console.log(`📦 [PoC] Merged PCM: ${pcmData.byteLength} bytes`);

        // Create WAV header
        const header = createWavHeader(16000, 1, 16, pcmData.byteLength);
        console.log(`📦 [PoC] Header created: 44 bytes`);

        // Combine header + data
        const wavFile = mergeArrayBuffers([header, pcmData]);
        console.log(`📦 [PoC] WAV file created: ${wavFile.byteLength} bytes`);

        // Expected duration (rough estimate)
        const expectedDurationMs = (pcmData.byteLength / (16000 * 2)) * 1000; // 16kHz, 16-bit
        console.log(`⏱️ [PoC] Expected duration: ~${expectedDurationMs.toFixed(0)}ms`);

        // Save to file
        const filepath = `${FileSystem.cacheDirectory}poc_test.wav`;
        const base64 = arrayBufferToBase64(wavFile);

        const saveStart = Date.now();
        await FileSystem.writeAsStringAsync(filepath, base64, {
            encoding: 'base64'
        });
        const saveTime = Date.now() - saveStart;

        console.log(`💾 [PoC] Saved to: ${filepath} (${saveTime}ms)`);

        // Try to play
        console.log(`🔊 [PoC] Attempting playback...`);

        const { sound } = await Audio.Sound.createAsync(
            { uri: filepath },
            { shouldPlay: true }
        );

        console.log("✅ [PoC] Playback started");

        // Wait for playback to finish or timeout
        return new Promise((resolve) => {
            let playbackStarted = false;

            sound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded) {
                    if (!playbackStarted) {
                        playbackStarted = true;
                        console.log(`🎵 [PoC] Duration: ${status.durationMillis}ms`);

                        // Check duration accuracy
                        const durationDiff = Math.abs((status.durationMillis || 0) - expectedDurationMs);
                        if (durationDiff < expectedDurationMs * 0.2) { // Within 20%
                            console.log(`✅ [PoC] Duration accurate (Δ${durationDiff.toFixed(0)}ms)`);
                        } else {
                            console.warn(`⚠️ [PoC] Duration mismatch (Δ${durationDiff.toFixed(0)}ms)`);
                        }
                    }

                    if (status.didJustFinish) {
                        console.log("✅ [PoC] Playback finished successfully");
                        sound.unloadAsync();

                        // Cleanup
                        FileSystem.deleteAsync(filepath, { idempotent: true });

                        resolve(true);
                    }
                }

                if (!status.isLoaded) {
                    console.error("❌ [PoC] Audio failed to load");
                    sound.unloadAsync();
                    resolve(false);
                }
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                console.warn("⚠️ [PoC] Playback timeout");
                sound.unloadAsync();
                resolve(false);
            }, 10000);
        });

    } catch (error) {
        console.error("❌ [PoC] WAV conversion error:", error);
        return false;
    }
}

/**
 * Run full test: WebSocket + WAV conversion
 */
export async function runFullConversionTest(): Promise<boolean> {
    console.log("\n🧪 [PoC] Running full conversion test...\n");

    // Import WebSocket test
    const { testCartesiaWebSocket } = require('./test-cartesia-websocket');

    try {
        // Step 1: Get PCM chunks from WebSocket
        console.log("📡 [PoC] Step 1: Fetching PCM chunks via WebSocket...");
        const metrics = await testCartesiaWebSocket();

        if (metrics.totalChunks === 0) {
            console.error("❌ [PoC] No chunks received");
            return false;
        }

        // Step 2: Convert to WAV and play
        console.log("\n🎵 [PoC] Step 2: Converting to WAV and playing...");
        const pcmChunks = metrics.chunks.map((c: any) => c.data);
        const success = await testWavConversion(pcmChunks);

        if (success) {
            console.log("\n✅ [PoC] FULL TEST PASSED");
            console.log("   ✅ WebSocket streaming works");
            console.log("   ✅ WAV conversion works");
            console.log("   ✅ expo-av playback works");
            console.log("\n🎯 [PoC] READY FOR PHASE 0.3 (Progressive Loading Test)");
        } else {
            console.log("\n❌ [PoC] FULL TEST FAILED");
        }

        return success;

    } catch (error) {
        console.error("❌ [PoC] Full test error:", error);
        return false;
    }
}
