# MSE (Media Source Extensions) Chunk Capture - Testing Guide

## ✅ Implementation Complete! (v2.0 - Auto Full Video Load)

MSE Chunk Capture đã được implement để download **FULL YouTube videos** trực tiếp trong extension không cần external API hay app.

**NEW in v2.0**: Tự động force load toàn bộ video bằng cách seek through video!

---

## 🎯 How It Works

### Architecture:

```
YouTube Player
    ↓ MediaSource.addSourceBuffer()
    ↓ SourceBuffer.appendBuffer(chunk)
MediaSource Hook (injected.js)
    ↓ Capture chunks
    ↓ Store in page context
    ↓ Separate video & audio tracks
User clicks "MSE Download"
    ↓ popup.js → content.js → injected.js
Auto-seek through video (NEW!)
    ↓ Seek to 0s, 30s, 60s, 90s... end
    ↓ Force YouTube to load ALL chunks
    ↓ Wait for buffering at each position
All chunks captured
    ↓ Merge chunks into Blobs
    ↓ Video blob + Audio blob
Create download links
    ↓ download files to Downloads folder
```

### Key Features:

- ✅ **Auto-Capture**: MSE capture tự động bắt đầu khi detect YouTube video
- ✅ **Auto Full Load** (NEW!): Tự động seek through video để force load tất cả chunks
- ✅ **No Manual Play Required**: Không cần xem hết video, extension tự động load
- ✅ **Progress Tracking**: Hiển thị progress khi load full video

---

## 🧪 Testing Steps (Updated for v2.0)

### 1. Reload Extension

```
Chrome → Extensions → Video Download Helper Pro → Reload
```

### 2. Mở YouTube Video

1. Mở tab mới: https://www.youtube.com/watch?v=dQw4w9WgXcQ
2. Chờ video load (player xuất hiện)
3. **KHÔNG CẦN PLAY** - extension sẽ tự động load

### 3. Check Logs

Mở **Console** (F12) và filter `[MSE]`:

**Expected logs**:
```
[MSE Capture] Initialized
[MSE Capture] MediaSource API hooked successfully
[MSE Capture] 🎉 Ready to capture YouTube video chunks
[MSE Capture] 🎯 addSourceBuffer called: video/mp4; codecs="avc1.64001F"
[MSE Capture] 📹 Video track detected
[MSE Capture] 🎯 addSourceBuffer called: audio/mp4; codecs="mp4a.40.2"
[MSE Capture] 🔊 Audio track detected
[MSE Capture] 🎬 STARTED CAPTURING
```

### 4. Click "MSE Download" (NEW Flow!)

1. Mở extension popup
2. Thấy video YouTube trong list
3. Click button **"MSE Download"** (button màu xanh lá)

**Expected behavior (AUTO FULL LOAD)**:
```
Console logs:
[Popup] MSE Download button clicked
[MSE Capture] 📥 Received DOWNLOAD_MSE_CHUNKS command
[MSE Capture] 🚀 FORCING FULL VIDEO LOAD
[MSE Capture] 📏 Video duration: 212 seconds
[MSE Capture] 🎯 Will seek through video to force chunk loading...
[MSE Capture] 📍 Seek points: 8 - Points: 0s, 30s, 60s, 90s, 120s, 150s, 180s, 207s
[MSE Capture] ⏩ Seeking to 0.0s (1/8)
[MSE Capture] ⏩ Seeking to 30.0s (2/8)
[MSE Capture] 📦 Video chunk 45: 12345 bytes
[MSE Capture] 🔊 Audio chunk 78: 5678 bytes
[MSE Capture] ⏩ Seeking to 60.0s (3/8)
[MSE Capture] 📦 Video chunk 90: 12345 bytes
...
[MSE Capture] ✅ FULL VIDEO LOAD COMPLETE
[MSE Capture] Video chunks: 456
[MSE Capture] Audio chunks: 789
[MSE Capture] Total size: 45.67 MB
[MSE Capture] 📦 Merging chunks...
[MSE Capture] ✅ Video blob created: 30.12 MB
[MSE Capture] ✅ Audio blob created: 15.55 MB
[MSE Capture] 📥 Video download triggered
[MSE Capture] 📥 Audio download triggered
[MSE Capture] ✅ Download completed successfully!
```

**Browser behavior**:
- Extension notification: "🚀 Loading full video... This may take a minute."
- Progress notifications: "Loading video: 25% (2/8 segments)"
- Video **tự động seek** through các mốc time (bạn thấy video jump)
- Sau khi load xong: Download 2 files
  1. `video_title_video_timestamp.mp4` (video only - FULL VIDEO)
  2. `video_title_audio_timestamp.m4a` (audio only - FULL AUDIO)

