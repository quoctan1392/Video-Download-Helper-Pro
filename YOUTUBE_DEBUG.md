# YouTube Detection Debugging Guide

Nếu bạn không thấy video YouTube được detect, hãy làm theo các bước sau để debug:

## Bước 1: Kiểm tra Console Logs

### 1.1 Mở Developer Tools
1. Mở YouTube và chọn một video
2. Nhấn `F12` để mở DevTools
3. Chuyển sang tab **Console**

### 1.2 Kiểm tra Injected Script
Bạn nên thấy các log sau:
```
[Injected] Video detection script loaded
[Injected] YouTube detected, starting player interception...
[Injected] DOMContentLoaded - starting detection
[Injected] Starting YouTube player interception...
```

Nếu không thấy, có thể:
- Extension chưa được load đúng
- Injected script bị block
- Cần reload lại trang

### 1.3 Kiểm tra Player Response
Khi video bắt đầu play, bạn nên thấy:
```
[Injected] YouTube player detected via ytInitialPlayerResponse
[Injected] Extracting YouTube video info...
[Injected] playerResponse: {videoDetails: {...}, streamingData: {...}}
[Injected] streamingData found: {formats: [...], adaptiveFormats: [...]}
```

Nếu thấy:
```
[Injected] No streaming data found in playerResponse
```
Có nghĩa là video có thể:
- Chưa load xong
- Bị giới hạn (age-restricted, region-locked)
- Có DRM protection

### 1.4 Kiểm tra Content Script
```
[Content] Received manifest from injected script: youtube-dash YouTube video
[Content] YouTube video info: [Video Title]
[Content] Sending to background...
[Content] Background response for manifest: {success: true}
```

### 1.5 Kiểm tra Background Script
Mở background service worker console:
1. Vào `chrome://extensions/`
2. Tìm extension
3. Click "service worker" link
4. Kiểm tra logs:
```
[Background-Simple] manifestDetected: youtube-dash
[Background-Simple] YouTube video detected: youtube-dash
[Background-Simple] YouTube video stored with key: ...
```

## Bước 2: Kiểm tra Network Requests

### 2.1 Mở Network Tab
1. DevTools > **Network** tab
2. Filter: `googlevideo`
3. Play video

### 2.2 Tìm videoplayback requests
Bạn nên thấy nhiều requests đến:
```
https://rr2---sn-42u-i5os7.googlevideo.com/videoplayback?expire=...
```

Nếu thấy requests này, extension nên log:
```
[Injected] YouTube video segment detected: https://rr2---sn...
```

## Bước 3: Manual Testing

### 3.1 Check ytInitialPlayerResponse
Trong Console, gõ:
```javascript
console.log(window.ytInitialPlayerResponse);
```

Nếu trả về `undefined`, thử:
```javascript
// Search in page scripts
let scripts = document.querySelectorAll('script');
for(let script of scripts) {
  if(script.textContent.includes('ytInitialPlayerResponse')) {
    console.log('Found in script tag!');
    break;
  }
}
```

### 3.2 Manual Extract
```javascript
// Try to find player data
if (window.ytInitialPlayerResponse) {
  const data = window.ytInitialPlayerResponse;
  console.log('Video ID:', data.videoDetails?.videoId);
  console.log('Title:', data.videoDetails?.title);
  console.log('Has streamingData:', !!data.streamingData);
  console.log('Formats count:', data.streamingData?.formats?.length);
  console.log('Adaptive formats:', data.streamingData?.adaptiveFormats?.length);
}
```

### 3.3 Check Video Element
```javascript
const video = document.querySelector('video');
console.log('Video element found:', !!video);
console.log('Video src:', video?.src);
console.log('Video currentSrc:', video?.currentSrc);
```

## Bước 4: Common Issues & Solutions

### Issue 1: "No streaming data found"
**Nguyên nhân:**
- Video age-restricted
- Video region-locked
- YouTube changed API

**Giải pháp:**
- Đăng nhập YouTube account
- Sử dụng VPN nếu region-locked
- Reload extension và thử lại

