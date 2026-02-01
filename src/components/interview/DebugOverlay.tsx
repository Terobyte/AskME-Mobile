import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { VibeConfig } from '../../types';

interface DebugOverlayProps {
    visible: boolean;
    onClose: () => void;
    anger: number;
    engagement: number;                // ← NEW
    currentVibe: VibeConfig | null;   // ← NEW
    debugValue: string;  // Now accepts QualityLevel | SpecialAction
    isDebugTtsMuted: boolean;
    isSimulating: boolean;
    setAnger: (value: number) => void;
    setEngagement: (value: number) => void;  // ← NEW
    setDebugValue: (value: string) => void;
    setIsDebugTtsMuted: (value: boolean) => void;
    onSimulate: () => Promise<void>;
    onForceFinish: () => Promise<void>;
}

// ============================================
// QUALITY LEVELS & SPECIAL ACTIONS
// ============================================
// 
// NEW DESIGN: Replaces old numeric system (0, 3, 5, 8, 10) with semantic levels
// that align with the new evaluation system in gemini-agent.ts
// 
// Quality Levels map to compositeScore ranges:
// - excellent: 9.0-10.0 → Green
// - good: 7.0-8.9 → Blue
// - mediocre: 5.0-6.9 → Orange
// - poor: 3.0-4.9 → Orange-Red
// - fail: 0.0-2.9 → Red
// 
// Special Actions are non-quality behaviors:
// - nonsense: Triggers anger
// - give_up: Polite skip
// - clarify: Request rephrasing
// - show_answer: Request explanation
// ============================================

// Quality levels with color coding
const qualityLevels = [
    { value: 'excellent', label: 'Excellent (9-10)', color: '#30D158' },
    { value: 'good', label: 'Good (7-8)', color: '#32ADE6' },
    { value: 'mediocre', label: 'Mediocre (5-6)', color: '#FF9F0A' },
    { value: 'poor', label: 'Poor (3-4)', color: '#FF6B35' },
    { value: 'fail', label: 'Fail (0-2)', color: '#FF3B30' }
];

