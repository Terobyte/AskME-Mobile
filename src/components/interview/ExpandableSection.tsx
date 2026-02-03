import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

interface ExpandableSectionProps {
    content: string;
    previewLines?: number;
    style?: any;
    textStyle?: any;
}

/**
 * ExpandableSection - Collapsible text component with "Read More" functionality
 * 
 * Shows a preview of text (default 2 lines) with a "Read More" button.
 * When expanded, shows full text with "Show Less" button.
 */
export function ExpandableSection({
    content,
    previewLines = 2,
    style,
    textStyle
}: ExpandableSectionProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpanded = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setIsExpanded(!isExpanded);
    };

    return (
        <View style={[styles.container, style]}>
            <Text
                style={[styles.text, textStyle]}
                numberOfLines={isExpanded ? undefined : previewLines}
            >
                {content}
            </Text>

            <TouchableOpacity
                onPress={toggleExpanded}
                style={styles.button}
                activeOpacity={0.7}
            >
                <Text style={styles.buttonText}>
                    {isExpanded ? 'Show Less' : 'Read More'}
                </Text>
                <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#007AFF"
                    style={styles.icon}
                />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        // Container styling can be overridden by parent
    },
    text: {
        fontSize: 15,
        color: '#333',
        lineHeight: 22,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        paddingVertical: 4,
    },
    buttonText: {
        fontSize: 14,
        color: '#007AFF',
        fontWeight: '600',
    },
    icon: {
        marginLeft: 4,
    },
});
