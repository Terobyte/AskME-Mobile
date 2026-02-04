/**
 * HistoryPanel - Sliding panel from right edge (iOS Control Center style)
 * Displays all past interview sessions with glass morphism design
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
    Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { SessionCard } from './SessionCard';
import { ResultsModal } from '../interview/ResultsModal';
import {
    getHistory,
    deleteSession,
    exportHistoryDebug,
    InterviewSession,
} from '../../services/history-storage';
import { FinalInterviewReport } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface HistoryPanelProps {
    visible: boolean;
    onClose: () => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ visible, onClose }) => {
    const [sessions, setSessions] = useState<InterviewSession[]>([]);
    const [selectedSession, setSelectedSession] = useState<InterviewSession | null>(null);
    const [showResultsModal, setShowResultsModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const translateX = useSharedValue(SCREEN_WIDTH);

    // Load history when panel opens
    useEffect(() => {
        console.log('📱 [HISTORY_PANEL] useEffect triggered, visible:', visible);
        
        if (visible) {
            console.log('📱 [HISTORY_PANEL] Panel opening, calling loadHistory()...');
            loadHistory();
            // Animate in
            translateX.value = withSpring(0, {
                damping: 20,
                stiffness: 90,
            });
            console.log('📱 [HISTORY_PANEL] Animation started');
        } else {
            // Animate out
            translateX.value = withSpring(SCREEN_WIDTH, {
                damping: 20,
                stiffness: 90,
            });
            console.log('📱 [HISTORY_PANEL] Panel closing');
        }
    }, [visible]);

    const loadHistory = async () => {
        setIsLoading(true);
        console.log('📂 [HISTORY_PANEL] loadHistory() called');
        console.log('📂 [HISTORY_PANEL] Current sessions state length:', sessions.length);
        
        try {
            console.log('📂 [HISTORY_PANEL] Calling getHistory()...');
            const history = await getHistory();
            
            console.log('✅ [HISTORY_PANEL] getHistory() returned:', history.length, 'sessions');
            console.log('📝 [HISTORY_PANEL] First session:', JSON.stringify(history[0], null, 2));
            console.log('📝 [HISTORY_PANEL] First session ID:', history[0]?.id);
            
            console.log('📝 [HISTORY_PANEL] Calling setSessions()...');
            setSessions(history);
            
            console.log('✅ [HISTORY_PANEL] setSessions() completed');
        } catch (error) {
            console.error('❌ [HISTORY_PANEL] Error in loadHistory():', error);
            console.error('❌ [HISTORY_PANEL] Error stack:', error instanceof Error ? error.stack : 'No stack');
        } finally {
            setIsLoading(false);
            console.log('📂 [HISTORY_PANEL] loadHistory() finished, isLoading:', false);
        }
    };

    const handleSessionPress = (session: InterviewSession) => {
        // Convert InterviewSession to FinalInterviewReport format
        const report: FinalInterviewReport = {
            questions: session.questions.map(q => ({
                topic: q.topic,
                userAnswer: q.userAnswer,
                score: q.score,
                feedback: q.feedback,
                metrics: q.metrics ? {
                    ...q.metrics,
                    reasoning: q.metrics.reasoning || 'Historical session'
                } : undefined,
            })),
            averageScore: session.totalScore,
            overallSummary: session.overallSummary,
            timestamp: session.timestamp,
        };

        setSelectedSession(session);
        setShowResultsModal(true);
    };

    const handleDeleteSession = async (sessionId: string) => {
        Alert.alert(
            'Delete Session',
            'Are you sure you want to delete this interview session?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        const success = await deleteSession(sessionId);
                        if (success) {
                            await loadHistory();
                        }
                    },
                },
            ]
        );
    };

    const handleExport = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        try {
            await exportHistoryDebug();
        } catch (error) {
            console.error('❌ [EXPORT] Error:', error);
            Alert.alert('Export Error', 'Failed to export history. Please try again.');
        }
    };

    const handleClose = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onClose();
    };

    // Swipe right to close gesture
    const swipeGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (event.translationX > 0) {
                translateX.value = event.translationX;
            }
        })
        .onEnd((event) => {
            if (event.translationX > 100 || event.velocityX > 500) {
                // Close panel
                translateX.value = withSpring(SCREEN_WIDTH, {
                    damping: 20,
                    stiffness: 90,
                });
                runOnJS(handleClose)();
            } else {
                // Snap back
                translateX.value = withSpring(0, {
                    damping: 20,
                    stiffness: 90,
                });
            }
        });

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    if (!visible) return null;

    return (
        <>
            <Modal visible={visible} animationType="fade" transparent>
                <BlurView intensity={20} style={styles.blurContainer} tint="light">
                    <View style={styles.modalContainer}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.headerTitleRow}>
                                <Ionicons name="time-outline" size={24} color="#333" />
                                <Text style={styles.modalTitle}>History</Text>
                            </View>
                            <TouchableOpacity onPress={handleClose}>
                                <Ionicons name="close" size={28} color="#333" />
                            </TouchableOpacity>
                        </View>

                        {/* Session List */}
                        <ScrollView
                            style={styles.scrollView}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {isLoading ? (
                                <View style={styles.emptyContainer}>
                                    <Text style={styles.emptyText}>Loading...</Text>
                                </View>
                            ) : sessions.length === 0 ? (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="document-text-outline" size={64} color="#CCC" />
                                    <Text style={styles.emptyText}>
                                        No interview history yet.
                                    </Text>
                                    <Text style={styles.emptySubtext}>
                                        Complete an interview to see results here.
                                    </Text>
                                </View>
                            ) : (
                                <>
                                    {console.log('🎨 [HISTORY_PANEL] Rendering sessions list, count:', sessions.length)}
                                    <Text style={styles.sectionTitle}>
                                        {sessions.length} SESSION{sessions.length !== 1 ? 'S' : ''}
                                    </Text>
                                    {sessions.map((session, index) => {
                                        console.log(`🎨 [HISTORY_PANEL] Rendering card ${index + 1}/${sessions.length}: ${session.id}`);
                                        return (
                                            <SessionCard
                                                key={session.id}
                                                session={session}
                                                onPress={() => handleSessionPress(session)}
                                                onDelete={() => handleDeleteSession(session.id)}
                                            />
                                        );
                                    })}
                                </>
                            )}
                        </ScrollView>

                        {/* Export Button (pinned at bottom) */}
                        <View style={styles.footer}>
                            <TouchableOpacity
                                style={styles.exportButton}
                                onPress={handleExport}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="download-outline" size={20} color="#333" />
                                <Text style={styles.exportButtonText}>
                                    EXPORT ALL HISTORY (DEBUG)
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </Modal>

            {/* Results Modal (when session is selected) */}
            {selectedSession && (
                <ResultsModal
                    visible={showResultsModal}
                    onClose={() => {
                        setShowResultsModal(false);
                        setSelectedSession(null);
                    }}
                    report={{
                        questions: selectedSession.questions.map(q => ({
                            topic: q.topic,
                            userAnswer: q.userAnswer,
                            score: q.score,
                            feedback: q.feedback,
                            metrics: q.metrics ? {
                                ...q.metrics,
                                reasoning: q.metrics.reasoning || 'Historical session'
                            } : undefined,
                        })),
                        averageScore: selectedSession.totalScore,
                        overallSummary: selectedSession.overallSummary,
                        timestamp: selectedSession.timestamp,
                    }}
                    roleTitle={selectedSession.role}
                />
            )}
        </>
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
        height: '70%', // ← ЯВНАЯ ВЫСОТА (вместо maxHeight!)
        backgroundColor: 'rgba(255, 255, 255, 0.98)', // ← Менее прозрачный
        borderRadius: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 50, // Выше z-index
        overflow: 'hidden', // Ensure content doesn't spill out
        borderWidth: 1, // ← Для видимости границ (можно убрать потом)
        borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16, // ← Уменьшили с 20 до 16
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0, 0, 0, 0.1)', // ← Более темная граница
        backgroundColor: 'rgba(255, 255, 255, 0.7)', // ← Более белый фон
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 90, // ← Уменьшили с 100 до 90
        flexGrow: 1, // ← Добавили для растяжения
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        letterSpacing: 1,
        marginBottom: 12,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
    },
    emptyText: {
        fontSize: 16,
        color: '#666',
        marginTop: 16,
        textAlign: 'center',
    },
    emptySubtext: {
        fontSize: 14,
        color: '#999',
        marginTop: 8,
        textAlign: 'center',
    },
    footer: {
        padding: 16, // ← Уменьшили с 20 до 16
        borderTopWidth: 1,
        borderTopColor: 'rgba(0, 0, 0, 0.1)', // ← Более темная граница
        backgroundColor: 'rgba(255, 255, 255, 0.95)', // ← Более белый фон
    },
    exportButton: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 16,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 2,
    },
    exportButtonText: {
        color: '#333',
        fontWeight: '600',
        marginLeft: 10,
        fontSize: 14,
        letterSpacing: 0.5,
    },
});