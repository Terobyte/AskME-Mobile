/**
 * ResultsModal - Light Control Center Style
 * Displays interview results with clean, light theme
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { FinalInterviewReport, QuestionResult } from '../../types';
import { getFavoriteIds, toggleFavorite, FavoriteQuestion } from '../../services/favorites-storage';
import { saveSession } from '../../services/history-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ResultsModalProps {
    visible: boolean;
    onClose: () => void;
    report: FinalInterviewReport | null;
    roleTitle?: string;  // e.g. "React Native Developer"
}

// Traffic light colors for scores
const getScoreColor = (score: number): string => {
    if (score >= 8) return '#10B981'; // Green
    if (score >= 5) return '#F59E0B'; // Yellow/Orange
    return '#EF4444'; // Red
};

// Format date
const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

// ============================================
// QUESTION ROW COMPONENT (Clean, no metrics)
// ============================================
interface QuestionRowProps {
    question: QuestionResult;
    onPress: () => void;
}

const QuestionRow: React.FC<QuestionRowProps> = ({ question, onPress }) => {
    const scoreColor = getScoreColor(question.score);

    return (
        <TouchableOpacity
            style={styles.questionRow}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <Text style={styles.questionText} numberOfLines={1}>
                {question.topic}
            </Text>
            <View style={[styles.scoreIndicator, { backgroundColor: scoreColor }]}>
                <Text style={styles.scoreIndicatorText}>
                    {question.score.toFixed(1)}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

// ============================================
// DETAIL VIEW COMPONENT (Full question + metrics + feedback)
// ============================================
interface DetailViewProps {
    visible: boolean;
    question: QuestionResult | null;
    isFavorite: boolean;
    onClose: () => void;
    onToggleFavorite: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({
    visible,
    question,
    isFavorite,
    onClose,
    onToggleFavorite
}) => {
    if (!visible || !question) return null;

    const metrics = (question as any).metrics || { accuracy: 0, depth: 0, structure: 0 };

    const handleFavorite = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggleFavorite();
    };

    return (
        <View style={styles.detailOverlay}>
            <View style={styles.detailCard}>
                {/* Close button */}
                <TouchableOpacity style={styles.detailCloseBtn} onPress={onClose}>
                    <Ionicons name="chevron-back" size={24} color="#333" />
                </TouchableOpacity>

                <ScrollView
                    style={styles.detailScroll}
                    contentContainerStyle={styles.detailScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Full Question */}
                    <View style={styles.detailHeader}>
                        <Text style={styles.detailQuestion}>{question.topic}</Text>
                        <TouchableOpacity onPress={handleFavorite} style={styles.favButton}>
                            <Ionicons
                                name={isFavorite ? "star" : "star-outline"}
                                size={26}
                                color={isFavorite ? "#FFD700" : "#999"}
                            />
                        </TouchableOpacity>
                    </View>

                    {/* Score */}
                    <View style={styles.detailScoreRow}>
                        <Text style={[styles.detailScore, { color: getScoreColor(question.score) }]}>
                            {question.score.toFixed(1)}/10
                        </Text>
                    </View>

                    {/* MANDATORY METRICS */}
                    <View style={styles.metricsBlock}>
                        <Text style={styles.metricsTitle}>PERFORMANCE METRICS</Text>
                        <View style={styles.metricsRow}>
                            <View style={[styles.metricPill, { backgroundColor: `${getScoreColor(metrics.accuracy)}15` }]}>
                                <Text style={styles.metricLabel}>Accuracy</Text>
                                <Text style={[styles.metricValue, { color: getScoreColor(metrics.accuracy) }]}>
                                    {metrics.accuracy}/10
                                </Text>
                            </View>
                            <View style={[styles.metricPill, { backgroundColor: `${getScoreColor(metrics.depth)}15` }]}>
                                <Text style={styles.metricLabel}>Depth</Text>
                                <Text style={[styles.metricValue, { color: getScoreColor(metrics.depth) }]}>
                                    {metrics.depth}/10
                                </Text>
                            </View>
                            <View style={[styles.metricPill, { backgroundColor: `${getScoreColor(metrics.structure)}15` }]}>
                                <Text style={styles.metricLabel}>Structure</Text>
                                <Text style={[styles.metricValue, { color: getScoreColor(metrics.structure) }]}>
                                    {metrics.structure}/10
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* AI Feedback */}
                    <View style={styles.feedbackBlock}>
                        <Text style={styles.feedbackTitle}>AI FEEDBACK</Text>
                        <Text style={styles.feedbackText}>{question.feedback}</Text>
                    </View>

                    {/* Your Answer (if available) */}
                    {question.userAnswer && (
                        <View style={styles.answerBlock}>
                            <Text style={styles.answerTitle}>YOUR ANSWER</Text>
                            <Text style={styles.answerText}>{question.userAnswer}</Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </View>
    );
};

