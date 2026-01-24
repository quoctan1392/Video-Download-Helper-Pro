# Chiến lược Testing cho Refactor - ĐẢM BẢO KHÔNG LỖI

## 🎯 MỤC TIÊU: ZERO REGRESSION

**Nguyên tắc vàng**: Mọi tính năng hoạt động TRƯỚC refactor phải hoạt động GIỐNG HỆT SAU refactor

---

## 📋 CHECKLIST TESTING CHI TIẾT

### ✅ Phase 0: BASELINE - Trước khi Refactor

#### 1. Document Current Behavior (Ghi lại hiện trạng)

```bash
# Tạo file test log
echo "=== BASELINE TEST - $(Get-Date) ===" > test-baseline.log
```

**Test từng tính năng và GHI KẾT QUẢ**:

##### A. YouTube MSE Download
- [ ] Navigate to YouTube video (e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ)
- [ ] Wait 3 seconds for detection
- [ ] Click Download button in popup
- [ ] **Verify**: Progress bar shows (size, speed, segments)
- [ ] **Verify**: Video downloads completely (check file size)
- [ ] **Verify**: No missing chunks (play downloaded file, seek to end)
- [ ] **Verify**: Downloaded badge shows after completion
- [ ] **Record**: File size, duration, segments count

##### B. DASH Detection
- [ ] Navigate to site with DASH (e.g., Vimeo)
- [ ] **Verify**: Manifest detected in popup
- [ ] **Verify**: Format shows "DASH"
- [ ] **Record**: Manifest URL pattern

##### C. HLS Detection
- [ ] Navigate to site with HLS (e.g., Twitter video)
- [ ] **Verify**: Manifest detected (.m3u8)
- [ ] **Verify**: Format shows "HLS"
- [ ] **Record**: Manifest URL pattern

##### D. MPD Detection
- [ ] Navigate to site with MPD
- [ ] **Verify**: Manifest detected (.mpd)
- [ ] **Verify**: Format shows "MPD"
- [ ] **Record**: Manifest URL pattern

##### E. YouTube Navigation Detection
- [ ] Go to YouTube homepage
- [ ] Click on a video
- [ ] **Verify**: Detection updates automatically
- [ ] Navigate to another video
- [ ] **Verify**: Old data cleared, new video detected
- [ ] **Record**: Detection timing (~3 seconds max)

##### F. YouTube API Interception
- [ ] Open DevTools → Network tab
- [ ] Play YouTube video
- [ ] Filter: `youtubei/v1/player`
- [ ] **Verify**: Request intercepted (check console logs)
- [ ] **Record**: API response captured

##### G. Popup UI State
- [ ] Close and reopen popup
- [ ] **Verify**: State persists
- [ ] Reload page
- [ ] **Verify**: Detection re-runs
- [ ] **Record**: State behavior

**➡️ SAVE BASELINE**: Copy all verified behaviors to `test-baseline.log`

---

### ✅ Phase 1-4: DURING Refactor - Test Từng Phase

**Quy tắc**: SAU MỖI PHASE, chạy full test suite

#### After Phase 1 (Core structure)
```bash
# Test xem core modules load được không
1. Check console errors - should be ZERO
2. Check injected scripts loaded - DevTools → Sources
3. Test message bus - send test message
```

- [ ] No console errors
- [ ] All files loaded correctly
- [ ] Message routing works

#### After Phase 2 (YouTube components)
**CRITICAL - Test YouTube đầu tiên vì đây là component lớn nhất**

Run full YouTube test suite (A + E + F từ baseline):
- [ ] YouTube MSE download works
- [ ] Navigation detection works
- [ ] API interception works
- [ ] File size matches baseline
- [ ] No missing chunks
- [ ] Progress bar identical

**⚠️ Nếu CÓ LỖI**: Stop, fix ngay, test lại trước khi tiếp Phase 3

#### After Phase 3 (DASH/HLS/MPD)
Run detection tests (B + C + D từ baseline):
- [ ] DASH detection works
- [ ] HLS detection works
- [ ] MPD detection works
- [ ] Manifest URLs match baseline

#### After Phase 4 (Integration)
**FULL REGRESSION TEST** - Chạy TẤT CẢ tests từ A → G:
- [ ] All YouTube features work
- [ ] All detection features work
- [ ] All UI features work
- [ ] Performance same/better than baseline

---

### ✅ Phase 5: FINAL VALIDATION - Sau Refactor

#### 1. Side-by-Side Comparison

