/**
 * PoC Test Screen
 * Temporary screen for running Proof of Concept tests
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { quickTest } from '../poc/run-poc-tests';

export default function PocTestScreen() {
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const runTests = async () => {
        setIsRunning(true);
        setLogs(['🚀 Starting PoC tests...']);

        // Capture console logs
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        const capturedLogs: string[] = [];

        console.log = (...args) => {
            const msg = args.join(' ');
            capturedLogs.push(msg);
            setLogs(prev => [...prev, msg]);
            originalLog(...args);
        };

        console.error = (...args) => {
            const msg = '❌ ' + args.join(' ');
            capturedLogs.push(msg);
            setLogs(prev => [...prev, msg]);
            originalError(...args);
        };

        console.warn = (...args) => {
            const msg = '⚠️ ' + args.join(' ');
            capturedLogs.push(msg);
            setLogs(prev => [...prev, msg]);
            originalWarn(...args);
        };

        try {
            const results = await quickTest();

            // Show final result
            Alert.alert(
                `PoC Result: ${results.recommendation}`,
                results.rationale,
                [{ text: 'OK' }]
            );

        } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Unknown error');
        } finally {
            // Restore console
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;

            setIsRunning(false);
        }
    };

    const clearLogs = () => {
        setLogs([]);
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Streaming TTS - PoC</Text>
                <Text style={styles.subtitle}>Proof of Concept Tests</Text>
            </View>

            <View style={styles.controls}>
                <TouchableOpacity
                    style={[styles.button, isRunning && styles.buttonDisabled]}
                    onPress={runTests}
                    disabled={isRunning}
                >
                    <Text style={styles.buttonText}>
                        {isRunning ? '⏳ Running Tests...' : '▶️ Run PoC Tests'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.buttonSecondary]}
                    onPress={clearLogs}
                >
                    <Text style={styles.buttonText}>🗑️ Clear Logs</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.logContainer}>
                {logs.map((log, index) => (
                    <Text key={index} style={styles.logText}>
                        {log}
                    </Text>
                ))}
                {logs.length === 0 && (
                    <Text style={styles.emptyText}>
                        Press "Run PoC Tests" to start
                    </Text>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        padding: 20,
    },
    header: {
        marginBottom: 20,
        paddingTop: 40,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 5,
    },
    subtitle: {
        fontSize: 14,
        color: '#888',
    },
    controls: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
    },
    button: {
        flex: 1,
        backgroundColor: '#0066ff',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
    },
    buttonSecondary: {
        backgroundColor: '#333',
    },
    buttonDisabled: {
        backgroundColor: '#444',
        opacity: 0.5,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    logContainer: {
        flex: 1,
        backgroundColor: '#111',
        borderRadius: 8,
        padding: 10,
    },
    logText: {
        fontFamily: 'Courier',
        fontSize: 12,
        color: '#0f0',
        marginBottom: 2,
    },
    emptyText: {
        color: '#666',
        textAlign: 'center',
        marginTop: 20,
        fontStyle: 'italic',
    },
});
