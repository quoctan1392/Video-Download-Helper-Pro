# Kiến trúc Mới - Video Download Helper (Refactored)

## 📁 Cấu trúc Thư mục

```
injected/
├── index.js                           # Entry point - khởi tạo tất cả
│
├── core/                              # Core functionality
│   ├── detector-base.js               # Base class cho detectors
│   ├── message-bus.js                 # Message routing system
│   └── interceptors.js                # Shared fetch/XHR hooks
│
├── detectors/                         # Video detection modules
│   ├── youtube-detector.js            # YouTube video detection
│   ├── dash-detector.js               # DASH manifest detection
│   ├── hls-detector.js                # HLS manifest detection
│   └── mpd-detector.js                # MPD manifest detection
│
├── downloaders/                       # Download handlers
│   └── mse-downloader.js              # MSE chunk capture (YouTube)
│
└── utils/                             # Utilities
    ├── logger.js                      # Centralized logging
    ├── format-detector.js             # Format detection
    └── manifest-parser.js             # Manifest parsing
```

## 🔄 Luồng Hoạt động

### 1. Khởi tạo
```
content.js
  ├─> injected/utils/*.js (logger, format-detector, manifest-parser)
  ├─> injected/core/*.js (message-bus, interceptors, detector-base)
  ├─> injected/detectors/*.js (youtube, dash, hls, mpd)
  ├─> injected/downloaders/*.js (mse-downloader)
  └─> injected/index.js (initialize all)
```

### 2. Detection Flow
```
User navigates to video page
  │
  ├─> YouTube Detector
  │     ├─ Intercepts API calls (fetch/XHR)
  │     ├─ Monitors ytInitialPlayerResponse
  │     ├─ Tracks URL changes
  │     └─> Emits VIDEO_DETECTED event
  │
  ├─> DASH/HLS/MPD Detectors
  │     ├─ Network Interceptors catch manifests
  │     ├─ Parse manifest content
  │     └─> Emit VIDEO_MANIFEST_DETECTED event
  │
  └─> Message Bus
        └─> Send to content script → background → popup
```

### 3. Download Flow (YouTube MSE)
```
User clicks Download
  │
  └─> popup.js sends DOWNLOAD_MSE_CHUNKS
        │
        └─> content.js → injected/index.js
              │
              └─> MSE Downloader
                    ├─ Start capture
                    ├─ Force load full video (seek through)
                    ├─ Capture all chunks
                    ├─ Merge video + audio
                    └─> Trigger browser download
```

## 🧩 Các Components

### Core Components

#### DetectorBase (detector-base.js)
- Abstract base class cho tất cả detectors
- Provides: `init()`, `detect()`, `emitDetection()`, `reset()`
- Manages: Detected videos map, enabled state

#### MessageBus (message-bus.js)
- Centralized event system
- Handles: message routing, listeners
- Methods: `on()`, `off()`, `emit()`, `sendToContentScript()`

#### Interceptors (interceptors.js)
- Network request interception
- Hooks: XMLHttpRequest, Fetch API, Player libraries
- Auto-detects: DASH (.mpd), HLS (.m3u8) manifests

### Detector Components

#### YouTubeDetector (youtube-detector.js)
- **Extends**: DetectorBase
- **Purpose**: Detect YouTube videos
- **Methods**:
  - `installFetchInterceptor()` - Intercept /youtubei/v1/player
  - `installXHRInterceptor()` - Intercept XHR requests
  - `monitorYtPlayerConfig()` - Watch ytplayer.config
  - `monitorYtInitialPlayerResponse()` - Watch global variable
  - `trackNavigation()` - Detect video changes
  - `extractVideoInfo()` - Parse player response

#### DASHDetector / HLSDetector / MPDDetector
- **Extends**: DetectorBase
- **Purpose**: Detect streaming manifests
- **Works with**: Interceptors (callbacks)
- **Simple**: Just handle detection and parsing

### Downloader Components