// ============================================
// MAIN RESULTS MODAL
// ============================================
export const ResultsModal: React.FC<ResultsModalProps> = ({
    visible,
    onClose,
    report,
    roleTitle = "Interview Session"
}) => {
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [selectedQuestion, setSelectedQuestion] = useState<QuestionResult | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Track if this session has been saved (prevent duplicate saves)
    const sessionSavedRef = useRef<boolean>(false);

    // Generate unique ID for a question
    const getQuestionId = (question: QuestionResult, index: number): string => {
        return `q_${question.topic.replace(/\s+/g, '_').substring(0, 20)}_${index}`;
    };

    // Load favorites when modal opens
    useEffect(() => {
        if (visible) {
            getFavoriteIds().then(ids => {
                setFavoriteIds(ids);
            }).catch(() => setFavoriteIds(new Set()));
        }
    }, [visible]);

    // AUTO-SAVE: Save session to history when modal first opens
    useEffect(() => {
        if (visible && report && !sessionSavedRef.current) {
            sessionSavedRef.current = true;

            // Save in background (non-blocking)
            saveSession(
                roleTitle,
                report.averageScore,
                report.overallSummary,
                report.questions
            ).then(session => {
                console.log('💾 [RESULTS] Session auto-saved:', session.id);
            }).catch(error => {
                console.error('❌ [RESULTS] Failed to auto-save session:', error);
            });
        }

        // Reset saved flag when modal closes (for next session)
        if (!visible) {
            sessionSavedRef.current = false;
        }
    }, [visible, report, roleTitle]);

    // Handle favorite toggle
    const handleToggleFavorite = async (question: QuestionResult, index: number) => {
        const questionId = getQuestionId(question, index);

        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        // Optimistic update
        setFavoriteIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(questionId)) {
                newSet.delete(questionId);
            } else {
                newSet.add(questionId);
            }
            return newSet;
        });

        // Persist
        const favoriteQuestion: FavoriteQuestion = {
            id: questionId,
            topic: question.topic,
            score: question.score,
            feedback: question.feedback,
            userAnswer: question.userAnswer || '',
            metrics: (question as any).metrics,
            timestamp: Date.now(),
        };

        toggleFavorite(favoriteQuestion).catch(console.error);
    };

    // Handle empty state
    if (!report) {
        return null;
    }

    const totalScore = report.averageScore;
    const totalScoreColor = getScoreColor(totalScore);
    const sessionDate = formatDate(report.timestamp || Date.now());

    return (
        <Modal visible={visible} transparent animationType="fade">
            <BlurView intensity={40} tint="light" style={styles.blurContainer}>
                <View style={styles.modalCard}>
                    {/* ===== HEADER ===== */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <Text style={styles.roleTitle}>{roleTitle}</Text>
                            <Text style={styles.dateText}>{sessionDate}</Text>
                        </View>
                        <View style={styles.headerRight}>
                            <Text style={[styles.totalScore, { color: totalScoreColor }]}>
                                {totalScore.toFixed(1)}
                            </Text>
                            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                <Ionicons name="close" size={28} color="#333" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* ===== QUESTIONS LIST ===== */}
                    <ScrollView
                        style={styles.listContainer}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <Text style={styles.sectionTitle}>QUESTIONS ({report.questions.length})</Text>

                        {report.questions.map((question, index) => (
                            <QuestionRow
                                key={getQuestionId(question, index)}
                                question={question}
                                onPress={() => {
                                    setSelectedQuestion(question);
                                    setSelectedIndex(index);
                                }}
                            />
                        ))}

                        {/* Summary */}
                        <View style={styles.summaryBlock}>
                            <Text style={styles.sectionTitle}>OVERALL SUMMARY</Text>
                            <Text style={styles.summaryText}>{report.overallSummary}</Text>
                        </View>
                    </ScrollView>

                    {/* ===== DETAIL VIEW (Overlay) ===== */}
                    <DetailView
                        visible={selectedQuestion !== null}
                        question={selectedQuestion}
                        isFavorite={selectedQuestion && selectedIndex >= 0
                            ? favoriteIds.has(getQuestionId(selectedQuestion, selectedIndex))
                            : false
                        }
                        onClose={() => {
                            setSelectedQuestion(null);
                            setSelectedIndex(-1);
                        }}
                        onToggleFavorite={() => {
                            if (selectedQuestion && selectedIndex >= 0) {
                                handleToggleFavorite(selectedQuestion, selectedIndex);
                            }
                        }}
                    />
                </View>
            </BlurView>
        </Modal>
    );
};

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
    // Blur background
    blurContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Main card (Light theme)
    modalCard: {
        width: '92%',
        height: '85%',  // FIXED: Changed from maxHeight to height
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 25,
        elevation: 15,
        overflow: 'hidden',
    },

    // ===== HEADER =====
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    },
    headerLeft: {
        flex: 1,
    },
    roleTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 4,
    },
    dateText: {
        fontSize: 14,
        color: '#666',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    totalScore: {
        fontSize: 36,
        fontWeight: 'bold',
    },
    closeBtn: {
        padding: 4,
    },

    // ===== LIST =====
    listContainer: {
        flex: 1,
    },
    listContent: {
        padding: 20,
        paddingBottom: 40,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 1,
        marginBottom: 12,
        marginTop: 8,
    },

    // ===== QUESTION ROW (glassButton style) =====
    questionRow: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        padding: 16,
        borderRadius: 14,
        alignItems: 'center',
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 2,
    },
    questionText: {
        flex: 1,
        fontSize: 15,
        color: '#333',
        fontWeight: '500',
        marginRight: 12,
    },
    scoreIndicator: {
        width: 44,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scoreIndicatorText: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#FFF',
    },

    // ===== SUMMARY =====
    summaryBlock: {
        marginTop: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
        padding: 16,
        borderRadius: 14,
    },
    summaryText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 24,
    },

    // ===== DETAIL VIEW (Overlay) =====
    detailOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderRadius: 25,
    },
    detailCard: {
        flex: 1,
    },
    detailCloseBtn: {
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        padding: 4,
    },
    detailScroll: {
        flex: 1,
    },
    detailScrollContent: {
        padding: 24,
        paddingTop: 60,
        paddingBottom: 40,
    },
    detailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    detailQuestion: {
        flex: 1,
        fontSize: 20,
        fontWeight: 'bold',
        color: '#000',
        lineHeight: 28,
        marginRight: 12,
    },
    favButton: {
        padding: 4,
    },
    detailScoreRow: {
        marginBottom: 24,
    },
    detailScore: {
        fontSize: 28,
        fontWeight: 'bold',
    },

    // ===== METRICS BLOCK =====
    metricsBlock: {
        marginBottom: 24,
    },
    metricsTitle: {
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

    // ===== FEEDBACK =====
    feedbackBlock: {
        marginBottom: 24,
    },
    feedbackTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 1,
        marginBottom: 12,
    },
    feedbackText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 24,
    },

    // ===== ANSWER =====
    answerBlock: {
        backgroundColor: 'rgba(0, 0, 0, 0.03)',
        padding: 16,
        borderRadius: 12,
    },
    answerTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 1,
        marginBottom: 8,
    },
    answerText: {
        fontSize: 14,
        color: '#555',
        lineHeight: 22,
        fontStyle: 'italic',
    },
});