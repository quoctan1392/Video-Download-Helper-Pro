# Video Download Helper - UX Standards

## Mục đích
Document này định nghĩa các chuẩn trải nghiệm người dùng (UX) cho extension Video Download Helper, đảm bảo tất cả các nguồn download video (DASH, HLS, MPD, YouTube MSE, v.v.) đều có cùng một trải nghiệm nhất quán.

---

## 1. HIỂN THỊ VIDEO TRONG POPUP

### 1.1 Video Item Layout
Mỗi video trong popup list PHẢI có cấu trúc sau:

```html
<div class="video-item" data-index="${index}" data-url="${url}">
  <div class="video-item-header">
    <!-- Type badge -->
    <span class="video-type ${type}">${type}</span>
    
    <!-- Downloaded badge (if downloaded) -->
    <span class="video-badge downloaded">✓ Downloaded</span>
    
    <!-- Live badge (if live stream) -->
    <span class="video-badge live">🔴 LIVE</span>
    
    <!-- Duration -->
    <span class="video-duration">⏱️ ${duration}</span>
    
    <!-- Streaming badge + Size (right-aligned) -->
    <div style="margin-left: auto;">
      <span class="video-badge streaming">🔗 Streaming</span>
      <span class="video-size">${size}</span>
    </div>
  </div>
  
  <div class="video-url" title="${fullUrl}">
    ${displayTitle}
  </div>
  
  <div class="video-actions">
    <!-- Download mode dropdown (for streaming) -->
    <!-- Quality dropdown (for streaming) -->
    <!-- Download button -->
    <!-- Folder button (if downloaded) -->
    <!-- Delete button -->
  </div>
  
  <!-- Progress bar (hidden by default) -->
  <div class="video-progress">...</div>
</div>
```

### 1.2 Video Information Display
- **Title/URL**: Hiển thị title nếu có (YouTube), nếu không thì truncate URL
- **Type badge**: Màu sắc theo loại (dash, hls, mpd, youtube, youtube-live)
- **Duration**: Format `HH:MM:SS` hoặc `MM:SS`
- **Size**: 
  - Hiển thị `✅ XXX MB` nếu là exact size
  - Hiển thị `XXX MB` nếu là estimated
  - Không hiển thị nếu chưa có thông tin

### 1.3 Badges
- **Downloaded**: `✓ Downloaded` - màu xanh lá
- **Live**: `🔴 LIVE` - màu đỏ
- **Streaming**: `🔗 Streaming` - màu xanh dương

---

## 2. DOWNLOAD WORKFLOW

### 2.1 Download Button Behavior

**Click Download Button:**
1. Check if video is already downloading → ignore if yes
2. Check video type:
   - **YouTube** → Use MSE capture method
   - **DASH/HLS/MPD** → Use stream processor
   - **Direct video** → Use chrome.downloads API
3. Disable download button
4. Show progress bar
5. Hide delete button (disable)
6. Show pause/cancel buttons

### 2.2 Download Button States

| State | Text | Icon | Disabled | Class |
|-------|------|------|----------|-------|
| Ready | "Download" | ⬇️ | No | `btn-primary` |
| Downloading | "Downloading..." | ⏳ (spinning) | Yes | `downloading` |
| Paused | "Paused" | ⏸️ | Yes | `downloading paused` |
| Success | "Download" | ⬇️ | No | `btn-primary` |
| Error | "Download" | ⬇️ | No | `btn-primary` |

---

## 3. PROGRESS BAR

### 3.1 Progress Bar Structure
```html
<div class="video-separator"></div>
<div class="video-progress">
  <div class="video-progress-header">
    <span class="video-progress-text">Downloading...</span>
    <div class="video-progress-controls">
      <span class="video-progress-percent">45%</span>
      <button class="pause-download-btn">⏸️/▶️</button>
      <button class="cancel-download-btn">✕</button>
    </div>
  </div>
  <div class="video-progress-bar">
    <div class="video-progress-fill" style="width: 45%"></div>
  </div>
  <div class="video-progress-details">
    <span class="video-progress-detail">45/100 segments</span>
    <div class="video-progress-stats">
      <span class="video-progress-size">123.5 MB</span>
      <span class="video-progress-speed">2.5 MB/s</span>
    </div>
  </div>
</div>
```

