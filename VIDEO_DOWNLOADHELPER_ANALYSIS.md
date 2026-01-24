# YouTube Download - Video DownloadHelper Approach Analysis

## 🔬 Research: Cách Video DownloadHelper Download YouTube

### ❓ Câu hỏi: Tại sao Video DownloadHelper download được YouTube KHÔNG cần app thứ 3?

## 🎯 Phát Hiện Quan Trọng

Video DownloadHelper capture **VIDEO CHUNKS** trực tiếp từ YouTube player qua:

1. **Media Source Extensions (MSE)** interception
2. **Blob URLs** capture  
3. **Network request interception** (webRequest API)

**YouTube streaming architecture**:
```
YouTube Player → MSE (Media Source Extensions) → Append video chunks → Display
                     ↑
              Extension intercepts HERE
```

---

## 🔧 Technique: MSE Interception

### YouTube Player hoạt động:

```javascript
// YouTube player code (simplified)
const mediaSource = new MediaSource();
const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');

// YouTube appends video chunks
sourceBuffer.appendBuffer(videoChunk1); // ← Chunk 1
sourceBuffer.appendBuffer(videoChunk2); // ← Chunk 2
sourceBuffer.appendBuffer(videoChunk3); // ← Chunk 3
```

### Extension intercepts:

```javascript
// injected.js - Override MediaSource API
(function() {
  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  const capturedChunks = [];
  
  MediaSource.prototype.addSourceBuffer = function(mimeType) {
    console.log('[Intercept] MediaSource.addSourceBuffer:', mimeType);
    
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    const originalAppendBuffer = sourceBuffer.appendBuffer;
    
    // Intercept appendBuffer calls
    sourceBuffer.appendBuffer = function(chunk) {
      console.log('[Intercept] Captured chunk:', chunk.byteLength, 'bytes');
      
      // Save chunk for download
      capturedChunks.push(new Uint8Array(chunk));
      
      // Send to extension
      window.postMessage({
        type: 'VIDEO_CHUNK_CAPTURED',
        chunk: chunk,
        mimeType: mimeType,
        totalChunks: capturedChunks.length
      }, '*');
      
      // Call original to let video play normally
      return originalAppendBuffer.call(this, chunk);
    };
    
    return sourceBuffer;
  };
  
  console.log('[Intercept] MediaSource API hooked');
})();
```

---

## ✅ GIẢI PHÁP MỚI: MSE Chunk Capture

### Architecture:

```
YouTube Player
    ↓ appendBuffer(chunk)
MediaSource API (hooked)
    ↓ Capture chunk
injected.js
    ↓ window.postMessage()
content.js
    ↓ chrome.runtime.sendMessage()
background.js (accumulate chunks)
    ↓ Merge all chunks
Download as MP4
```

### Implementation Steps:

#### 1. Hook MediaSource trong injected.js

```javascript
// injected.js - Add this BEFORE YouTube player loads

class YouTubeChunkCapture {
  constructor() {
    this.chunks = [];
    this.mimeType = null;
    this.isCapturing = false;
    this.videoInfo = null;
  }
  
  startCapture(videoInfo) {
    this.chunks = [];
    this.videoInfo = videoInfo;
    this.isCapturing = true;
    console.log('[ChunkCapture] Started for:', videoInfo.title);
  }
  
  stopCapture() {
    this.isCapturing = false;
    console.log('[ChunkCapture] Stopped. Total chunks:', this.chunks.length);
    return this.chunks;
  }
  
  hookMediaSource() {
    const self = this;
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    
    MediaSource.prototype.addSourceBuffer = function(mimeType) {
      console.log('[MSE Hook] addSourceBuffer:', mimeType);
      self.mimeType = mimeType;
      
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      const originalAppendBuffer = sourceBuffer.appendBuffer;
      
      sourceBuffer.appendBuffer = function(chunk) {
        if (self.isCapturing) {
          console.log('[MSE Hook] Chunk captured:', chunk.byteLength, 'bytes');
          
          // Clone chunk data
          const chunkCopy = new Uint8Array(chunk).slice();
          self.chunks.push(chunkCopy);
          
          // Notify extension
          window.postMessage({
            type: 'YOUTUBE_CHUNK_CAPTURED',
            chunkSize: chunk.byteLength,
            totalChunks: self.chunks.length,
            mimeType: mimeType
          }, '*');
        }
        
        return originalAppendBuffer.call(this, chunk);
      };
      
      return sourceBuffer;
    };
    
    console.log('[ChunkCapture] MediaSource API hooked successfully');
  }
}

// Initialize on YouTube
if (window.location.hostname.includes('youtube.com')) {
  const chunkCapture = new YouTubeChunkCapture();
  chunkCapture.hookMediaSource();
  
  // Expose to window for control
  window.youtubeChunkCapture = chunkCapture;
}
```

