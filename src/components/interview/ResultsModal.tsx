import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Modal,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FinalInterviewReport, QuestionResult } from '../../types';
import { getFavoriteIds, toggleFavorite, FavoriteQuestion } from '../../services/favorites-storage';

interface ResultsModalProps {
    visible: boolean;
    onClose: () => void;
    report: FinalInterviewReport | null;
}

interface ScoreColors {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    label: string;
}

// Helper function to get color scheme based on score
const getScoreColor = (score: number): ScoreColors => {
    if (score > 7) {
        return {
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderColor: 'rgba(16, 185, 129, 0.3)',
            textColor: '#10B981',
            label: 'Excellent',
        };
    } else if (score >= 5) {
        return {
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderColor: 'rgba(245, 158, 11, 0.3)',
            textColor: '#F59E0B',
            label: 'Good',
        };
    } else {
        return {
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderColor: 'rgba(239, 68, 68, 0.3)',
            textColor: '#EF4444',
            label: 'Needs Work',
        };
    }
};

interface QuestionCardProps {
    question: QuestionResult;
    index: number;
    isFavorite: boolean;
    onToggleFavorite: () => void;
}

// Sub-component for individual question cards
const QuestionCard: React.FC<QuestionCardProps> = ({ question, index, isFavorite, onToggleFavorite }) => {
    const colors = getScoreColor(question.score);

    // Safely access metrics with fallback
    const metrics = (question as any).metrics || { accuracy: 0, depth: 0, structure: 0 };

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: colors.backgroundColor,
                    borderColor: colors.borderColor,
                },
            ]}
        >
            {/* Header Row */}
            <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                    {/* Score Badge */}
                    <View
                        style={[
                            styles.scoreBadge,
                            {
                                backgroundColor: colors.backgroundColor,
                                borderColor: colors.borderColor,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.scoreBadgeText,
                                { color: colors.textColor },
                            ]}
                        >
                            {question.score.toFixed(1)}
                        </Text>
                    </View>

                    {/* Topic and Label */}
                    <View style={styles.topicContainer}>
                        <Text style={styles.topicText} numberOfLines={2}>
                            Q{index + 1}: {question.topic}
                        </Text>
                        <Text
                            style={[
                                styles.scoreLabel,
                                { color: colors.textColor },
                            ]}
                        >
                            {colors.label}
                        </Text>
                    </View>
                </View>

                {/* Favorite Button */}
                <TouchableOpacity
                    onPress={onToggleFavorite}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.favoriteButton}
                >
                    <Ionicons
                        name={isFavorite ? "star" : "star-outline"}
                        size={22}
                        color={isFavorite ? "#FFD700" : "rgba(255, 255, 255, 0.5)"}
                    />
                </TouchableOpacity>
            </View>

            {/* Feedback Section */}
            <View style={styles.feedbackSection}>
                <Text style={styles.feedbackLabel}>AI FEEDBACK:</Text>
                <Text style={styles.feedbackText} numberOfLines={4}>
                    {question.feedback}
                </Text>
            </View>

            {/* Metrics Pills */}
            <View style={styles.metricsContainer}>
                <View style={styles.metricPill}>
                    <Text style={styles.metricLabel}>Accuracy</Text>
                    <Text style={styles.metricValue}>{metrics.accuracy}/10</Text>
                </View>
                <View style={styles.metricPill}>
                    <Text style={styles.metricLabel}>Depth</Text>
                    <Text style={styles.metricValue}>{metrics.depth}/10</Text>
                </View>
                <View style={styles.metricPill}>
                    <Text style={styles.metricLabel}>Structure</Text>
                    <Text style={styles.metricValue}>{metrics.structure}/10</Text>
                </View>
            </View>
        </View>
    );
};

