import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EvaluationMetrics } from '../types';

interface MetricsHudProps {
    metrics: EvaluationMetrics | null;
}

export const MetricsHud: React.FC<MetricsHudProps> = ({ metrics }) => {
    if (!metrics) return null;

    const calculateOverall = (m: EvaluationMetrics) => {
        return ((m.accuracy + m.depth + m.structure) / 3).toFixed(1);
    };

    const getColor = (score: number) => {
        if (score >= 7) return '#10B981'; // Green
        if (score >= 5) return '#F59E0B'; // Yellow
        return '#EF4444'; // Red
    };

    const ScoreItem = ({ label, score }: { label: string, score: number }) => (
        <View style={styles.scoreItem}>
            <Text style={styles.scoreLabel}>{label}</Text>
            <Text style={[styles.scoreValue, { color: getColor(score) }]}>{score}</Text>
        </View>
    );

    return (
        <View style={styles.container}>
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
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'rgba(255,255,255,0.9)',
        marginHorizontal: 20,
        marginTop: 10,
        borderRadius: 16,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
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
        marginTop: 8,
        paddingTop: 8,
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
