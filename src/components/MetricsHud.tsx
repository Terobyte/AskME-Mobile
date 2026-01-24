import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EvaluationMetrics } from '../types';

interface MetricsHudProps {
    metrics: EvaluationMetrics | null;
    success?: number;
    patience?: number;
    topicTitle?: string; // New Prop
    anger?: number;      // New Prop
}

export const MetricsHud: React.FC<MetricsHudProps> = ({ 
    metrics, 
    success = 0, 
    patience = 0,
    topicTitle = "Interview",
    anger = -10
}) => {
    // If no metrics and we are at the very start (intro), we might still want to show the Topic Title
    // But if everything is empty/null, return null.
    if (!metrics && success === 0 && patience === 0 && topicTitle === "Interview") return null;

    const calculateOverall = (m: EvaluationMetrics) => {
        return ((m.accuracy + m.depth + m.structure) / 3).toFixed(1);
    };

    const getColor = (score: number) => {
        if (score >= 7) return '#10B981'; // Green
        if (score >= 5) return '#F59E0B'; // Yellow
        return '#EF4444'; // Red
    };

    // Determine Anger Color
    const getAngerColor = (val: number) => {
        if (val < 0) return '#10B981';   // Green (Chill)
        if (val < 10) return '#F59E0B';  // Orange (Annoyed)
        return '#EF4444';                // Red (Angry)
    };

    const ProgressBar = ({ label, value, color }: { label: string, value: number, color: string }) => (
        <View style={styles.progressWrapper}>
             <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabel}>{label}</Text>
                <Text style={[styles.progressValueText, { color }]}>{Math.round(value)}%</Text>
            </View>
            <View style={styles.track}>
                <View style={[styles.bar, { width: `${value}%`, backgroundColor: color }]} />
            </View>
        </View>
    );

    const ScoreItem = ({ label, score }: { label: string, score: number }) => (
        <View style={styles.scoreItem}>
            <Text style={styles.scoreLabel}>{label}</Text>
            <Text style={[styles.scoreValue, { color: getColor(score) }]}>{score}</Text>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* Header: Topic Title & Anger */}
            <View style={styles.headerRow}>
                <Text style={styles.topicTitle} numberOfLines={1}>
                    {topicTitle}
                </Text>
                <Text style={[styles.angerText, { color: getAngerColor(anger) }]}>
                    {anger > 10 ? "🤬" : (anger > 0 ? "😠" : "😌")} Anger: {anger.toFixed(1)}
                </Text>
            </View>

            {/* RPG Stats Panel (Success & Patience) */}
            <View style={styles.statsPanel}>
                <ProgressBar label="SUCCESS" value={success} color="#10B981" />
                <View style={{ width: 15 }} />
                <ProgressBar label="PATIENCE" value={patience} color="#EF4444" />
            </View>

            {/* Detailed Metrics (Only if available) */}
            {metrics && (
                <>
                    <View style={styles.divider} />
                    
                    <View style={styles.row}>
                        <ScoreItem label="Accuracy" score={metrics.accuracy} />
                        <ScoreItem label="Depth" score={metrics.depth} />
                        <ScoreItem label="Structure" score={metrics.structure} />
                        
                        <View style={[styles.scoreItem, styles.overallItem]}>
                            <Text style={styles.overallLabel}>OVERALL</Text>
                            <Text style={[styles.overallValue, { color: getColor(parseFloat(calculateOverall(metrics))) }]}>
                                {calculateOverall(metrics)}
                            </Text>
                        </View>
                    </View>

                    {metrics.reasoning && (
                        <View style={styles.reasoningContainer}>
                            <Text style={styles.reasoningText} numberOfLines={2}>
                                💡 {metrics.reasoning}
                            </Text>
                        </View>
                    )}
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'rgba(255,255,255,0.95)',
        marginHorizontal: 20,
        marginTop: 10,
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    // Header Styles
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    topicTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1F2937',
        maxWidth: '65%',
    },
    angerText: {
        fontSize: 12,
        fontWeight: '700',
    },
    // RPG Stats Styles
    statsPanel: {
        flexDirection: 'row',
        marginBottom: 4, 
    },
    progressWrapper: {
        flex: 1,
    },
    progressLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 5,
    },
    progressLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6B7280',
        letterSpacing: 0.5,
    },
    progressValueText: {
        fontSize: 10,
        fontWeight: '800',
    },
    track: {
        height: 6,
        backgroundColor: '#F3F4F6',
        borderRadius: 3,
        overflow: 'hidden',
    },
    bar: {
        height: '100%',
        borderRadius: 3,
    },
    divider: {
        height: 1,
        backgroundColor: '#F3F4F6',
        marginVertical: 12,
    },
    // Detailed Metrics
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    scoreItem: {
        alignItems: 'center',
        flex: 1,
    },
    scoreLabel: {
        fontSize: 10,
        color: '#6B7280',
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    scoreValue: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    overallItem: {
        borderLeftWidth: 1,
        borderLeftColor: '#E5E7EB',
        paddingLeft: 10,
    },
    overallLabel: {
        fontSize: 10,
        color: '#374151',
        fontWeight: '800',
        marginBottom: 2,
    },
    overallValue: {
        fontSize: 22,
        fontWeight: '900',
    },
    reasoningContainer: {
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    reasoningText: {
        fontSize: 12,
        color: '#4B5563',
        fontStyle: 'italic',
        textAlign: 'center',
    }
});