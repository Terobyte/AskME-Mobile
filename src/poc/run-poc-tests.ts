/**
 * PoC Test Runner
 * 
 * Run all Proof of Concept tests and generate decision report
 */

import { runWebSocketTest } from './test-cartesia-websocket';
import { runFullConversionTest } from './test-wav-conversion';

interface PocResults {
    websocketTest: boolean;
    conversionTest: boolean;
    overallSuccess: boolean;
    recommendation: 'GO' | 'NO-GO';
    rationale: string;
}

/**
 * Run all PoC tests
 */
export async function runAllPocTests(): Promise<PocResults> {
    console.log("═══════════════════════════════════════");
    console.log("🧪 STREAMING TTS PROOF OF CONCEPT");
    console.log("═══════════════════════════════════════\n");

    const results: PocResults = {
        websocketTest: false,
        conversionTest: false,
        overallSuccess: false,
        recommendation: 'NO-GO',
        rationale: ''
    };

    try {
        // Test 1: WebSocket Streaming
        console.log("TEST 1: WebSocket Streaming");
        console.log("───────────────────────────────────────\n");
        results.websocketTest = await runWebSocketTest();

        if (!results.websocketTest) {
            results.rationale = "WebSocket streaming test failed. Connection too slow or chunks not streaming properly.";
            printResults(results);
            return results;
        }

        console.log("\n");

        // Test 2: WAV Conversion & Playback
        console.log("TEST 2: WAV Conversion & Playback");
        console.log("───────────────────────────────────────\n");
        results.conversionTest = await runFullConversionTest();

        if (!results.conversionTest) {
            results.rationale = "WAV conversion or playback failed. expo-av cannot play generated audio.";
            printResults(results);
            return results;
        }

        // All tests passed
        results.overallSuccess = true;
        results.recommendation = 'GO';
        results.rationale = "All tests passed. Streaming is technically feasible. Proceed to PHASE 1.";

    } catch (error) {
        console.error("\n❌ [PoC] Critical error:", error);
        results.rationale = `Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    printResults(results);
    return results;
}

/**
 * Print final results
 */
function printResults(results: PocResults): void {
    console.log("\n");
    console.log("═══════════════════════════════════════");
    console.log("📊 POC RESULTS");
    console.log("═══════════════════════════════════════\n");

    console.log("Test Results:");
    console.log(`  WebSocket Test:     ${results.websocketTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Conversion Test:    ${results.conversionTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Overall:            ${results.overallSuccess ? '✅ SUCCESS' : '❌ FAILURE'}\n`);

    console.log(`Decision: ${results.recommendation}`);
    console.log(`Rationale: ${results.rationale}\n`);

    if (results.recommendation === 'GO') {
        console.log("🎯 NEXT STEPS:");
        console.log("  1. Proceed to PHASE 1 (Infrastructure & Types)");
        console.log("  2. Expected improvement: ~2500ms → ~300ms (8x faster)");
        console.log("  3. Use Chunked Files strategy\n");
    } else {
        console.log("⚠️ ALTERNATIVES:");
        console.log("  1. Optimize REST API (caching, HTTP/2, pre-generation)");
        console.log("  2. Try different audio library (react-native-audio-toolkit)");
        console.log("  3. Consider different TTS provider with better SDK\n");
    }

    console.log("═══════════════════════════════════════\n");
}

/**
 * Export for manual testing
 */
export async function quickTest() {
    console.log("🚀 Running quick PoC test...\n");
    const results = await runAllPocTests();
    return results;
}