#### 2. Content Script - Forward chunks

```javascript
// content.js - Listen for chunk messages

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'YOUTUBE_CHUNK_CAPTURED') {
    console.log('[Content] Chunk captured:', event.data.totalChunks);
    
    chrome.runtime.sendMessage({
      action: 'youtubeChunkCaptured',
      data: event.data
    });
  }
});
```

#### 3. Background - Accumulate & Download

```javascript
// background-simple.js

const youtubeChunkStorage = new Map(); // key: videoUrl, value: {chunks, mimeType, videoInfo}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'youtubeChunkCaptured') {
    const videoUrl = sender.tab.url;
    
    if (!youtubeChunkStorage.has(videoUrl)) {
      youtubeChunkStorage.set(videoUrl, {
        chunks: [],
        mimeType: message.data.mimeType,
        startTime: Date.now()
      });
    }
    
    const storage = youtubeChunkStorage.get(videoUrl);
    console.log('[Background] Captured chunk', message.data.totalChunks, 'for', videoUrl);
    
    // Update UI với progress
    chrome.runtime.sendMessage({
      action: 'chunkCaptureProgress',
      data: {
        url: videoUrl,
        chunksCount: message.data.totalChunks,
        size: storage.chunks.reduce((sum, c) => sum + c.byteLength, 0)
      }
    }).catch(() => {});
  }
  
  if (message.action === 'downloadCapturedChunks') {
    const videoUrl = message.url;
    const storage = youtubeChunkStorage.get(videoUrl);
    
    if (!storage || storage.chunks.length === 0) {
      sendResponse({success: false, error: 'No chunks captured'});
      return;
    }
    
    // Merge chunks
    const totalSize = storage.chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of storage.chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    
    // Create blob and download
    const blob = new Blob([merged], {type: storage.mimeType || 'video/mp4'});
    const dataUrl = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: dataUrl,
      filename: `youtube_${Date.now()}.mp4`,
      saveAs: true
    }, (downloadId) => {
      sendResponse({success: true, downloadId: downloadId});
      youtubeChunkStorage.delete(videoUrl);
    });
    
    return true; // async response
  }
});
```

---

## ⚠️ VẤNĐỀ với Approach này

### 🔴 Problem 1: Chunk Transfer Size Limits

- Chrome extension messages có **giới hạn kích thước** (~64MB)
- Không thể transfer chunks lớn qua `postMessage` hoặc `sendMessage`

**Solution**: Accumulate chunks TRONG injected.js, chỉ gửi metadata

```javascript
// injected.js - Store chunks locally
const capturedChunks = [];

sourceBuffer.appendBuffer = function(chunk) {
  capturedChunks.push(new Uint8Array(chunk)); // Store HERE
  
  window.postMessage({
    type: 'CHUNK_METADATA', // Only metadata, not chunk data
    chunkIndex: capturedChunks.length,
    size: chunk.byteLength
  }, '*');
  
  return originalAppendBuffer.call(this, chunk);
};

// When download requested
window.addEventListener('message', (e) => {
  if (e.data.type === 'REQUEST_DOWNLOAD') {
    // Merge chunks HERE in page context
    const merged = mergeChunks(capturedChunks);
    const blob = new Blob([merged], {type: 'video/mp4'});
    const url = URL.createObjectURL(blob);
    
    // Create hidden download link
    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube_video.mp4';
    a.click();
  }
});
```

### 🔴 Problem 2: YouTube separates Video + Audio

YouTube streams **video và audio riêng biệt**:

