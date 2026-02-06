/**
 * Test Audio Stream Page
 *
 * Test page for the new streaming audio player using react-native-audio-api.
 * Provides UI for testing WebSocket streaming, metrics visualization, and controls.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Types (will be replaced with actual imports)
interface PlayerMetrics {
  state: string;
  bufferDuration: number;
  thresholdDuration: number;
  bufferPercent: number;
  samplesQueued: number;
  playbackPosition: number;
  latency: number;
  droppedChunks: number;
  underrunCount: number;
  gain: number;
}

type PlayerState =
  | 'idle'
  | 'connecting'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'error';

// Log entry
interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
}

/**
 * Test Audio Stream Page Component
 */
export const TestAudioStreamPage: React.FC = () => {
  // Connection state
  const [wsUrl, setWsUrl] = useState('ws://localhost:8080/audio');
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<PlayerMetrics>({
    state: 'idle',
    bufferDuration: 0,
    thresholdDuration: 300,
    bufferPercent: 0,
    samplesQueued: 0,
    playbackPosition: 0,
    latency: 0,
    droppedChunks: 0,
    underrunCount: 0,
    gain: 1.0,
  });

  // Volume
  const [volume, setVolume] = useState(100);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);

  // Player reference (would be actual player instance)
  const playerRef = useRef<any>(null);
  const metricsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Add log entry
   */
  const addLog = useCallback((source: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, source, message }]);
  }, []);

  /**
   * Connect to WebSocket
   */
  const handleConnect = useCallback(async () => {
    addLog('UI', `Connecting to ${wsUrl}...`);
    setPlayerState('connecting');
    setError(null);

    try {
      // TODO: Initialize actual player
      // await player.connect(wsUrl);

      // Simulate connection for UI testing
      setTimeout(() => {
        setPlayerState('buffering');
        addLog('Player', 'Connected and buffering...');
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Connection failed';
      setError(errorMsg);
      setPlayerState('error');
      addLog('Error', errorMsg);
    }
  }, [wsUrl, addLog]);

  /**
   * Start streaming
   */
  const handleStart = useCallback(() => {
    addLog('UI', 'Starting playback...');
    // TODO: player.start();
    setPlayerState('playing');
    addLog('Player', 'Playback started');

    // Simulate metrics updates
    if (!metricsIntervalRef.current) {
      metricsIntervalRef.current = setInterval(() => {
        setMetrics((prev) => ({
          ...prev,
          bufferDuration: Math.min(prev.bufferDuration + 20, prev.thresholdDuration),
          bufferPercent: Math.min((prev.bufferDuration / prev.thresholdDuration) * 100, 100),
          samplesQueued: prev.samplesQueued + 320,
          latency: Date.now() - (Date.now() - 5000),
        }));
      }, 100);
    }
  }, [addLog]);

  /**
   * Stop streaming
   */
  const handleStop = useCallback(() => {
    addLog('UI', 'Stopping playback...');
    // TODO: player.stop();
    setPlayerState('stopped');
    addLog('Player', 'Stopped');

    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }

    setMetrics({
      state: 'stopped',
      bufferDuration: 0,
      thresholdDuration: 300,
      bufferPercent: 0,
      samplesQueued: 0,
      playbackPosition: 0,
      latency: 0,
      droppedChunks: 0,
      underrunCount: 0,
      gain: volume / 100,
    });
  }, [addLog, volume]);

  /**
   * Pause/Resume
   */
  const handlePauseResume = useCallback(() => {
    if (playerState === 'playing') {
      addLog('UI', 'Pausing...');
      // TODO: player.pause();
      setPlayerState('paused');
      addLog('Player', 'Paused');
    } else if (playerState === 'paused') {
      addLog('UI', 'Resuming...');
      // TODO: player.resume();
      setPlayerState('playing');
      addLog('Player', 'Resumed');
    }
  }, [playerState, addLog]);

  /**
   * Clear buffer
   */
  const handleClearBuffer = useCallback(() => {
    addLog('UI', 'Clearing buffer...');
    // TODO: player.clearBuffer();
    setMetrics((prev) => ({
      ...prev,
      bufferDuration: 0,
      bufferPercent: 0,
      samplesQueued: 0,
    }));
    addLog('Player', 'Buffer cleared');
  }, [addLog]);

  /**
   * Volume change
   */
  const handleVolumeChange = useCallback((delta: number) => {
    setVolume((prev) => {
      const newVolume = Math.max(0, Math.min(100, prev + delta));
      // TODO: player.setVolume(newVolume / 100);
      addLog('UI', `Volume: ${newVolume}%`);
      return newVolume;
    });
  }, [addLog]);

  /**
   * Auto-scroll logs
   */
  useEffect(() => {
    if (scrollViewRef.current && logs.length > 0) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [logs]);

  /**
   * Cleanup
   */
  useEffect(() => {
    return () => {
      if (metricsIntervalRef.current) {
        clearInterval(metricsIntervalRef.current);
      }
    };
  }, []);

  /**
   * Render state badge
   */
  const renderStateBadge = () => {
    const colors: Record<PlayerState, string> = {
      idle: '#9CA3AF',
      connecting: '#F59E0B',
      buffering: '#3B82F6',
      playing: '#10B981',
      paused: '#8B5CF6',
      stopped: '#6B7280',
      error: '#EF4444',
    };

    return (
      <View style={[styles.stateBadge, { backgroundColor: colors[playerState] }]}>
        <Text style={styles.stateText}>{playerState.toUpperCase()}</Text>
      </View>
    );
  };

  /**
   * Render buffer bar
   */
  const renderBufferBar = () => {
    const percent = Math.min(metrics.bufferPercent, 100);
    const barColor = percent >= 100 ? '#10B981' : percent >= 50 ? '#3B82F6' : '#F59E0B';

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
  const renderMetricCard = (title: string, value: string | number, unit?: string) => (
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

      {/* Connection Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <TextInput
          style={styles.input}
          value={wsUrl}
          onChangeText={setWsUrl}
          placeholder="WebSocket URL"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.button, styles.connectButton]}
          onPress={handleConnect}
          disabled={playerState === 'connecting' || playerState === 'playing'}>
          <Text style={styles.buttonText}>
            {playerState === 'connecting' ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Playback Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Playback Controls</Text>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStart}
            disabled={playerState !== 'buffering' && playerState !== 'paused'}>
            <Text style={styles.buttonText}>▶ Start</Text>
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

          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={handleClearBuffer}>
            <Text style={styles.buttonText}>Clear</Text>
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
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Metrics</Text>
        <View style={styles.metricsGrid}>
          {renderMetricCard('Samples Queued', metrics.samplesQueued.toLocaleString())}
          {renderMetricCard('Latency', metrics.latency.toFixed(0), 'ms')}
          {renderMetricCard('Dropped Chunks', metrics.droppedChunks)}
          {renderMetricCard('Underruns', metrics.underrunCount)}
        </View>
      </View>

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
          <TouchableOpacity onPress={() => setLogs([])}>
            <Text style={styles.clearLogsText}>Clear</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={scrollViewRef}
          style={styles.logsContainer}
          nestedScrollEnabled>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logEntry}>
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
  input: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    padding: 12,
    color: '#F9FAFB',
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  connectButton: {
    backgroundColor: '#3B82F6',
  },
  startButton: {
    backgroundColor: '#10B981',
  },
  pauseButton: {
    backgroundColor: '#8B5CF6',
  },
  stopButton: {
    backgroundColor: '#EF4444',
  },
  clearButton: {
    backgroundColor: '#6B7280',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    gap: 12,
  },
  metricCard: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 12,
    minWidth: 100,
    flex: 1,
    minHeight: 70,
  },
  metricTitle: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 4,
  },
  metricValue: {
    color: '#F9FAFB',
    fontSize: 18,
    fontWeight: '600',
  },
  metricUnit: {
    fontSize: 12,
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
    color: '#D1D5DB',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  logTimestamp: {
    color: '#6B7280',
  },
  logSource: {
    color: '#3B82F6',
  },
  noLogs: {
    color: '#6B7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
});

export default TestAudioStreamPage;
