# Phân tích & Phương án Refactor injected.js

## 📊 PHÂN TÍCH HIỆN TRẠNG

### File Size & Structure
- **Kích thước**: 55,712 bytes
- **Số dòng**: 1,367 dòng code
- **Đánh giá**: ❌ QUÁ LỚN - khó maintain, dễ conflict, rủi ro cao

### Các Thành Phần Chính Hiện Tại

```
injected.js (1,367 dòng)
├─ MSE Chunk Capture (YouTube) - ~350 dòng
│  ├─ MediaSourceChunkCapture class
│  ├─ hookMediaSource()
│  ├─ forceLoadFullVideo()
│  └─ Chunk merging & download
│
├─ XMLHttpRequest Interceptor - ~150 dòng
│  ├─ Detect DASH/HLS/MPD manifests
│  ├─ Detect video requests
│  └─ YouTube API interception
│
├─ Fetch API Interceptor - ~100 dòng
│  ├─ Detect manifests
│  └─ YouTube player API
│
├─ YouTube Detection - ~500 dòng
│  ├─ ytInitialPlayerResponse polling
│  ├─ ytplayer.config monitoring
│  ├─ URL change detection
│  ├─ extractYouTubeVideoInfo()
│  └─ Navigation event listeners
│
├─ Message Handlers - ~100 dòng
│  ├─ MSE download commands
│  ├─ Status requests
│  └─ Capture control
│
└─ General Utils - ~167 dòng
   ├─ Manifest parsing
   ├─ Format detection
   └─ Logging
```

---

## 🎯 PHƯƠNG ÁN REFACTOR

### Kiến trúc mới đề xuất

```
injected/
├─ index.js                    (Entry point - ~150 dòng)
│  ├─ Load all detectors
│  ├─ Coordinate message routing
│  └─ Shared state management
│
├─ core/
│  ├─ detector-base.js         (Base class cho detectors)
│  ├─ interceptors.js          (Shared fetch/XHR hooks)
│  └─ message-bus.js           (Message routing system)
│
├─ detectors/
│  ├─ youtube-detector.js      (~400 dòng)
│  │  ├─ YouTube API detection
│  │  ├─ URL change monitoring
│  │  └─ Player response extraction
│  │
│  ├─ dash-detector.js         (~100 dòng)
│  │  └─ DASH manifest detection
│  │
│  ├─ hls-detector.js          (~100 dòng)
│  │  └─ HLS manifest detection
│  │
│  └─ mpd-detector.js          (~50 dòng)
│     └─ MPD manifest detection
│
├─ downloaders/
│  ├─ mse-downloader.js        (~500 dòng)
│  │  ├─ MediaSourceChunkCapture
│  │  ├─ Force video load
│  │  ├─ Chunk merging
│  │  └─ Download triggers
│  │
│  └─ stream-downloader.js     (~100 dòng)
│     └─ Generic stream handling
│
└─ utils/
   ├─ manifest-parser.js       (~100 dòng)
   ├─ format-detector.js       (~50 dòng)
   └─ logger.js                (~50 dòng)
```

---

## 📋 KẾ HOẠCH THỰC HIỆN

### Phase 1: Tạo Cấu trúc Core (Foundation)
**Thời gian**: ~1-2 giờ

1. **Tạo thư mục structure**
   ```
   mkdir injected/core injected/detectors injected/downloaders injected/utils
   ```

2. **Tạo base classes**
   - `core/detector-base.js` - Abstract detector
   - `core/message-bus.js` - Event system
   - `core/interceptors.js` - Shared fetch/XHR hooks

3. **Tạo utils**
   - `utils/logger.js` - Centralized logging
   - `utils/manifest-parser.js` - Manifest parsing
   - `utils/format-detector.js` - Format detection

### Phase 2: Tách YouTube Components
**Thời gian**: ~2-3 giờ

1. **Tạo `detectors/youtube-detector.js`**
   - Move YouTube detection logic
   - URL monitoring
   - Player response extraction
   - Navigation listeners

2. **Tạo `downloaders/mse-downloader.js`**
   - Move MediaSourceChunkCapture class
   - Force load logic
   - Chunk management
   - Download handlers

3. **Test YouTube detection & download** ✅

### Phase 3: Tách DASH/HLS/MPD Components
**Thời gian**: ~1-2 giờ

1. **Tạo detectors riêng**
   - `detectors/dash-detector.js`
   - `detectors/hls-detector.js`
   - `detectors/mpd-detector.js`

