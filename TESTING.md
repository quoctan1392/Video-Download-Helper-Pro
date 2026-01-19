# Testing Guide - Video Download Extension

## New Features: Download Management & Cancel

Đã thêm 3 tính năng mới quan trọng:

### ✅ Download Button States
- **Disabled during download**: Các button khác không click được khi đang download
- **Loading animation**: Button đang download hiển thị icon loading xoay và text "Đang tải..."
- **Visual states**: Download button có màu xanh khi active, xám khi disabled
- **Auto-reset**: Buttons tự động enable lại khi download xong hoặc bị lỗi

### ✅ Cancel Download Button
- **Icon button**: Nút hủy (❌) trong progress bar area
- **Instant cancel**: Click để hủy download ngay lập tức
- **UI reset**: Tự động reset tất cả UI states khi cancel
- **Background stop**: Dừng việc download segments trong background script

### ✅ Real-time Segment Progress
- Progress bar theo dõi từng segment được download thực tế
- Hiển thị: `📥 Đang tải video... (45.2%)` với `23/51 segments`
- Phân biệt rõ ràng video (🎥) và audio (🎵) streams
- Dung lượng real-time: `💾 142.5 MB` downloaded

## Test Flow Example

### **Normal Download:**
1. **Click download button** → Button turns green with loading animation
2. **Other buttons disabled** → Cannot click other videos  
3. **Progress bar shows** with cancel button ❌
4. **Real-time updates**: `📥 Đang tải video... (34.7%) - 18/52 segments - 💾 89.2 MB`
5. **Download completes** → All buttons re-enabled, progress hides after 3s

### **Cancel Download:**
1. **During download** → Click cancel button ❌ in progress bar
2. **Immediate stop** → Progress shows `❌ Đã hủy tải xuống`
3. **UI reset** → All buttons re-enabled immediately  
4. **Background stop** → Segment downloads halt in background script

### **Multiple Videos:**
- **Only 1 download** allowed at a time
- **Other buttons grayed out** when downloading  
- **Click ignored** if already downloading
- **Queue system** not implemented - must wait for completion/cancel
4. **Kiểm tra:**
   - ✅ **Download button states**: Click 1 button → các button khác bị disable
   - ✅ **Loading animation**: Button active có loading icon xoay và text "Đang tải..."
   - ✅ **Cancel button**: Nút ❌ xuất hiện trong progress bar, click để hủy
   - ✅ **Real-time progress**: `📥 Đang tải video... (67.3%)` + `34/51 segments`
   - ✅ **Live file size**: `💾 256.8 MB`
   - ✅ **Auto reset**: Buttons enable lại khi hoàn thành/error/cancel

### 3. Expected Behavior

**For Separate Streams (Audio + Video):**
- Progress: `🎥 Đang tải video... (23.5%)` → `🎵 Đang tải audio... (78.2%)`
- Real-time: `12/51 video segments` → `39/45 audio segments`  
- Size tracking: `💾 125.4 MB` → `💾 267.8 MB`
- **KHÔNG HỎI USER** - tự động lưu Downloads folder
- Final: `✅ Hoàn thành! Video + Audio lưu Downloads folder 267.8 MB`

**For Single Stream (Video only):**
- Progress: `📥 Đang tải video... (45.2%)` với `23/51 segments`
- Size: `💾 142.5 MB` real-time updates
- Merge: `🔧 Đang ghép video... 51 segments`
- Final: `✅ Video đã tải xong! filename.mp4 235.7 MB`

### 4. Debug Info

Nếu có lỗi, check Console:
```bash
# Mở Extension popup
# F12 -> Console
# Tìm logs: [IntegratedStreamProcessor], [Popup]
```

Background script logs:
```bash
# chrome://extensions/
# Click "service worker" link next to extension
# Check Console logs
```

### 5. Common Issues

**No Audio Download:**
- Check if DASH manifest has both video và audio AdaptationSets
- Logs sẽ show: "Found separate video and audio streams"

**No Progress Bar:**
- Popup phải mở trong khi download
- Check popup.js message listener

**Download Fails:**
- Check manifest URL accessibility
- CORS issues với video segments

## Test URLs

Cloudflare Stream format:
```
https://domain.com/manifest.mpd
https://domain.com/video/playlist.m3u8
```

## Expected Console Logs

```
[IntegratedStreamProcessor] Processing DASH stream: https://...
[IntegratedStreamProcessor] Extracted 45 video segments, 45 audio segments  
[IntegratedStreamProcessor] Found separate video and audio streams
[IntegratedStreamProcessor] Downloading video segment 23/45: https://...
[IntegratedStreamProcessor] Downloaded video segment 23, size: 524288, total: 12058624
[IntegratedStreamProcessor] Downloading audio segment 34/45: https://...  
[IntegratedStreamProcessor] Downloaded audio segment 34, size: 98304, total: 3350528
[IntegratedStreamProcessor] Downloads completed: video_123456.mp4, audio_123456.m4a
```

## Progress Bar Stages

1. **🎬 Bắt đầu tải video... (0%)**
2. **📥 Đang tải video... (23.5%) - 12/51 segments - 💾 45.2 MB**
3. **🔧 Đang ghép video... (95%) - 51 segments - 💾 178.4 MB** 
4. **💾 Tạo file tải xuống... (98%) - filename.mp4 - 178.4 MB**
5. **✅ Video đã tải xong! (100%) - filename.mp4 - 178.4 MB**

For dual streams:
1. **🎥 Đang tải video... (15.2%) - 8/51 segments - 💾 23.4 MB**
2. **🎵 Đang tải audio... (78.9%) - 35/45 segments - 💾 156.8 MB**
3. **💾 Lưu vào Downloads folder... (95%) - Video + Audio - 186.2 MB**
4. **✅ Hoàn thành! (100%) - Video + Audio lưu Downloads folder - 186.2 MB**