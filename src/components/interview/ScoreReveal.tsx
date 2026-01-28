import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Mask, Rect } from 'react-native-svg';
import AnimatedReanimated, { useSharedValue, useAnimatedProps, withTiming, withDelay, Easing, runOnJS, withRepeat } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

// Animated SVG Components
const AnimatedPath = AnimatedReanimated.createAnimatedComponent(Path);

interface ScoreRevealProps {
    score: number;
    summary: string;
    loading: boolean;
    onReturnToMenu?: () => void;
    onShowResults?: () => void;
}

export const ScoreReveal = React.memo(({ score, summary, loading, onReturnToMenu, onShowResults }: ScoreRevealProps) => {
    const progress = useSharedValue(0);
    const [showButton, setShowButton] = useState(false);
    const [displayScore, setDisplayScore] = useState("0.0");
    const [isRevealed, setIsRevealed] = useState(false);
    const [displaySummary, setDisplaySummary] = useState("");
    const animationStartedRef = useRef(false);
    const scrambleIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Scramble Effect - runs continuously until revealed
    useEffect(() => {
        scrambleIntervalRef.current = setInterval(() => {
            if (!isRevealed) {
                setDisplayScore((Math.random() * 10).toFixed(1));
            }
        }, 50);

        return () => {
            if (scrambleIntervalRef.current) {
                clearInterval(scrambleIntervalRef.current);
            }
        };
    }, [isRevealed]);

    // Main Animation - only runs ONCE when loading becomes false
    useEffect(() => {
        if (!loading && !animationStartedRef.current) {
            animationStartedRef.current = true;
            console.log("🎰 [ScoreReveal] Starting casino animation...");

            // Start Arc Animation
            progress.value = withTiming(1, {
                duration: 4000,
                easing: Easing.bezier(0.4, 0, 0.2, 1)
            }, (finished) => {
                if (finished) {
                    runOnJS(setIsRevealed)(true);
                    runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
                    runOnJS(setDisplayScore)(score.toFixed(1));
                }
            });
        } else if (loading) {
            // Pulse/Breathe effect while loading
            progress.value = withRepeat(withTiming(0.2, { duration: 1000 }), -1, true);
        }
    }, [loading, score]);

    // Typewriter effect for summary
    useEffect(() => {
        if (isRevealed && summary) {
            let index = 0;
            const typeInterval = setInterval(() => {
                if (index <= summary.length) {
                    setDisplaySummary(summary.substring(0, index));
                    index++;
                } else {
                    clearInterval(typeInterval);
                    // Show button after typewriter completes
                    setTimeout(() => setShowButton(true), 500);
                }
            }, 30);
            return () => clearInterval(typeInterval);
        }
    }, [isRevealed, summary]);

    const animatedProps = useAnimatedProps(() => {
        const radius = 120;
        const circumference = Math.PI * radius; // Semi-circle
        const effectiveScore = loading ? 10 : score;
        const strokeDashoffset = circumference * (1 - progress.value * (effectiveScore / 10));
        return {
            strokeDashoffset,
        };
    });

    return (
        <View style={styles.revealContainer}>
            <View style={styles.gaugeContainer}>
                <Svg width={300} height={160} viewBox="0 0 300 160">
                    <Defs>
                        <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="#EF4444" stopOpacity="1" />
                            <Stop offset="0.5" stopColor="#F59E0B" stopOpacity="1" />
                            <Stop offset="1" stopColor="#10B981" stopOpacity="1" />
                        </LinearGradient>
                        <Mask id="mask">
                            <AnimatedPath
                                d="M 30 150 A 120 120 0 0 1 270 150"
                                stroke="white"
                                strokeWidth="20"
                                fill="none"
                                strokeDasharray={`${Math.PI * 120}`}
                                animatedProps={animatedProps}
                                strokeLinecap="round"
                            />
                        </Mask>
                    </Defs>

                    {/* Background Track */}
                    <Path
                        d="M 30 150 A 120 120 0 0 1 270 150"
                        stroke="#333"
                        strokeWidth="20"
                        fill="none"
                        strokeLinecap="round"
                    />

                    {/* Gradient Fill with Mask */}
                    <Rect
                        x="0"
                        y="0"
                        width="300"
                        height="160"
                        fill="url(#grad)"
                        mask="url(#mask)"
                    />
                </Svg>

                {/* Score Text */}
                <View style={styles.scoreTextContainer}>
                    <Text style={[
                        styles.scoreText,
                        isRevealed && { color: score >= 8 ? "#10B981" : score >= 5 ? "#F59E0B" : "#EF4444", transform: [{ scale: 1.2 }] }
                    ]}>
                        {displayScore}
                    </Text>
                    <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
                </View>
            </View>

            {isRevealed && (
                <View style={styles.summaryContainer}>
                    <Text style={styles.summaryText}>{displaySummary}<Text style={{ opacity: displaySummary.length < summary.length ? 1 : 0 }}>|</Text></Text>
                </View>
            )}

            {showButton && (
                <AnimatedReanimated.View style={styles.resultButtonContainer}>
                    <TouchableOpacity 
                        style={styles.resultButton} 
                        onPress={onShowResults || onReturnToMenu || (() => {})}
                    >
                        <Text style={styles.resultButtonText}>CHECK YOUR RESULTS</Text>
                        <Ionicons name="arrow-forward" size={20} color="#000" />
                    </TouchableOpacity>
                </AnimatedReanimated.View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    revealContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000',
        width: '100%',
    },
    gaugeContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        marginBottom: 20,
    },
    scoreTextContainer: {
        position: 'absolute',
        top: 80,
        alignItems: 'center',
    },
    scoreText: {
        fontSize: 48,
        fontWeight: '900',
        color: '#FFF',
        fontVariant: ['tabular-nums'],
    },
    scoreLabel: {
        fontSize: 12,
        color: '#666',
        letterSpacing: 2,
        marginTop: 5,
        fontWeight: 'bold',
    },
    summaryContainer: {
        paddingHorizontal: 30,
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 40,
        minHeight: 100,
    },
    summaryText: {
        color: '#CCC',
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    resultButtonContainer: {
        width: '100%',
        alignItems: 'center',
        position: 'absolute',
        bottom: 50,
    },
    resultButton: {
        flexDirection: 'row',
        backgroundColor: '#FFF',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 30,
        alignItems: 'center',
        shadowColor: '#FFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 5,
    },
    resultButtonText: {
        color: '#000',
        fontWeight: 'bold',
        fontSize: 16,
        marginRight: 10,
        letterSpacing: 1,
    },
});