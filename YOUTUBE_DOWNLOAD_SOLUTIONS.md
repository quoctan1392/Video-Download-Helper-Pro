# YouTube Download Solutions - Research & Proposals

## ❌ Vấn Đề Hiện Tại

Extension hiện tại **KHÔNG THỂ** download YouTube video thành MP4 vì:

1. **Signature Cipher**: YouTube formats có `signatureCipher` thay vì `url` trực tiếp
2. **Fallback Failed**: Code fallback về download page URL → tạo file `.htm` không xem được
3. **No Direct URLs**: YouTube không còn cung cấp direct URLs cho videos (chống download)

**Ví dụ format YouTube trả về**:
```json
{
  "itag": 137,
  "mimeType": "video/mp4; codecs=\"avc1.640028\"",
  "signatureCipher": "s=..........&sp=sig&url=https%3A%2F%2F...",
  "width": 1920,
  "height": 1080
}
```

→ Cần **decode signature** để có URL thật.

---

## 🔬 Các Giải Pháp Đã Nghiên Cứu

### ❌ Giải Pháp 1: Signature Decoding trong Browser

**Ý tưởng**: Parse JavaScript player của YouTube, extract hàm decode signature

**Cách hoạt động**:
1. Fetch `/s/player/XXXXX/player_base.js`
2. Parse JavaScript để tìm signature decoding function
3. Execute function để decode `signatureCipher`
4. Get real video URL

**Ưu điểm**:
- ✅ Chạy hoàn toàn client-side
- ✅ Không cần external service

**Nhược điểm**:
- ❌ **RẤT PHỨC TẠP** - cần parse & execute obfuscated JS
- ❌ **BẤT ỔN ĐỊNH** - YouTube thay đổi player code liên tục
- ❌ **DỄ BỊ BREAK** - mỗi lần YouTube update là phải fix lại
- ❌ **Cao risk** - có thể vi phạm ToS của YouTube

**Kết luận**: ❌ **KHÔNG KHUYẾN NGHỊ** - quá phức tạp và không bền vững

---

### ✅ Giải Pháp 2: yt-dlp Integration (RECOMMENDED)

**Ý tưởng**: Tích hợp yt-dlp (Python tool tốt nhất để download YouTube)

#### Option 2A: Copy URL để dùng yt-dlp Manual

**Cách hoạt động**:
1. Extension detect video và hiển thị trong list
2. User click "Copy URL"
3. User chạy lệnh: `yt-dlp "URL"` trong terminal

**Ưu điểm**:
- ✅ **ĐƠN GIẢN** - chỉ cần copy URL
- ✅ **RELIABLE** - yt-dlp được maintain tốt
- ✅ **NHIỀU TÍNH NĂNG** - support tất cả qualities, formats

**Nhược điểm**:
- ❌ Cần cài yt-dlp trước
- ❌ Phải dùng terminal (không user-friendly)

**Implementation**:
```javascript
// popup.js - thêm button "Copy URL"
function copyYouTubeUrl(video) {
  navigator.clipboard.writeText(video.url);
  showNotification('✅ Copied! Run: yt-dlp "' + video.url + '"');
}
```

**Kết luận**: ✅ **KHUYẾN NGHỊ** cho simple use case

---

#### Option 2B: Native Messaging Host với yt-dlp (ADVANCED)

**Cách hoạt động**:
1. Cài yt-dlp
2. Cài Native Messaging Host (Python script)
3. Extension gọi Native Host qua Chrome API
4. Native Host chạy yt-dlp và return file

**Architecture**:
```
Extension (popup.js)
    ↓ chrome.runtime.sendNativeMessage()
Native Host (Python script)
    ↓ subprocess.run(['yt-dlp', ...])
yt-dlp
    ↓ Download video
Return file path to Extension
```

**Ưu điểm**:
- ✅ **SEAMLESS** - user chỉ click download
- ✅ **POWERFUL** - full yt-dlp features
- ✅ **RELIABLE** - leverage yt-dlp's signature decoding

**Nhược điểm**:
- ❌ **PHỨC TẠP** - cần setup Native Host
- ❌ Cần user cài Python + yt-dlp
- ❌ Chỉ hoạt động trên desktop (không support mobile)

**Implementation Files Needed**:
1. `native-host/youtube-downloader.py` - Python script
2. `native-host/manifest.json` - Native host manifest
3. `install-native-host.bat` - Install script
4. Update `manifest.json` - Add "nativeMessaging" permission

**Kết luận**: ✅ **KHUYẾN NGHỊ** cho power users

---

### ⚠️ Giải Pháp 3: Invidious API

**Ý tưởng**: Dùng Invidious (alternative YouTube frontend) API để lấy video URLs

**Cách hoạt động**:
1. Extract video ID từ YouTube URL
2. Call Invidious API: `https://invidious.instance.com/api/v1/videos/{videoId}`
3. Get direct video URLs từ response
4. Download như bình thường

