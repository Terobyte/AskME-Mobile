/**
 * ResultsModal - Unified Glass Morphism Design
 * Supports both score reveal animation and detailed results view
 */

import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Modal,
    Dimensions,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { 
    useSharedValue, 
    useAnimatedStyle, 
    withTiming, 
    Easing,
    runOnJS 
} from 'react-native-reanimated';
import { FinalInterviewReport, QuestionResult } from '../../types';
import { getFavoriteIds, toggleFavorite, FavoriteQuestion } from '../../services/favorites-storage';
import { GeminiAgentService } from '../../services/gemini-agent';
import { updateQuestionAdvice } from '../../services/history-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ResultsModalProps {
    visible: boolean;
    onClose: () => void;
    report: FinalInterviewReport | null;
    roleTitle?: string;
    mode?: 'reveal' | 'detail'; // NEW: Default 'detail'
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
// QUESTION ROW COMPONENT
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
// DETAIL VIEW COMPONENT
// ============================================
interface DetailViewProps {
    visible: boolean;
    question: QuestionResult | null;
    isFavorite: boolean;
    sessionId?: string;
    onClose: () => void;
    onToggleFavorite: () => void;
    onAdviceGenerated?: (topic: string, advice: string) => void;
}

const DetailView: React.FC<DetailViewProps> = ({
    visible,
    question,
    isFavorite,
    sessionId,
    onClose,
    onToggleFavorite,
    onAdviceGenerated
}) => {
    const [debugExpanded, setDebugExpanded] = useState(false);
    const [generatingAdvice, setGeneratingAdvice] = useState(false);
    const [currentAdvice, setCurrentAdvice] = useState<string | undefined>(undefined);

    // Sync currentAdvice with question.advice when question changes
    useEffect(() => {
        if (question) {
            setCurrentAdvice(question.advice);
        }
    }, [question]);

    if (!visible || !question) return null;

    const metrics = question.metrics || { accuracy: 0, depth: 0, structure: 0 };
    const displayAdvice = currentAdvice || question.advice;

    // Handler for generating advice
    const handleGenerateAdvice = async () => {
        if (!question || generatingAdvice) return;

        console.log(`✨ [ADVICE] Generating advice for "${question.topic}"`);
        setGeneratingAdvice(true);

        try {
            // Create Gemini agent instance
            const agent = new GeminiAgentService();

            // Generate advice
            const advice = await agent.generateAdvice(
                question.topic,
                question.score,
                question.feedback,
                question.metrics || { accuracy: 0, depth: 0, structure: 0 },
                question.userAnswer || ''
            );

            console.log(`✅ [ADVICE] Generated: "${advice.substring(0, 50)}..."`);

            // Update local state immediately for UI
            setCurrentAdvice(advice);

            // Save to storage if we have a sessionId
            if (sessionId) {
                const saveSuccess = await updateQuestionAdvice(sessionId, question.topic, advice);
                
                if (saveSuccess) {
                    console.log(`💾 [ADVICE] Saved to storage`);
                    // Notify parent component if callback provided
                    onAdviceGenerated?.(question.topic, advice);
                } else {
                    console.warn(`⚠️ [ADVICE] Generated but not saved to storage`);
                }
            } else {
                console.warn(`⚠️ [ADVICE] No sessionId provided, advice not persisted`);
            }

            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
            console.error('❌ [ADVICE] Generation failed:', error);
            alert('Could not generate advice. Please try again.');
        } finally {
            setGeneratingAdvice(false);
        }
    };

    const handleFavorite = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggleFavorite();
    };

    return (
        <View style={styles.detailOverlay}>
            <View style={styles.detailCard}>
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

                    {/* METRICS */}
                    <View style={styles.metricsBlock}>
                        <Text style={styles.sectionTitle}>PERFORMANCE METRICS</Text>
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
                        <Text style={styles.sectionTitle}>AI FEEDBACK</Text>
                        <Text style={styles.feedbackText}>{question.feedback}</Text>
                    </View>

                    {/* Advice Section - NEW */}
                    <View style={styles.adviceSection}>
                        <Text style={styles.sectionTitle}>💡 STUDY ADVICE</Text>
                        {displayAdvice ? (
                            <View style={styles.adviceCard}>
                                <Text style={styles.adviceText}>{displayAdvice}</Text>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={styles.generateAdviceButton}
                                onPress={handleGenerateAdvice}
                                disabled={generatingAdvice}
                                activeOpacity={0.7}
                            >
                                {generatingAdvice ? (
                                    <>
                                        <Text style={styles.generateAdviceText}>Generating...</Text>
                                    </>
                                ) : (
                                    <>
                                        <Ionicons name="sparkles" size={18} color="#3B82F6" />
                                        <Text style={styles.generateAdviceText}>Generate Study Advice</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Your Answer */}
                    {question.userAnswer && (
                        <View style={styles.answerBlock}>
                            <Text style={styles.sectionTitle}>YOUR ANSWER</Text>
                            <Text style={styles.answerText}>{question.userAnswer}</Text>
                        </View>
                    )}

                    {/* Debug Section - NEW */}
                    <View style={styles.debugSection}>
                        <TouchableOpacity 
                            style={styles.debugHeader}
                            onPress={() => setDebugExpanded(!debugExpanded)}
                        >
                            <Text style={styles.debugTitle}>🔧 Debug Info</Text>
                            <Ionicons 
                                name={debugExpanded ? "chevron-up" : "chevron-down"} 
                                size={20} 
                                color="#666" 
                            />
                        </TouchableOpacity>
                        
                        {debugExpanded && (
                            <View style={styles.debugContent}>
                                {question.rawExchange && question.rawExchange.length > 0 ? (
                                    question.rawExchange.map((msg, idx) => (
                                        <View key={idx} style={styles.debugMessage}>
                                            <Text style={styles.debugSpeaker}>
                                                {msg.speaker === 'Victoria' ? '🎤 Victoria:' : '👤 You:'}
                                            </Text>
                                            <Text style={styles.debugText}>{msg.text}</Text>
                                        </View>
                                    ))
                                ) : (
                                    <Text style={styles.debugPlaceholder}>
                                        No raw conversation data available for this session.
                                    </Text>
                                )}
                                
                                {/* Evaluation Metrics */}
                                {question.metrics && (
                                    <View style={styles.debugMetrics}>
                                        <Text style={styles.debugSpeaker}>--- EVALUATION ---</Text>
                                        <Text style={styles.debugText}>Accuracy: {question.metrics.accuracy}/10</Text>
                                        <Text style={styles.debugText}>Depth: {question.metrics.depth}/10</Text>
                                        <Text style={styles.debugText}>Structure: {question.metrics.structure}/10</Text>
                                        <Text style={styles.debugText}>Score: {question.score.toFixed(1)}/10</Text>
                                        {question.metrics.reasoning && (
                                            <Text style={styles.debugText}>Reasoning: {question.metrics.reasoning}</Text>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
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
    roleTitle = "Interview Session",
    mode = 'detail'
}) => {
    const [internalMode, setInternalMode] = useState(mode);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [selectedQuestion, setSelectedQuestion] = useState<QuestionResult | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Animation values for reveal mode
    const animatedScore = useSharedValue(0);
    const [displayScore, setDisplayScore] = useState('0.0');

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

    // Reset internal mode when mode prop changes
    useEffect(() => {
        if (visible) {
            setInternalMode(mode);
        }
    }, [mode, visible]);

    // Score reveal animation
    useEffect(() => {
        if (visible && internalMode === 'reveal' && report) {
            console.log('🎰 [REVEAL] Starting score animation');
            
            // Animate score from 0 to final value
            animatedScore.value = 0;
            animatedScore.value = withTiming(report.averageScore, {
                duration: 2000,
                easing: Easing.out(Easing.cubic)
            }, (finished) => {
                if (finished) {
                    runOnJS(setDisplayScore)(report.averageScore.toFixed(1));
                }
            });
        }
    }, [visible, internalMode, report]);

    // Animated score style
    const animatedScoreStyle = useAnimatedStyle(() => {
        return {
            opacity: withTiming(internalMode === 'reveal' ? 1 : 0, { duration: 300 })
        };
    });

    // Update display score during animation
    useEffect(() => {
        if (internalMode === 'reveal' && report) {
            const interval = setInterval(() => {
                const currentValue = animatedScore.value;
                setDisplayScore(currentValue.toFixed(1));
            }, 50);

            return () => clearInterval(interval);
        }
    }, [internalMode, report]);

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
            metrics: question.metrics,
            timestamp: Date.now(),
        };

        toggleFavorite(favoriteQuestion).catch(console.error);
    };

    // Fallback if no report
    if (!report) {
        return (
            <Modal visible={visible} transparent animationType="fade">
                <BlurView intensity={80} tint="light" style={styles.blurContainer}>
                    <View style={styles.glassCard}>
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.roleTitle}>No Results Available</Text>
                                <Text style={styles.dateText}>
                                    The interview ended before results could be generated.
                                </Text>
                            </View>
                            <View style={styles.headerRight}>
                                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                    <Ionicons name="close" size={28} color="#333" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </BlurView>
            </Modal>
        );
    }

    const totalScore = report.averageScore;
    const totalScoreColor = getScoreColor(totalScore);
    const sessionDate = formatDate(report.timestamp || Date.now());
    const hasQuestions = report.questions && report.questions.length > 0;
    const briefSummary = report.overallSummary.split('.')[0] + '.';

    return (
        <Modal visible={visible} transparent animationType="fade">
            <BlurView intensity={80} tint="light" style={styles.blurContainer}>
                {internalMode === 'reveal' ? (
                    // ============================================
                    // REVEAL MODE - Score Animation
                    // ============================================
                    <View style={styles.revealContainer}>
                        <Animated.View style={[styles.scoreCircle, animatedScoreStyle]}>
                            <Text style={[styles.bigScore, { color: totalScoreColor }]}>
                                {displayScore}
                            </Text>
                            <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
                        </Animated.View>

                        <View style={styles.briefSummaryContainer}>
                            <Text style={styles.briefSummary}>{briefSummary}</Text>
                        </View>

                        <TouchableOpacity 
                            style={styles.detailButton}
                            onPress={() => {
                                setInternalMode('detail');
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }}
                        >
                            <Text style={styles.detailButtonText}>SEE DETAILED RESULTS</Text>
                            <Ionicons name="arrow-forward" size={20} color="#333" />
                        </TouchableOpacity>
                    </View>
                ) : (
                    // ============================================
                    // DETAIL MODE - Full Results
                    // ============================================
                    <View style={styles.glassCard}>
                        {/* Header */}
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

                        {/* Overall Summary */}
                        <View style={styles.summaryCard}>
                            <Text style={styles.sectionTitle}>OVERALL SUMMARY</Text>
                            <Text style={styles.summaryText}>{report.overallSummary}</Text>
                        </View>

                        {/* Questions List */}
                        <ScrollView
                            style={styles.listContainer}
                            contentContainerStyle={styles.listContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {hasQuestions ? (
                                <>
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
                                </>
                            ) : (
                                <View style={styles.emptyState}>
                                    <Ionicons name="information-circle-outline" size={48} color="#999" />
                                    <Text style={styles.emptyText}>
                                        No questions were answered during this session.
                                    </Text>
                                </View>
                            )}
                        </ScrollView>

                        {/* Detail View Overlay */}
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
                )}
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

    // Glass card (detail mode)
    glassCard: {
        width: '92%',
        height: '85%',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        borderRadius: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 25,
        elevation: 15,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
        overflow: 'hidden',
    },

    // ===== REVEAL MODE =====
    revealContainer: {
        width: '92%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    scoreCircle: {
        alignItems: 'center',
        marginBottom: 40,
    },
    bigScore: {
        fontSize: 72,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    scoreLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 2,
    },
    briefSummaryContainer: {
        paddingHorizontal: 20,
        marginBottom: 40,
    },
    briefSummary: {
        fontSize: 16,
        color: '#333',
        textAlign: 'center',
        lineHeight: 24,
    },
    detailButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    detailButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#333',
        marginRight: 8,
        letterSpacing: 0.5,
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
        color: '#333',
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

    // ===== SUMMARY CARD =====
    summaryCard: {
        margin: 20,
        marginBottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    summaryText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 24,
    },

    // ===== LIST =====
    listContainer: {
        flex: 1,
    },
    listContent: {
        padding: 20,
        paddingTop: 10,
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

    // ===== QUESTION ROW =====
    questionRow: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
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

    // ===== EMPTY STATE =====
    emptyState: {
        paddingVertical: 32,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: '#666',
        marginTop: 12,
        textAlign: 'center',
    },

    // ===== DETAIL VIEW =====
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
        color: '#333',
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

    // ===== METRICS =====
    metricsBlock: {
        marginBottom: 24,
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
    feedbackText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 24,
    },

    // ===== ADVICE SECTION - NEW =====
    adviceSection: {
        marginBottom: 24,
    },
    adviceCard: {
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(59, 130, 246, 0.2)',
    },
    adviceText: {
        fontSize: 14,
        color: '#333',
        lineHeight: 20,
    },
    generateAdviceButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(59, 130, 246, 0.3)',
        borderStyle: 'dashed',
        gap: 8,
    },
    generateAdviceText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#3B82F6',
    },

    // ===== ANSWER =====
    answerBlock: {
        backgroundColor: 'rgba(0, 0, 0, 0.03)',
        padding: 16,
        borderRadius: 12,
        marginBottom: 20,
    },
    answerText: {
        fontSize: 14,
        color: '#555',
        lineHeight: 22,
        fontStyle: 'italic',
    },

    // ===== DEBUG SECTION - NEW =====
    debugSection: {
        marginTop: 20,
        borderTopWidth: 1,
        borderTopColor: '#E5E5E5',
        paddingTop: 16,
    },
    debugHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    debugTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
    },
    debugContent: {
        marginTop: 12,
        backgroundColor: '#F5F5F5',
        borderRadius: 8,
        padding: 12,
    },
    debugMessage: {
        marginBottom: 12,
    },
    debugSpeaker: {
        fontSize: 12,
        fontWeight: '700',
        color: '#333',
        marginBottom: 4,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    debugText: {
        fontSize: 12,
        color: '#555',
        lineHeight: 18,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    debugPlaceholder: {
        fontSize: 12,
        color: '#999',
        fontStyle: 'italic',
        textAlign: 'center',
        paddingVertical: 8,
    },
    debugMetrics: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#DDD',
    },
});