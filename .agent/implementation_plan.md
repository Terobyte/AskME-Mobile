# UI/UX Refactoring Implementation Plan

## Overview
Refactoring the mock interview app to fix critical data persistence bugs and improve UI organization.

## Priority 1: Critical Bugs

### ✅ Bug 1: History not saving on early termination
**Files to modify:**
- `src/screens/VoiceInterviewScreen.tsx` - Add history save to onInterviewComplete
- `src/hooks/interview/useInterviewLogic.ts` - Update forceFinish to generate real partial report
- `src/types/index.ts` - Add wasForceFinished flag to FinalInterviewReport

**Implementation:**
1. Import historyStorage in VoiceInterviewScreen
2. Update onInterviewComplete callback to call historyStorage.saveSession
3. Refactor forceFinish to use actual interview data instead of mock data
4. Add metadata flag to track termination reason

### ✅ Bug 2: Debug info cluttering results
**Files to modify:**
- `src/components/interview/ResultsModal.tsx` - Complete refactor with tabs
- Create `src/components/interview/ExpandableSection.tsx` - New component

**Implementation:**
1. Create ExpandableSection component (collapsible text with "Read More")
2. Add tab state management (Summary/Topics/Debug)
3. Refactor Summary tab: score card + stats grid + expandable AI summary
4. Refactor Topics tab: clean cards with score indicators, no debug data
5. Create Debug tab: all technical data (rawExchange, metrics, metadata)

### ✅ Bug 3: Overall Summary too long
**Covered by Bug 2** - ExpandableSection component solves this

## Priority 2: Medium Importance

### ✅ Bug 4: MetricsHud duplicates DebugOverlay
**Files to modify:**
- `src/screens/VoiceInterviewScreen.tsx` - Remove MetricsHud usage
- `src/components/interview/DebugOverlay.tsx` - Add Live Metrics section
- `src/components/MetricsHud.tsx` - Can be deleted after migration

**Implementation:**
1. Add new props to DebugOverlay: currentTopic, currentTopicIndex, topicSuccess, topicPatience, metrics
2. Create "📊 Live Metrics" section in DebugOverlay
3. Remove MetricsHud from VoiceInterviewScreen
4. Update DebugOverlay call with new props

## Execution Order
1. Create ExpandableSection component
2. Fix Bug 1 (History persistence)
3. Fix Bug 2 & 3 (ResultsModal refactor with tabs)
4. Fix Bug 4 (Remove MetricsHud, enhance DebugOverlay)

## Testing Checklist
- [ ] Force Finish saves to history with correct data
- [ ] Early termination (anger/patience) saves to history
- [ ] ResultsModal Summary tab shows clean, compact view
- [ ] ResultsModal Topics tab shows user-friendly cards
- [ ] ResultsModal Debug tab shows all technical data
- [ ] ExpandableSection works correctly
- [ ] DebugOverlay shows live metrics
- [ ] MetricsHud is completely removed
- [ ] No visual regressions in existing UI
