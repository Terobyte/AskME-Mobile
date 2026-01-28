import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';

interface DebugOverlayProps {
    visible: boolean;
    onClose: () => void;
    anger: number;
    debugValue: string;
    isDebugTtsMuted: boolean;
    isSimulating: boolean;
    setAnger: (value: number) => void;
    setDebugValue: (value: string) => void;
    setIsDebugTtsMuted: (value: boolean) => void;
    onSimulate: () => Promise<void>;
    onForceFinish: () => Promise<void>;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
    visible,
    onClose,
    anger,
    debugValue,
    isDebugTtsMuted,
    isSimulating,
    setAnger,
    setDebugValue,
    setIsDebugTtsMuted,
    onSimulate,
    onForceFinish
}) => {
    if (!visible) return null;

    const options = ["0", "3", "5", "8", "10", "NONSENSE", "CLARIFICATION", "GIVE_UP", "SHOW_ANSWER", "I_AM_READY"];

    return (
        <View style={styles.debugOverlay}>
            <View style={styles.debugHeader}>
                <Text style={styles.debugTitle}>🛠️ DEBUG</Text>
                <TouchableOpacity onPress={onClose}>
                    <Ionicons name="close-circle" size={24} color="#FF3B30" />
                </TouchableOpacity>
            </View>

            {/* Metrics Control */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>Anger Level: {anger.toFixed(0)}%</Text>
                <Slider
                    style={{ width: '100%', height: 30 }}
                    minimumValue={0}
                    maximumValue={100}
                    step={5}
                    value={anger}
                    onValueChange={setAnger}
                    minimumTrackTintColor="#FF3B30"
                    thumbTintColor="#FF3B30"
                />
            </View>

            {/* Simulation Control */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>Simulate Response:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.debugScroll}>
                    {options.map(opt => (
                        <TouchableOpacity
                            key={opt}
                            style={[styles.debugChip, debugValue === opt && styles.debugChipActive]}
                            onPress={() => setDebugValue(opt)}
                        >
                            <Text style={[styles.debugChipText, debugValue === opt && styles.debugChipTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
                <View style={styles.debugRow}>
                    <TouchableOpacity style={styles.debugButton} onPress={onSimulate} disabled={isSimulating}>
                        <Text style={styles.debugButtonText}>{isSimulating ? "⏳..." : "⚡ SIMULATE"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.debugToggle, isDebugTtsMuted && styles.debugToggleActive]}
                        onPress={() => setIsDebugTtsMuted(!isDebugTtsMuted)}
                    >
                        <Text style={styles.debugToggleText}>{isDebugTtsMuted ? "🔇" : "🔊"}</Text>
                    </TouchableOpacity>
                </View>

                {/* Force Finish Button */}
                <TouchableOpacity
                    style={[styles.debugButton, { backgroundColor: '#FF3B30', marginTop: 15, marginRight: 0 }]}
                    onPress={onForceFinish}
                >
                    <Text style={styles.debugButtonText}>🛑 FORCE FINISH</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    debugOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#1C1C1E',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        zIndex: 9999,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 20,
    },
    debugHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    debugTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    debugSection: {
        marginBottom: 20,
    },
    debugLabel: {
        color: '#8E8E93',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 10,
        textTransform: 'uppercase',
    },
    debugRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 15,
    },
    debugScroll: {
        marginBottom: 8,
        height: 35,
    },
    debugChip: {
        backgroundColor: '#2C2C2E',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginRight: 8,
        borderWidth: 1,
        borderColor: '#3A3A3C',
    },
    debugChipActive: {
        backgroundColor: '#0A84FF',
        borderColor: '#0A84FF',
    },
    debugChipText: {
        color: '#8E8E93',
        fontSize: 12,
        fontWeight: '600',
    },
    debugChipTextActive: {
        color: '#FFF',
    },
    debugButton: {
        flex: 1,
        backgroundColor: '#30D158',
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        marginRight: 10,
    },
    debugButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
    debugToggle: {
        padding: 12,
        backgroundColor: '#3A3A3C',
        borderRadius: 10,
        width: 44,
        alignItems: 'center',
    },
    debugToggleActive: {
        backgroundColor: '#FF9F0A',
    },
    debugToggleText: {
        fontSize: 16,
    },
});