### 3.2 Progress Updates
Tất cả download methods PHẢI gửi progress updates với format:
```javascript
updateVideoProgress({
  videoUrl: string,        // REQUIRED - để identify video
  show: boolean,           // REQUIRED - show/hide progress
  percent: number,         // 0-100
  text: string,           // "Downloading...", "Paused", "Merging..."
  detail: string,         // "45/100 segments", "Loading chunks..."
  size: string,           // "123.5 MB" - formatted size
  speed: string,          // "2.5 MB/s" - download speed
  paused: boolean         // true/false - pause state
})
```

### 3.3 Progress Text Examples

| Phase | Text | Detail |
|-------|------|--------|
| Initializing | "Initializing download..." | "Starting..." |
| Loading (MSE) | "Loading video segments..." | "15/50 segments" |
| Downloading | "Downloading..." | "45/100 segments" |
| Merging | "Merging chunks..." | "Processing..." |
| Paused | "⏸️ Paused" | "45/100 segments" |
| Complete | "✅ Downloaded!" | "Download complete" |
| Error | "❌ Download failed" | Error message |

### 3.4 Progress Visibility Rules
- **Show**: Khi bắt đầu download
- **Hide**: 
  - Khi download hoàn thành (sau 2s)
  - Khi download bị cancel
  - Khi download bị lỗi (sau 2s)

---

## 4. POST-DOWNLOAD UI UPDATES

### 4.1 Sau khi download thành công:
1. **Hide progress bar** (sau 2 giây)
2. **Mark video as downloaded**:
   ```javascript
   video.downloaded = true;
   video.downloadId = downloadId; // if available
   ```
3. **Add "Downloaded" badge** to video header
4. **Add "Open Folder" button** (nếu có downloadId):
   ```html
   <button class="folder-btn" data-download-id="${downloadId}">
     <svg>📁</svg>
   </button>
   ```
5. **Save to storage**: `saveVideosToStorage()`
6. **Re-enable delete button**

### 4.2 Folder Button
- **Chỉ hiện** nếu có `downloadId` từ chrome.downloads API
- **Click**: Mở file explorer tại vị trí file
- **Position**: Giữa download button và delete button
- **Icon**: 📁 folder SVG

---

## 5. ERROR HANDLING

### 5.1 Error Display
Khi có lỗi:
1. Hide progress bar
2. Show error notification (status bar)
3. Show error info button (❌)
4. Restore download button
5. Log error details

### 5.2 Error Modal
Hiển thị:
- ⏰ Timestamp
- 📝 Error message
- 🎬 Video type & URL
- 🐛 Stack trace (if available)
- 💻 FFmpeg command (if applicable)
- 💡 Suggestions

---

## 6. FILENAME STANDARDS

### 6.1 Filename Sanitization
```javascript
const safeTitle = title
  .normalize('NFD')                    // Decompose Vietnamese chars
  .replace(/[\u0300-\u036f]/g, '')    // Remove diacritics
  .replace(/[^a-zA-Z0-9\s_-]/g, '_')  // Replace special chars
  .replace(/\s+/g, '_')                // Spaces to underscore
  .replace(/_+/g, '_')                 // Multiple underscores to one
  .substring(0, 50);                   // Max 50 chars
```

### 6.2 Filename Format
```
${safeTitle}_${quality}_${timestamp}.${extension}
```

Examples:
- `Video_hoc_tieng_Anh_1080p_1234567890.mp4`
- `YouTube_Tutorial_video_1234567890.mp4`
- `YouTube_Tutorial_audio_1234567890.m4a`

### 6.3 Multiple Files (Video + Audio)
```
${safeTitle}_video_${timestamp}.mp4
${safeTitle}_audio_${timestamp}.m4a
merge_${safeTitle}_${timestamp}.bat  // FFmpeg merge script
```

---

## 7. BUTTON CONTROLS

### 7.1 Pause/Resume Button
```html
<button class="pause-download-btn">
  <svg class="pause-icon">⏸️</svg>
  <svg class="resume-icon" style="display: none;">▶️</svg>
</button>
```

**States:**
- **Downloading**: Show pause icon (⏸️), title="Pause"
- **Paused**: Show resume icon (▶️), title="Resume"

### 7.2 Cancel Button
- Always visible during download
- Click → Cancel download immediately
- Clear download state
- Hide progress bar