#### MSEDownloader (mse-downloader.js)
- **Purpose**: Capture YouTube video via MediaSource Extension
- **Methods**:
  - `startCapture()` - Begin chunk capture
  - `hookMediaSource()` - Hook MSE API
  - `forceLoadFullVideo()` - Seek through video
  - `stopCapture()` - Stop and return chunks
  - `formatBytes()` - Format size display

### Utility Components

#### Logger (logger.js)
- Centralized logging with prefix
- Methods: `log()`, `info()`, `warn()`, `error()`, `success()`, `debug()`

#### FormatDetector (format-detector.js)
- Detect video formats from URLs
- Methods: `detectFromUrl()`, `isManifest()`, `isVideoSegment()`

#### ManifestParser (manifest-parser.js)
- Parse DASH/HLS manifests
- Methods: `parseDash()`, `parseHls()`, `parse()`

## 📦 Module Dependencies

```
index.js
  ├─ depends on: All modules
  │
  ├─ core/message-bus.js
  │   └─ no dependencies
  │
  ├─ core/interceptors.js
  │   ├─ depends on: logger.js
  │   └─ depends on: message-bus.js
  │
  ├─ core/detector-base.js
  │   ├─ depends on: logger.js
  │   └─ depends on: message-bus.js
  │
  ├─ detectors/*.js
  │   ├─ depends on: detector-base.js
  │   ├─ depends on: logger.js
  │   └─ depends on: interceptors.js (for DASH/HLS/MPD)
  │
  └─ downloaders/mse-downloader.js
      ├─ depends on: logger.js
      └─ depends on: message-bus.js
```

## 🔧 Cách Thêm Detector Mới

1. **Tạo file mới** trong `injected/detectors/`
2. **Extend DetectorBase**:
```javascript
class MyDetector extends window.VDDetectorBase {
  constructor() {
    super('MyDetector');
  }
  
  init() {
    // Setup detection logic
  }
  
  detect() {
    // Manual detection trigger
  }
}

window.VDMyDetector = MyDetector;
```

3. **Đăng ký trong index.js**:
```javascript
if (window.VDMyDetector) {
  const myDetector = new window.VDMyDetector();
  myDetector.init();
  detectors.push(myDetector);
}
```

4. **Update content.js** để inject file mới

## 🚀 Cách Thêm Downloader Mới

1. **Tạo file** trong `injected/downloaders/`
2. **Implement download logic**
3. **Đăng ký message handler** trong `index.js`:
```javascript
window.VDMessageBus.on('MY_DOWNLOAD', async (data) => {
  // Handle download
});
```

## 📝 Global Variables

Tất cả modules expose via `window`:

- `window.VDLogger` - Logger instance
- `window.VDMessageBus` - Message bus instance
- `window.VDInterceptors` - Interceptors instance
- `window.VDDetectorBase` - DetectorBase class
- `window.VDYouTubeDetector` - YouTube detector class
- `window.VDDASHDetector` - DASH detector class
- `window.VDHLSDetector` - HLS detector class
- `window.VDMPDDetector` - MPD detector class
- `window.VDMSEDownloader` - MSE downloader class
- `window.VDFormatDetector` - Format detector
- `window.VDManifestParser` - Manifest parser

## 🔒 Backward Compatibility

- `window.mseCapture` - Alias for MSE downloader instance
- Old message types still supported
- Gradual migration path

## ✅ Lợi ích của Kiến trúc Mới

1. **Separation of Concerns**: Mỗi detector/downloader độc lập
2. **Maintainability**: Files nhỏ (50-500 dòng), dễ đọc
3. **Extensibility**: Thêm detector mới không ảnh hưởng code cũ
4. **Testability**: Test từng module riêng
5. **Scalability**: Plugin architecture, dễ mở rộng
6. **Debugging**: Dễ trace issues, centralized logging

## 🔄 Migration từ Old Code

- Old file: `injected.js` (1,367 dòng)
- Backup: `injected.js.backup`
- Rollback: Comment out new files, uncomment old injection in content.js

---

**Tạo bởi**: Refactoring Phase - Jan 2026
**Version**: 2.0