**Setup**:
```bash
# Keep old injected.js as backup
cp injected.js injected.js.backup

# Test with old version
git stash  # Hide new code
# Test all features → Record results

# Test with new version
git stash pop
# Test all features → Compare results
```

**Compare**:
- [ ] File sizes identical (±1%)
- [ ] Download speed identical (±5%)
- [ ] Detection timing identical (±0.5s)
- [ ] No new console errors
- [ ] No new warnings

#### 2. Cross-Browser Testing (Optional but recommended)

Test on multiple Chrome profiles:
- [ ] Fresh profile (no extensions)
- [ ] Profile with other extensions
- [ ] Incognito mode

#### 3. Edge Cases Testing

Test unusual scenarios:
- [ ] YouTube video with age restriction
- [ ] YouTube live stream
- [ ] YouTube private video (should fail gracefully)
- [ ] Very long video (>2 hours)
- [ ] Very short video (<30s)
- [ ] Multiple tabs with different videos
- [ ] Rapid navigation (click videos quickly)
- [ ] Slow internet (throttle in DevTools)

#### 4. Performance Testing

```javascript
// Add to console
console.time('Detection time');
// Navigate to YouTube video
// Wait for detection
console.timeEnd('Detection time');
// Should be < 3 seconds
```

- [ ] Detection time < 3s
- [ ] Memory usage < 50MB
- [ ] No memory leaks (close/open popup 10 times)
- [ ] CPU usage normal

#### 5. Error Handling Testing

Intentionally cause errors:
- [ ] Block YouTube API → Should fallback gracefully
- [ ] Disable internet mid-download → Should show error
- [ ] Invalid manifest URL → Should not crash
- [ ] Corrupted video data → Should handle gracefully

---

## 🔧 AUTOMATED TESTING TOOLS

### Option 1: Manual Test Script (Quick)

Tạo file `test-runner.js`:
```javascript
// Run in DevTools Console
const tests = {
  async testYouTubeDetection() {
    console.log('Testing YouTube detection...');
    // Simulate navigation
    window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    await new Promise(r => setTimeout(r, 3000));
    // Check detection
    const detected = !!document.querySelector('[data-video-detected]');
    console.log(detected ? '✅ PASS' : '❌ FAIL');
    return detected;
  },
  
  async testManifestDetection() {
    // Check if detectedManifests has entries
    const hasManifests = window.detectedManifests?.size > 0;
    console.log(hasManifests ? '✅ PASS' : '❌ FAIL');
    return hasManifests;
  }
};

// Run all tests
async function runTests() {
  const results = {};
  for (const [name, test] of Object.entries(tests)) {
    results[name] = await test();
  }
  console.table(results);
}
```

### Option 2: Chrome Extension Testing (Advanced)

Create `test/e2e-test.js`:
```javascript
// Puppeteer-based E2E tests
const puppeteer = require('puppeteer');

describe('Extension E2E Tests', () => {
  let browser, page;
  
  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${__dirname}`,
        `--load-extension=${__dirname}`
      ]
    });
    page = await browser.newPage();
  });
  
  test('YouTube video detection', async () => {
    await page.goto('https://www.youtube.com/watch?v=test');
    await page.waitForTimeout(3000);
    
    // Check if extension detected video
    const detected = await page.evaluate(() => {
      return !!window.detectedVideos;
    });
    
    expect(detected).toBe(true);
  });
  
  afterAll(() => browser.close());
});
```

### Option 3: Console Monitoring (Simplest)

```javascript
// Add to background.js during testing
const testLog = [];

// Wrap all critical functions
const originalDetect = detectVideo;
detectVideo = function(...args) {
  testLog.push({ fn: 'detectVideo', args, time: Date.now() });
  return originalDetect.apply(this, args);
};

