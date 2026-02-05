# 🧪 QUICK TESTING CHECKLIST

## ✅ DebugOverlay Test (2 minutes)

1. **Open Debug Panel:**
   - Start interview
   - 3-finger tap or press debug button

2. **Test Close Methods:**
   ```
   ✓ Click X button → Closes?        [ ]
   ✓ Click dark area → Closes?       [ ]
   ✓ Click white panel → Stays open? [ ]
   ✓ (Android) Back button → Closes? [ ]
   ```

3. **Pass Criteria:** All 4 checkboxes ✓

---

## 🎤 Victoria "Thank You" Test (5-10 minutes)

1. **Start Fresh Interview:**
   - Clear any existing session
   - Open console/logs

2. **Answer Questions:**
   - Complete first question
   - Check console for: `🎤 [INTERVIEW STATE]`
   - Record values:
     ```
     Question 1: 
       Current Index: ___
       Next Index: ___
       Total Topics: ___
       Transition Mode: ___
     
     Question 2:
       Current Index: ___
       Next Index: ___
       Total Topics: ___
       Transition Mode: ___
     ```

3. **If "Thank You" Appears Too Early:**
   - Screenshot console logs
   - Note which question number (Expected: ___, Got: ___)
   - Copy the full `🎤 [INTERVIEW STATE]` block

4. **Expected Behavior:**
   ```
   For 5-topic interview:
   Topic 1: Index 0 → 1 (NEXT_PASS/FAIL)
   Topic 2: Index 1 → 2 (NEXT_PASS/FAIL)
   Topic 3: Index 2 → 3 (NEXT_PASS/FAIL)
   Topic 4: Index 3 → 4 (NEXT_PASS/FAIL)
   Topic 5: Index 4 → 5 (FINISH_INTERVIEW) ✅
   ```

---

## 📤 Export Test (1 minute)

**Note:** Should already be working! Just verify:

1. Complete an interview
2. Click "Export History" or debug export button
3. Check:
   ```
   ✓ NO crash?                    [ ]
   ✓ Success message shown?       [ ]
   ✓ Data exported/shared?        [ ]
   ```

---

## 🐛 Bug Reporting Template

If issues found, report:

```markdown
**Issue:** [DebugOverlay / Victoria / Export]

**What Happened:**
[Describe behavior]

**Expected:**
[What should happen]

**Console Logs:**
[Paste relevant logs, especially 🎤 [INTERVIEW STATE] sections]

**Values When Bug Occurred:**
- Current Index: ___
- Next Index: ___
- Total Topics: ___
- Transition Mode: ___

**Steps to Reproduce:**
1. 
2. 
3. 
```

---

## 📊 PASS/FAIL Summary

- [ ] DebugOverlay: PASS / FAIL
- [ ] Victoria Flow: PASS / FAIL / NEEDS MORE TESTING
- [ ] Export: PASS / FAIL

**Overall Result:** _______________

**Date Tested:** _______________
