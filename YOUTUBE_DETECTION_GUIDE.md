# YouTube Video Detection Guide

## 📋 Tổng Quan

Tài liệu này mô tả cách extension detect video YouTube và các phương pháp được sử dụng. **ĐỌC KỸ TRƯỚC KHI CHỈNH SỬA CODE!**

## 🎯 Mục Tiêu

Detect video YouTube mới khi user:
- Click vào video mới trong YouTube (Single Page Application navigation)
- Load trang YouTube trực tiếp
- Autoplay video tiếp theo

## 🏗️ Kiến Trúc

### 1. Luồng Detection

```
injected.js (Page Context)
    ↓ window.postMessage()
content.js (Content Script)
    ↓ chrome.runtime.sendMessage()
background-simple.js (Service Worker)
    ↓ Store in detectedVideos Map
popup.js (Extension Popup)
    ↓ Display video list
```

### 2. Files Liên Quan

- **injected.js**: Chạy trong page context, intercept YouTube APIs
- **content.js**: Bridge giữa page và extension
- **background-simple.js**: Service worker, lưu trữ videos
- **popup.js**: UI hiển thị danh sách videos

## 🔧 Các Phương Pháp Detection

### ⭐ Method 1: Fetch API Interceptor (PRIMARY)

**File**: `injected.js` lines 278-318

**Hoạt động**: Intercept tất cả `fetch()` requests và bắt `/youtubei/v1/player` API

**Code Pattern**:
```javascript
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  
  if (url && url.includes('/youtubei/v1/player')) {
    return originalFetch.apply(this, args).then(response => {
      const clone = response.clone();
      clone.json().then(data => {
        const videoId = data?.videoDetails?.videoId;
        if (videoId && videoId !== lastExtractedVideoId) {
          extractYouTubeVideoInfo(data);
          lastExtractedVideoId = videoId;
        }
      });
      return response;
    });
  }
  
  return originalFetch.apply(this, args);
};
```

**Quan Trọng**:
- ✅ PHẢI clone response trước khi đọc (`.clone()`)
- ✅ PHẢI return original response cho YouTube
- ✅ PHẢI track `lastExtractedVideoId` để tránh duplicate
- ❌ KHÔNG được modify response
- ❌ KHÔNG được block request

**Triggers khi**:
- User click video mới
- Autoplay video tiếp theo
- Refresh trang

---

### ⭐ Method 2: XMLHttpRequest Interceptor (FALLBACK)

**File**: `injected.js` lines 320-358

**Hoạt động**: Intercept XHR nếu YouTube dùng XMLHttpRequest thay vì Fetch

**Code Pattern**:
```javascript
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._url = url;
  return originalXHROpen.apply(this, [method, url, ...rest]);
};

XMLHttpRequest.prototype.send = function(...args) {
  if (this._url && this._url.includes('/youtubei/v1/player')) {
    this.addEventListener('load', function() {
      const data = JSON.parse(this.responseText);
      const videoId = data?.videoDetails?.videoId;
      if (videoId && videoId !== lastExtractedVideoId) {
        extractYouTubeVideoInfo(data);
        lastExtractedVideoId = videoId;
      }
    });
  }
  return originalXHRSend.apply(this, args);
};
```

**Quan Trọng**:
- ✅ PHẢI lưu URL trong `this._url` ở `open()`
- ✅ PHẢI dùng `addEventListener('load')` không phải `onload`
- ✅ PHẢI parse JSON an toàn với try-catch

---

### ⭐ Method 3: ytplayer.config Monitor (NEW)

**File**: `injected.js` lines 366-399

**Hoạt động**: Poll `window.ytplayer.config` object để lấy player data trực tiếp

**Code Pattern**:
```javascript
const checkYtPlayer = setInterval(() => {
  if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
    const playerData = window.ytplayer.config.args;
    const videoId = playerData.video_id;
    
    if (videoId && videoId !== lastExtractedVideoId) {
      clearInterval(checkYtPlayer);
      if (playerData.player_response) {
        const playerResponse = typeof playerData.player_response === 'string' 
          ? JSON.parse(playerData.player_response) 
          : playerData.player_response;
        
        extractYouTubeVideoInfo(playerResponse);
        lastExtractedVideoId = videoId;
      }
    }
  }
}, 500);
```