// Export log
window.getTestLog = () => testLog;
```

---

## 🚨 ROLLBACK TRIGGERS

**Rollback NGAY LẬP TỨC nếu**:

### Critical Issues (P0)
- [ ] Extension crashes/không load được
- [ ] YouTube download hoàn toàn không hoạt động
- [ ] Manifest detection hoàn toàn không hoạt động
- [ ] Console errors liên tục
- [ ] Memory leak nghiêm trọng (>200MB)

### Major Issues (P1) - Rollback trong 1 giờ
- [ ] Download thiếu >10% video
- [ ] Detection time >10 seconds
- [ ] Progress bar không hiển thị
- [ ] Downloaded badge không hiện

### Minor Issues (P2) - Fix trong 1 ngày
- [ ] Console warnings
- [ ] UI glitches nhỏ
- [ ] Performance giảm <10%

---

## 📊 TEST MATRIX

| Feature | Before | After Phase 2 | After Phase 3 | After Phase 4 | Final |
|---------|--------|---------------|---------------|---------------|-------|
| YouTube MSE Download | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| YouTube Navigation | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| DASH Detection | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| HLS Detection | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| MPD Detection | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| Progress Bar | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| Downloaded Badge | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |
| API Interception | ✅ | ⏳ | ⏳ | ⏳ | ⏳ |

**Update mỗi phase**: ✅ Pass | ❌ Fail | ⏳ Not tested yet

---

## 🎯 ACCEPTANCE CRITERIA

Refactor chỉ được coi là THÀNH CÔNG khi:

### Functional Requirements
- [x] 100% features hoạt động như cũ
- [x] 0 regressions
- [x] All edge cases handled
- [x] Error handling maintained

### Performance Requirements
- [x] Detection time ≤ baseline (+0%)
- [x] Download speed ≥ baseline (-0%)
- [x] Memory usage ≤ baseline (+10% acceptable)
- [x] CPU usage ≤ baseline (+5% acceptable)

### Code Quality Requirements
- [x] No console errors
- [x] No console warnings (or explain why acceptable)
- [x] All files < 500 lines
- [x] Clear separation of concerns

### Documentation Requirements
- [x] Architecture documented
- [x] Each module has header comment
- [x] Message flow documented
- [x] Testing results logged

---

## 📝 TEST EXECUTION PLAN

### Day 1: Baseline Testing
**Time**: 2 hours
- [ ] Run full baseline tests
- [ ] Document all results
- [ ] Create `test-baseline.log`
- [ ] Take screenshots of working features

### Day 2-3: Incremental Testing
**Time**: 6-8 hours
- [ ] Phase 1 → Test → Document
- [ ] Phase 2 → Test → Document
- [ ] Phase 3 → Test → Document
- [ ] Phase 4 → Test → Document

### Day 4: Final Validation
**Time**: 3 hours
- [ ] Side-by-side comparison
- [ ] Edge case testing
- [ ] Performance testing
- [ ] Sign-off or rollback decision

---

## 🔐 SAFETY MEASURES

### 1. Git Safety Net
```bash
# Before starting
git checkout -b refactor-injected-js
git commit -am "Baseline before refactor"
git tag baseline-before-refactor

# Each phase
git commit -am "Phase X completed"
git tag phase-X-done

# Quick rollback
git reset --hard baseline-before-refactor
```

### 2. Feature Flags (Advanced)
```javascript
// Add to manifest or background.js
const FEATURE_FLAGS = {
  USE_NEW_ARCHITECTURE: false  // Toggle để switch giữa old/new
};

if (FEATURE_FLAGS.USE_NEW_ARCHITECTURE) {
  // Load new modules
} else {
  // Load old injected.js
}
```

### 3. A/B Testing (Pro)
```javascript
// 50% users get new code, 50% get old code
const useNewCode = Math.random() > 0.5;
chrome.storage.local.set({ useNewArchitecture: useNewCode });
```

### 4. Monitoring
```javascript
// Log errors to background
window.addEventListener('error', (e) => {
  chrome.runtime.sendMessage({
    type: 'ERROR_REPORT',
    error: e.message,
    stack: e.error?.stack,
    version: 'refactored'
  });
});
```

---

## ✅ FINAL CHECKLIST - Sign Off

Trước khi merge refactor vào main branch:

- [ ] All baseline tests PASS
- [ ] All phase tests PASS
- [ ] No regressions found
- [ ] Performance meets criteria
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] Test log saved
- [ ] Rollback plan ready
- [ ] Backup created
- [ ] Team informed (if applicable)

**Signed off by**: _______________ Date: _______________

---

## 🎉 SUCCESS CRITERIA

Refactor thành công = **Zero user complaints** trong 7 ngày đầu sau release

Track metrics:
- Extension errors (Chrome Web Store dashboard)
- User reports
- Download success rate
- Performance metrics

**If zero issues after 7 days → Delete old `injected.js.backup` ✅**

---

## TÓM TẮT NGẮN GỌN

### Làm thế nào đảm bảo không lỗi?

1. **Test trước** → Ghi baseline
2. **Test mỗi phase** → Fix ngay nếu lỗi
3. **Test sau** → So sánh với baseline
4. **Test edge cases** → Đảm bảo robust
5. **Keep backup** → Rollback dễ dàng
6. **Monitor production** → Catch issues sớm

**Nếu làm đủ 6 bước trên → 99% không có lỗi nghiêm trọng! 🎯**
