# Debug Instructions

## Để debug vấn đề download streaming

1. **Mở Chrome DevTools**:
   - F12 hoặc Right-click → Inspect
   - Chuyển sang tab Console

2. **Load extension**:
   - Chrome → Extensions → Developer mode → Load unpacked
   - Chọn folder "Video download helper"

3. **Test trên trang có streaming video**:
   - Truy cập trang có video streaming (.m3u8, .mpd)
   - Click vào extension icon
   - Click Download

4. **Theo dõi logs trong Console**:
   ```
   [StreamProcessor] ===================
   [StreamProcessor] DASH SEGMENT EXTRACTION STARTED
   [StreamProcessor] ===================
   [StreamProcessor] Manifest length: XXXX
   [StreamProcessor] Base URL: [url]
   [StreamProcessor] Is Cloudflare Stream: true/false
   ```

5. **Logs quan trọng để check**:
   - ExtractSegments result: `segmentsLength: 0` → vấn đề parsing
   - `Found X segments` → nếu 0 thì vấn đề
   - `Alternative parsing result: X segments` → fallback
   - `No segments found with alternative methods` → sẽ download manifest

6. **Nếu vẫn download manifest**:
   - Copy logs từ Console
   - Gửi để debug tiếp

## Test URLs

- HLS: `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- DASH: Tìm site có .mpd manifest

## Logs mong muốn thấy

```
[StreamProcessor] Found 150 segments
[StreamProcessor] Downloading and merging segments...
[StreamProcessor] Download progress: 50% (75/150)
```

Không mong muốn thấy:
```
[StreamProcessor] No segments found, using fallback
```