/**
 * Test Audio Stream Page
 *
 * Test page for the new CartesiaStreamingPlayer using react-native-audio-api.
 * Provides UI for testing streaming audio, metrics visualization, and controls.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Constants } from 'expo-constants';

// Import the new Cartesia Streaming Player
import {
  CartesiaStreamingPlayer,
  PlayerState as CartesiaPlayerState,
  PlayerMetrics as CartesiaPlayerMetrics,
  getCartesiaStreamingPlayer,
} from '../services/audio/CartesiaStreamingPlayer';

// Import the new Deepgram Streaming Player
import {
  DeepgramStreamingPlayer,
  PlayerState as DeepgramPlayerState,
  PlayerMetrics as DeepgramPlayerMetrics,
  getDeepgramStreamingPlayer,
} from '../services/audio/DeepgramStreamingPlayer';

// Import the new OpenAI Streaming Player
import {
  OpenAIStreamingPlayer,
  PlayerState as OpenAIPlayerState,
  PlayerMetrics as OpenAIPlayerMetrics,
  getOpenAIStreamingPlayer,
} from '../services/audio/OpenAIStreamingPlayer';

// Import OpenAI types
import { OpenAIVoice } from '../types';

// Log entry
interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

// TTS Provider type
type TTSProvider = 'cartesia' | 'deepgram' | 'openai';

// Unified state type (both players have the same states)
type PlayerState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'stopped' | 'done' | 'error';

// Test texts
const TEST_TEXTS = {
  short: "Hello world, this is a test.",
  medium: `Hello world, it is me Victoria - I am here, and you can speak with me, isn't it magic? I'm your AI interviewer, ready to help you practice.`,
  long: `Hello world, it is me Victoria - I am here, and you can speak with me, isn't it magic? ` +
    `I'm your AI interviewer, ready to help you practice and improve your skills. ` +
    `We'll go through various technical questions, and I'll provide feedback on your answers. ` +
    `Don't worry about making mistakes - this is a safe space to learn and grow. ` +
    `Take your time, think through your responses, and remember that practice makes perfect. ` +
    `Are you ready to begin our interview session? Let's dive in and explore your knowledge together!`,
};

/**
 * Test Audio Stream Page Component
 */