**API Example**:
```javascript
async function getInvidiousUrls(videoId) {
  const instance = 'https://inv.riverside.rocks'; // Public instance
  const response = await fetch(`${instance}/api/v1/videos/${videoId}`);
  const data = await response.json();
  
  return data.adaptiveFormats.map(f => ({
    quality: f.qualityLabel,
    url: f.url, // Direct URL - no signature!
    type: f.type
  }));
}
```

**Ưu điểm**:
- ✅ **ĐơN giản** - chỉ cần fetch API
- ✅ **No signature decoding** - Invidious đã xử lý
- ✅ Chạy hoàn toàn client-side

**Nhược điểm**:
- ❌ **PHỤ THUỘC** external service
- ❌ **BẤT ỔN ĐỊNH** - public instances hay down
- ❌ **Rate limits** - có thể bị giới hạn requests
- ❌ **Privacy concerns** - gửi video IDs đến third-party

**Kết luận**: ⚠️ **CÂN NHẮC** - OK cho prototype nhưng không reliable lâu dài

---

### ❌ Giải Pháp 4: YouTube Data API v3

**Ý tưởng**: Dùng official YouTube API

**Vấn đề**:
- ❌ YouTube Data API **KHÔNG** cung cấp video download URLs
- ❌ Chỉ có metadata (title, description, thumbnails)
- ❌ Cần API key + quota limits

**Kết luận**: ❌ **KHÔNG KHẢ THI** - API không support download

---

### ❌ Giải Pháp 5: Iframe Video Interceptor

**Ý tưởng**: Tạo hidden iframe, load video, intercept video chunks

**Cách hoạt động**:
1. Tạo `<iframe src="youtube-video-url">`
2. Intercept network requests từ iframe
3. Capture video chunks khi YouTube load
4. Merge chunks thành MP4

**Vấn đề**:
- ❌ **KHÔNG HOẠT ĐỘNG** - Chrome extension không thể intercept iframe requests từ youtube.com (Same-Origin Policy)
- ❌ Cần webRequest API với blocking mode (Manifest V3 không support)

**Kết luận**: ❌ **KHÔNG KHẢ THI** với Manifest V3

---

## 🎯 GIẢI PHÁP ĐỀ XUẤT (3-Tier Approach)

Implement **3 options** cho user tùy technical level:

### 🥇 Tier 1: Quick Copy URL (EASY - Everyone)

**Target**: Mọi user