### 5. Verify Full Video Downloaded

**Check file sizes**:
- Video file: ~20-50MB (tùy quality & duration)
- Audio file: ~5-20MB
- **Total phải > 30s buffer** (check duration khi play file)

**Play video file**:
- Should show FULL video (not just 30s)
- No audio (expected - video only track)

### 6. Merge Video + Audio

**Note**: MSE capture tải 2 files riêng (video + audio) vì YouTube streams separately.

**Merge với FFmpeg**:
```bash
cd Downloads
ffmpeg -i video_title_video_12345.mp4 -i video_title_audio_12345.m4a -c copy merged.mp4
```

**Alternative**: Dùng online tool như https://www.videoconverter.com/video-combiner/

---

## ✅ Success Criteria

### Logs phải có:

1. ✅ `[MSE Capture] MediaSource API hooked successfully`
2. ✅ `[MSE Capture] 📹 Video track detected`
3. ✅ `[MSE Capture] 🔊 Audio track detected`
4. ✅ `[MSE Capture] 🎬 STARTED CAPTURING`
5. ✅ `[MSE Capture] 📦 Video chunk X` (nhiều lần)
6. ✅ `[MSE Capture] 🔊 Audio chunk X` (nhiều lần)
7. ✅ `[MSE Capture] ✅ Download completed successfully!`

### Files downloaded:

1. ✅ `*_video_*.mp4` - Video file (no audio)
2. ✅ `*_audio_*.m4a` - Audio file (no video)
3. ✅ Both files playable (video shows picture, audio has sound)
4. ✅ FFmpeg merge successful → merged.mp4 có cả video và audio

---

## ❌ Troubleshooting

### Problem 1: Only 30s downloaded (OLD ISSUE - FIXED in v2.0!)

**v1.0 Behavior**: Chỉ download ~30s đầu video

**v2.0 Fix**: Extension giờ **tự động seek** through toàn bộ video để force YouTube load tất cả chunks!

**How it works**:
- Auto-seek đến: 0s → 30s → 60s → 90s → ... → end
- Mỗi seek point, chờ YouTube buffer chunks
- Capture ALL chunks từ đầu đến cuối video

**If still only 30s**:
1. ✅ Check console logs - có thấy "FORCING FULL VIDEO LOAD"?
2. ✅ Check seek points - có log "⏩ Seeking to Xs"?
3. ✅ Wait longer - video dài cần time để seek hết
4. ✅ Check video duration - duration = 0 thì không seek được

### Problem 2: Auto-seek failed

**Symptoms**:
```
[MSE Capture] ❌ Video element not found!
[MSE Capture] ❌ Video duration is 0 or unknown
```

**Solutions**:
1. ✅ Wait cho video load completely - player phải ready
2. ✅ Reload page nếu player stuck
3. ✅ Try different video
4. ✅ Check if video is age-restricted (may block auto-seek)

### Problem 3: Seeking too slow / timeout

**Symptoms**:
```
[MSE Capture] ⚠️ Seek timeout at 120.0s
```

**Reasons**:
- Slow internet connection
- Very long video (> 1 hour)
- YouTube throttling

**Solutions**:
1. ✅ Wait longer - process continues despite timeout
2. ✅ Check internet speed
3. ✅ Try shorter video first (< 10 min)
4. ✅ Reload page và retry

### Problem 4: No chunks captured (even after auto-seek)

**Symptoms**:
```
[MSE Capture] Video chunks: 0
[MSE Capture] Audio chunks: 0
```

**Solutions**:
1. ✅ Check if MediaSource hook successful - Look for "MediaSource API hooked"
2. ✅ Reload extension completely
3. ✅ Hard refresh YouTube page (Ctrl+Shift+R)
4. ✅ Try different video - Some may use different player
5. ✅ Check if video is embargoed/restricted

### Problem 2: Only video OR only audio captured

**Symptoms**:
```
[MSE Capture] Video chunks: 45
[MSE Capture] Audio chunks: 0
```

**Possible reasons**:
- Video is still loading
- Muted video (audio track may load later)
- Different video encoding

**Solution**: Play video longer, ensure audio is on

### Problem 3: MediaSource not hooked

**Symptoms**:
```
No [MSE Capture] logs at all
```

**Solutions**:
1. ✅ Reload extension completely
2. ✅ Refresh YouTube page (hard refresh: Ctrl+Shift+R)
3. ✅ Check if injected.js loaded: Look for `[Injected] Video detection script loaded`
4. ✅ Check browser compatibility - MSE requires modern Chrome

### Problem 4: Download button does nothing

**Symptoms**:
- Click "MSE Download" → nothing happens
- No console logs

