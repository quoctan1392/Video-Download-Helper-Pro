# YouTube Download Fix - Sửa lỗi tải manifest .htm thay vì MP4

## Vấn đề
Khi download video YouTube, extension đang tải file manifest HTML (ví dụ: `manifest_1768921361329.htm`) thay vì file video MP4.

## Nguyên nhân
- Extension đang ưu tiên sử dụng `dashManifestUrl` hoặc `hlsManifestUrl` từ YouTube API
- Những URL này trỏ đến file manifest HTML thay vì video thực sự
- Cần sử dụng `adaptiveFormats` với URL trực tiếp thay vì manifest URLs

## Giải pháp đã áp dụng

### 1. Sửa `injected.js` (✅ Hoàn thành)
- **Thay đổi**: Ưu tiên sử dụng `adaptiveFormats` với URL trực tiếp
- **Logic mới**:
  1. Kiểm tra `adaptiveFormats` có direct URLs không
  2. Nếu có → Gửi formats với direct URLs
  3. Nếu không → Mới sử dụng `dashManifestUrl`/`hlsManifestUrl` làm fallback

### 2. Thêm logging trong `background-simple.js` (✅ Hoàn thành)
- Log số lượng formats nhận được
- Log số lượng formats có URLs
- Log khi fallback sang DASH manifest
- Giúp debug dễ dàng hơn

## Cách test

### Bước 1: Reload extension
1. Mở Chrome → `chrome://extensions`
2. Tìm extension "Video Download Helper Pro"
3. Click nút **Reload** (biểu tượng tròn)

### Bước 2: Mở DevTools để xem logs
1. Mở trang YouTube bất kỳ
2. Nhấn `F12` để mở DevTools
3. Chọn tab **Console**
4. Filter logs bằng: `[Injected]` hoặc `[Background-Simple]`

### Bước 3: Test download
1. Chơi một video YouTube
2. Click icon extension
3. Xem trong console logs:
   ```
   [Injected] Found X YouTube adaptive formats
   [Injected] Sending Y YouTube formats with direct URLs
   ```
4. Click **Download** trên video
5. Kiểm tra console logs:
   ```
   [Background-Simple] Video formats count: X
   [IntegratedStreamProcessor] Formats with URLs: Y
   ```

### Bước 4: Kiểm tra file tải về
1. Mở **Downloads** trong Chrome (`Ctrl+J`)
2. File tải về phải là `.mp4` hoặc `.webm`, **KHÔNG** phải `.htm`
3. Có thể có 2 file:
   - `..._video_XXXp_video_timestamp.mp4` (video only)
   - `..._audio_timestamp.m4a` (audio only)

## Debug khi gặp lỗi

### Trường hợp 1: Vẫn download file .htm
**Kiểm tra**:
- Console có log: `No YouTube formats have direct URLs`?
- Console có log: `Fallback to YouTube DASH manifest`?

**Nguyên nhân**: YouTube có thể đã mã hóa URLs (signature cipher)

**Giải pháp tạm thời**:
- Sử dụng công cụ khác như `yt-dlp`
- Hoặc cần implement signature decoder (phức tạp)

### Trường hợp 2: Không thấy video trong popup
**Kiểm tra**:
- Console có log: `[Injected] YouTube player detected`?
- Console có log: `[Injected] Extracting YouTube video info`?

**Giải pháp**:
1. Refresh trang YouTube
2. Chờ video load xong
3. Click icon extension lại

### Trường hợp 3: Download bị lỗi
**Kiểm tra console**:
```
[IntegratedStreamProcessor] Video or audio URL is missing!
```

**Nguyên nhân**: Formats không có URL field

**Giải pháp**: Xem logs chi tiết về formats để tìm vấn đề

## Logs quan trọng cần chú ý

### Logs thành công:
```
[Injected] Found 20 YouTube adaptive formats
[Injected] Sending 18 YouTube formats with direct URLs
[Background-Simple] Video formats count: 18
[IntegratedStreamProcessor] Formats with URLs: 18
[IntegratedStreamProcessor] Selected video: 1080p https://...
[IntegratedStreamProcessor] Selected audio: audio/mp4 https://...
[IntegratedStreamProcessor] YouTube downloads started: 123 124
```

### Logs lỗi:
```
[Injected] No formats with direct URLs found
[IntegratedStreamProcessor] Formats with URLs: 0
[IntegratedStreamProcessor] Falling back to DASH manifest
```

## Lưu ý
- YouTube có thể thay đổi API bất cứ lúc nào
- Một số video có thể bị bảo vệ bởi DRM → không thể download
- Live streams cần xử lý khác (dùng HLS manifest)

## Cải tiến trong tương lai
1. Implement signature decoder cho các formats bị mã hóa
2. Hỗ trợ merge video + audio tự động bằng FFmpeg
3. Thêm UI chọn quality trước khi download
4. Cache player response để tăng tốc detection

## Hỗ trợ
Nếu vẫn gặp lỗi, hãy:
1. Export console logs (copy toàn bộ)
2. Kiểm tra file `YOUTUBE_DEBUG.md` để biết thêm chi tiết
3. Báo lỗi với đầy đủ logs