### Issue 2: "Injected script not loaded"
**Nguyên nhân:**
- CSP (Content Security Policy) block
- Extension permissions không đủ

**Giải pháp:**
```javascript
// Check if script injected
console.log(document.querySelector('script[src*="injected.js"]'));
```

Nếu `null`, reload extension:
1. `chrome://extensions/`
2. Click reload icon
3. Reload YouTube page

### Issue 3: "Background service worker inactive"
**Nguyên nhân:**
- Service worker tự động sleep sau 30s không hoạt động

**Giải pháp:**
1. Mở background console (keeps it alive)
2. Click extension icon để wake service worker
3. Click "Refresh" button trong popup

### Issue 4: "YouTube player detection timeout"
**Nguyên nhân:**
- Trang load chậm
- YouTube API chưa ready

**Giải pháp:**
- Đợi video load hoàn toàn
- Click "Refresh" trong extension popup
- Reload trang YouTube

## Bước 5: Force Detection

### Manual Trigger từ Console
```javascript
// Send message to extension
window.postMessage({
  type: 'VIDEO_MANIFEST_DETECTED',
  format: 'youtube-dash',
  url: window.location.href,
  videoInfo: {
    title: document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent,
    id: new URLSearchParams(window.location.search).get('v')
  }
}, '*');
```

### Reload Content Script
```javascript
// From popup console
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    files: ['content.js']
  });
});
```

## Bước 6: Report Issue

Nếu vẫn không hoạt động, thu thập thông tin sau:

### Console Logs
1. Copy toàn bộ logs từ:
   - Page console (F12)
   - Background service worker console
   - Extension popup console

### Video Info
- Video URL: `https://youtube.com/watch?v=...`
- Video type: (normal/live/premiere/age-restricted/etc)
- Browser: Chrome version
- Extension version

### Network Info
- Check Network tab có thấy `googlevideo.com` requests không?
- Có lỗi CORS hay CSP không?

### Screenshots
- Extension popup (showing "No videos found")
- Console với error messages
- Network tab showing requests

## Advanced Debugging

### Enable Verbose Logging
```javascript
// Add to injected.js temporarily
window.DEBUG_YOUTUBE = true;
```

### Monitor All API Calls
```javascript
// Intercept ALL XHR
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  if (url.includes('youtube') || url.includes('googlevideo')) {
    console.log('[XHR]', method, url.substring(0, 100));
  }
  return originalOpen.apply(this, arguments);
};
```

### Check Extension Permissions
```javascript
chrome.permissions.getAll((permissions) => {
  console.log('Permissions:', permissions);
});
```

## Troubleshooting Checklist

- [ ] Extension installed and enabled
- [ ] Page reloaded after extension install
- [ ] DevTools console open (F12)
- [ ] Seeing `[Injected]` logs in console
- [ ] Video is playing (not paused)
- [ ] Not age-restricted or region-locked video
- [ ] Background service worker is active
- [ ] No CSP or CORS errors in console
- [ ] Network tab shows `googlevideo.com` requests
- [ ] `window.ytInitialPlayerResponse` exists
- [ ] Content script loaded (check sources tab)

## Expected Log Sequence

Khi mọi thứ hoạt động đúng:

```
1. [Injected] Video detection script loaded
2. [Injected] YouTube detected, starting player interception...
3. [Injected] Starting YouTube player interception...
4. [Injected] YouTube player detected via ytInitialPlayerResponse
5. [Injected] Extracting YouTube video info...
6. [Injected] streamingData found: {...}
7. [Injected] Found YouTube DASH manifest: https://...
8. [Content] Received manifest from injected script: youtube-dash
9. [Content] YouTube video info: Video Title
10. [Background-Simple] manifestDetected: youtube-dash
11. [Background-Simple] YouTube video detected
12. [Popup] Video detected, adding incrementally...
```

Nếu bạn thấy chuỗi logs này, extension đang hoạt động đúng!