**Quan Trọng**:
- ✅ PHẢI clear interval sau khi tìm thấy
- ✅ PHẢI parse `player_response` string thành JSON
- ✅ PHẢI có timeout (max 10 attempts)
- ⚠️ Chỉ chạy khi Method 1 & 2 fail

---

### ⭐ Method 4: ytInitialPlayerResponse Polling (LEGACY)

**File**: `injected.js` lines 427-459

**Hoạt động**: Poll `window.ytInitialPlayerResponse` global variable (OLD YouTube)

**Status**: ❌ **DEPRECATED** - YouTube hiện đại không expose biến này

**Code Pattern**:
```javascript
let pollAttempts = 0;
const pollInterval = setInterval(() => {
  pollAttempts++;
  
  if (window.ytInitialPlayerResponse) {
    const videoId = window.ytInitialPlayerResponse?.videoDetails?.videoId;
    if (videoId && videoId !== lastExtractedVideoId) {
      clearInterval(pollInterval);
      extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
      lastExtractedVideoId = videoId;
    }
  }
  
  if (pollAttempts >= 20) {
    clearInterval(pollInterval);
  }
}, 500);
```

**Quan Trọng**:
- ⚠️ Method này KHÔNG còn hoạt động với YouTube hiện đại
- ✅ GIỮ LẠI để tương thích với các trang embed YouTube cũ
- ✅ PHẢI có max attempts để tránh loop vô hạn

---

## 📦 extractYouTubeVideoInfo() Function

**File**: `injected.js` lines 461-628

**Nhiệm vụ**: Parse player data và gửi message lên extension

### Input Data Structure

```javascript
{
  videoDetails: {
    videoId: "VIDEO_ID",
    title: "Video Title",
    lengthSeconds: "360",
    isLiveContent: false
  },
  streamingData: {
    adaptiveFormats: [
      {
        itag: 137,
        mimeType: "video/mp4; codecs=\"avc1.640028\"",
        url: "https://...", // Direct URL (best case)
        signatureCipher: "...", // OR signature cipher (needs decoding)
        width: 1920,
        height: 1080,
        bitrate: 4887249,
        hasVideo: true,
        hasAudio: false
      },
      // ... more formats
    ],
    dashManifestUrl: "https://...", // DASH manifest (fallback)
    hlsManifestUrl: "https://..." // HLS manifest (live videos)
  }
}
```

### Detection Flow

```
1. Extract videoDetails
   ↓
2. Check streamingData.adaptiveFormats
   ↓
3. Filter formats with direct URLs (f.url exists)
   ↓
4. IF direct URLs found:
     → Send formats to extension
   ELSE:
     → Check dashManifestUrl
     → Check hlsManifestUrl
     → Send page URL as fallback
   ↓
5. Post message via window.postMessage()
```

### Important Cases

#### ✅ CASE 1: Direct URLs Available (BEST)

```javascript
const availableFormats = formats.filter(f => f.url);
if (availableFormats.length > 0) {
  // Send formats with direct URLs
  const messageData = {
    type: 'VIDEO_MANIFEST_DETECTED',
    format: 'youtube',
    url: window.location.href,
    formats: availableFormats.map(f => ({
      itag: f.itag,
      url: f.url,
      mimeType: f.mimeType,
      width: f.width,
      height: f.height,
      bitrate: f.bitrate,
      hasVideo: !f.mimeType.includes('audio'),
      hasAudio: f.mimeType.includes('audio')
    })),
    videoInfo: { ... }
  };
  window.postMessage(messageData, '*');
}
```

#### ⚠️ CASE 2: Signature Cipher Only (NEEDS DECODING)

Formats chỉ có `signatureCipher` field, không có `url`:

