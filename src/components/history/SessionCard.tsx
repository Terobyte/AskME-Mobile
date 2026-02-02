/**
 * SessionCard - Reusable session card for history list
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { InterviewSession } from '../../services/history-storage';

interface SessionCardProps {
    session: InterviewSession;
    onPress: () => void;
    onDelete: () => void;
}

// Traffic light colors for scores
const getScoreColor = (score: number): string => {
    if (score >= 8) return '#10B981'; // Green
    if (score >= 5) return '#F59E0B'; // Yellow/Orange
    return '#EF4444'; // Red
};

export const SessionCard: React.FC<SessionCardProps> = ({ session, onPress, onDelete }) => {
    const scoreColor = getScoreColor(session.totalScore);

    const handleDelete = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onDelete();
    };

    const handlePress = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
    };

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            <View style={styles.content}>
                {/* Role icon */}
                <View style={styles.iconContainer}>
                    <Ionicons name="briefcase-outline" size={20} color="#666" />
                </View>

                {/* Role and date */}
                <View style={styles.textContainer}>
                    <Text style={styles.roleText} numberOfLines={1}>
                        {session.role}
                    </Text>
                    <Text style={styles.dateText}>{session.date}</Text>
                </View>

                {/* Score badge */}
                <View style={[styles.scoreBadge, { backgroundColor: scoreColor }]}>
                    <Text style={styles.scoreText}>{session.totalScore.toFixed(1)}</Text>
                </View>

                {/* Delete button */}
                <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={handleDelete}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        borderRadius: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 2,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    iconContainer: {
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
        marginRight: 12,
    },
    roleText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    dateText: {
        fontSize: 12,
        color: '#666',
    },
    scoreBadge: {
        width: 48,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    scoreText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#FFF',
    },
    deleteButton: {
        padding: 4,
    },
});