### 7.3 Delete Button
- **Enabled**: When not downloading
- **Disabled**: During download (opacity 0.5, cursor not-allowed)

---

## 8. STREAMING VIDEO SPECIFIC

### 8.1 Download Mode Dropdown (VNA vs VWA)
- **VNA** (Video + Audio): Download riêng biệt
- **VWA** (With Audio): Download merged MP4
- Default: VNA
- Position: Trước quality dropdown

### 8.2 Quality Dropdown
- Show available qualities
- Default: 1080p
- Format: `${height}p` badge + `${resolution}` text
- Position: Giữa mode dropdown và download button

---

## 9. NOTIFICATIONS

### 9.1 Status Bar Updates
```javascript
updateStatus(message, icon)
```

Examples:
- `updateStatus("Found 5 videos", "✅")`
- `updateStatus("Downloading...", "⬇️")`
- `updateStatus("Download complete!", "🎉")`

### 9.2 Toast Notifications (Optional)
For important events:
- MSE full video load started
- Download completed
- Errors

---

## 10. IMPLEMENTATION CHECKLIST

Khi implement download method mới, đảm bảo:

- [ ] Detect video type correctly
- [ ] Show progress bar với đầy đủ info (percent, text, detail, size, speed)
- [ ] Update progress regularly (mỗi segment/chunk)
- [ ] Handle pause/resume/cancel
- [ ] Hide progress sau khi complete (2s delay)
- [ ] Add "Downloaded" badge sau khi xong
- [ ] Add "Open Folder" button (nếu có downloadId)
- [ ] Save to storage
- [ ] Handle errors gracefully
- [ ] Sanitize filename properly
- [ ] Log chi tiết cho debugging

---

## 11. CODE PATTERNS

### 11.1 Starting Download
```javascript
// Show initial progress
updateVideoProgress({
  videoUrl: url,
  show: true,
  percent: 0,
  text: 'Initializing download...',
  detail: 'Starting...'
});

// Disable button
btn.disabled = true;
btn.classList.add('downloading');
```

### 11.2 Progress Update
```javascript
updateVideoProgress({
  videoUrl: url,
  show: true,
  percent: Math.round((current / total) * 100),
  text: 'Downloading...',
  detail: `${current}/${total} segments`,
  size: formatFileSize(downloadedBytes),
  speed: formatSpeed(bytesPerSecond)
});
```

### 11.3 Download Complete
```javascript
updateVideoProgress({
  videoUrl: url,
  show: true,
  percent: 100,
  text: '✅ Downloaded!',
  detail: 'Download complete',
  size: formatFileSize(totalBytes)
});

// Mark as downloaded
video.downloaded = true;
video.downloadId = downloadId;
await saveVideosToStorage();

// Hide progress after 2s
setTimeout(() => {
  updateVideoProgress({ videoUrl: url, show: false });
  // Add UI badges and buttons
}, 2000);
```

### 11.4 Error Handling
```javascript
try {
  // Download logic
} catch (error) {
  console.error('[Source] Download error:', error);
  
  updateVideoProgress({
    videoUrl: url,
    show: false
  });
  
  showNotification('Download failed: ' + error.message, 'error');
  
  // Restore button
  btn.disabled = false;
  btn.classList.remove('downloading');
}
```

---

## 12. TESTING CHECKLIST

Trước khi release, test tất cả scenarios:

- [ ] Download DASH video
- [ ] Download HLS video
- [ ] Download YouTube video (MSE)
- [ ] Download YouTube live stream
- [ ] Download direct MP4
- [ ] Pause/Resume download
- [ ] Cancel download
- [ ] Download with different qualities
- [ ] Download video với tên tiếng Việt
- [ ] Download nhiều videos cùng lúc
- [ ] Refresh popup during download
- [ ] Close/reopen popup during download
- [ ] Download complete → badge hiển thị
- [ ] Download complete → folder button hiển thị
- [ ] Click folder button → mở đúng vị trí

---

## VERSION HISTORY

- **v1.0** (2026-01-24): Initial UX standards document
  - Unified progress bar for all download sources
  - Standardized post-download UI updates
  - Filename sanitization rules
  - Button states and controls

---

## MAINTENANCE

Document này cần được update khi:
- Thêm download source mới
- Thay đổi UI/UX design
- Thêm tính năng mới (merge, conversion, etc.)
- Phát hiện edge cases cần standardize