**Solutions**:
1. ✅ Check if content script loaded - Look for `[Content]` logs
2. ✅ Check if popup can communicate with tab
3. ✅ Try reloading extension AND page
4. ✅ Check Chrome permissions - ensure extension has tab access

### Problem 5: Chunks captured but download fails

**Symptoms**:
```
[MSE Capture] Video chunks: 45
[MSE Capture] Audio chunks: 78
[MSE Capture] ❌ Download error: ...
```

**Possible errors**:
- **Blob too large** - Video too long (>1GB chunks)
- **Permission denied** - Chrome blocking downloads
- **Memory error** - Not enough RAM to merge chunks

**Solutions**:
1. ✅ Try shorter video (< 10 minutes)
2. ✅ Check Chrome download settings
3. ✅ Close other tabs to free memory

---

## 📊 Test Cases

### Test 1: Short Video (< 5 min)

**Video**: https://www.youtube.com/watch?v=dQw4w9WgXcQ  
**Expected**: ✅ Both video + audio captured, download successful

### Test 2: HD Video (1080p)

**Video**: Any 1080p YouTube video  
**Expected**: ✅ Larger chunks, but still works

### Test 3: Long Video (> 30 min)

**Video**: Any long video  
**Expected**: ⚠️ May have memory issues, use cautiously

### Test 4: Live Stream

**Video**: Any YouTube live stream  
**Expected**: ⚠️ May not work (different streaming method)

### Test 5: Navigate Between Videos

**Steps**:
1. Open video A → capture starts
2. Click video B → capture should reset and restart
3. Download video B

**Expected**: ✅ Only video B chunks downloaded (not mixed with A)

---

## 🎯 Known Limitations

### 1. Separate Files

**Issue**: Download 2 files riêng (video + audio)  
**Reason**: YouTube streams video và audio separately via MSE  
**Workaround**: Merge với FFmpeg hoặc online tool

**Future**: Có thể implement MP4Box.js để merge trực tiếp trong extension

### 2. Memory Usage

**Issue**: Long videos (> 1 hour) có thể consume nhiều RAM  
**Reason**: Chunks stored trong memory trước khi download  
**Workaround**: Download shorter segments, clear chunks periodically

### 3. Browser Compatibility

**Issue**: Chỉ works với browsers support MediaSource API  
**Supported**: Chrome, Edge, Firefox, Opera  
**Not supported**: Old browsers, IE

### 4. YouTube Changes

**Issue**: YouTube có thể thay đổi streaming mechanism  
**Impact**: MSE capture có thể break khi YouTube updates  
**Mitigation**: Monitor for changes, update hook logic

---

## 🚀 Next Steps (Future Improvements)

### Phase 1: Auto-Merge với MP4Box.js

```javascript
// Integrate mp4box.js to merge in-browser
import MP4Box from 'mp4box';

async function mergeVideoAudio(videoBlob, audioBlob) {
  // Use MP4Box to mux video + audio into single MP4
  const merged = await mp4box.mux(videoBlob, audioBlob);
  return merged;
}
```

**Benefit**: Single file download thay vì 2 files riêng

### Phase 2: Real-time Progress UI

```javascript
// Show capture progress in popup
window.postMessage({
  type: 'MSE_CAPTURE_PROGRESS',
  videoChunks: 45,
  audioChunks: 78,
  totalSize: 12345678,
  duration: 123 // seconds captured
}, '*');
```

**Benefit**: User thấy progress khi capture

### Phase 3: Quality Selector

```javascript
// Capture only selected quality
if (videoHeight === 1080) {
  captureChunk(chunk); // Only capture 1080p
}
```

**Benefit**: Tiết kiệm bandwidth, chọn quality mong muốn

### Phase 4: Chunk Streaming

```javascript
// Stream chunks directly to download instead of storing in memory
const writableStream = new WritableStream({
  write(chunk) {
    // Write directly to file
  }
});
```

**Benefit**: Reduce memory usage, support longer videos

---

## 📝 Conclusion

MSE Chunk Capture là **experimental feature** nhưng hoạt động tốt cho:
- ✅ Short-medium YouTube videos (< 30 min)
- ✅ Standard quality (360p-1080p)
- ✅ Normal playback (not live streams)

**Limitations**:
- ⚠️ Requires video playback (must watch to capture)
- ⚠️ Separate video/audio files (needs merge)
- ⚠️ Memory intensive for long videos

**Recommendation**:
- Use MSE capture cho YouTube videos KHÔNG có direct URLs
- Fallback to Invidious API nếu MSE fails
- Provide clear user instructions về merging files

---

**Last Updated**: 2026-01-24  
**Status**: ✅ Ready for Testing  
**Version**: 1.0.0

**Happy Testing!** 🎉