```javascript
if (availableFormats.length === 0) {
  // Fallback to manifest URLs
  if (streamingData.dashManifestUrl) {
    const messageData = {
      type: 'VIDEO_MANIFEST_DETECTED',
      format: 'youtube-dash',
      url: streamingData.dashManifestUrl,
      videoInfo: { ... }
    };
    window.postMessage(messageData, '*');
  }
  
  // Or fallback to page URL
  if (!streamingData.dashManifestUrl && !streamingData.hlsManifestUrl) {
    const messageData = {
      type: 'VIDEO_MANIFEST_DETECTED',
      format: 'youtube',
      url: window.location.href,
      videoInfo: {
        ...
        note: 'Formats require signature decoding - use yt-dlp'
      }
    };
    window.postMessage(messageData, '*');
  }
}
```

---

## 🔄 Reset Detection State

**File**: `injected.js` lines 401-425

**Trigger**: Khi detect navigation event trong YouTube SPA

**Events**:
- `yt-navigate-finish` - YouTube's custom navigation event
- URL change detection (polling every 500ms)
- Title element mutation

**Code Pattern**:
```javascript
function resetYouTubeDetection() {
  youtubePlayerDetected = false;
  lastYouTubePlaybackId = null;
  lastExtractedVideoId = null; // ⚠️ CRITICAL - must reset!
  
  // Clear manifest cache
  detectedManifests.delete('youtube-segments-detected');
  
  // Clear YouTube-related manifests
  for (const key of detectedManifests) {
    if (key.includes('youtube.com') || key.includes('googlevideo.com')) {
      detectedManifests.delete(key);
    }
  }
  
  // Start polling for new video...
}
```

**Quan Trọng**:
- ✅ PHẢI reset `lastExtractedVideoId = null`
- ✅ PHẢI clear manifest cache
- ✅ PHẢI start new polling cycle
- ❌ KHÔNG được skip reset bất kỳ biến nào

---

## 🎪 Navigation Event Listeners

**File**: `injected.js` lines 654-720

### Event 1: yt-navigate-finish

```javascript
document.addEventListener('yt-navigate-finish', () => {
  console.log('[Injected] yt-navigate-finish event detected');
  resetYouTubeDetection();
});
```

**Triggers**: YouTube SPA navigation complete

### Event 2: URL Polling

```javascript
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    console.log('[Injected] URL changed:', lastUrl, '->', window.location.href);
    lastUrl = window.location.href;
    resetYouTubeDetection();
  }
}, 500);
```

**Triggers**: URL change (fallback if yt-navigate-finish fails)

### Event 3: Title MutationObserver

```javascript
const titleObserver = new MutationObserver(() => {
  const newTitle = document.title;
  if (newTitle !== lastVideoTitle) {
    console.log('[Injected] Title changed:', lastVideoTitle, '->', newTitle);
    lastVideoTitle = newTitle;
    resetYouTubeDetection();
  }
});

const titleElement = document.querySelector('title');
if (titleElement) {
  titleObserver.observe(titleElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
}
```

**Triggers**: Document title change (additional fallback)

---

## ⚠️ CRITICAL - Common Mistakes

### ❌ MISTAKE 1: Không Track lastExtractedVideoId

```javascript
// WRONG - sẽ detect duplicate
if (videoId) {
  extractYouTubeVideoInfo(data);
}

// CORRECT - check videoId khác trước
if (videoId && videoId !== lastExtractedVideoId) {
  extractYouTubeVideoInfo(data);
  lastExtractedVideoId = videoId;
}
```

### ❌ MISTAKE 2: Không Clone Response

```javascript
// WRONG - consume response
fetch(url).then(response => {
  response.json().then(data => { ... });
  return response; // ← Response đã consumed!
});

// CORRECT - clone trước
fetch(url).then(response => {
  const clone = response.clone();
  clone.json().then(data => { ... });
  return response; // ← Original response intact
});
```

### ❌ MISTAKE 3: Không Reset State

```javascript
// WRONG - không reset
document.addEventListener('yt-navigate-finish', () => {
  // Poll for new video...
});

// CORRECT - reset trước
document.addEventListener('yt-navigate-finish', () => {
  resetYouTubeDetection(); // ← Clear old state first!
});
```

### ❌ MISTAKE 4: Quên Clear Interval

