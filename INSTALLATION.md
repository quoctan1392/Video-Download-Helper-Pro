# Installation Guide - Video Download Helper Pro

## 📦 Cài đặt Extension vào Chrome

### Bước 1: Chuẩn bị Icons

Extension cần các file icon PNG. Bạn có 2 lựa chọn:

**Option A: Tạo icons tự động (Khuyến nghị)**

Sử dụng một trong các công cụ online sau:
- [Favicon Generator](https://favicon.io/)
- [RealFaviconGenerator](https://realfavicongenerator.net/)
- [Icons8](https://icons8.com/)

Tạo các file với kích thước: 16x16, 32x32, 48x48, 128x128 pixels và đặt vào thư mục `icons/`

**Option B: Sử dụng placeholder**

Các file placeholder đã được tạo. Extension sẽ hoạt động nhưng không có icon đẹp.

### Bước 2: Load Extension vào Chrome

1. **Mở Chrome Extension Management**
   - Mở Google Chrome
   - Vào `chrome://extensions/`
   - Hoặc Menu (⋮) → More Tools → Extensions

2. **Bật Developer Mode**
   - Bật switch "Developer mode" ở góc trên bên phải

3. **Load Extension**
   - Click button "Load unpacked"
   - Chọn thư mục: `d:\Tan\Code\Video download helper`
   - Extension sẽ xuất hiện trong danh sách

4. **Pin Extension (Tùy chọn)**
   - Click icon puzzle (Extensions) trên toolbar
   - Tìm "Video Download Helper Pro"
   - Click pin icon để pin vào toolbar

### Bước 3: Test Extension

1. Mở một trang web có video (ví dụ: YouTube, Vimeo)
2. Phát video
3. Click vào icon extension trên toolbar
4. Bạn sẽ thấy danh sách video được phát hiện

## 🔧 Troubleshooting

### Extension không load được?

**Lỗi: "Failed to load extension"**
- Kiểm tra tất cả files có trong thư mục
- Đảm bảo manifest.json đúng format

**Lỗi: Icons không tìm thấy**
- Tạo các file icon trong thư mục `icons/`
- Hoặc comment out phần icons trong manifest.json

### Extension không phát hiện video?

1. Reload trang web
2. Phát video trước
3. Mở Developer Console: Right-click → Inspect
4. Check tab Console để xem logs/errors

## 📱 Sử dụng trên Microsoft Edge

Extension này cũng hoạt động trên Microsoft Edge (Chromium):

1. Mở Edge và vào `edge://extensions/`
2. Bật "Developer mode"
3. Click "Load unpacked"
4. Chọn thư mục extension

## 🎯 Các tính năng chính

### Phát hiện Video
- ✅ Tự động phát hiện video khi trang load
- ✅ Hỗ trợ nhiều định dạng: MP4, WebM, MKV, AVI, MOV
- ✅ Phát hiện streaming: DASH, HLS, MPD
- ✅ Phát hiện live streams

### Download Manager
- ✅ Download trực tiếp video files
- ✅ Tự động đặt tên file
- ✅ Badge hiển thị số lượng video

### Streaming Support
- ✅ Parse DASH manifests (.mpd)
- ✅ Parse HLS playlists (.m3u8)
- ✅ Phát hiện multiple quality levels
- ✅ Hướng dẫn convert sang MP4

## 🎬 Hướng dẫn sử dụng

### Download video thông thường (MP4, WebM, ...)

1. Truy cập trang web có video
2. Phát video
3. Click icon extension
4. Click "Tải xuống" bên cạnh video muốn tải
5. Video sẽ được download vào thư mục Downloads

### Download streaming video (DASH, HLS, MPD)

1. Extension sẽ phát hiện manifest file
2. Click "Tải xuống" để tải manifest
3. Extension sẽ tải về manifest và tạo file hướng dẫn
4. Sử dụng FFmpeg để convert sang MP4:

```bash
# HLS
ffmpeg -i video.m3u8 -c copy output.mp4

# DASH
ffmpeg -i video.mpd -c copy output.mp4
```

### Cài đặt FFmpeg

**Windows:**
1. Download từ https://ffmpeg.org/download.html
2. Extract vào C:\ffmpeg
3. Thêm C:\ffmpeg\bin vào PATH
4. Mở Command Prompt mới và test: `ffmpeg -version`

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt update
sudo apt install ffmpeg
```

## 🚨 Lưu ý quan trọng

### Các loại video KHÔNG thể download:

❌ **DRM Protected Content**
- Netflix, Disney+, Amazon Prime Video
- HBO Max, Apple TV+
- Các nền tảng có bảo vệ DRM

❌ **Blob URLs**
- Video được load qua blob://
- Cần download bằng công cụ khác

❌ **Private/Protected Videos**
- Video cần authentication
- Video có geo-restriction

### Legal Notice

⚠️ **Chỉ download video bạn có quyền download**
- Video của bạn upload
- Video có license cho phép
- Video miễn phí/public domain
- Tuân thủ Terms of Service của website

## 📊 Kiểm tra Extension hoạt động

### Debug Background Script
```
1. Vào chrome://extensions/
2. Tìm "Video Download Helper Pro"
3. Click "Inspect views: background page"
4. Console sẽ hiển thị logs
```

### Debug Content Script
```
1. Mở trang web có video
2. Right-click → Inspect
3. Tab Console sẽ có logs từ content script
```

### Debug Popup
```
1. Click icon extension
2. Right-click trong popup
3. Chọn "Inspect"
4. Console sẽ hiển thị popup logs
```

## 🔄 Update Extension

Khi có code changes:
1. Vào `chrome://extensions/`
2. Tìm extension
3. Click icon reload (🔄)
4. Test lại

## 📞 Hỗ trợ

Nếu gặp vấn đề:
1. Check README.md
2. Check console logs
3. Xem phần Troubleshooting
4. Test trên trang web khác

---

**Chúc bạn sử dụng thành công! 🎉**
