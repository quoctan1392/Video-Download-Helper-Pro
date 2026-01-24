# Sửa lỗi không detect video YouTube khi chuyển video

## Vấn đề
Khi click chuyển giữa các video YouTube, extension không detect video mới.

## Nguyên nhân
Biến `lastExtractedVideoId` **KHÔNG được reset** trong function `resetYouTubeDetection()`.

### Chi tiết kỹ thuật:
```javascript
// TRƯỚC KHI SỬA (SAI):
function resetYouTubeDetection() {
  youtubePlayerDetected = false;
  lastYouTubePlaybackId = null;
  // lastExtractedVideoId is NOT reset - used to prevent duplicate sends ❌
  // ...
}
```

Khi chuyển video:
1. `yt-navigate-finish` event fire → `resetYouTubeDetection()` được gọi
2. `lastExtractedVideoId` vẫn giữ videoId CŨ
3. `interceptYouTubePlayer()` được gọi → detect video MỚI
4. So sánh: `currentVideoId !== lastExtractedVideoId` → FALSE (vì chưa reset!)
5. **Skip không gửi message** → Video không hiển thị trong popup

## Giải pháp
Reset `lastExtractedVideoId = null` trong `resetYouTubeDetection()`:

```javascript
// SAU KHI SỬA (ĐÚNG):
function resetYouTubeDetection() {
  youtubePlayerDetected = false;
  lastYouTubePlaybackId = null;
  lastExtractedVideoId = null; // ✅ Reset để cho phép detect video mới
  // ...
}
```

## Cách test

### Bước 1: Reload extension
1. `chrome://extensions`
2. Click **Reload** trên extension

### Bước 2: Test detection
1. Mở YouTube.com
2. Mở **DevTools** (`F12`) → Tab **Console**
3. Chơi video bất kỳ
4. Xem logs:
   ```
   [Injected] YouTube player detected
   [Injected] New video ID: abc123 (previous: null)
   [Injected] Sending X YouTube formats with direct URLs
   ```

### Bước 3: Test chuyển video
1. Click vào video khác trong sidebar
2. **QUAN TRỌNG**: Xem logs phải có:
   ```
   [Injected] ▶ yt-navigate-finish event fired
   [Injected] Resetting YouTube detection state
   [Injected] Previous lastExtractedVideoId: abc123
   [Injected] Reset complete, lastExtractedVideoId now: null
   [Injected] Starting YouTube player interception...
   [Injected] New video ID: xyz789 (previous: null)  ← PHẢI LÀ null!
   [Injected] Sending Y YouTube formats with direct URLs
   ```

### Bước 4: Kiểm tra popup
1. Click icon extension
2. Phải thấy video MỚI trong danh sách
3. Video có đúng title và thumbnail

## Debug nếu vẫn lỗi

### Log mong đợi khi chuyển video:
```
[Injected] ▶ yt-navigate-finish event fired
[Injected] Resetting YouTube detection state
[Injected] Previous lastExtractedVideoId: <video-id-cũ>
[Injected] Reset complete, lastExtractedVideoId now: null
[Injected] Starting YouTube player interception...
[Injected] New video ID: <video-id-mới> (previous: null)
```

### Nếu thấy log này → VẪN LỖI:
```
[Injected] Same video ID, waiting for update: <video-id>
```
**Nguyên nhân**: `ytInitialPlayerResponse` chưa được update

**Giải pháp**:
- Chờ thêm 1-2 giây
- Hoặc refresh trang

### Nếu thấy log này → VẪN LỖI:
```
[Injected] Same video, skipping: <video-id>
```
**Nguyên nhân**: `lastVideoId` trong setter chưa được reset

**Giải pháp**: Cần thêm reset `lastVideoId` (hiện tại chưa cần)

### Nếu KHÔNG thấy `yt-navigate-finish`:
**Nguyên nhân**: YouTube không fire event

**Giải pháp**: Fallback mechanisms sẽ hoạt động:
- MutationObserver sẽ detect URL change
- Hoặc polling mỗi 1s sẽ detect

**Xem logs**:
```
[Injected] ▶ URL changed (MutationObserver): ...
// hoặc
[Injected] ▶ URL changed (polling): ...
```

## So sánh trước/sau

### TRƯỚC (Lỗi):
```
Video 1 → lastExtractedVideoId = "abc123"
Click Video 2 → resetYouTubeDetection()
              → lastExtractedVideoId vẫn = "abc123" ❌
              → interceptYouTubePlayer()
              → currentVideoId = "xyz789"
              → xyz789 !== abc123? TRUE
              → Nhưng trong loop kiểm tra: xyz789 === abc123? FALSE
              → Lặp lại nhiều lần → timeout
              → KHÔNG gửi message ❌
```

### SAU (Đúng):
```
Video 1 → lastExtractedVideoId = "abc123"
Click Video 2 → resetYouTubeDetection()
              → lastExtractedVideoId = null ✅
              → interceptYouTubePlayer()
              → currentVideoId = "xyz789"
              → xyz789 !== null? TRUE ✅
              → Gửi message ngay lập tức ✅
```

## Lưu ý
- Extension sử dụng 3 phương pháp detect video mới:
  1. `yt-navigate-finish` event (ưu tiên)
  2. MutationObserver (fallback)
  3. Polling mỗi 1s (fallback cuối)
  
- Mỗi phương pháp đều gọi `resetYouTubeDetection()` trước khi `interceptYouTubePlayer()`

- Nếu vẫn không detect được, kiểm tra:
  - Console có errors không?
  - `ytInitialPlayerResponse` có tồn tại không?
  - YouTube có thay đổi API không?

## Kết quả mong đợi
✅ Chuyển video mượt mà, detect ngay lập tức
✅ Mỗi video chỉ được gửi 1 lần (không duplicate)
✅ Video hiển thị đầy đủ trong popup với title và formats