```javascript
// WRONG - interval chạy mãi
setInterval(() => {
  if (found) {
    // Process...
  }
}, 500);

// CORRECT - clear khi tìm thấy
const interval = setInterval(() => {
  if (found) {
    clearInterval(interval); // ← Stop polling
    // Process...
  }
}, 500);
```

---

## 🐛 Debugging

### Log Quan Trọng

**Detection triggered**:
```
[Injected] 🎯 Intercepted fetch player API request
[Injected] ✅ NEW VIDEO detected from API, extracting...
```

**Video info extracted**:
```
[Injected] 📺 Video Details: {videoId, title, duration, isLive}
[Injected] Found X YouTube adaptive formats
```

**Message posted**:
```
[Injected] 📤 POSTING MESSAGE TO CONTENT SCRIPT: {...}
[Content] ===== VIDEO_MANIFEST_DETECTED MESSAGE RECEIVED =====
[Background-Simple] manifestDetected received: youtube
```

**Video stored**:
```
[Background-Simple] YouTube video stored with key: TABID_URL
[Background-Simple] detectedVideos Map size: X
```

### Common Issues

**Issue 1**: Video không detect
- ✅ Check: Có log "Intercepted fetch player API request"?
- ❌ Không có → API interceptor chưa chạy
- ✅ Có → Check "NEW VIDEO detected"?
- ❌ Không có → videoId trùng với lastExtractedVideoId

**Issue 2**: Duplicate videos
- ✅ Check: `lastExtractedVideoId` có được reset không?
- ✅ Check: Navigation events có trigger `resetYouTubeDetection()`?

**Issue 3**: Formats không có URL
- ✅ Check log: "No formats with direct URLs found"
- ✅ Check: Có DASH/HLS manifest URLs?
- ✅ Fallback: Send page URL để user dùng yt-dlp

---

## 📝 Message Format

### Message gửi từ injected.js → content.js

```javascript
{
  type: 'VIDEO_MANIFEST_DETECTED',
  format: 'youtube', // or 'youtube-dash', 'youtube-hls'
  url: 'https://www.youtube.com/watch?v=...',
  manifest: null,
  formats: [
    {
      itag: 137,
      url: 'https://...',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      width: 1920,
      height: 1080,
      bitrate: 4887249,
      hasVideo: true,
      hasAudio: false
    },
    // ...
  ],
  videoInfo: {
    id: 'VIDEO_ID',
    title: 'Video Title',
    duration: '360',
    isLive: false
  }
}
```

### Message gửi từ content.js → background.js

```javascript
{
  action: 'manifestDetected',
  data: {
    type: 'youtube',
    url: 'https://www.youtube.com/watch?v=...',
    videoInfo: { ... },
    formats: [ ... ],
    tabId: 12345,
    timestamp: 1234567890
  }
}
```

---

## 🔐 Security Notes

1. **Content Security Policy**: Code chạy trong page context, bypass CSP
2. **Isolation**: injected.js KHÔNG có quyền truy cập chrome APIs
3. **Message Passing**: Dùng `window.postMessage()` để gửi cross-context
4. **Origin Check**: content.js PHẢI check `event.source === window`

---

## 📚 References

- [YouTube Player API](https://developers.google.com/youtube/iframe_api_reference)
- [Chrome Extension Messaging](https://developer.chrome.com/docs/extensions/mv3/messaging/)
- [Content Script Injection](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)

---

## 🚀 Testing Checklist

- [ ] Click vào video mới → Video hiển thị trong list
- [ ] Autoplay video tiếp theo → Video mới hiển thị
- [ ] Refresh trang → Video hiện tại hiển thị
- [ ] Open YouTube link trực tiếp → Video hiển thị
- [ ] Navigate back/forward → Không duplicate
- [ ] Live stream → Detect với HLS manifest
- [ ] Embedded video → Detect qua ytInitialPlayerResponse
- [ ] Private/Restricted video → Graceful error handling

---

**Last Updated**: 2026-01-23
**Version**: 1.0
**Author**: AI Assistant

**⚠️ LƯU Ý: ĐỌC KỸ TÀI LIỆU NÀY TRƯỚC KHI CHỈNH SỬA CODE YOUTUBE DETECTION!**