export const TestAudioStreamPage: React.FC = () => {
  // Player instance - using union type since all players have similar interfaces
  const playerRef = useRef<CartesiaStreamingPlayer | DeepgramStreamingPlayer | OpenAIStreamingPlayer | null>(null);

  // State
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [metrics, setMetrics] = useState<CartesiaPlayerMetrics | DeepgramPlayerMetrics | OpenAIPlayerMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<keyof typeof TEST_TEXTS>('medium');
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>('cartesia');

  // OpenAI specific state
  const [openaiVoice, setOpenaiVoice] = useState<OpenAIVoice>('marin'); // Default = best quality
  const [openaiInstructions, setOpenaiInstructions] = useState<string>(''); // 🆕 Voice style instructions

  // 🆕 Instruction presets
  const instructionPresets = [
    { label: 'Default', value: '' },
    { label: 'Cheerful', value: 'Speak in a cheerful and positive tone.' },
    { label: 'Calm', value: 'Speak in a calm, soothing voice.' },
    { label: 'Whisper', value: 'Whisper softly.' },
    { label: 'Excited', value: 'Sound excited and energetic!' },
    { label: 'Professional', value: 'Speak in a professional, business-like tone.' },
    { label: 'Storyteller', value: 'Speak like a storyteller, with dramatic pauses.' },
  ];

  // Volume
  const [volume, setVolume] = useState(100);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);

  /**
   * Add log entry
   */
  const addLog = useCallback((source: string, message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-99), { timestamp, source, message, type }]);
  }, []);

  /**
   * Initialize player (re-create when provider changes)
   */
  useEffect(() => {
    // Stop previous player
    if (playerRef.current) {
      playerRef.current.stop();
    }

    // Create new player based on selected provider
    let player: CartesiaStreamingPlayer | DeepgramStreamingPlayer | OpenAIStreamingPlayer;

    if (ttsProvider === 'cartesia') {
      player = getCartesiaStreamingPlayer({
        sampleRate: 16000,
        preBufferThreshold: 500,
        maxBufferSize: 5,
        chunkSize: 2048,
      });
    } else if (ttsProvider === 'deepgram') {
      player = getDeepgramStreamingPlayer({
        sampleRate: 16000,
        preBufferThreshold: 500,
        maxBufferSize: 5,
        chunkSize: 2048,
      });
    } else {
      // OpenAI
      const openaiApiKey = (Constants?.expoConfig?.extra?.openaiApiKey as string)
        || process.env.EXPO_PUBLIC_OPENAI_API_KEY
        || 'your-key-here';
      player = getOpenAIStreamingPlayer(openaiApiKey, {
        sampleRate: 16000,
        preBufferThreshold: 500,
        maxBufferSize: 5,
        chunkSize: 2048,
      });
    }

    playerRef.current = player;

    // Reset state
    setPlayerState('idle');
    setMetrics(null);
    setError(null);

    const providerName = ttsProvider === 'cartesia' ? 'Cartesia'
      : ttsProvider === 'deepgram' ? 'Deepgram'
      : 'OpenAI';
    addLog('UI', `Switched to ${providerName} provider`, 'info');

    // Subscribe to events
    const unsubscribeEvents: Array<() => void> = [];

    const setupListener = (event: any, callback: (data: any) => void) => {
      player.on(event, callback);
      unsubscribeEvents.push(() => player.off(event, callback));
    };

    setupListener('connecting', (data) => {
      setPlayerState('connecting');
      addLog('Player', `Connecting to ${ttsProvider}...`, 'info');
    });

    setupListener('connected', (data) => {
      setPlayerState('buffering');
      addLog('Player', `Connected - buffering...`, 'success');
    });

    setupListener('playing', (data) => {
      setPlayerState('playing');
      addLog('Player', `Playback started!`, 'success');
    });

    setupListener('paused', (data) => {
      setPlayerState('paused');
      addLog('Player', `Paused`, 'info');
    });

    setupListener('stopped', (data) => {
      setPlayerState('stopped');
      addLog('Player', `Stopped`, 'warning');
    });

    setupListener('done', (data) => {
      setPlayerState('done');
      addLog('Player', `Playback complete!`, 'success');
    });

    setupListener('underrun', (data) => {
      addLog('Player', `Buffer underrun detected!`, 'warning');
    });

    setupListener('error', (data) => {
      setPlayerState('error');
      setError(data.error);
      addLog('Player', `Error: ${data.error}`, 'error');
    });

    setupListener('metrics', (data) => {
      setMetrics(data);
    });

    return () => {
      unsubscribeEvents.forEach(fn => fn());
    };
  }, [ttsProvider, addLog]);

  /**
   * Auto-scroll logs
   */
  useEffect(() => {
    if (scrollViewRef.current && logs.length > 0) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [logs]);

  /**
   * Start playback
   */
  const handleStart = useCallback(async () => {
    if (!playerRef.current) return;

    setError(null);
    addLog('UI', `Starting playback (${selectedText} text, ${ttsProvider} provider)...`, 'info');

    try {
      if (ttsProvider === 'cartesia') {
        await (playerRef.current as CartesiaStreamingPlayer).speak(TEST_TEXTS[selectedText], {
          emotion: ['positivity:high'],
          speed: 'normal',
        });
      } else if (ttsProvider === 'deepgram') {
        await (playerRef.current as DeepgramStreamingPlayer).speak(TEST_TEXTS[selectedText], {
          voiceId: 'aura-2-thalia-en',
        });
      } else {
        // OpenAI with instructions
        await (playerRef.current as OpenAIStreamingPlayer).speak(TEST_TEXTS[selectedText], {
          voiceId: openaiVoice,
          instructions: openaiInstructions || undefined,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Playback failed';
      setError(errorMsg);
      addLog('Error', errorMsg, 'error');
    }
  }, [selectedText, ttsProvider, openaiVoice, openaiInstructions, addLog]);

  /**
   * Stop playback
   */
  const handleStop = useCallback(() => {
    if (!playerRef.current) return;

    addLog('UI', 'Stopping playback...', 'info');
    playerRef.current.stop();
  }, [addLog]);

  /**
   * Pause/Resume toggle
   */
  const handlePauseResume = useCallback(() => {
    if (!playerRef.current) return;

    if (playerState === 'playing') {
      playerRef.current.pause();
    } else if (playerState === 'paused') {
      playerRef.current.resume();
    }
  }, [playerState]);

  /**
   * Volume change
   */
  const handleVolumeChange = useCallback((delta: number) => {
    setVolume((prev) => {
      const newVolume = Math.max(0, Math.min(100, prev + delta));
      playerRef.current?.setVolume(newVolume / 100);
      addLog('UI', `Volume: ${newVolume}%`, 'info');
      return newVolume;
    });
  }, [addLog]);

  /**
   * Clear logs
   */
  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  /**
   * Select test text
   */
  const handleSelectText = useCallback((length: keyof typeof TEST_TEXTS) => {
    setSelectedText(length);
    addLog('UI', `Selected ${length} test text`, 'info');
  }, [addLog]);

  /**
   * Render state badge
   */
  const renderStateBadge = () => {
    const colors: Record<PlayerState, string> = {
      'idle': '#9CA3AF',
      'connecting': '#F59E0B',
      'buffering': '#3B82F6',
      'playing': '#10B981',
      'paused': '#8B5CF6',
      'stopped': '#6B7280',
      'done': '#059669',
      'error': '#EF4444',
    };

    return (
      <View style={[styles.stateBadge, { backgroundColor: colors[playerState] }]}>
        {playerState === 'connecting' && <ActivityIndicator size="small" color="white" />}
        <Text style={styles.stateText}>{playerState.toUpperCase()}</Text>
      </View>
    );
  };

  /**
   * Render buffer bar
   */
  const renderBufferBar = () => {
    if (!metrics) return null;

    const percent = Math.min(metrics.bufferPercent, 100);
    const barColor = percent >= 100 ? '#10B981' : percent >= 50 ? '#3B82F6' : percent >= 20 ? '#F59E0B' : '#EF4444';

    return (
      <View style={styles.bufferBarContainer}>
        <View style={styles.bufferBarBackground}>
          <View style={[styles.bufferBarFill, { width: `${percent}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.bufferBarText}>
          {metrics.bufferDuration.toFixed(0)}ms / {metrics.thresholdDuration}ms ({percent.toFixed(0)}%)
        </Text>
      </View>
    );
  };

  /**
   * Render metric card
   */
  const renderMetricCard = (title: string, value: string | number, unit?: string, color?: string) => (
    <View style={styles.metricCard}>
      <Text style={styles.metricTitle}>{title}</Text>
      <Text style={styles.metricValue}>
        {value}
        {unit && <Text style={styles.metricUnit}> {unit}</Text>}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Audio Stream Test</Text>
        {renderStateBadge()}
      </View>

      {/* TTS Provider Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TTS Provider</Text>
        <View style={styles.providerSelector}>
          <TouchableOpacity
            style={[
              styles.providerButton,
              ttsProvider === 'cartesia' && styles.providerButtonActive,
              ttsProvider === 'cartesia' && { backgroundColor: '#10B981', borderColor: '#10B981' },
            ]}
            onPress={() => setTtsProvider('cartesia')}>
            <Text
              style={[
                styles.providerButtonText,
                ttsProvider === 'cartesia' && styles.providerButtonTextActive,
              ]}>
              Cartesia
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.providerButton,
              ttsProvider === 'deepgram' && styles.providerButtonActive,
              ttsProvider === 'deepgram' && { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
            ]}
            onPress={() => setTtsProvider('deepgram')}>
            <Text
              style={[
                styles.providerButtonText,
                ttsProvider === 'deepgram' && styles.providerButtonTextActive,
              ]}>
              Deepgram
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.providerButton,
              ttsProvider === 'openai' && styles.providerButtonActive,
              ttsProvider === 'openai' && { backgroundColor: '#10B981', borderColor: '#10B981' },
            ]}
            onPress={() => setTtsProvider('openai')}>
            <Text
              style={[
                styles.providerButtonText,
                ttsProvider === 'openai' && styles.providerButtonTextActive,
              ]}>
              OpenAI
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.textPreview}>
          {ttsProvider === 'cartesia'
            ? 'Cartesia Sonic API - WebSocket streaming with emotion support'
            : ttsProvider === 'deepgram'
            ? 'Deepgram Aura API - WebSocket streaming with natural voices'
            : 'OpenAI gpt-4o-mini-tts - HTTP streaming with 13 voices + instructions'}
        </Text>
      </View>

      {/* OpenAI Voice & Instructions Selection */}
      {ttsProvider === 'openai' && (
        <>
          {/* Voice Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Voice (marin/cedar = best ⭐)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
              {(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const).map((voice) => (
                <TouchableOpacity
                  key={voice}
                  style={[
                    styles.voiceButton,
                    openaiVoice === voice && styles.voiceButtonActive,
                    (voice === 'marin' || voice === 'cedar') && styles.voiceButtonPremium,
                  ]}
                  onPress={() => setOpenaiVoice(voice)}>
                  <Text
                    style={[
                      styles.voiceButtonText,
                      openaiVoice === voice && styles.voiceButtonTextActive,
                    ]}>
                    {voice}{voice === 'marin' || voice === 'cedar' ? '⭐' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Instructions Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Voice Style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
              {instructionPresets.map((preset) => (
                <TouchableOpacity
                  key={preset.label}
                  style={[
                    styles.voiceButton,
                    openaiInstructions === preset.value && styles.voiceButtonActive,
                  ]}
                  onPress={() => setOpenaiInstructions(preset.value)}>
                  <Text
                    style={[
                      styles.voiceButtonText,
                      openaiInstructions === preset.value && styles.voiceButtonTextActive,
                    ]}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Custom instructions input */}
            {openaiInstructions && !instructionPresets.find(p => p.value === openaiInstructions) && (
              <View style={styles.customInstructionsContainer}>
                <TextInput
                  style={styles.customInstructionsInput}
                  placeholder="Custom instructions (optional)"
                  placeholderTextColor="#6B7280"
                  value={openaiInstructions}
                  onChangeText={setOpenaiInstructions}
                  multiline
                />
              </View>
            )}
          </View>
        </>
      )}

      {/* Text Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Text</Text>
        <View style={styles.textSelector}>
          {(['short', 'medium', 'long'] as const).map((length) => (
            <TouchableOpacity
              key={length}
              style={[
                styles.textSelectorButton,
                selectedText === length && styles.textSelectorButtonActive,
              ]}
              onPress={() => handleSelectText(length)}>
              <Text
                style={[
                  styles.textSelectorButtonText,
                  selectedText === length && styles.textSelectorButtonTextActive,
                ]}>
                {length.charAt(0).toUpperCase() + length.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.textPreview} numberOfLines={2}>
          {TEST_TEXTS[selectedText]}
        </Text>
      </View>

      {/* Playback Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Controls</Text>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStart}
            disabled={playerState === 'playing' || playerState === 'connecting' || playerState === 'buffering'}>
            <Text style={styles.buttonText}>
              {playerState === 'connecting' ? 'Connecting...' :
               playerState === 'buffering' ? 'Buffering...' :
               '▶ Play'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.pauseButton]}
            onPress={handlePauseResume}
            disabled={playerState !== 'playing' && playerState !== 'paused'}>
            <Text style={styles.buttonText}>
              {playerState === 'paused' ? '▶ Resume' : '⏸ Pause'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={handleStop}
            disabled={playerState === 'idle' || playerState === 'stopped'}>
            <Text style={styles.buttonText}>⏹ Stop</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Volume Control */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Volume: {volume}%</Text>
        <View style={styles.volumeControls}>
          <TouchableOpacity style={styles.volumeButton} onPress={() => handleVolumeChange(-10)}>
            <Text style={styles.volumeButtonText}>-</Text>
          </TouchableOpacity>
          <View style={styles.volumeBar}>
            <View style={[styles.volumeFill, { width: `${volume}%` }]} />
          </View>
          <TouchableOpacity style={styles.volumeButton} onPress={() => handleVolumeChange(10)}>
            <Text style={styles.volumeButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Buffer Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Buffer Status</Text>
        {renderBufferBar()}
      </View>

      {/* Metrics */}
      {metrics && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Metrics</Text>
          <View style={styles.metricsGrid}>
            {renderMetricCard('First Chunk', metrics.firstChunkLatency, 'ms')}
            {renderMetricCard('First Sound', metrics.playbackLatency, 'ms')}
            {renderMetricCard('Buffer', `${metrics.samplesQueued}`, 'samples')}
            {renderMetricCard('Duration', `${metrics.bufferDuration.toFixed(0)}`, 'ms')}
            {renderMetricCard('Chunks/s', metrics.chunksPerSecond)}
            {renderMetricCard('Underruns', metrics.underrunCount)}
            {renderMetricCard('Dropped', metrics.droppedChunks)}
            {renderMetricCard('FIFO Size', metrics.fifoQueueSize)}
            {renderMetricCard('Streaming', metrics.isStreaming ? 'Yes' : 'No')}
          </View>
        </View>
      )}

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Logs */}
      <View style={styles.section}>
        <View style={styles.logsHeader}>
          <Text style={styles.sectionTitle}>Event Logs</Text>
          <TouchableOpacity onPress={handleClearLogs}>
            <Text style={styles.clearLogsText}>Clear ({logs.length})</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={scrollViewRef}
          style={styles.logsContainer}
          nestedScrollEnabled>
          {logs.map((log, index) => (
            <Text key={index} style={[styles.logEntry, { color: getLogColor(log.type) }]}>
              <Text style={styles.logTimestamp}>[{log.timestamp}]</Text>{' '}
              <Text style={styles.logSource}>[{log.source}]</Text>{' '}
              {log.message}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.noLogs}>No logs yet...</Text>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

/**
 * Get log color by type
 */
function getLogColor(type: LogEntry['type']): string {
  switch (type) {
    case 'success': return '#10B981';
    case 'warning': return '#F59E0B';
    case 'error': return '#EF4444';
    default: return '#D1D5DB';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F9FAFB',
  },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 12,
  },
  providerSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  providerButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  providerButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  providerButtonText: {
    color: '#9CA3AF',
    fontWeight: '500',
  },
  providerButtonTextActive: {
    color: '#FFFFFF',
  },
  textSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  textSelectorButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  textSelectorButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  textSelectorButtonText: {
    color: '#9CA3AF',
    fontWeight: '500',
  },
  textSelectorButtonTextActive: {
    color: '#FFFFFF',
  },
  textPreview: {
    color: '#9CA3AF',
    fontSize: 12,
    fontStyle: 'italic',
    backgroundColor: '#1F2937',
    padding: 12,
    borderRadius: 8,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  startButton: {
    backgroundColor: '#10B981',
    flex: 1,
  },
  pauseButton: {
    backgroundColor: '#8B5CF6',
    flex: 1,
  },
  stopButton: {
    backgroundColor: '#EF4444',
    flex: 1,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  volumeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volumeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeButtonText: {
    fontSize: 20,
    color: '#F9FAFB',
    fontWeight: '600',
  },
  volumeBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#374151',
    borderRadius: 4,
    overflow: 'hidden',
  },
  volumeFill: {
    height: '100%',
    backgroundColor: '#10B981',
  },
  bufferBarContainer: {
    gap: 8,
  },
  bufferBarBackground: {
    height: 24,
    backgroundColor: '#374151',
    borderRadius: 12,
    overflow: 'hidden',
  },
  bufferBarFill: {
    height: '100%',
  },
  bufferBarText: {
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 10,
    minWidth: 80,
    flex: 1,
    minHeight: 60,
  },
  metricTitle: {
    color: '#9CA3AF',
    fontSize: 11,
    marginBottom: 4,
  },
  metricValue: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  metricUnit: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '400',
  },
  errorContainer: {
    margin: 16,
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearLogsText: {
    color: '#3B82F6',
    fontSize: 14,
  },
  logsContainer: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 12,
    minHeight: 150,
    maxHeight: 250,
  },
  logEntry: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  logTimestamp: {
    color: '#6B7280',
  },
  logSource: {
    fontWeight: '600',
  },
  noLogs: {
    color: '#6B7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  // OpenAI voice & instructions styles
  voiceScroll: {
    flexDirection: 'row',
  },
  voiceButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 8,
  },
  voiceButtonActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  voiceButtonPremium: {
    borderColor: '#FBBF24', // Gold border for marin/cedar
    borderWidth: 2,
  },
  voiceButtonText: {
    color: '#9CA3AF',
    fontWeight: '500',
    fontSize: 12,
  },
  voiceButtonTextActive: {
    color: '#FFFFFF',
  },
  customInstructionsContainer: {
    marginTop: 12,
  },
  customInstructionsInput: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 12,
    color: '#F9FAFB',
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#374151',
    fontSize: 14,
  },
});

export default TestAudioStreamPage;
