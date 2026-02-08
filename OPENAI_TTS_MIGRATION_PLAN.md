# OpenAI TTS Migration Plan
## From TestAudioStreamPage to Control Center (VoiceInterviewScreen)

---

## Context

**Why this change?**
- `TestAudioStreamPage.tsx` has a fully working OpenAI TTS implementation with 13 voices and instructions
- `VoiceInterviewScreen.tsx` (Control Center) only has 6 voices and NO instructions UI
- We need to migrate the complete OpenAI TTS experience to the main app

**Current State:**
| Feature | TestAudioStreamPage | VoiceInterviewScreen |
|---------|---------------------|----------------------|
| OpenAI Voices | 13 (marin/cedar ⭐ best) | 6 (nova default) |
| Instructions UI | ✅ Full (6 presets + custom) | ❌ Not implemented |
| Instructions passed to player | ✅ Yes | ❌ No |
| Settings persistence | ❌ Local state only | ✅ AsyncStorage |

**Target State:**
- All 13 OpenAI voices available in Control Center
- Instructions UI with presets + custom input
- Instructions passed through to OpenAIStreamingPlayer
- Settings saved to AsyncStorage

---

## Implementation Plan

### Phase 1: Type Definitions
**File:** `src/types.ts`

Add to `TTSProvider` section (around line 180+):

```typescript
// Already exists - verify completeness:
export type OpenAIVoice =
  | 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable'
  | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse'
  | 'marin' | 'cedar';  // ⭐ Best quality voices
```

No changes needed - types already include all 13 voices.

---

### Phase 2: TTS Service Updates
**File:** `src/services/tts-service.ts`

#### 2.1 Add instructions state (line ~32)

```typescript
private openaiInstructions: string = '';  // NEW
```

#### 2.2 Add getter/setter (after line ~142)

```typescript
setOpenaiInstructions(instructions: string): void {
  this.openaiInstructions = instructions;
  console.log(`🎙️ [TTS] OpenAI instructions: "${instructions}"`);
  this.saveSettings();
}

getOpenaiInstructions(): string {
  return this.openaiInstructions;
}
```

#### 2.3 Update speakOpenAIStreaming() (line 709)

**FROM:**
```typescript
await player.speak(text, {
  voiceId: this.openaiVoice,
  speed: options?.speed,
});
```

**TO:**
```typescript
await player.speak(text, {
  voiceId: this.openaiVoice,
  speed: options?.speed,
  instructions: this.openaiInstructions || undefined,  // NEW
});
```

#### 2.4 Update saveSettings() (line ~170)

Add to settings object:
```typescript
{
  // ... existing
  openaiInstructions: this.openaiInstructions,
}
```

#### 2.5 Update loadSettings() (line ~183)

Add to loading:
```typescript
this.openaiInstructions = settings.openaiInstructions || '';
```

---

### Phase 3: VoiceInterviewScreen UI Updates
**File:** `src/screens/VoiceInterviewScreen.tsx`

#### 3.1 Add state (line ~72)

```typescript
const [openaiInstructions, setOpenaiInstructions] = useState<string>('');
```

#### 3.2 Add instruction presets (after line ~75)

```typescript
const openaiInstructionPresets = [
  { label: 'Default', value: '' },
  { label: 'Cheerful', value: 'Speak in a cheerful and positive tone.' },
  { label: 'Calm', value: 'Speak in a calm, soothing voice.' },
  { label: 'Whisper', value: 'Whisper softly.' },
  { label: 'Excited', value: 'Sound excited and energetic!' },
  { label: 'Professional', value: 'Speak in a professional, business-like tone.' },
  { label: 'Storyteller', value: 'Speak like a storyteller, with dramatic pauses.' },
];
```

#### 3.3 Add handler (after line ~257)

```typescript
const handleOpenaiInstructionsChange = (instructions: string) => {
  setOpenaiInstructions(instructions);
  TTSService.setOpenaiInstructions(instructions);
};
```

#### 3.4 Update voice chip array (line 589-595)

**FROM:**
```typescript
{[
  { id: 'nova' as OpenAIVoice, label: 'Nova (F)' },
  { id: 'alloy' as OpenAIVoice, label: 'Alloy (M/F)' },
  { id: 'echo' as OpenAIVoice, label: 'Echo (M)' },
  { id: 'fable' as OpenAIVoice, label: 'Fable (M-BR)' },
  { id: 'onyx' as OpenAIVoice, label: 'Onyx (M-D)' },
  { id: 'shimmer' as OpenAIVoice, label: 'Shimmer (F)' ]}
```

**TO:**
```typescript
{[
  { id: 'alloy' as OpenAIVoice, label: 'Alloy' },
  { id: 'ash' as OpenAIVoice, label: 'Ash' },
  { id: 'ballad' as OpenAIVoice, label: 'Ballad' },
  { id: 'coral' as OpenAIVoice, label: 'Coral' },
  { id: 'echo' as OpenAIVoice, label: 'Echo (M)' },
  { id: 'fable' as OpenAIVoice, label: 'Fable (BR)' },
  { id: 'nova' as OpenAIVoice, label: 'Nova (F)' },
  { id: 'onyx' as OpenAIVoice, label: 'Onyx (M)' },
  { id: 'sage' as OpenAIVoice, label: 'Sage' },
  { id: 'shimmer' as OpenAIVoice, label: 'Shimmer (F)' },
  { id: 'verse' as OpenAIVoice, label: 'Verse' },
  { id: 'marin' as OpenAIVoice, label: 'Marin ⭐' },
  { id: 'cedar' as OpenAIVoice, label: 'Cedar ⭐' },
]}
```

