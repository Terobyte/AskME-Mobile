import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioState } from '../hooks/useInterviewAudio';

interface PushToTalkButtonProps {
    state: AudioState;
    onPress: () => void;
}

export const PushToTalkButton: React.FC<PushToTalkButtonProps> = ({ state, onPress }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (state === 'RECORDING') {
            // Pulse Animation
            Animated.loop(
                Animated.sequence([
                    Animated.timing(scaleAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(scaleAnim, {
                        toValue: 1.0,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            scaleAnim.setValue(1);
            scaleAnim.stopAnimation();
        }
    }, [state]);

    const getButtonContent = () => {
        switch (state) {
            case 'IDLE':
                return (
                    <>
                        <Ionicons name="mic" size={40} color="#FFFFFF" />
                        <Text style={styles.label}>Tap to Speak</Text>
                    </>
                );
            case 'RECORDING':
                return (
                    <>
                        <Ionicons name="stop" size={40} color="#FFFFFF" />
                        <Text style={styles.label}>Tap to Send</Text>
                    </>
                );
            case 'PROCESSING':
                return (
                    <>
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        <Text style={styles.label}>Thinking...</Text>
                    </>
                );
            case 'AI_SPEAKING':
                return (
                    <>
                        <Ionicons name="volume-high" size={40} color="#AAAAAA" />
                        <Text style={[styles.label, { color: '#AAAAAA' }]}>Listening...</Text>
                        <Ionicons name="lock-closed" size={16} color="#AAAAAA" style={styles.lockIcon} />
                    </>
                );
        }
    };

    const getBackgroundColor = () => {
        switch (state) {
            case 'IDLE': return '#10B981'; // Green
            case 'RECORDING': return '#EF4444'; // Red
            case 'PROCESSING': return '#3B82F6'; // Blue
            case 'AI_SPEAKING': return '#374151'; // Dark Grey
        }
    };

    return (
        <View style={styles.container}>
            <TouchableOpacity
                onPress={onPress}
                disabled={state === 'PROCESSING' || state === 'AI_SPEAKING'}
                activeOpacity={0.8}
            >
                <Animated.View style={[
                    styles.button,
                    { 
                        backgroundColor: getBackgroundColor(),
                        transform: [{ scale: scaleAnim }]
                    }
                ]}>
                    {getButtonContent()}
                </Animated.View>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 20,
    },
    button: {
        width: 160,
        height: 160,
        borderRadius: 80,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
    },
    label: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        marginTop: 8,
        fontSize: 16,
    },
    lockIcon: {
        position: 'absolute',
        top: 20,
        right: 20,
    }
});
