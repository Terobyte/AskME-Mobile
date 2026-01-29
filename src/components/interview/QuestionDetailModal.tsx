/**
 * QuestionDetailModal - Full detail view for a single question
 * Shows full question text, metrics, and AI feedback
 */

import React from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Modal,
    Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuestionResult } from '../../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface QuestionDetailModalProps {
    visible: boolean;
    onClose: () => void;
    question: QuestionResult | null;
    isFavorite: boolean;
    onToggleFavorite: () => void;
}

// Traffic light color logic for metrics
const getMetricColor = (value: number): string => {
    if (value >= 8) return '#10B981'; // Green
    if (value >= 5) return '#F59E0B'; // Orange/Yellow
    return '#EF4444'; // Red
};

// Get background color (lighter version)
const getMetricBgColor = (value: number): string => {
    if (value >= 8) return 'rgba(16, 185, 129, 0.15)';
    if (value >= 5) return 'rgba(245, 158, 11, 0.15)';
    return 'rgba(239, 68, 68, 0.15)';
};

export const QuestionDetailModal: React.FC<QuestionDetailModalProps> = ({
    visible,
    onClose,
    question,
    isFavorite,
    onToggleFavorite,
}) => {
    if (!question) return null;

    const metrics = question.metrics || { accuracy: 0, depth: 0, structure: 0 };

    const handleFavoritePress = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggleFavorite();
    };

    return (
        <Modal visible={visible} transparent animationType="slide">
            <BlurView intensity={30} tint="dark" style={styles.blurContainer}>
                <View style={styles.modalContainer}>
                    {/* Close Button (Top Right) */}
                    <TouchableOpacity
                        style={styles.closeButton}
                        onPress={onClose}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="close-circle" size={32} color="#666" />
                    </TouchableOpacity>

                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Header Row: Question + Favorite */}
                        <View style={styles.headerRow}>
                            <Text style={styles.questionText}>{question.topic}</Text>
                            <TouchableOpacity
                                style={styles.favoriteButton}
                                onPress={handleFavoritePress}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <Ionicons
                                    name={isFavorite ? 'star' : 'star-outline'}
                                    size={28}
                                    color={isFavorite ? '#FFD700' : '#999'}
                                />
                            </TouchableOpacity>
                        </View>

                        {/* Score Badge */}
                        <View style={styles.scoreBadgeContainer}>
                            <View style={[
                                styles.scoreBadge,
                                { backgroundColor: getMetricBgColor(question.score) }
                            ]}>
                                <Text style={[
                                    styles.scoreBadgeText,
                                    { color: getMetricColor(question.score) }
                                ]}>
                                    Score: {question.score.toFixed(1)}/10
                                </Text>
                            </View>
                        </View>

                        {/* Metrics Block */}
                        <View style={styles.metricsSection}>
                            <Text style={styles.sectionLabel}>PERFORMANCE METRICS</Text>
                            <View style={styles.metricsRow}>
                                {/* Accuracy */}
                                <View style={[
                                    styles.metricPill,
                                    { backgroundColor: getMetricBgColor(metrics.accuracy) }
                                ]}>
                                    <Text style={styles.metricLabel}>Accuracy</Text>
                                    <Text style={[
                                        styles.metricValue,
                                        { color: getMetricColor(metrics.accuracy) }
                                    ]}>
                                        {metrics.accuracy}/10
                                    </Text>
                                </View>

                                {/* Depth */}
                                <View style={[
                                    styles.metricPill,
                                    { backgroundColor: getMetricBgColor(metrics.depth) }
                                ]}>
                                    <Text style={styles.metricLabel}>Depth</Text>
                                    <Text style={[
                                        styles.metricValue,
                                        { color: getMetricColor(metrics.depth) }
                                    ]}>
                                        {metrics.depth}/10
                                    </Text>
                                </View>

                                {/* Structure */}
                                <View style={[
                                    styles.metricPill,
                                    { backgroundColor: getMetricBgColor(metrics.structure) }
                                ]}>
                                    <Text style={styles.metricLabel}>Structure</Text>
                                    <Text style={[
                                        styles.metricValue,
                                        { color: getMetricColor(metrics.structure) }
                                    ]}>
                                        {metrics.structure}/10
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Feedback Section */}
                        <View style={styles.feedbackSection}>
                            <Text style={styles.sectionLabel}>AI FEEDBACK</Text>
                            <Text style={styles.feedbackText}>{question.feedback}</Text>
                        </View>

                        {/* User Answer Section (if available) */}
                        {question.userAnswer && (
                            <View style={styles.answerSection}>
                                <Text style={styles.sectionLabel}>YOUR ANSWER</Text>
                                <Text style={styles.answerText}>{question.userAnswer}</Text>
                            </View>
                        )}
                    </ScrollView>
                </View>
            </BlurView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    blurContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        width: '92%',
        maxHeight: SCREEN_HEIGHT * 0.85,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 15,
        overflow: 'hidden',
    },
    closeButton: {
        position: 'absolute',
        top: 15,
        right: 15,
        zIndex: 10,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 25,
        paddingTop: 50, // Space for close button
        paddingBottom: 40,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    questionText: {
        flex: 1,
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1a1a1a',
        lineHeight: 30,
        marginRight: 15,
    },
    favoriteButton: {
        padding: 5,
    },
    scoreBadgeContainer: {
        marginBottom: 25,
    },
    scoreBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    scoreBadgeText: {
        fontSize: 16,
        fontWeight: '700',
    },
    metricsSection: {
        marginBottom: 25,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 1,
        marginBottom: 12,
    },
    metricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
    },
    metricPill: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 12,
        alignItems: 'center',
    },
    metricLabel: {
        fontSize: 11,
        color: '#666',
        fontWeight: '500',
        marginBottom: 4,
    },
    metricValue: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    feedbackSection: {
        marginBottom: 25,
    },
    feedbackText: {
        fontSize: 16,
        color: '#333',
        lineHeight: 26,
    },
    answerSection: {
        backgroundColor: 'rgba(0, 0, 0, 0.03)',
        padding: 15,
        borderRadius: 12,
        marginBottom: 20,
    },
    answerText: {
        fontSize: 15,
        color: '#555',
        lineHeight: 24,
        fontStyle: 'italic',
    },
});
