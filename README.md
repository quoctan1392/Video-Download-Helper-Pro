# Video Download Helper Pro

Chrome extension để tải video từ các trang web với hỗ trợ đầy đủ cho các giao thức streaming hiện đại.

## 🎯 Tính năng

- ✅ **Phát hiện video tự động** - Tự động phát hiện các video trên trang web
- ✅ **Hỗ trợ nhiều định dạng**:
  - MP4, WebM, MKV, AVI, MOV, FLV, WMV
  - DASH (Dynamic Adaptive Streaming over HTTP)
  - HLS (HTTP Live Streaming) - M3U8
  - MPD (Media Presentation Description)
- ✅ **Live Streaming** - Hỗ trợ phát hiện và tải live streams
- ✅ **High Definition** - Hỗ trợ video chất lượng cao (4K, 8K)
- ✅ **Giao diện thân thiện** - UI đẹp mắt, dễ sử dụng
- ✅ **Download Manager** - Quản lý tải xuống tích hợp

## 📋 Yêu cầu

- Google Chrome hoặc Microsoft Edge (Chromium-based)
- Chrome Extension Manifest V3 support

## 🚀 Cài đặt

### Cài đặt từ Source Code

1. **Clone hoặc download repository này**
   ```bash
   git clone <repository-url>
   cd "Video download helper"
   ```

2. **Mở Chrome Extension Management**
   - Mở Chrome/Edge
   - Truy cập `chrome://extensions/` (hoặc `edge://extensions/`)
   - Bật "Developer mode" ở góc trên bên phải

3. **Load Extension**
   - Click "Load unpacked"
   - Chọn thư mục `Video download helper`
   - Extension sẽ được cài đặt và kích hoạt

4. **Tạo Icons (Tùy chọn)**
   
   Extension cần các file icon. Bạn có thể:
   - Tạo các file PNG với kích thước: 16x16, 32x32, 48x48, 128x128
   - Đặt chúng vào thư mục `icons/` với tên: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
   - Hoặc sử dụng một tool online để tạo icon như [favicon.io](https://favicon.io/)

## 📖 Sử dụng

1. **Truy cập trang web có video**
   - Mở bất kỳ trang web nào có video (YouTube, Vimeo, v.v.)

2. **Phát video**
   - Phát video để extension phát hiện

3. **Mở Extension**
   - Click vào icon của extension trên toolbar
   - Bạn sẽ thấy danh sách các video được phát hiện

4. **Tải xuống**
   - Click nút "Tải xuống" bên cạnh video bạn muốn tải
   - Video sẽ được tải về máy của bạn

## 🔧 Cấu trúc Project

```
Video download helper/
├── manifest.json              # Chrome extension manifest
├── background.js              # Background service worker
├── content.js                 # Content script
├── injected.js               # Injected page script
├── popup.html                # Popup UI
├── popup.js                  # Popup logic
├── popup.css                 # Popup styles
├── icons/                    # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── modules/                  # Core modules
│   ├── videoDetector.js     # Video detection logic
│   ├── downloadManager.js   # Download management
│   └── streamProcessor.js   # Stream processing (DASH/HLS)
└── README.md                # Documentation
```

## 🎨 Tính năng chính

### Video Detection
- Phát hiện video qua network requests
- Phát hiện DASH/HLS manifests
- Phát hiện video elements trong DOM
- Intercept player APIs (Shaka Player, HLS.js, DASH.js)

### Download Manager
- Tải xuống trực tiếp video files
- Hỗ trợ pause/resume downloads
- Quản lý multiple downloads
- Auto-generate filenames

### Stream Processor
- Parse DASH MPD manifests
- Parse HLS M3U8 playlists
- Phát hiện quality levels
- Hỗ trợ live streams

## 🔄 Chuyển đổi sang MP4

Đối với các video streaming (DASH/HLS/MPD), extension sẽ tải về manifest file. Để chuyển đổi sang MP4, bạn cần:

### Sử dụng FFmpeg (Khuyến nghị)

1. **Cài đặt FFmpeg**
   - Windows: Download từ [ffmpeg.org](https://ffmpeg.org/download.html)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

2. **Chuyển đổi HLS sang MP4**
   ```bash
   ffmpeg -i "video.m3u8" -c copy output.mp4
   ```

3. **Chuyển đổi DASH sang MP4**
   ```bash
   ffmpeg -i "video.mpd" -c copy output.mp4
   ```

### Sử dụng yt-dlp (Cho YouTube và nhiều sites)

```bash
# Cài đặt
pip install yt-dlp

# Download và convert
yt-dlp -f best "URL"
```

## 🛠️ Development

### Prerequisites
- Node.js (tùy chọn, cho development tools)
- Chrome/Edge browser

### Debug Extension

1. Mở `chrome://extensions/`
2. Tìm extension "Video Download Helper Pro"
3. Click "Details"
4. Click "Inspect views: background page" để debug background script
5. Click "Inspect" trên popup để debug popup

### Logs

- **Background logs**: Console trong background page inspector
- **Content script logs**: Console của trang web
- **Popup logs**: Console trong popup inspector

## 📝 Lưu ý quan trọng

- ⚠️ **DRM Content**: Extension không thể tải video được bảo vệ bởi DRM (Netflix, Disney+, v.v.)
- ⚠️ **Blob URLs**: Extension không thể tải video từ blob URLs
- ⚠️ **Legal**: Chỉ tải video bạn có quyền tải xuống
- ⚠️ **Streaming**: DASH/HLS videos cần tools bên ngoài (FFmpeg) để convert sang MP4

## 🐛 Troubleshooting

### Extension không phát hiện video?

1. Reload trang web
2. Phát video trước khi mở extension
3. Check console logs để xem errors
4. Một số sites có thể block video detection

### Download không hoạt động?

1. Kiểm tra Chrome download settings
2. Cho phép downloads trong extension permissions
3. Một số videos cần authentication/cookies

### Icons không hiển thị?

1. Tạo icon files trong thư mục `icons/`
2. Hoặc update manifest.json để remove icon references

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is for educational purposes. Please respect copyright laws and only download content you have the right to download.

## 🔗 Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [DASH Specification](https://dashif.org/)
- [HLS Specification](https://datatracker.ietf.org/doc/html/rfc8216)

## 📞 Support

Nếu gặp vấn đề, vui lòng:
1. Check README và Troubleshooting section
2. Check console logs
3. Create an issue với detailed description

---

**Lưu ý**: Extension này được tạo cho mục đích học tập. Vui lòng sử dụng có trách nhiệm và tuân thủ luật bản quyền.
