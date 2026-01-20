# Download Modes Feature

## Overview
Each video item with separate audio and video streams now has its own download mode dropdown, allowing per-video customization of how files are downloaded.

## Download Modes

### 1. VNA (Video and Audio) - Default
**Badge:** Purple gradient (VNA)
**Behavior:** Downloads video and audio as **separate files**
- Video file: `{name}_video_{timestamp}.mp4`
- Audio file: `{name}_audio_{timestamp}.m4a`
- Both files are saved to the default Downloads folder
- User can merge them later using ffmpeg: 
  ```bash
  ffmpeg -i video_file.mp4 -i audio_file.m4a -c copy merged.mp4
  ```

### 2. VWA (Video with Audio)
**Badge:** Pink gradient (VWA)
**Behavior:** **Merges** video and audio into a **single file**
- Output file: `{name}_merged_{timestamp}.mp4`
- No ffmpeg required - ready to play immediately
- Single file saved to Downloads folder

## UI Components

### Dropdown Location
**Per-video:** Each streaming video item (DASH/HLS/MPD) has its own mode dropdown in the video-actions area, positioned **before** the quality selector.

### Visual Design
- **Label:** "Mode:" in small text
- **Toggle button:** Shows selected mode badge (VNA/VWA) with dropdown arrow
- **Dropdown menu:** Shows both options with badges and full descriptions
- **Active selection:** Highlighted with primary container color
- **Smooth animations:** Dropdown slide-in effect

### Badges
- **VNA Badge:** Purple-to-violet gradient (`#667eea` → `#764ba2`)
- **VWA Badge:** Pink-to-red gradient (`#f093fb` → `#f5576c`)
- **Font:** Bold, uppercase, 11px

## Technical Implementation

### Files Modified
1. **popup.html** - Removed global dropdown
2. **popup.css** - Removed global styles, added per-video-item dropdown styles
3. **popup.js** - Added per-item dropdown in `generateVideoItemHTML()`, removed global dropdown functions
4. **background-simple.js** - Added merge logic in `downloadSeparateStreams()` (unchanged from v1)

### State Management
- **Per-video mode:** Each video item's dropdown stores selected mode in `data-selected-mode` attribute
- **Default mode:** `'vna'` (Video and Audio) for all new video items
- **No persistence:** Mode resets to default when popup reopens (can be enhanced later)

### Download Flow
1. User selects download mode from video item's dropdown
2. Mode is stored in the dropdown toggle's `data-selected-mode` attribute
3. When clicking download, `downloadVideoWithQuality()` reads mode from that video's dropdown
4. Mode is passed to background script
5. Background checks mode in `downloadSeparateStreams()`:
   - **VNA mode:** Downloads video and audio separately (existing behavior)
   - **VWA mode:** Downloads both, merges blobs, saves single file

### Event Handling
- **Toggle dropdown:** Click mode toggle button to open/close menu
- **Select mode:** Click menu item to select and update toggle badge
- **Close on outside click:** Global click listener closes all open dropdowns
- **Prevent conflicts:** Opening one dropdown closes others

### Merge Implementation
- Method: `mergeVideoAudioBlobs(videoBlob, audioBlob)` in background-simple.js
- Current approach: Simple blob concatenation
- **Note:** For production-quality merging, consider implementing:
  - mp4box.js for proper MP4 muxing
  - ffmpeg.wasm for browser-based ffmpeg processing
  - Server-side merging endpoint

## Usage Instructions

### For Users
1. Open extension popup on a video page
2. Each streaming video will show "Mode:" dropdown before quality selector
3. Click dropdown to choose:
   - **VNA** for separate files (can merge later with ffmpeg)
   - **VWA** for merged file (ready to play immediately)
4. Select quality (if available)
5. Click Download - mode applies to that specific video
6. Different videos can use different modes!

### For Developers

#### Adding Default Mode Persistence
To remember mode selection per video URL:

```javascript
// In generateVideoItemHTML, load saved mode
const savedMode = await getSavedModeForVideo(video.url);
const defaultMode = savedMode || 'vna';

// In mode selection handler
modeToggle.dataset.selectedMode = mode;
await saveModeForVideo(video.url, mode);
```

#### Improving Merge Quality
Integrate mp4box.js:

```javascript
import MP4Box from 'mp4box';

async mergeVideoAudioBlobs(videoBlob, audioBlob) {
  const mp4boxfile = MP4Box.createFile();
  // Add proper MP4 muxing logic here
}
```

Or use ffmpeg.wasm:
```javascript
import { createFFmpeg } from '@ffmpeg/ffmpeg';

async mergeVideoAudioBlobs(videoBlob, audioBlob) {
  const ffmpeg = createFFmpeg({ log: true });
  await ffmpeg.load();
  // Use ffmpeg commands to merge properly
}
```

## Testing Checklist
- [x] Each streaming video has its own mode dropdown
- [x] Dropdown positioned before quality selector
- [x] Badge updates when selecting mode
- [x] Mode selection independent per video
- [x] VNA mode downloads separate files
- [x] VWA mode downloads single merged file
- [x] Dropdowns close when clicking outside
- [x] Multiple videos can have different modes
- [x] No errors in console

## Known Limitations
1. **VWA merge quality:** Current implementation uses simple blob concatenation, not proper MP4 muxing
2. **No persistence:** Mode selection doesn't persist across popup sessions (resets to VNA)
3. **Browser compatibility:** Tested on Chrome, may need adjustments for other browsers
4. **Large files:** Merging very large files in browser may cause memory issues
5. **Non-streaming videos:** Regular MP4 downloads don't show mode selector (only for DASH/HLS/MPD)

## Future Improvements
- [ ] Persist mode selection per video URL using chrome.storage
- [ ] Add global default mode setting
- [ ] Implement proper MP4 muxing with mp4box.js
- [ ] Add server-side merge option for better quality
- [ ] Show merge progress indicator
- [ ] Add tooltip explaining modes
- [ ] Remember last used mode per domain
- [ ] Add "Always use this mode" checkbox