// Special actions (non-answer behaviors)
const specialActions = [
    { value: 'nonsense', label: '💩 Nonsense', color: '#8E8E93' },
    { value: 'give_up', label: '🏳️ Give Up', color: '#8E8E93' },
    { value: 'clarify', label: '❓ Clarify', color: '#8E8E93' },
    { value: 'show_answer', label: '💡 Show Answer', color: '#8E8E93' }
];

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
    visible,
    onClose,
    anger,
    engagement,        // ← ADD
    currentVibe,       // ← ADD
    debugValue,
    isDebugTtsMuted,
    isSimulating,
    setAnger,
    setEngagement,     // ← ADD
    setDebugValue,
    setIsDebugTtsMuted,
    onSimulate,
    onForceFinish
}) => {
    if (!visible) return null;

    // Helper to determine if a value is a quality level
    const isQualityLevel = qualityLevels.some(l => l.value === debugValue);
    const isSpecialAction = specialActions.some(a => a.value === debugValue);

    // Get the color for the currently selected value
    const getSelectedColor = () => {
        const quality = qualityLevels.find(l => l.value === debugValue);
        if (quality) return quality.color;
        const action = specialActions.find(a => a.value === debugValue);
        if (action) return action.color;
        return '#0A84FF';
    };

    return (
        <View style={styles.debugOverlay}>
            <View style={styles.debugHeader}>
                <Text style={styles.debugTitle}>🛠️ DEBUG</Text>
                <TouchableOpacity onPress={onClose}>
                    <Ionicons name="close-circle" size={24} color="#FF3B30" />
                </TouchableOpacity>
            </View>

            {/* NEW: Current Vibe Display */}
            {currentVibe && (
                <View style={styles.vibeSection}>
                    <Text style={styles.vibeSectionTitle}>🎭 Current Vibe</Text>
                    <View style={styles.vibeCard}>
                        <View style={styles.vibeHeader}>
                            <Text style={styles.vibeLabel}>{currentVibe.label}</Text>
                            <Text style={styles.vibeEmotion}>{currentVibe.cartesiaEmotion}</Text>
                        </View>
                        <Text style={styles.vibeDescription}>{currentVibe.description}</Text>
                        <View style={styles.vibeStats}>
                            <View style={styles.vibeStatItem}>
                                <Text style={styles.vibeStatLabel}>Speed:</Text>
                                <Text style={styles.vibeStatValue}>{currentVibe.speed.toFixed(2)}x</Text>
                            </View>
                            {currentVibe.emotionLevel && currentVibe.emotionLevel.length > 0 && (
                                <View style={styles.vibeStatItem}>
                                    <Text style={styles.vibeStatLabel}>Emotions:</Text>
                                    <Text style={styles.vibeStatValue} numberOfLines={1}>
                                        {currentVibe.emotionLevel.join(', ')}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            )}

            {!currentVibe && (
                <View style={styles.vibeSection}>
                    <Text style={styles.vibeNoData}>No vibe data yet (answer a question first)</Text>
                </View>
            )}

            {/* NEW: Engagement Slider */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>⭐ Engagement: {engagement.toFixed(0)}%</Text>
                <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={0}
                    maximumValue={100}
                    step={5}
                    value={engagement}
                    onValueChange={setEngagement}
                    minimumTrackTintColor="#30D158"
                    maximumTrackTintColor="#3A3A3C"
                    thumbTintColor="#30D158"
                />
                <View style={styles.engagementMarkers}>
                    <Text style={styles.engagementMarker}>Disengaged</Text>
                    <Text style={styles.engagementMarker}>Neutral</Text>
                    <Text style={styles.engagementMarker}>Highly Engaged</Text>
                </View>
            </View>

            {/* Anger Level Control */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>🔥 Anger: {anger.toFixed(0)}%</Text>
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

            {/* Quality Level Selection */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>Quality Level:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.debugScroll}>
                    {qualityLevels.map(level => (
                        <TouchableOpacity
                            key={level.value}
                            style={[
                                styles.debugChip,
                                debugValue === level.value && {
                                    backgroundColor: level.color,
                                    borderColor: level.color
                                }
                            ]}
                            onPress={() => setDebugValue(level.value)}
                        >
                            <Text style={[
                                styles.debugChipText,
                                debugValue === level.value && styles.debugChipTextActive
                            ]}>
                                {level.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Special Actions Selection */}
            <View style={styles.debugSection}>
                <Text style={styles.debugLabel}>Special Actions:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.debugScroll}>
                    {specialActions.map(action => (
                        <TouchableOpacity
                            key={action.value}
                            style={[
                                styles.debugChip,
                                debugValue === action.value && {
                                    backgroundColor: action.color,
                                    borderColor: action.color
                                }
                            ]}
                            onPress={() => setDebugValue(action.value)}
                        >
                            <Text style={[
                                styles.debugChipText,
                                debugValue === action.value && styles.debugChipTextActive
                            ]}>
                                {action.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Simulate Row */}
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
    
    // NEW: Vibe section styles
    vibeSection: {
        marginBottom: 16,
        padding: 12,
        backgroundColor: 'rgba(100, 100, 255, 0.08)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(100, 100, 255, 0.25)',
    },
    vibeSectionTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 10,
        letterSpacing: 0.5,
    },
    vibeCard: {
        padding: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
        borderRadius: 8,
    },
    vibeHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    vibeLabel: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFD700',
        flex: 1,
    },
    vibeEmotion: {
        fontSize: 12,
        color: '#87CEEB',
        backgroundColor: 'rgba(135, 206, 235, 0.15)',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        overflow: 'hidden',
    },
    vibeDescription: {
        fontSize: 12,
        color: '#AAAAAA',
        fontStyle: 'italic',
        marginBottom: 10,
        lineHeight: 16,
    },
    vibeStats: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    vibeStatItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        padding: 6,
        borderRadius: 4,
    },
    vibeStatLabel: {
        fontSize: 10,
        color: '#888888',
        marginRight: 4,
        fontWeight: '600',
    },
    vibeStatValue: {
        fontSize: 11,
        color: '#FFFFFF',
        flex: 1,
    },
    vibeNoData: {
        fontSize: 12,
        color: '#666666',
        fontStyle: 'italic',
        textAlign: 'center',
        paddingVertical: 12,
    },
    
    // NEW: Engagement slider styles
    engagementMarkers: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginTop: 6,
    },
    engagementMarker: {
        fontSize: 10,
        color: '#666666',
        fontWeight: '500',
    },
});