export const ResultsModal: React.FC<ResultsModalProps> = ({ visible, onClose, report }) => {
    const [localQuestions, setLocalQuestions] = useState<QuestionResult[]>([]);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

    // Generate unique ID for a question
    const getQuestionId = (question: QuestionResult, index: number): string => {
        return `q_${question.topic.replace(/\s+/g, '_').substring(0, 20)}_${index}_${question.score}`;
    };

    // Load favorites when modal opens
    useEffect(() => {
        if (visible) {
            console.log("⭐ [RESULTS MODAL] Loading favorites...");
            getFavoriteIds().then(ids => {
                console.log("⭐ [RESULTS MODAL] Loaded favorite IDs:", ids.size);
                setFavoriteIds(ids);
            });
        }
    }, [visible]);

    // Sync local questions when modal opens or report changes
    useEffect(() => {
        console.log("🔍 [RESULTS MODAL] useEffect triggered");
        if (visible && report?.questions && report.questions.length > 0) {
            console.log("✅ [RESULTS MODAL] Setting localQuestions:", report.questions.length);
            setLocalQuestions([...report.questions]);
        }
    }, [visible, report?.questions]);

    // Handle favorite toggle with haptic feedback
    const handleToggleFavorite = async (question: QuestionResult, index: number) => {
        const questionId = getQuestionId(question, index);
        console.log("⭐ [RESULTS MODAL] Toggle favorite:", questionId);

        // Haptic feedback
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        // Optimistic UI update
        setFavoriteIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(questionId)) {
                newSet.delete(questionId);
            } else {
                newSet.add(questionId);
            }
            return newSet;
        });

        // Create favorite question object
        const favoriteQuestion: FavoriteQuestion = {
            id: questionId,
            topic: question.topic,
            score: question.score,
            feedback: question.feedback,
            userAnswer: question.userAnswer || '',
            metrics: (question as any).metrics,
            timestamp: Date.now(),
        };

        // Persist to storage (in background)
        toggleFavorite(favoriteQuestion).then(result => {
            console.log(`⭐ [RESULTS MODAL] ${result.added ? 'Added to' : 'Removed from'} favorites`);
        });
    };

    // Handle empty state
    if (!report || !report.questions || report.questions.length === 0) {
        return (
            <Modal visible={visible} transparent animationType="fade">
                <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
                    <View style={styles.modalContainer}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Interview Results</Text>
                            <TouchableOpacity onPress={onClose}>
                                <Ionicons name="close-circle" size={32} color="#FFF" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyStateText}>No questions available</Text>
                        </View>
                    </View>
                </BlurView>
            </Modal>
        );
    }

    return (
        <Modal visible={visible} transparent animationType="fade">
            <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
                <View style={styles.modalContainer}>
                    {/* Header */}
                    <View style={styles.modalHeader}>
                        <View style={styles.headerLeft}>
                            <Text style={styles.modalTitle}>Interview Results</Text>
                            <Text style={styles.averageScore}>
                                Average Score: {report.averageScore.toFixed(1)}/10
                            </Text>
                        </View>
                        <TouchableOpacity
                            onPress={onClose}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons name="close-circle" size={32} color="#FFF" />
                        </TouchableOpacity>
                    </View>

                    {/* ScrollView with Question Cards - wrapped in flex View */}
                    <View style={{ flex: 1 }}>
                        <ScrollView
                            style={styles.scrollView}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {localQuestions.length === 0 ? (
                                <View style={styles.emptyState}>
                                    <Text style={styles.emptyStateText}>
                                        DEBUG: localQuestions is empty
                                    </Text>
                                    <Text style={styles.emptyStateText}>
                                        report.questions: {report?.questions?.length || 0}
                                    </Text>
                                </View>
                            ) : (
                                localQuestions.map((question, index) => {
                                    const questionId = getQuestionId(question, index);
                                    return (
                                        <QuestionCard
                                            key={questionId}
                                            question={question}
                                            index={index}
                                            isFavorite={favoriteIds.has(questionId)}
                                            onToggleFavorite={() => handleToggleFavorite(question, index)}
                                        />
                                    );
                                })
                            )}
                        </ScrollView>
                    </View>

                    {/* Summary Footer */}
                    <View style={styles.summaryFooter}>
                        <Text style={styles.summaryLabel}>OVERALL SUMMARY</Text>
                        <ScrollView
                            style={styles.summaryScrollView}
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={styles.summaryText}>{report.overallSummary}</Text>
                        </ScrollView>
                    </View>
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
        width: '90%',
        height: '85%',  // FIXED: Changed from maxHeight to height
        backgroundColor: 'rgba(20, 20, 20, 0.95)',
        borderRadius: 25,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerLeft: {
        flex: 1,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFF',
    },
    averageScore: {
        fontSize: 14,
        color: '#999',
        marginTop: 4,
    },
    scrollView: {
        flex: 1,
        backgroundColor: 'rgba(255, 0, 0, 0.1)',  // DEBUG: Red background to verify ScrollView has space
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 10,
    },
    card: {
        borderRadius: 15,
        borderWidth: 1,
        padding: 15,
        marginBottom: 15,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        flex: 1,
        alignItems: 'flex-start',
    },
    scoreBadge: {
        width: 50,
        height: 50,
        borderRadius: 10,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    scoreBadgeText: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    topicContainer: {
        flex: 1,
    },
    topicText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFF',
        marginBottom: 4,
    },
    scoreLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    favoriteButton: {
        padding: 4,
    },
    feedbackSection: {
        marginBottom: 15,
    },
    feedbackLabel: {
        fontSize: 10,
        color: '#666',
        fontWeight: 'bold',
        marginBottom: 6,
        letterSpacing: 1,
    },
    feedbackText: {
        fontSize: 14,
        color: '#CCC',
        lineHeight: 20,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    metricsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    metricPill: {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        alignItems: 'center',
    },
    metricLabel: {
        fontSize: 10,
        color: '#999',
        marginBottom: 2,
    },
    metricValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#FFF',
    },
    summaryFooter: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.1)',
        padding: 20,
        maxHeight: 150,
    },
    summaryLabel: {
        fontSize: 12,
        color: '#666',
        fontWeight: 'bold',
        marginBottom: 10,
        letterSpacing: 1,
    },
    summaryScrollView: {
        maxHeight: 100,
    },
    summaryText: {
        fontSize: 14,
        color: '#CCC',
        lineHeight: 20,
    },
    emptyState: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyStateText: {
        fontSize: 16,
        color: '#999',
        textAlign: 'center',
    },
});