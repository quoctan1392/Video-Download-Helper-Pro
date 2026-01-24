# YouTube Video Download Support

Extension này đã được bổ sung tính năng detect và download video YouTube với hỗ trợ DASH streaming.

## Tính năng

### 1. Phát hiện Video YouTube
- Tự động detect video YouTube khi bạn xem video
- Hỗ trợ cả video thường và live streaming
- Hiển thị tiêu đề video, thời lượng và thông tin chất lượng

### 2. Định dạng được hỗ trợ
- **YouTube DASH**: DASH manifest với video và audio riêng biệt
- **YouTube HLS**: HLS manifest cho live streaming
- **YouTube Adaptive**: Direct video URLs với nhiều chất lượng khác nhau

### 3. Chất lượng video
Extension có thể detect và download các chất lượng:
- 8K (4320p)
- 4K (2160p) 
- 2K (1440p)
- Full HD (1080p)
- HD (720p)
- SD (480p, 360p, 240p)

## Cách sử dụng

### Bước 1: Mở video YouTube
1. Truy cập YouTube.com
2. Mở bất kỳ video nào bạn muốn download

### Bước 2: Detect video
Extension sẽ tự động detect video khi:
- Video bắt đầu load
- Bạn click vào video mới (YouTube SPA navigation)
- Bạn click nút "Refresh" trong popup

### Bước 3: Chọn chất lượng
1. Click vào extension icon
2. Video YouTube sẽ hiển thị với icon 📹 và tiêu đề
3. Chọn chất lượng mong muốn từ dropdown menu

### Bước 4: Download
1. Chọn download mode:
   - **VNA (Video + Audio)**: Download video và audio riêng biệt
   - **VWA (Merged MP4)**: Download file MP4 đã merge (coming soon)
2. Click nút "Download"

## Chi tiết kỹ thuật

### YouTube Player API Interception
Extension hook vào YouTube player thông qua:
- `ytInitialPlayerResponse` object
- `ytplayer` API
- Navigation events (pushState/replaceState)

### Streaming Data
Extension trích xuất:
- DASH manifest URL
- HLS manifest URL (cho live streaming)
- Adaptive formats (direct video URLs)
- Video metadata (title, duration, videoId)

### Download Process
1. **DASH Format**: Download video và audio segments riêng biệt
2. **HLS Format**: Download live streaming segments
3. **Adaptive Format**: Download từ direct URLs với quality được chọn

## Lưu ý

### Limitations
- **VWA Mode**: Cần FFmpeg để merge video + audio (đang phát triển)
- **Live Streaming**: Chỉ download được phần đã stream
- **Protected Content**: Không thể download video có DRM/Copyright protection

### Best Practices
1. Chọn chất lượng phù hợp với bandwidth của bạn
2. Với DASH videos, download ở VNA mode để có chất lượng tốt nhất
3. Đối với live streams, chờ stream kết thúc để download toàn bộ

### Troubleshooting

**Video không được detect:**
- Reload trang web
- Click nút "Refresh" trong popup
- Kiểm tra console logs (F12)

**Download bị lỗi:**
- Thử chất lượng thấp hơn
- Kiểm tra kết nối internet
- Xem error details trong popup

**Quality dropdown trống:**
- Video có thể chưa load xong
- Thử refresh lại
- Một số video có giới hạn chất lượng

## API Detection Flow

```
YouTube Page Load
    ↓
Injected Script Detects ytInitialPlayerResponse
    ↓
Extract streamingData (DASH/HLS manifests, adaptive formats)
    ↓
Send to Content Script
    ↓
Forward to Background Service Worker
    ↓
Store in detectedVideos Map
    ↓
Display in Popup with metadata
```

## Video Info Structure

```javascript
{
  url: "https://youtube.com/api/manifest/dash/...",
  type: "youtube-dash",
  title: "Video Title",
  videoId: "abc123",
  duration: 300, // seconds
  isLive: false,
  formats: [
    {
      itag: 137,
      quality: "1080p",
      qualityLabel: "1080p",
      mimeType: "video/mp4; codecs=\"avc1.640028\"",
      width: 1920,
      height: 1080,
      fps: 30,
      hasVideo: true,
      hasAudio: false
    },
    // ... more formats
  ]
}
```

## Future Enhancements

- [ ] Auto-merge video + audio với FFmpeg integration
- [ ] Download subtitle/captions
- [ ] Playlist download support
- [ ] Quality auto-selection based on connection speed
- [ ] Resume interrupted downloads
- [ ] Download speed limiting
- [ ] Thumbnail extraction

## Compatibility

- ✅ Chrome 88+
- ✅ Edge 88+
- ✅ Brave
- ✅ Opera GX

## Legal Notice

This extension is for personal use only. Please respect YouTube's Terms of Service and copyright laws. Only download videos you have permission to download.