#### 3.5 Add Instructions UI (after line 614)

Insert after the voice chips ScrollView:

```tsx
{/* OpenAI Instructions */}
{ttsProvider === 'openai' && (
  <View style={styles.openaiInstructionsContainer}>
    <Text style={styles.sectionSubtitle}>Voice Style</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {openaiInstructionPresets.map((preset) => (
        <TouchableOpacity
          key={preset.label}
          style={[
            styles.voiceChip,
            openaiInstructions === preset.value && styles.voiceChipActive
          ]}
          onPress={() => handleOpenaiInstructionsChange(preset.value)}
        >
          <Text style={[
            styles.voiceChipText,
            openaiInstructions === preset.value && styles.voiceChipTextActive
          ]}>
            {preset.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>

    {/* Custom input when not using preset */}
    {openaiInstructions && !openaiInstructionPresets.find(p => p.value === openaiInstructions) && (
      <TextInput
        style={styles.customInstructionsInput}
        placeholder="Custom instructions..."
        placeholderTextColor="#6B7280"
        value={openaiInstructions}
        onChangeText={handleOpenaiInstructionsChange}
        multiline
      />
    )}
  </View>
)}
```

#### 3.6 Add styles (bottom of file)

```typescript
openaiInstructionsContainer: {
  marginTop: 15,
},
customInstructionsInput: {
  backgroundColor: '#F5F5F5',
  borderRadius: 8,
  padding: 12,
  marginTop: 10,
  fontSize: 14,
  color: '#000',
  minHeight: 60,
},
```

#### 3.7 Load settings on modal open (line ~215)

```typescript
setOpenaiInstructions(TTSService.getOpenaiInstructions());
```

---

### Phase 4: Optional - Default Voice Change
**File:** `src/services/tts-service.ts` (line ~29)

Change default voice to best quality:
```typescript
private openaiVoice: OpenAIVoice = 'marin';  // Was 'nova'
```

---

## Testing Plan

### Manual Testing Checklist

#### 1. Voice Selection (All 13 Voices)
- [ ] Alloy - Balanced
- [ ] Ash - Soft, calm
- [ ] Ballad - Expressive
- [ ] Coral - Cheerful
- [ ] Echo - Male, soft
- [ ] Fable - Male, British
- [ ] Nova - Female, friendly
- [ ] Onyx - Male, deep
- [ ] Sage - Warm, storyteller
- [ ] Shimmer - Female, soft
- [ ] Verse - Energetic
- [ ] Marin - Best quality ⭐
- [ ] Cedar - Best quality ⭐

#### 2. Instructions Presets
- [ ] Default (no instructions)
- [ ] Cheerful - "Speak in a cheerful and positive tone."
- [ ] Calm - "Speak in a calm, soothing voice."
- [ ] Whisper - "Whisper softly."
- [ ] Excited - "Sound excited and energetic!"
- [ ] Professional - "Speak in a professional, business-like tone."
- [ ] Storyteller - "Speak like a storyteller, with dramatic pauses."

#### 3. Custom Instructions
- [ ] Type custom instruction in text input
- [ ] Verify it's applied to speech

#### 4. Settings Persistence
- [ ] Change voice
- [ ] Change instructions
- [ ] Close and reopen Control Center
- [ ] Verify settings are saved

#### 5. Provider Switching
- [ ] OpenAI → Cartesia → OpenAI (voice preserved)
- [ ] OpenAI → Deepgram → OpenAI (voice preserved)

#### 6. Interview Flow
- [ ] Start interview with OpenAI + marin + Cheerful
- [ ] Verify Victoria speaks with correct voice
- [ ] Verify instructions affect delivery

---

## Critical Files to Modify

| File | Lines | Changes |
|------|-------|---------|
| `src/services/tts-service.ts` | ~32, ~142, ~709, ~170, ~183 | Add instructions state, getter/setter, pass to player |
| `src/screens/VoiceInterviewScreen.tsx` | ~72, ~75, ~257, ~589-614, ~215 | Add state, presets, handler, UI, load settings |
| `src/types.ts` | ~180 | Verify all 13 voices defined (already exists) |

---

## Success Criteria

1. ✅ All 13 OpenAI voices visible and selectable in Control Center
2. ✅ Instructions UI appears when OpenAI is selected
3. ✅ All 7 instruction presets work correctly
4. ✅ Custom instructions input works
5. ✅ Settings persist across app restarts
6. ✅ Interview uses correct voice and instructions
7. ✅ No console errors during playback

---

## Implementation Order

1. **tts-service.ts** - Add backend support for instructions
2. **VoiceInterviewScreen.tsx** - Add UI for voices and instructions
3. **Test** - Verify all functionality works
4. **Commit** - Create focused commit with changes

---

## Notes

- **No changes needed** to `OpenAIStreamingPlayer.ts` - already supports instructions
- **No changes needed** to `openai-streaming-service.ts` - already supports instructions
- **Marin/Cedar** are marked with ⭐ as best quality (consistent with TestAudioStreamPage)
- **Instructions** only work with `gpt-4o-mini-tts` model (already default)