2. **Tạo `downloaders/stream-downloader.js`**
   - Generic stream handling

3. **Test DASH/HLS/MPD detection** ✅

### Phase 4: Tạo Entry Point & Integration
**Thời gian**: ~1 giờ

1. **Tạo `injected/index.js`**
   - Initialize all detectors
   - Setup message routing
   - Coordinate components

2. **Update manifest.json**
   - Inject từng file theo thứ tự
   - Hoặc bundle thành 1 file

3. **Full integration test** ✅

### Phase 5: Cleanup & Documentation
**Thời gian**: ~30 phút

1. **Xóa `injected.js` cũ**
2. **Update README**
3. **Add architecture docs**

---

## 💡 LỢI ÍCH

### ✅ Maintainability
- Mỗi file < 500 dòng
- Dễ đọc, dễ hiểu
- Tìm bug nhanh hơn

### ✅ Scalability
- Thêm detector mới dễ dàng
- Không ảnh hưởng code cũ
- Plugin architecture

### ✅ Testing
- Test từng component riêng
- Mock dependencies dễ
- Ít regression bugs

### ✅ Collaboration
- Ít conflict khi merge
- Review code dễ hơn
- Nhiều người code cùng lúc

### ✅ Performance
- Lazy load detectors (optional)
- Chỉ load detector cần thiết
- Giảm memory footprint

---

## ⚠️ RỦI RO & GIẢI PHÁP

### Rủi ro 1: Breaking Changes
**Giải pháp**: 
- Giữ `injected.js` cũ song song
- Test kỹ trước khi switch
- Rollback dễ dàng nếu cần

### Rủi ro 2: Load Order Issues
**Giải pháp**:
- Define dependencies rõ ràng
- Load theo thứ tự: utils → core → detectors → downloaders → index
- Hoặc bundle thành 1 file duy nhất

### Rủi ro 3: Message Routing Complexity
**Giải pháp**:
- Implement message bus đơn giản
- Document message flow rõ ràng
- Centralize trong `core/message-bus.js`

### Rủi ro 4: File Size Increase (multiple files)
**Giải pháp**:
- Option 1: Bundle với webpack/rollup
- Option 2: Lazy load khi cần
- Option 3: Keep separated (tradeoff acceptable)

---

## 🔄 ROLLBACK PLAN

Nếu gặp vấn đề nghiêm trọng:

1. **Immediate**: Comment out new files, uncomment `injected.js` cũ
2. **Git**: `git revert` commits
3. **Manifest**: Restore old injection
4. **Time**: < 5 phút để rollback

---

## 📊 SO SÁNH

### Trước Refactor
```
injected.js (1,367 dòng)
├─ Khó đọc ❌
├─ Khó maintain ❌
├─ Dễ conflict ❌
├─ Rủi ro cao khi thêm feature ❌
└─ 1 file duy nhất ✅ (đơn giản)
```

### Sau Refactor
```
injected/
├─ 12 files, mỗi file ~50-500 dòng ✅
├─ Dễ đọc ✅
├─ Dễ maintain ✅
├─ Ít conflict ✅
├─ Rủi ro thấp khi thêm feature ✅
└─ Nhiều files ⚠️ (phức tạp hơn)
```

---

## 🎯 QUYẾT ĐỊNH

### Đề xuất: THỰC HIỆN REFACTOR

**Lý do**:
1. File hiện tại quá lớn (1,367 dòng)
2. Đã có nhiều features (YouTube, DASH, HLS, MPD, MSE)
3. Sẽ còn thêm nhiều features nữa
4. Rủi ro cao khi maintain
5. Lợi ích > Rủi ro

### Timeline
- **Tổng thời gian**: ~6-8 giờ
- **Có thể chia nhỏ**: Làm từng phase
- **Rollback time**: < 5 phút nếu cần

### Next Steps (Chờ approval)
1. ✅ Bạn review phương án này
2. ✅ Quyết định có thực hiện không
3. ✅ Nếu OK → Start Phase 1
4. ✅ Test từng phase trước khi tiếp

---

## ❓ CÂU HỎI CHO BẠN

1. **Bundling**: Có muốn bundle thành 1 file (webpack) hay giữ nhiều files?
2. **Timing**: Làm ngay bây giờ hay đợi sau khi hoàn thành features khác?
3. **Backward compat**: Giữ `injected.js` cũ bao lâu (1 ngày, 1 tuần)?
4. **Testing**: Có muốn thêm unit tests cho từng module không?

---

**Chờ quyết định của bạn để bắt đầu! 🚀**