```
Video Track: video/mp4 (no audio)
Audio Track: audio/mp4 (no video)
```

**Solution**: Capture BOTH tracks và merge

```javascript
const videoChunks = [];
const audioChunks = [];

MediaSource.prototype.addSourceBuffer = function(mimeType) {
  const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
  const originalAppend = sourceBuffer.appendBuffer;
  
  sourceBuffer.appendBuffer = function(chunk) {
    if (mimeType.includes('video')) {
      videoChunks.push(new Uint8Array(chunk));
    } else if (mimeType.includes('audio')) {
      audioChunks.push(new Uint8Array(chunk));
    }
    
    return originalAppend.call(this, chunk);
  };
  
  return sourceBuffer;
};
```

**Vấn đề**: Merge video + audio cần **MP4 muxing** (phức tạp)

---

## 🎯 GIẢI PHÁP THỰC TẾ (Video DownloadHelper's Approach)

Video DownloadHelper THỰC SỰ làm gì:

### 1. **Manifest V2 + webRequest Blocking**

Họ vẫn dùng Manifest V2 với `webRequest` blocking mode:

```javascript
// Manifest V2
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('googlevideo.com')) {
      // Capture video segment URL
      captureVideoSegment(details.url);
    }
  },
  {urls: ['*://*.googlevideo.com/*']},
  ['blocking', 'requestBody']
);
```

→ Extension của chúng ta dùng **Manifest V3** → KHÔNG có blocking webRequest!

### 2. **Companion App (Optional)**

Cho video cần merging phức tạp, họ có companion app để:
- Merge video + audio tracks
- Convert formats
- Handle large files

---

## ✅ GIẢI PHÁP KHẢ THI cho Manifest V3

### Option A: Hybrid Approach (RECOMMENDED)

**Combine**: MSE chunk capture + Invidious API fallback

```javascript
// 1. Try MSE chunk capture first
if (canCaptureChunks()) {
  captureViaMediaSource();
} else {
  // 2. Fallback to Invidious API
  downloadViaInvidious();
}
```

**Pros**:
- ✅ Works trong extension (no external app)
- ✅ Có fallback reliable
- ✅ Manifest V3 compatible

**Cons**:
- ⚠️ MSE capture phức tạp (video + audio separate)
- ⚠️ Cần MP4 muxer (có thể dùng mp4box.js)

### Option B: Invidious API Primary (SIMPLER)

**Skip MSE complexity**, dùng Invidious làm primary:

```javascript
async function downloadYouTube(videoId) {
  // Simple and reliable
  const formats = await invidiousAPI.getFormats(videoId);
  const selectedFormat = formats.find(f => f.quality === '1080p');
  
  chrome.downloads.download({
    url: selectedFormat.url,
    filename: 'video.mp4'
  });
}
```

**Pros**:
- ✅ Simple implementation
- ✅ Works ngay
- ✅ No complex muxing

**Cons**:
- ⚠️ Phụ thuộc external API

---

## 💡 KẾT LUẬN & ĐỀ XUẤT

**Video DownloadHelper có thể download YouTube vì**:
1. Dùng Manifest V2 (webRequest blocking)
2. Có companion app cho complex cases
3. Years of development & optimization

**Extension chúng ta (Manifest V3)**:
- ❌ Không có webRequest blocking
- ❌ Không có companion app
- ✅ CÓ THỂ dùng MSE capture (nhưng phức tạp)

### 🎯 Recommendation:

**Implement theo thứ tự**:

1. **Phase 1** (Quick - 2 giờ): 
   - Invidious API integration
   - Works ngay, reliable

2. **Phase 2** (Advanced - 1 tuần):
   - MSE chunk capture experiment
   - Nếu successful → better UX
   - Nếu too complex → stick với Invidious

**Bạn muốn**:
- [ ] **A**: Implement Invidious API ngay (simple, works now)
- [ ] **B**: Research MSE capture trước (complex, experimental)
- [ ] **C**: Cả hai song song (Invidious + MSE experiment)

Tôi recommend **Option A** để có working solution nhanh! 🚀

---

**Last Updated**: 2026-01-23
**Research Source**: Video DownloadHelper reverse engineering analysis
