/**
 * Audio Conversion Utilities for Streaming TTS
 * 
 * Handles PCM ↔ WAV conversion, base64 encoding, and audio data manipulation.
 * Based on PoC implementations with production-ready error handling.
 */

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Create WAV file header
 * 
 * @param sampleRate - Audio sample rate in Hz (e.g., 16000)
 * @param numChannels - Number of audio channels (1 = mono, 2 = stereo)
 * @param bitsPerSample - Bits per sample (8, 16, 24, 32)
 * @param dataSize - Size of PCM data in bytes
 * @returns WAV header as ArrayBuffer (44 bytes)
 */
export function createWavHeader(
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
 * Merge multiple ArrayBuffers into one
 * 
 * @param buffers - Array of ArrayBuffers to merge
 * @returns Single merged ArrayBuffer
 */
export function mergePCMChunks(buffers: ArrayBuffer[]): ArrayBuffer {
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
 * Create complete WAV file from PCM chunks
 * 
 * @param pcmChunks - Array of PCM data ArrayBuffers
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @param numChannels - Number of channels (default: 1 = mono)
 * @param bitsPerSample - Bits per sample (default: 16)
 * @returns Complete WAV file as ArrayBuffer
 */
export function createWavFile(
    pcmChunks: ArrayBuffer[],
    sampleRate: number = 16000,
    numChannels: number = 1,
    bitsPerSample: number = 16
): ArrayBuffer {
    const pcmData = mergePCMChunks(pcmChunks);
    const header = createWavHeader(sampleRate, numChannels, bitsPerSample, pcmData.byteLength);

    return mergePCMChunks([header, pcmData]);
}

/**
 * Calculate audio duration from PCM data size
 * 
 * @param dataSize - Size of PCM data in bytes
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @param numChannels - Number of channels (default: 1)
 * @param bitsPerSample - Bits per sample (default: 16)
 * @returns Duration in milliseconds
 */
export function calculateAudioDuration(
    dataSize: number,
    sampleRate: number = 16000,
    numChannels: number = 1,
    bitsPerSample: number = 16
): number {
    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = dataSize / (numChannels * bytesPerSample);
    const durationSeconds = totalSamples / sampleRate;
    return durationSeconds * 1000; // Return in milliseconds
}

/**
 * Update WAV header with correct data size
 * (For progressive file writing - if hybrid strategy is used)
 * 
 * @param wavBuffer - Existing WAV file buffer
 * @param newDataSize - New size of PCM data in bytes
 * @returns Updated WAV buffer
 */
export function updateWavHeaderSize(
    wavBuffer: ArrayBuffer,
    newDataSize: number
): ArrayBuffer {
    const view = new DataView(wavBuffer);

    // Update file size at offset 4
    view.setUint32(4, 36 + newDataSize, true);

    // Update data chunk size at offset 40
    view.setUint32(40, newDataSize, true);

    return wavBuffer;
}

/**
 * Validate WAV header
 * 
 * @param wavBuffer - WAV file buffer to validate
 * @returns True if valid WAV file
 */
export function isValidWavFile(wavBuffer: ArrayBuffer): boolean {
    if (wavBuffer.byteLength < 44) {
        return false;
    }

    const view = new DataView(wavBuffer);

    // Check RIFF header
    const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    );

    // Check WAVE format
    const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11)
    );

    return riff === 'RIFF' && wave === 'WAVE';
}

/**
 * Get WAV file info
 * 
 * @param wavBuffer - WAV file buffer
 * @returns Audio file information
 */
export function getWavFileInfo(wavBuffer: ArrayBuffer): {
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
    dataSize: number;
    duration: number;
} | null {
    if (!isValidWavFile(wavBuffer)) {
        return null;
    }

    const view = new DataView(wavBuffer);

    const numChannels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    const dataSize = view.getUint32(40, true);

    const duration = calculateAudioDuration(dataSize, sampleRate, numChannels, bitsPerSample);

    return {
        sampleRate,
        numChannels,
        bitsPerSample,
        dataSize,
        duration,
    };
}
