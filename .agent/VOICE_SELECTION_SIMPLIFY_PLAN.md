# Voice Selection Simplification Plan
## Reduce UI to single voices per provider

---

## Context

Simplify TTS voice selection UI by showing only one voice per provider:
- **OpenAI**: Only "Marin" (best quality)
- **OpenAI Instructions**: Only "Professional"
- **Deepgram**: Only "Thalia" (energetic, enthusiastic)

---

## Implementation

### 1. VoiceInterviewScreen.tsx - OpenAI Voices

**Location:** Lines 599-612

**FROM:** 13 voices
```typescript
{[
    { id: 'alloy' as OpenAIVoice, label: 'Alloy' },
    { id: 'ash' as OpenAIVoice, label: 'Ash' },
    // ... 11 more voices
].map(...)}
```

**TO:** Single voice, no ScrollView needed
```tsx
{ttsProvider === 'openai' && (
    <View style={styles.openaiVoicesContainer}>
        <Text style={styles.sectionSubtitle}>Voice: Marin</Text>
        <View style={styles.singleVoiceChip}>
            <Text style={styles.singleVoiceText}>Marin ⭐</Text>
        </View>
    </View>
)}
```

### 2. VoiceInterviewScreen.tsx - OpenAI Instructions

**Location:** Lines 639-678

**FROM:** 7 presets with ScrollView
```typescript
{[
    { label: 'Default', value: '' },
    { label: 'Cheerful', value: '...' },
    // ... 5 more presets
].map(...)}
```

**TO:** Single preset, no selection UI
```tsx
{ttsProvider === 'openai' && (
    <View style={styles.openaiInstructionsContainer}>
        <Text style={styles.sectionSubtitle}>Style: Professional</Text>
        <View style={styles.singleVoiceChip}>
            <Text style={styles.singleVoiceText}>Professional</Text>
        </View>
    </View>
)}
```

### 3. VoiceInterviewScreen.tsx - Deepgram Voices

**Location:** Lines 684-691

**FROM:** 6 voices
```typescript
{[
    { id: 'aura-2-thalia-en' as DeepgramVoice, label: 'Thalia (F)', description: 'Energetic' },
    // ... 5 more voices
].map(...)}
```

**TO:** Single voice
```tsx
{ttsProvider === 'deepgram' && (
    <View style={styles.deepgramVoicesContainer}>
        <Text style={styles.sectionSubtitle}>Voice: Thalia</Text>
        <View style={styles.singleVoiceChip}>
            <Text style={styles.singleVoiceText}>Thalia (F)</Text>
            <Text style={styles.singleVoiceSubtext}>Energetic</Text>
        </View>
    </View>
)}
```

### 4. tts-service.ts - Set Default Values

**Location:** Lines 29, 31

```typescript
private openaiVoice: OpenAIVoice = 'marin';  // Already marin
private openaiInstructions: string = 'Speak in a professional, business-like tone.';  // NEW
```

### 5. Add New Styles

**Location:** End of styles object

```typescript
singleVoiceChip: {
  backgroundColor: '#F0F0F0',
  borderRadius: 20,
  paddingVertical: 10,
  paddingHorizontal: 20,
  alignSelf: 'flex-start',
},
singleVoiceText: {
  fontSize: 15,
  fontWeight: '600',
  color: '#000',
},
singleVoiceSubtext: {
  fontSize: 12,
  color: '#666',
  marginTop: 2,
},
```

---

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/screens/VoiceInterviewScreen.tsx` | 595-631 | Remove OpenAI ScrollView, show single Marin |
| `src/screens/VoiceInterviewScreen.tsx` | 634-678 | Remove OpenAI instructions ScrollView, show single Professional |
| `src/screens/VoiceInterviewScreen.tsx` | 680-718 | Remove Deepgram ScrollView, show single Thalia |
| `src/screens/VoiceInterviewScreen.tsx` | ~1150 | Add new styles |
| `src/services/tts-service.ts` | 31 | Set default instructions to Professional |

---

## Testing

1. Open Control Center
2. Select OpenAI - should see "Voice: Marin" only
3. Select Deepgram - should see "Voice: Thalia" only
4. Verify no voice chips/ScrollViews
5. Test audio plays correctly with selected voices
