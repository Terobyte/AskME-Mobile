import React, { useEffect } from 'react';
import { StyleSheet, View, Text, Image } from 'react-native';
import { useTypewriter } from '../hooks/useTypewriter';

interface MessageBubbleProps {
    role: 'user' | 'ai';
    text: string;
    avatar?: string;
    isLatestAi?: boolean; // Trigger for typewriter
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ role, text, avatar, isLatestAi }) => {
    // Only apply typewriter if it's the latest AI message. 
    // Otherwise show full text immediately (history).
    const displayText = isLatestAi ? useTypewriter(text, 30) : text;

    return (
        <View style={[
            styles.bubbleContainer, 
            role === 'user' ? styles.rowRight : styles.rowLeft
        ]}>
            {role === 'ai' && avatar && <Image source={{uri: avatar}} style={styles.avatar} />}
            
            <View style={[
                styles.bubble, 
                role === 'user' ? styles.userBubble : styles.aiBubble
            ]}>
                <Text style={[
                    styles.text, 
                    role === 'user' ? styles.userText : styles.aiText
                ]}>
                    {displayText}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    bubbleContainer: {
        flexDirection: 'row',
        marginBottom: 16,
        maxWidth: '85%',
    },
    rowLeft: {
        alignSelf: 'flex-start',
    },
    rowRight: {
        alignSelf: 'flex-end',
        justifyContent: 'flex-end',
    },
    bubble: {
        padding: 12,
        borderRadius: 16,
    },
    userBubble: {
        backgroundColor: '#10B981',
        borderBottomRightRadius: 4,
    },
    aiBubble: {
        backgroundColor: '#E5E7EB',
        borderBottomLeftRadius: 4,
    },
    text: {
        fontSize: 16,
        lineHeight: 24,
    },
    userText: {
        color: '#FFF',
    },
    aiText: {
        color: '#1F2937',
    },
    avatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        marginRight: 8,
    },
});