**Flow**:
1. Detect YouTube video
2. Show in list với button "📋 Copy URL"
3. Click → copy URL + show instruction
4. User paste vào [y2mate.com](https://y2mate.com) hoặc yt-dlp

**Implementation**:
- ✅ 10 dòng code
- ✅ Works ngay lập tức
- ✅ No dependencies

**Code**:
```javascript
// popup.js
function copyUrlForDownload(video) {
  navigator.clipboard.writeText(video.url);
  
  const instruction = `
    ✅ URL copied!
    
    Option 1: Use online tool
    → Paste at: https://y2mate.com
    
    Option 2: Use yt-dlp (best quality)
    → Run: yt-dlp "${video.url}"
  `;
  
  alert(instruction);
}
```

---

### 🥈 Tier 2: Invidious API (MEDIUM - Tech-savvy users)

**Target**: Users muốn download trong extension

**Flow**:
1. Detect YouTube video
2. Click "Download" → fetch Invidious API
3. Show quality options (360p, 720p, 1080p)
4. Download selected quality

**Implementation**:
- ⚠️ ~50 dòng code
- ⚠️ Cần handle API errors
- ⚠️ Có thể unstable

**Code**:
```javascript
// modules/invidiousHelper.js
class InvidiousHelper {
  constructor() {
    this.instances = [
      'https://inv.riverside.rocks',
      'https://invidious.snopyta.org',
      'https://yewtu.be'
    ];
  }
  
  async getVideoUrls(videoId) {
    for (const instance of this.instances) {
      try {
        const response = await fetch(`${instance}/api/v1/videos/${videoId}`);
        const data = await response.json();
        
        return {
          formats: data.adaptiveFormats.map(f => ({
            quality: f.qualityLabel,
            url: f.url,
            itag: f.itag,
            type: f.type,
            hasVideo: !f.type.includes('audio'),
            hasAudio: f.type.includes('audio')
          })),
          title: data.title
        };
      } catch (err) {
        console.log(`Instance ${instance} failed, trying next...`);
      }
    }
    
    throw new Error('All Invidious instances failed');
  }
}
```

---

### 🥇 Tier 3: Native Host + yt-dlp (ADVANCED - Power users)

**Target**: Power users muốn seamless experience

**Flow**:
1. One-time setup: Run `install-native-host.bat`
2. Detect YouTube video
3. Click "Download with yt-dlp" → instant download
4. File saved to Downloads folder

**Implementation**:
- ⚠️ ~200 dòng code + setup files
- ✅ Best quality
- ✅ Most reliable

**Files Structure**:
```
native-host/
  ├── youtube-downloader.py      # Native host script
  ├── manifest.json               # Native host manifest
  ├── install.bat                 # Windows installer
  └── install.sh                  # Linux/Mac installer
```

**Python Script** (`youtube-downloader.py`):
```python
#!/usr/bin/env python3
import sys
import json
import struct
import subprocess
import os

def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def read_message():
    text_length_bytes = sys.stdin.buffer.read(4)
    if len(text_length_bytes) == 0:
        sys.exit(0)
    
    text_length = struct.unpack('I', text_length_bytes)[0]
    text = sys.stdin.buffer.read(text_length).decode('utf-8')
    return json.loads(text)

def download_video(url, quality='best'):
    try:
        # Get Downloads folder
        downloads = os.path.join(os.path.expanduser('~'), 'Downloads')
        
        # Run yt-dlp
        cmd = [
            'yt-dlp',
            '-f', f'bestvideo[height<={quality}]+bestaudio/best',
            '-o', os.path.join(downloads, '%(title)s.%(ext)s'),
            url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            return {'success': True, 'message': 'Download completed'}
        else:
            return {'success': False, 'error': result.stderr}
            
    except Exception as e:
        return {'success': False, 'error': str(e)}

# Main loop
while True:
    message = read_message()
    
    if message['action'] == 'download':
        result = download_video(message['url'], message.get('quality', 'best'))
        send_message(result)
    elif message['action'] == 'ping':
        send_message({'status': 'ok'})
```

**Extension Code** (`background-simple.js`):
```javascript
// Check if native host is available
async function checkNativeHost() {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      'com.videodownloader.youtube',
      { action: 'ping' },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(response?.status === 'ok');
        }
      }
    );
  });
}

// Download via native host
async function downloadViaYtDlp(url, quality = '1080') {
  const available = await checkNativeHost();
  
  if (!available) {
    return {
      success: false,
      error: 'Native host not installed. Please run install-native-host.bat'
    };
  }
  
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      'com.videodownloader.youtube',
      { 
        action: 'download',
        url: url,
        quality: quality
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      }
    );
  });
}
```

---

## 📊 So Sánh Các Giải Pháp

| Giải Pháp | Độ Khó | Reliability | User Experience | Speed |
|-----------|--------|-------------|-----------------|-------|
| Copy URL (Manual) | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Invidious API | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Native + yt-dlp | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Signature Decode | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 🚀 ROADMAP Đề Xuất

### Phase 1: Quick Win (1-2 giờ)
- ✅ Implement "Copy URL" button
- ✅ Add instructions cho yt-dlp
- ✅ Test với 5-10 videos

### Phase 2: Enhanced (1 ngày)
- ⚠️ Implement Invidious API integration
- ⚠️ Add quality selector UI
- ⚠️ Add fallback giữa multiple instances
- ⚠️ Error handling

### Phase 3: Advanced (2-3 ngày)
- 🔵 Create Native Host script
- 🔵 Create install scripts (Windows/Mac/Linux)
- 🔵 Add Native Host detection
- 🔵 Integration vào extension
- 🔵 Testing end-to-end

### Phase 4: Polish (1 ngày)
- 🔵 UI improvements
- 🔵 Progress tracking
- 🔵 Error messages
- 🔵 Documentation

---

## 🎯 KẾT LUẬN & ĐỀ XUẤT

### Cho MVP (Minimum Viable Product):
**→ IMPLEMENT TIER 1 + TIER 2**

1. **Tier 1 (Copy URL)** - 1 giờ:
   - Thêm button "Copy URL"  
   - Show instruction popup
   - Test với users

2. **Tier 2 (Invidious)** - 4 giờ:
   - Integrate Invidious API
   - Quality selector
   - Error handling

→ **Total: ~5 giờ work** cho giải pháp hoạt động được

### Cho Production Ready:
**→ ADD TIER 3 (Native Host)**

- Setup guide rõ ràng
- Install scripts tự động
- Fallback gracefully khi không có Native Host

→ **Total: +2 ngày** cho full-featured solution

---

## ❓ CÂU HỎI CHO BẠN

1. **Bạn muốn implement giải pháp nào?**
   - [ ] Tier 1 only (Copy URL - simplest)
   - [ ] Tier 1 + Tier 2 (Copy + Invidious API)
   - [ ] All 3 tiers (Full solution)

2. **Target users?**
   - [ ] General users (cần simple)
   - [ ] Tech-savvy users (OK với terminal)
   - [ ] Power users (muốn best quality)

3. **Priority?**
   - [ ] Ship nhanh (MVP first)
   - [ ] Feature-complete (implement hết)

**Tôi recommend**: Start với **Tier 1 + Tier 2** để có working solution ngay, sau đó add Tier 3 nếu có users request.

Bạn muốn tôi implement giải pháp nào trước?

---

**Last Updated**: 2026-01-23
**Status**: Proposal - Pending Decision
