// Stream Processor Module - Handles DASH, HLS, MPD streams
import { MP4Merger } from './mp4Merger.js';

export class StreamProcessor {
  constructor() {
    this.parsers = {
      dash: this.parseDashManifest.bind(this),
      hls: this.parseHlsManifest.bind(this),
      mpd: this.parseDashManifest.bind(this)
    };
    this.mp4Merger = new MP4Merger();
  }
  
  // Log helper
  log(level, message, data = null) {
    console.log(`[StreamProcessor] ${message}`, data || '');
  }
  
  // Send progress update to popup
  sendProgressUpdate(data) {
    try {
      chrome.runtime.sendMessage({
        action: 'downloadProgress',
        data: data
      }).catch(() => {});
    } catch (error) {
      // Ignore if popup is closed
    }
  }
  
  // Safe notification helper
  async showNotification(id, options) {
    try {
      if (chrome && chrome.notifications && chrome.notifications.create) {
        await chrome.notifications.create(id, options);
      }
    } catch (error) {
      console.warn('[StreamProcessor] Notification not available:', error.message);
    }
  }
  
  async clearNotification(id) {
    try {
      if (chrome && chrome.notifications && chrome.notifications.clear) {
        await chrome.notifications.clear(id);
      }
    } catch (error) {
      // Ignore
    }
  }
  
  async processStream(video, options = {}) {
    const { type, url, manifest } = video;
    
    console.log('[StreamProcessor] Processing stream:', { type, url });
    
    try {
      // For streaming protocols, we need to parse the manifest
      if (type === 'dash' || type === 'hls' || type === 'mpd') {
        return await this.handleStreamingProtocol(video, options);
      } else {
        // Direct video file download
        return await this.directDownload(url, options);
      }
    } catch (error) {
      console.error('[StreamProcessor] Stream processing error:', error);
      // Show user-friendly error notification
      await this.showNotification('error', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Lỗi tải video',
        message: `Không thể tải video: ${error.message}`
      });
      throw error;
    }
  }
  
  async handleStreamingProtocol(video, options) {
    const { type, url, manifest } = video;
    
    console.log('[StreamProcessor] Handling streaming protocol:', type);
    
    try {
      // Fetch manifest if not provided
      let manifestContent = manifest;
      if (!manifestContent) {
        console.log('[StreamProcessor] Fetching manifest from:', url);
        try {
          manifestContent = await this.fetchManifest(url);
        } catch (fetchError) {
          console.error('[StreamProcessor] Failed to fetch manifest:', fetchError);
          throw new Error(`Không thể tải manifest: ${fetchError.message}`);
        }
      }
      
      // Parse manifest to get video segments
      const parser = this.parsers[type];
      if (!parser) {
        throw new Error(`Unsupported streaming type: ${type}`);
      }
      
      console.log('[StreamProcessor] Parsing manifest...');
      const streamInfo = await parser(manifestContent, url);
      streamInfo.type = type;
      streamInfo.url = url;
      
      console.log('[StreamProcessor] Stream info:', streamInfo);
      
      // Download the stream
      return await this.downloadStream(streamInfo, options);
    } catch (error) {
      console.error('[StreamProcessor] Error in handleStreamingProtocol:', error);
      throw error;
    }
  }
  
  async fetchManifest(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      console.error('Error fetching manifest:', error);
      throw error;
    }
  }
  
  async parseDashManifest(manifestContent, baseUrl) {
    // Parse DASH MPD manifest without DOMParser (not available in service worker)
    console.log('[StreamProcessor] Parsing DASH manifest...');
    
    // Get duration from MPD using regex
    const durationMatch = manifestContent.match(/mediaPresentationDuration="([^"]+)"/);
    let duration = null;
    
    if (durationMatch) {
      duration = this.parseISO8601Duration(durationMatch[1]);
    }
    
    // Find all video representations using regex
    const representations = [];
    
    // Match AdaptationSet with video mime type
    const videoAdaptationSets = manifestContent.match(/<AdaptationSet[^>]*mimeType="[^"]*video[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/gi);
    
    if (videoAdaptationSets) {
      videoAdaptationSets.forEach(adaptationSet => {
        // Find all Representation elements
        const repMatches = adaptationSet.matchAll(/<Representation[^>]*>/gi);
        
        for (const repMatch of repMatches) {
          const repTag = repMatch[0];
          
          // Extract attributes
          const bandwidthMatch = repTag.match(/bandwidth="([^"]+)"/);
          const widthMatch = repTag.match(/width="([^"]+)"/);
          const heightMatch = repTag.match(/height="([^"]+)"/);
          const codecsMatch = repTag.match(/codecs="([^"]+)"/);
          
          if (bandwidthMatch && heightMatch) {
            representations.push({
              bandwidth: parseInt(bandwidthMatch[1]),
              width: widthMatch ? parseInt(widthMatch[1]) : 0,
              height: parseInt(heightMatch[1]),
              codecs: codecsMatch ? codecsMatch[1] : '',
              quality: `${heightMatch[1]}p`
            });
          }
        }
      });
    }
    
    // Sort by quality (highest first)
    representations.sort((a, b) => b.height - a.height);
    
    console.log(`[StreamProcessor] DASH: found ${representations.length} representations, duration: ${duration}s`);
    
    return {
      type: 'dash',
      url: baseUrl,
      representations: representations,
      bestQuality: representations[0],
      duration: duration
    };
  }
  
  async parseHlsManifest(manifestContent, baseUrl) {
    // Parse HLS M3U8 manifest
    const lines = manifestContent.split('\n').filter(line => line.trim());
    const variants = [];
    let totalDuration = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Parse stream info
        const bandwidth = this.extractValue(line, 'BANDWIDTH');
        const resolution = this.extractValue(line, 'RESOLUTION');
        const codecs = this.extractValue(line, 'CODECS');
        
        // Next line should be the URL
        if (i + 1 < lines.length) {
          const streamUrl = this.resolveUrl(baseUrl, lines[i + 1]);
          
          const [width, height] = resolution ? resolution.split('x') : [0, 0];
          
          variants.push({
            bandwidth: parseInt(bandwidth),
            resolution: resolution,
            width: parseInt(width),
            height: parseInt(height),
            codecs: codecs,
            url: streamUrl,
            quality: `${height}p`
          });
        }
      }
      
      // Extract duration from EXTINF
      if (line.startsWith('#EXTINF:')) {
        const durationMatch = line.match(/#EXTINF:([0-9.]+)/);
        if (durationMatch) {
          totalDuration += parseFloat(durationMatch[1]);
        }
      }
    }
    
    // Sort by quality (highest first)
    variants.sort((a, b) => b.height - a.height);
    
    return {
      type: 'hls',
      url: baseUrl,
      variants: variants,
      bestQuality: variants[0],
      duration: totalDuration || null
    };
  }
  
  extractValue(line, key) {
    const regex = new RegExp(`${key}=([^,]+)`);
    const match = line.match(regex);
    return match ? match[1].replace(/"/g, '') : null;
  }
  
  resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
      return relativeUrl;
    }
    
    try {
      const base = new URL(baseUrl);
      return new URL(relativeUrl, base).href;
    } catch {
      return relativeUrl;
    }
  }
  
  async downloadStream(streamInfo, options) {
    console.log('[StreamProcessor] Starting stream download...');
    console.log('[StreamProcessor] StreamInfo:', {
      type: streamInfo.type,
      url: streamInfo.url ? streamInfo.url.substring(0, 100) + '...' : 'none',
      hasManifest: !!streamInfo.manifest
    });
    
    try {
      // Parse manifest to get all segments
      console.log('[StreamProcessor] Calling extractSegments...');
      const segments = await this.extractSegments(streamInfo, options);
      
      console.log(`[StreamProcessor] ExtractSegments result:`, {
        segmentsType: typeof segments,
        segmentsLength: segments ? segments.length : 'N/A',
        hasSeparateStreams: segments && segments.separateStreams,
        firstSegment: segments && segments.length > 0 ? segments[0].substring(0, 50) + '...' : 'none'
      });
      
      // Check if we have separate audio/video streams
      const hasSeparateStreams = segments && segments.separateStreams;
      
      if (hasSeparateStreams) {
        console.log('[StreamProcessor] Detected separate audio/video streams');
        return await this.downloadSeparateStreams(segments, streamInfo, options);
      }
      
      if (!segments || segments.length === 0) {
        console.warn('[StreamProcessor] No segments found, trying advanced parsing...');
        // Try alternative parsing methods before fallback
        const alternativeSegments = await this.tryAlternativeParsing(streamInfo, options);
        
        console.log(`[StreamProcessor] Alternative parsing result: ${alternativeSegments ? alternativeSegments.length : 'none'} segments`);
        
        if (alternativeSegments && alternativeSegments.length > 0) {
          console.log(`[StreamProcessor] Alternative parsing found ${alternativeSegments.length} segments`);
          const mergedBlob = await this.downloadAndMergeSegments(alternativeSegments, streamInfo.type);
          
          // Generate filename and download
          let filename = options.filename;
          if (!filename) {
            const timestamp = Date.now();
            const videoName = this.extractVideoName(streamInfo.url);
            filename = `${videoName}_${timestamp}.mp4`;
          } else if (!filename.endsWith('.mp4')) {
            filename = filename.replace(/\.[^.]+$/, '') + '.mp4';
          }
          
          const reader = new FileReader();
          const dataUrl = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(mergedBlob);
          });
          
          const downloadId = await chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: true
          });
          
          return {
            downloadId: downloadId,
            filename: filename,
            segmentCount: alternativeSegments.length,
            totalSize: mergedBlob.size,
            requiresConversion: false
          };
        }
        
        console.warn('[StreamProcessor] No segments found with alternative methods, using fallback');
        return await this.downloadManifestFallback(streamInfo, options);
      }
      
      // Increase segment limit for streaming content
      if (segments.length > 2000) {
        console.warn(`[StreamProcessor] Very large video (${segments.length} segments), asking user...`);
        await this.showNotification('large-video', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Video Download Helper',
          message: `Video rất lớn (${segments.length} segments). Đang thử tải...`
        });
        // Still try to download, but warn user
      }
      
      console.log('[StreamProcessor] Downloading and merging segments...');
      
      // Download and merge segments
      const mergedBlob = await this.downloadAndMergeSegments(segments, streamInfo.type);
      
      console.log(`[StreamProcessor] Merged blob size: ${mergedBlob.size} bytes`);
      
      // Convert blob to data URL (service worker doesn't have URL.createObjectURL)
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(mergedBlob);
      });
      
      console.log('[StreamProcessor] Blob converted to data URL');
      
      // Generate better filename with .mp4 extension
      let filename = options.filename;
      if (!filename) {
        const timestamp = Date.now();
        const videoName = this.extractVideoName(streamInfo.url);
        filename = `${videoName}_${timestamp}.mp4`; // Always use .mp4 for merged video
      } else if (!filename.endsWith('.mp4')) {
        // Force .mp4 extension
        filename = filename.replace(/\.[^.]+$/, '') + '.mp4';
      }
      
      console.log('[StreamProcessor] Triggering download:', filename);
      
      // Trigger download using data URL
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      });
      
      // Show success notification
      await this.showNotification('success', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Video Download Helper',
        message: `Đã ghép ${segments.length} segments thành video MP4 (${this.formatBytes(mergedBlob.size)})`
      });
      
      return {
        downloadId: downloadId,
        filename: filename,
        segmentCount: segments.length,
        totalSize: mergedBlob.size,
        requiresConversion: false
      };
    } catch (error) {
      console.error('[StreamProcessor] Stream download error:', error);
      console.log('[StreamProcessor] Falling back to manifest download');
      
      // Fallback: download manifest file
      return await this.downloadManifestFallback(streamInfo, options);
    }
  }
  
  async downloadSeparateStreams(streams, streamInfo, options) {
    try {
      console.log('[StreamProcessor] Downloading separate audio and video streams...');
      
      // Download video
      console.log(`[StreamProcessor] Downloading video (${streams.video.length} segments)...`);
      this.sendProgressUpdate({
        show: true,
        percent: 0,
        text: 'Downloading video...',
        detail: `0/${streams.video.length} segments`,
        size: '0 MB'
      });
      const videoBlob = await this.downloadAndMergeSegments(streams.video, streamInfo.type);
      
      // Download audio
      console.log(`[StreamProcessor] Downloading audio (${streams.audio.length} segments)...`);
      this.sendProgressUpdate({
        show: true,
        percent: 50,
        text: 'Downloading audio...',
        detail: `0/${streams.audio.length} segments`,
        size: this.formatBytes(videoBlob.size)
      });
      const audioBlob = await this.downloadAndMergeSegments(streams.audio, streamInfo.type);
      
      console.log(`[StreamProcessor] Video: ${this.formatBytes(videoBlob.size)}, Audio: ${this.formatBytes(audioBlob.size)}`);
      
      // Convert blobs to data URLs
      this.sendProgressUpdate({
        show: true,
        percent: 90,
        text: 'Preparing download...',
        detail: 'Creating download links',
        size: this.formatBytes(videoBlob.size + audioBlob.size)
      });
      
      const videoReader = new FileReader();
      const videoDataUrl = await new Promise((resolve, reject) => {
        videoReader.onloadend = () => resolve(videoReader.result);
        videoReader.onerror = reject;
        videoReader.readAsDataURL(videoBlob);
      });
      
      const audioReader = new FileReader();
      const audioDataUrl = await new Promise((resolve, reject) => {
        audioReader.onloadend = () => resolve(audioReader.result);
        audioReader.onerror = reject;
        audioReader.readAsDataURL(audioBlob);
      });
      
      // Generate filenames
      const timestamp = Date.now();
      const videoName = this.extractVideoName(streamInfo.url);
      const videoFilename = `${videoName}_video_${timestamp}.m4v`;
      const audioFilename = `${videoName}_audio_${timestamp}.m4a`;
      
      // Download both files
      console.log('[StreamProcessor] Downloading video file...');
      const videoDownloadId = await chrome.downloads.download({
        url: videoDataUrl,
        filename: videoFilename,
        saveAs: false
      });
      
      console.log('[StreamProcessor] Downloading audio file...');
      const audioDownloadId = await chrome.downloads.download({
        url: audioDataUrl,
        filename: audioFilename,
        saveAs: false
      });
      
      // Hide progress
      this.sendProgressUpdate({ show: false });
      
      // Show success notification
      await this.showNotification('success', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Downloaded 2 Files',
        message: `Video (${this.formatBytes(videoBlob.size)}) và Audio (${this.formatBytes(audioBlob.size)}) đã tải xong!`
      });
      
      return {
        downloadId: videoDownloadId, // Return video file's downloadId for folder access
        audioDownloadId: audioDownloadId,
        videoFile: videoFilename,
        audioFile: audioFilename,
        segmentCount: streams.video.length + streams.audio.length,
        totalSize: videoBlob.size + audioBlob.size,
        requiresConversion: false,
        separateFiles: true
      };
      
    } catch (error) {
      console.error('[StreamProcessor] Separate streams download error:', error);
      return await this.downloadManifestFallback(streamInfo, options);
    }
  }
  
  async downloadManifestFallback(streamInfo, options) {
    console.log('[StreamProcessor] Using manifest fallback download');
    
    // For Cloudflare Stream, show better instructions
    const isCloudflareStream = streamInfo.url.includes('cloudflarestream.com') || streamInfo.url.includes('videodelivery.net');
    
    if (isCloudflareStream) {
      // Don't download manifest for Cloudflare - just show FFmpeg instructions
      const ffmpegCommand = `ffmpeg -i "${streamInfo.url}" -c copy video.mp4`;
      
      await this.showNotification('cloudflare-ffmpeg', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Cloudflare Stream',
        message: `Video này yêu cầu FFmpeg để tải. Click biểu tượng ℹ️ để xem lệnh FFmpeg.`
      });
      
      return {
        streamInfo: streamInfo,
        requiresConversion: true,
        ffmpegCommand: ffmpegCommand,
        skipDownload: true // Flag to skip actual download
      };
    }
    
    // For other streams, download manifest file
    const filename = options.filename || `stream_${Date.now()}.${streamInfo.type === 'hls' ? 'm3u8' : 'mpd'}`;
    
    const downloadId = await chrome.downloads.download({
      url: streamInfo.url,
      filename: filename,
      saveAs: true
    });
    
    const ffmpegCommand = `ffmpeg -i "${filename}" -c copy output.mp4`;
    
    await this.showNotification('fallback', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Video Download Helper',
      message: `Đã tải manifest file. Sử dụng FFmpeg để convert.`
    });
    
    return {
      downloadId: downloadId,
      streamInfo: streamInfo,
      requiresConversion: true,
      ffmpegCommand: ffmpegCommand
    };
  }
  
  async extractSegments(streamInfo, options = {}) {
    const { type, url } = streamInfo;
    
    console.log('[StreamProcessor] ExtractSegments called with:', {
      type,
      url: url ? url.substring(0, 100) + '...' : 'none',
      hasManifest: !!streamInfo.manifest
    });
    
    // Fetch manifest if needed
    let manifest = streamInfo.manifest;
    if (!manifest) {
      try {
        console.log('[StreamProcessor] Fetching manifest from URL...');
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
        }
        manifest = await response.text();
        console.log(`[StreamProcessor] Manifest fetched: ${manifest.length} characters`);
        console.log(`[StreamProcessor] Manifest preview: ${manifest.substring(0, 300)}...`);
      } catch (error) {
        console.error('[StreamProcessor] Failed to fetch manifest:', error);
        throw error;
      }
    } else {
      console.log(`[StreamProcessor] Using provided manifest: ${manifest.length} characters`);
    }
    
    let segments = [];
    let duration = null;
    
    console.log(`[StreamProcessor] Starting ${type} parsing...`);
    
    if (type === 'hls') {
      console.log('[StreamProcessor] Calling extractHlsSegments...');
      segments = await this.extractHlsSegments(manifest, url);
      duration = segments.duration || null;
      console.log(`[StreamProcessor] HLS parsing result: ${segments.length} segments, duration: ${duration}`);
    } else if (type === 'dash' || type === 'mpd') {
      console.log('[StreamProcessor] Calling extractDashSegments...');
      segments = await this.extractDashSegments(manifest, url, options.quality);
      console.log(`[StreamProcessor] DASH parsing result: ${segments.length} segments`);
      if (segments.separateStreams) {
        console.log('[StreamProcessor] DASH returned separate streams');
      }
    }
    
    // Store duration in streamInfo
    if (duration) {
      streamInfo.duration = duration;
    }
    
    // Calculate exact size from all segments (but only for smaller streams)
    if (segments.length > 0 && segments.length < 200 && !segments.separateStreams) {
      console.log(`[StreamProcessor] Calculating size for ${segments.length} segments...`);
      try {
        const exactSize = await this.calculateStreamSize(segments);
        if (exactSize) {
          streamInfo.estimatedSize = exactSize;
          streamInfo.isExactSize = true;
          console.log(`[StreamProcessor] Calculated size: ${this.formatBytes(exactSize)}`);
        }
      } catch (error) {
        console.warn('[StreamProcessor] Failed to calculate stream size:', error);
      }
    }
    
    console.log(`[StreamProcessor] ExtractSegments final result: ${segments.length} segments`);
    return segments;
  }

  // Try alternative parsing methods when standard parsing fails
  async tryAlternativeParsing(streamInfo, options) {
    console.log('[StreamProcessor] ===============================');
    console.log('[StreamProcessor] TRYING ALTERNATIVE PARSING METHODS');
    console.log('[StreamProcessor] ===============================');
    
    const { type, url } = streamInfo;
    
    try {
      // Fetch manifest content first
      let manifest = streamInfo.manifest;
      if (!manifest) {
        console.log('[StreamProcessor] Fetching manifest for alternative parsing...');
        const response = await fetch(url);
        manifest = await response.text();
      }
      
      console.log(`[StreamProcessor] Manifest for alternative parsing: ${manifest.length} characters`);
      console.log(`[StreamProcessor] Manifest preview: ${manifest.substring(0, 200)}...`);
      
      const segments = [];
      
      // For HLS, try to find any .ts segments in the manifest
      if (type === 'hls') {
        console.log('[StreamProcessor] Alternative HLS parsing...');
        
        const lines = manifest.split('\n');
        let segmentCount = 0;
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          // Look for actual segment files (not comments, not empty)
          if (trimmed && 
              !trimmed.startsWith('#') && 
              (trimmed.includes('.ts') || trimmed.includes('.m4s') || trimmed.includes('.mp4'))) {
            const segmentUrl = this.resolveUrl(url, trimmed);
            segments.push(segmentUrl);
            segmentCount++;
            
            if (segmentCount <= 3) {
              console.log(`[StreamProcessor] HLS Alt segment ${segmentCount}: ${segmentUrl.substring(0, 80)}...`);
            }
          }
          
          // Also check for URLs without extensions (some streams don't use .ts)
          if (trimmed &&
              !trimmed.startsWith('#') &&
              !trimmed.includes('.m3u8') &&
              !trimmed.includes('.mpd') &&
              trimmed.length > 10) {
            const segmentUrl = this.resolveUrl(url, trimmed);
            segments.push(segmentUrl);
            segmentCount++;
            
            if (segmentCount <= 3) {
              console.log(`[StreamProcessor] HLS Alt segment (no ext) ${segmentCount}: ${segmentUrl.substring(0, 80)}...`);
            }
          }
        }
        
        console.log(`[StreamProcessor] Alternative HLS found ${segments.length} segments`);
        return segments;
      }
      
      // For DASH, try to find any segment URLs
      if (type === 'dash' || type === 'mpd') {
        console.log('[StreamProcessor] Alternative DASH parsing...');
        
        // Look for SegmentURL elements
        const segmentUrlMatches = manifest.match(/<SegmentURL[^>]*media="([^"]+)"/gi);
        if (segmentUrlMatches) {
          console.log(`[StreamProcessor] Found ${segmentUrlMatches.length} SegmentURL elements`);
          for (const match of segmentUrlMatches) {
            const urlMatch = match.match(/media="([^"]+)"/);
            if (urlMatch) {
              const segmentUrl = this.resolveUrl(url, urlMatch[1]);
              segments.push(segmentUrl);
            }
          }
        }
        
        // Method 2: Look for any URLs in the manifest that look like segments
        if (segments.length === 0) {
          const urlMatches = manifest.match(/https?:\/\/[^\s<>"']+/gi);
          if (urlMatches) {
            console.log(`[StreamProcessor] Found ${urlMatches.length} URLs in manifest`);
            for (const foundUrl of urlMatches) {
              // Filter for likely segment URLs
              if (foundUrl.includes('.m4s') || 
                  foundUrl.includes('.mp4') || 
                  foundUrl.includes('segment') ||
                  /\d+$/.test(foundUrl)) {
                segments.push(foundUrl);
              }
            }
          }
        }
        
        // Method 3: Generate segments from template if found
        if (segments.length === 0) {
          const mediaMatch = manifest.match(/media="([^"]+)"/);
          const initMatch = manifest.match(/initialization="([^"]+)"/);
          
          if (mediaMatch) {
            const mediaTemplate = mediaMatch[1];
            console.log(`[StreamProcessor] Using template generation: ${mediaTemplate}`);
            
            // Add init segment if available
            if (initMatch) {
              const initUrl = this.resolveUrl(url, initMatch[1]);
              segments.push(initUrl);
              console.log(`[StreamProcessor] Added init segment: ${initUrl.substring(0, 80)}...`);
            }
            
            // Generate media segments (start with 100 segments)
            for (let i = 1; i <= 100; i++) {
              let segmentUrl = mediaTemplate;
              segmentUrl = segmentUrl.replace('$Number$', i.toString());
              segmentUrl = segmentUrl.replace('$Time$', (i * 2000).toString()); // Estimate 2-second segments
              
              const fullUrl = this.resolveUrl(url, segmentUrl);
              segments.push(fullUrl);
              
              if (i <= 3) {
                console.log(`[StreamProcessor] Generated segment ${i}: ${fullUrl.substring(0, 80)}...`);
              }
            }
          }
        }
        
        console.log(`[StreamProcessor] Alternative DASH found ${segments.length} segments`);
        return segments;
      }
      
    } catch (error) {
      console.error('[StreamProcessor] Alternative parsing failed:', error);
    }
    
    return [];
  }
  
  async extractHlsSegments(manifest, baseUrl) {
    const lines = manifest.split('\n').filter(line => line.trim());
    const segments = [];
    let isCloudflareStream = baseUrl.includes('cloudflarestream.com') || baseUrl.includes('videodelivery.net');
    let totalDuration = 0;
    
    console.log(`[StreamProcessor] Parsing HLS manifest: ${lines.length} lines, Cloudflare: ${isCloudflareStream}`);
    
    // Check if this is a master playlist by looking for #EXT-X-STREAM-INF
    const isMasterPlaylist = lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'));
    
    if (isMasterPlaylist) {
      console.log('[StreamProcessor] Detected master playlist, finding best quality variant...');
      
      // Find all variants and pick the best one
      const variants = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const bandwidth = this.extractValue(line, 'BANDWIDTH');
          const resolution = this.extractValue(line, 'RESOLUTION');
          
          if (i + 1 < lines.length) {
            const variantUrl = this.resolveUrl(baseUrl, lines[i + 1].trim());
            
            const [width, height] = resolution ? resolution.split('x') : [0, 0];
            variants.push({
              url: variantUrl,
              bandwidth: parseInt(bandwidth || 0),
              height: parseInt(height || 0),
              resolution: resolution
            });
          }
        }
      }
      
      // Sort by quality (bandwidth and height) and pick best
      variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
      
      console.log(`[StreamProcessor] Found ${variants.length} variants:`);
      variants.forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.resolution || 'unknown'} - ${v.bandwidth || 0} bps - ${v.url.substring(0, 100)}`);
      });
      
      if (variants.length > 0) {
        const bestVariant = variants[0];
        console.log(`[StreamProcessor] Using best variant: ${bestVariant.resolution} (${bestVariant.bandwidth} bps)`);
        
        try {
          const response = await fetch(bestVariant.url);
          const variantManifest = await response.text();
          return await this.extractHlsSegments(variantManifest, bestVariant.url);
        } catch (error) {
          console.error('[StreamProcessor] Failed to fetch best variant playlist:', error);
          // Try other variants as fallback
          for (let i = 1; i < variants.length; i++) {
            try {
              console.log(`[StreamProcessor] Trying fallback variant ${i + 1}...`);
              const response = await fetch(variants[i].url);
              const variantManifest = await response.text();
              return await this.extractHlsSegments(variantManifest, variants[i].url);
            } catch (fallbackError) {
              console.error(`[StreamProcessor] Fallback variant ${i + 1} failed:`, fallbackError);
            }
          }
        }
      }
    }
    
    // This is a media playlist - extract actual segments
    console.log('[StreamProcessor] Parsing media playlist for segments...');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Extract duration from EXTINF (format: #EXTINF:duration,title)
      if (line.startsWith('#EXTINF:')) {
        const durationMatch = line.match(/#EXTINF:([0-9.]+)/);
        if (durationMatch) {
          totalDuration += parseFloat(durationMatch[1]);
        }
      }

      // This is a segment URL (not starting with #)
      if (!line.startsWith('#') && line.length > 0) {
        const segmentUrl = this.resolveUrl(baseUrl, line);
        segments.push(segmentUrl);
      }
    }
    
    console.log(`[StreamProcessor] HLS segments: ${segments.length}, total duration: ${totalDuration}s`);
    
    // Store duration in a way we can retrieve it
    if (segments.length > 0) {
      segments.duration = totalDuration > 0 ? totalDuration : null;
    }
    
    return segments;
  }
  
  async extractDashSegments(manifest, baseUrl, selectedQuality = null) {
    const segments = [];
    
    console.log('[StreamProcessor] ===================');
    console.log('[StreamProcessor] DASH SEGMENT EXTRACTION STARTED');
    console.log('[StreamProcessor] ===================');
    console.log(`[StreamProcessor] Manifest length: ${manifest.length}`);
    console.log(`[StreamProcessor] Base URL: ${baseUrl}`);
    console.log(`[StreamProcessor] Selected quality: ${selectedQuality ? JSON.stringify(selectedQuality) : 'auto (highest)'}`);
    console.log(`[StreamProcessor] Manifest preview (first 500 chars): ${manifest.substring(0, 500)}`);
    
    // Check if this is a Cloudflare Stream manifest
    const isCloudflareStream = baseUrl.includes('cloudflarestream.com') || baseUrl.includes('videodelivery.net');
    console.log(`[StreamProcessor] Is Cloudflare Stream: ${isCloudflareStream}`);
    
    if (!isCloudflareStream) {
      console.log('[StreamProcessor] Not Cloudflare Stream - trying generic DASH parsing...');
      
      // Try generic DASH parsing for other providers
      const segmentUrls = manifest.match(/<SegmentURL[^>]*media="([^"]+)"/gi);
      if (segmentUrls) {
        console.log(`[StreamProcessor] Found ${segmentUrls.length} SegmentURL elements`);
        for (const match of segmentUrls) {
          const urlMatch = match.match(/media="([^"]+)"/);
          if (urlMatch) {
            const segmentUrl = this.resolveUrl(baseUrl, urlMatch[1]);
            segments.push(segmentUrl);
          }
        }
        console.log(`[StreamProcessor] Generic DASH: extracted ${segments.length} segments`);
        return segments;
      }
      
      // Try SegmentTemplate parsing
      const templateMatch = manifest.match(/<SegmentTemplate[^>]*media="([^"]+)"[^>]*>/i);
      if (templateMatch) {
        console.log('[StreamProcessor] Found SegmentTemplate, attempting to generate segments...');
        const mediaTemplate = templateMatch[1];
        console.log(`[StreamProcessor] Media template: ${mediaTemplate}`);
        
        // Generate some segments (simplified approach)
        for (let i = 1; i <= 100; i++) {
          const segmentUrl = mediaTemplate.replace('$Number$', i.toString());
          const fullUrl = this.resolveUrl(baseUrl, segmentUrl);
          segments.push(fullUrl);
        }
        console.log(`[StreamProcessor] SegmentTemplate: generated ${segments.length} segments`);
        return segments;
      }
      
      console.log('[StreamProcessor] No standard DASH segments found, falling back to Cloudflare parsing...');
    }
    
    // For Cloudflare Stream, try to extract segments from SegmentTemplate
    if (isCloudflareStream) {
      console.log('[StreamProcessor] Attempting to parse Cloudflare Stream segments...');
      
      // Extract video duration from manifest (ISO 8601 format: PT10M5.6S)
      const durationMatch = manifest.match(/mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([0-9.]+)S)?"/);
      let duration = 0;
      if (durationMatch) {
        const hours = parseInt(durationMatch[1] || 0);
        const minutes = parseInt(durationMatch[2] || 0);
        const seconds = parseFloat(durationMatch[3] || 0);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
      console.log(`[StreamProcessor] Video duration: ${duration} seconds`);
      
      // Find video and audio AdaptationSets
      const adaptationSets = manifest.match(/<AdaptationSet[^>]*>[\s\S]*?<\/AdaptationSet>/gi) || [];
      console.log(`[StreamProcessor] Found ${adaptationSets.length} AdaptationSets`);
      
      const videoSegments = [];
      const audioSegments = [];
      let videoMetadata = null;
      let audioMetadata = null;
      
      for (const adaptationSet of adaptationSets) {
        const isVideo = adaptationSet.includes('mimeType="video');
        const isAudio = adaptationSet.includes('mimeType="audio');
        
        if (!isVideo && !isAudio) continue;
        
        console.log(`[StreamProcessor] Found ${isVideo ? 'video' : 'audio'} AdaptationSet`);
        console.log(`[StreamProcessor] Selected quality parameter: ${JSON.stringify(selectedQuality)}`);
        
        // Find best representation based on user selection or automatic
        const representations = adaptationSet.match(/<Representation[^>]*>/gi) || [];
        let bestRepresentation = null;
        let bestScore = 0;
        
        console.log(`[StreamProcessor] Found ${representations.length} representations`);
        
        for (const rep of representations) {
          const bandwidthMatch = rep.match(/bandwidth="([0-9]+)"/);
          const heightMatch = rep.match(/height="([0-9]+)"/);
          const widthMatch = rep.match(/width="([0-9]+)"/);
          
          if (bandwidthMatch) {
            const bandwidth = parseInt(bandwidthMatch[1]);
            const height = heightMatch ? parseInt(heightMatch[1]) : 0;
            const width = widthMatch ? parseInt(widthMatch[1]) : 0;
            
            console.log(`[StreamProcessor]   - Representation: ${width}x${height}, bandwidth=${bandwidth}`);
            
            // Check if this matches user's selected quality
            if (isVideo && selectedQuality && height === selectedQuality.height) {
              console.log(`[StreamProcessor]   ✅ Matched user selection: ${height}p`);
              bestRepresentation = rep;
              bestScore = height;
              break; // Found exact match, stop searching
            }
            
            // Otherwise, find highest quality (for video: by height, for audio: by bandwidth)
            const score = isVideo ? height : bandwidth;
            
            if (score > bestScore) {
              bestScore = score;
              bestRepresentation = rep;
            }
          }
        }
        
        // If user selected quality but not found, log warning
        if (isVideo && selectedQuality && bestScore !== selectedQuality.height) {
          console.log(`[StreamProcessor] ⚠️ Requested quality ${selectedQuality.height}p not available`);
          if (bestRepresentation) {
            console.log(`[StreamProcessor]    Using closest available: ${bestScore}p`);
          } else {
            console.log(`[StreamProcessor]    No video quality found at all!`);
          }
        }
        
        if (bestRepresentation) {
          const heightMatch = bestRepresentation.match(/height="([0-9]+)"/);
          const widthMatch = bestRepresentation.match(/width="([0-9]+)"/);
          const selectedHeight = heightMatch ? heightMatch[1] : null;
          const quality = heightMatch ? `${widthMatch ? widthMatch[1] + 'x' : ''}${heightMatch[1]}p` : 'unknown';
          
          console.log(`[StreamProcessor] Best ${isVideo ? 'video' : 'audio'} representation: ${quality}, score=${bestScore}`);
          console.log(`[StreamProcessor] Will use resolution: ${selectedHeight} for URL replacement`);
          console.log(`[StreamProcessor] Full representation: ${bestRepresentation.substring(0, 200)}`);
          
          // Extract SegmentTemplate from this representation's AdaptationSet
          const segmentTemplateMatch = adaptationSet.match(/<SegmentTemplate[^>]*>/);
          if (segmentTemplateMatch) {
            const template = segmentTemplateMatch[0];
            console.log(`[StreamProcessor] SegmentTemplate: ${template}`);
            
            const mediaMatch = template.match(/media="([^"]+)"/);
            const initMatch = template.match(/initialization="([^"]+)"/);
            const timescaleMatch = template.match(/timescale="([^"]+)"/);
            const durationSegMatch = template.match(/duration="([^"]+)"/);
            
            if (mediaMatch && durationSegMatch && timescaleMatch) {
              // Decode HTML entities (&amp; -> &)
              let mediaTemplate = mediaMatch[1].replace(/&amp;/g, '&');
              let initTemplate = initMatch ? initMatch[1].replace(/&amp;/g, '&') : null;
              
              // IMPORTANT: Replace resolution in URL templates for Cloudflare Stream
              if (isVideo && selectedHeight) {
                // Replace /video/{any_number}/ with /video/{selectedHeight}/
                mediaTemplate = mediaTemplate.replace(/\/video\/\d+\//, `/video/${selectedHeight}/`);
                if (initTemplate) {
                  initTemplate = initTemplate.replace(/\/video\/\d+\//, `/video/${selectedHeight}/`);
                }
                console.log(`[StreamProcessor] Replaced video quality in URLs to ${selectedHeight}p`);
                console.log(`[StreamProcessor] Init template: ${initTemplate}`);
                console.log(`[StreamProcessor] Media template: ${mediaTemplate}`);
              }
              const timescale = parseFloat(timescaleMatch[1]);
              const segmentDuration = parseFloat(durationSegMatch[1]);
              
              // Calculate number of segments
              const segmentCount = Math.ceil((duration * timescale) / segmentDuration);
              
              // Store metadata for verification
              const metadata = {
                timescale: timescale,
                segmentDuration: segmentDuration,
                segmentCount: segmentCount,
                totalDuration: duration,
                quality: bestScore
              };
              
              console.log(`[StreamProcessor] Cloudflare Stream config: segments=${segmentCount}, timescale=${timescale}, duration=${duration}s`);
              
              const currentSegments = [];
              
              // Add init segment FIRST (contains ftyp/moov boxes - required for valid MP4)
              if (initTemplate) {
                const initUrl = this.resolveUrl(baseUrl, initTemplate);
                console.log(`[StreamProcessor] Init segment: ${initUrl}`);
                currentSegments.push(initUrl);
              }
              
              // Generate media segment URLs
              for (let i = 1; i <= segmentCount; i++) {
                const segmentUrl = mediaTemplate.replace('$Number$', i.toString());
                const fullUrl = this.resolveUrl(baseUrl, segmentUrl);
                currentSegments.push(fullUrl);
              }
              
              // Store in appropriate array with metadata
              if (isVideo) {
                videoSegments.push(...currentSegments);
                videoMetadata = metadata;
                console.log(`[StreamProcessor] Video: Generated ${currentSegments.length} segment URLs (1 init + ${segmentCount} media)`);
              } else {
                audioSegments.push(...currentSegments);
                audioMetadata = metadata;
                console.log(`[StreamProcessor] Audio: Generated ${currentSegments.length} segment URLs (1 init + ${segmentCount} media)`);
              }
              
              if (currentSegments.length > 0) {
                console.log(`[StreamProcessor] Sample ${isVideo ? 'video' : 'audio'} segment URLs: ${JSON.stringify(currentSegments.slice(0, 3))}`);
              }
            } else {
              console.log('[StreamProcessor] Missing required SegmentTemplate attributes');
            }
          } else {
            console.log('[StreamProcessor] No SegmentTemplate found in AdaptationSet');
          }
        } else {
          this.log('error', `❌ CRITICAL: No representation found for ${isVideo ? 'video' : 'audio'}!`);
          if (isVideo && selectedQuality) {
            this.log('error', `   Requested quality: ${selectedQuality.height}p (${selectedQuality.resolution})`);
            this.log('error', `   Available representations: ${representations.length}`);
            this.log('error', `   This quality may not be available for this video.`);
            this.log('warn', `   Will try to download without video segments (may result in audio-only).`);
          }
        }
      }
      
      // Return both audio and video segments
      if (videoSegments.length > 0 && audioSegments.length > 0) {
        this.log('success', `Cloudflare Stream: Found ${videoSegments.length} video + ${audioSegments.length} audio segments`);
        
        // CRITICAL VERIFICATION: Audio and video MUST match
        this.log('info', `Video metadata: ${JSON.stringify(videoMetadata)}`);
        this.log('info', `Audio metadata: ${JSON.stringify(audioMetadata)}`);
        
        // Check 0: Extract video ID from URLs to verify same source
        const videoSample = videoSegments[1] || videoSegments[0]; // Skip init, use first media segment
        const audioSample = audioSegments[1] || audioSegments[0];
        
        const videoIdMatch = videoSample.match(/\/([a-f0-9]{32})\/(video|audio)/);
        const audioIdMatch = audioSample.match(/\/([a-f0-9]{32})\/(video|audio)/);
        
        if (videoIdMatch && audioIdMatch) {
          const videoId = videoIdMatch[1];
          const audioId = audioIdMatch[1];
          
          this.log('info', `Video ID: ${videoId}`);
          this.log('info', `Audio ID: ${audioId}`);
          
          if (videoId !== audioId) {
            this.log('error', `❌ VIDEO ID MISMATCH! Audio and video are from DIFFERENT sources!`);
            this.log('error', `   Video ID: ${videoId}`);
            this.log('error', `   Audio ID: ${audioId}`);
            this.log('warn', 'Using video-only to avoid wrong audio.');
            return videoSegments;
          }
          
          this.log('success', `✅ SAME VIDEO ID: ${videoId}`);
        }
        
        // Check 1: Segment count must be identical
        if (videoSegments.length !== audioSegments.length) {
          this.log('error', `❌ MISMATCH: Video has ${videoSegments.length} segments, Audio has ${audioSegments.length} segments`);
          this.log('warn', 'Audio and video are from different sources! Using video-only.');
          return videoSegments;
        }
        
        // Check 2: Duration must be identical
        if (videoMetadata && audioMetadata) {
          const durationDiff = Math.abs(videoMetadata.totalDuration - audioMetadata.totalDuration);
          if (durationDiff > 1.0) { // Allow 1 second tolerance
            this.log('error', `❌ DURATION MISMATCH: Video ${videoMetadata.totalDuration}s, Audio ${audioMetadata.totalDuration}s`);
            this.log('warn', 'Audio and video have different durations! Using video-only.');
            return videoSegments;
          }
          
          // Check 3: Segment count from metadata must match
          if (videoMetadata.segmentCount !== audioMetadata.segmentCount) {
            this.log('error', `❌ SEGMENT COUNT MISMATCH: Video expects ${videoMetadata.segmentCount}, Audio expects ${audioMetadata.segmentCount}`);
            this.log('warn', 'Audio and video segment counts differ! Using video-only.');
            return videoSegments;
          }
          
          this.log('success', `✅ VERIFIED: Audio and video are perfectly matched!`);
          this.log('success', `   - Same video ID (Cloudflare Stream)`);
          this.log('success', `   - Same segment count: ${videoMetadata.segmentCount}`);
          this.log('success', `   - Same duration: ${videoMetadata.totalDuration}s`);
          this.log('success', `   - Will download as 2 separate files`);
        }
        
        return {
          video: videoSegments,
          audio: audioSegments,
          separateStreams: true,
          metadata: {
            video: videoMetadata,
            audio: audioMetadata
          }
        };
      } else if (videoSegments.length > 0) {
        // CRITICAL VERIFICATION: Audio and video MUST match
        this.log('info', `Video metadata: ${JSON.stringify(videoMetadata)}`);
        this.log('info', `Audio metadata: ${JSON.stringify(audioMetadata)}`);
        
        // Check 0: Extract video ID from URLs to verify same source
        const videoSample = videoSegments[1] || videoSegments[0]; // Skip init, use first media segment
        const audioSample = audioSegments[1] || audioSegments[0];
        
        const videoIdMatch = videoSample.match(/\/([a-f0-9]{32})\/(video|audio)/);
        const audioIdMatch = audioSample.match(/\/([a-f0-9]{32})\/(video|audio)/);
        
        if (videoIdMatch && audioIdMatch) {
          const videoId = videoIdMatch[1];
          const audioId = audioIdMatch[1];
          
          this.log('info', `Video ID: ${videoId}`);
          this.log('info', `Audio ID: ${audioId}`);
          
          if (videoId !== audioId) {
            this.log('error', `❌ VIDEO ID MISMATCH! Audio and video are from DIFFERENT sources!`);
            this.log('error', `   Video ID: ${videoId}`);
            this.log('error', `   Audio ID: ${audioId}`);
            this.log('warn', 'Using video-only to avoid wrong audio.');
            return videoSegments;
          }
          
          this.log('success', `✅ SAME VIDEO ID: ${videoId}`);
        }
        
        // Check 1: Segment count must be identical
        if (videoSegments.length !== audioSegments.length) {
          this.log('error', `❌ MISMATCH: Video has ${videoSegments.length} segments, Audio has ${audioSegments.length} segments`);
          this.log('warn', 'Audio and video are from different sources! Using video-only.');
          return videoSegments;
        }
        
        // Check 2: Duration must be identical
        if (videoMetadata && audioMetadata) {
          const durationDiff = Math.abs(videoMetadata.totalDuration - audioMetadata.totalDuration);
          if (durationDiff > 1.0) { // Allow 1 second tolerance
            this.log('error', `❌ DURATION MISMATCH: Video ${videoMetadata.totalDuration}s, Audio ${audioMetadata.totalDuration}s`);
            this.log('warn', 'Audio and video have different durations! Using video-only.');
            return videoSegments;
          }
          
          // Check 3: Segment count from metadata must match
          if (videoMetadata.segmentCount !== audioMetadata.segmentCount) {
            this.log('error', `❌ SEGMENT COUNT MISMATCH: Video expects ${videoMetadata.segmentCount}, Audio expects ${audioMetadata.segmentCount}`);
            this.log('warn', 'Audio and video segment counts differ! Using video-only.');
            return videoSegments;
          }
          
          this.log('success', `✅ VERIFIED: Audio and video are perfectly matched!`);
          this.log('success', `   - Same video ID (Cloudflare Stream)`);
          this.log('success', `   - Same segment count: ${videoMetadata.segmentCount}`);
          this.log('success', `   - Same duration: ${videoMetadata.totalDuration}s`);
          this.log('success', `   - Ready to merge!`);
        }
        
        return {
          video: videoSegments,
          audio: audioSegments,
          separateStreams: true,
          metadata: {
            video: videoMetadata,
            audio: audioMetadata
          }
        };
      } else if (videoSegments.length > 0) {
        this.log('warn', '⚠️ Only video segments found (no audio) - will download video only');
        this.log('info', `Video segments count: ${videoSegments.length}`);
        return videoSegments;
      } else if (audioSegments.length > 0) {
        this.log('error', '❌ CRITICAL: Only audio segments found (NO VIDEO)!');
        this.log('error', `   Audio segments: ${audioSegments.length}`);
        this.log('error', `   Video segments: 0`);
        this.log('error', `   This usually means the requested video quality is not available.`);
        this.log('warn', 'Returning audio only - download may fail or produce audio-only file');
        return audioSegments;
      }
      
      if (videoSegments.length === 0 && audioSegments.length === 0) {
        this.log('warn', 'Could not parse Cloudflare Stream segments, trying standard DASH parsing');
      } else {
        this.log('success', 'Successfully parsed Cloudflare Stream, returning segments');
        return segments;
      }
    }
    
    // Find SegmentTemplate or SegmentList using regex
    const segmentTemplates = manifest.match(/<SegmentTemplate[^>]*>[\s\S]*?<\/SegmentTemplate>/gi);
    const segmentLists = manifest.match(/<SegmentList[^>]*>[\s\S]*?<\/SegmentList>/gi);
    
    console.log('[StreamProcessor] SegmentTemplates found:', segmentTemplates ? segmentTemplates.length : 0);
    console.log('[StreamProcessor] SegmentLists found:', segmentLists ? segmentLists.length : 0);
    
    if (segmentTemplates && segmentTemplates.length > 0) {
      // Find first video AdaptationSet
      const videoAdaptationSets = manifest.match(/<AdaptationSet[^>]*mimeType="[^"]*video[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/gi);
      
      console.log('[StreamProcessor] Video AdaptationSets found:', videoAdaptationSets ? videoAdaptationSets.length : 0);
      
      if (videoAdaptationSets && videoAdaptationSets.length > 0) {
        const adaptationSet = videoAdaptationSets[0];
        
        // Find SegmentTemplate
        const templateMatch = adaptationSet.match(/<SegmentTemplate[^>]*\/?>/);
        
        if (templateMatch) {
          const template = templateMatch[0];
          
          console.log('[StreamProcessor] SegmentTemplate:', template);
          
          // Extract attributes
          const mediaMatch = template.match(/media="([^"]+)"/);
          const startNumberMatch = template.match(/startNumber="([^"]+)"/);
          const durationMatch = template.match(/duration="([^"]+)"/);
          const timescaleMatch = template.match(/timescale="([^"]+)"/);
          
          if (mediaMatch) {
            const media = mediaMatch[1];
            const startNumber = startNumberMatch ? parseInt(startNumberMatch[1]) : 1;
            const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;
            const timescale = timescaleMatch ? parseFloat(timescaleMatch[1]) : 1;
            
            // Estimate number of segments
            // This is approximate - ideally should be calculated from MPD duration
            const segmentCount = 100; // Default fallback
            
            console.log(`[StreamProcessor] DASH SegmentTemplate: ${media}, generating ${segmentCount} segments`);
            
            for (let i = 0; i < segmentCount; i++) {
              const segmentNumber = startNumber + i;
              let segmentUrl = media
                .replace('$Number$', segmentNumber.toString())
                .replace('$Time$', (segmentNumber * duration).toString());
              
              segmentUrl = this.resolveUrl(baseUrl, segmentUrl);
              segments.push(segmentUrl);
            }
          } else {
            console.warn('[StreamProcessor] No media attribute found in SegmentTemplate');
          }
        } else {
          console.warn('[StreamProcessor] No SegmentTemplate found in AdaptationSet');
        }
      } else {
        console.warn('[StreamProcessor] No video AdaptationSet found');
      }
    } else if (segmentLists && segmentLists.length > 0) {
      // Handle SegmentList
      segmentLists.forEach(segmentList => {
        // Find all SegmentURL elements
        const segmentUrls = segmentList.matchAll(/<SegmentURL[^>]*\/?>|<SegmentURL[^>]*>[\s\S]*?<\/SegmentURL>/gi);
        
        for (const segMatch of segmentUrls) {
          const segTag = segMatch[0];
          const mediaMatch = segTag.match(/media="([^"]+)"/);
          
          if (mediaMatch) {
            const segUrl = this.resolveUrl(baseUrl, mediaMatch[1]);
            segments.push(segUrl);
          }
        }
      });
    }
    
    console.log(`[StreamProcessor] Extracted ${segments.length} DASH segments`);
    
    return segments;
  }
  
  async downloadAndMergeSegments(segmentUrls, type) {
    const chunks = [];
    const maxConcurrent = 3; // Giảm xuống 3 để tránh overload
    const totalSegments = segmentUrls.length;
    
    console.log(`[StreamProcessor] Downloading ${totalSegments} segments...`);
    
    // Show progress notification
    const notificationId = 'download-progress-' + Date.now();
    await this.showNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Video Download Helper',
      message: `Đang tải và ghép ${totalSegments} segments...`
    });
    
    // Download segments in batches
    for (let i = 0; i < segmentUrls.length; i += maxConcurrent) {
      const batch = segmentUrls.slice(i, i + maxConcurrent);
      const batchChunks = await Promise.all(
        batch.map((url, index) => this.downloadSegment(url, i + index + 1, totalSegments))
      );
      chunks.push(...batchChunks);
      
      // Update progress
      const progress = Math.round((chunks.length / totalSegments) * 100);
      console.log(`[StreamProcessor] Download progress: ${progress}% (${chunks.length}/${totalSegments})`);
      
      // Send progress to popup
      this.sendProgressUpdate({
        show: true,
        percent: progress,
        text: `Đang tải ${type.toUpperCase()}...`,
        detail: `${chunks.length}/${totalSegments} segments`,
        size: this.formatBytes(chunks.reduce((sum, c) => sum + (c ? c.size : 0), 0))
      });
    }
    
    // Clear notification
    await this.clearNotification(notificationId);
    
    // Filter out failed downloads
    const validChunks = chunks.filter(chunk => chunk !== null);
    
    console.log(`[StreamProcessor] Valid chunks: ${validChunks.length}/${totalSegments}`);
    
    if (validChunks.length === 0) {
      throw new Error('Không thể tải segments nào. Có thể do CORS hoặc URL không hợp lệ.');
    }
    
    if (validChunks.length < totalSegments * 0.5) {
      console.warn(`[StreamProcessor] Only ${validChunks.length}/${totalSegments} segments downloaded`);
    }
    
    // Merge all chunks into one blob with MP4 mime type
    const mergedBlob = new Blob(validChunks, { 
      type: 'video/mp4' // Always use MP4 for better compatibility
    });
    
    console.log(`[StreamProcessor] Merged blob created: ${mergedBlob.size} bytes`);
    
    return mergedBlob;
  }
  
  async downloadSegment(url, index, total, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[StreamProcessor] Retry ${attempt} for segment ${index}/${total}`);
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
        
        console.log(`[StreamProcessor] Downloading segment ${index}/${total}: ${url.substring(0, 100)}...`);
        
        const response = await fetch(url, {
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Accept': '*/*',
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            console.error(`[StreamProcessor] Segment ${index} not found (404), skipping...`);
            return null; // Don't retry 404s
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        
        // Validate blob is not empty
        if (blob.size === 0) {
          throw new Error('Empty segment received');
        }
        
        console.log(`[StreamProcessor] Segment ${index} downloaded: ${blob.size} bytes`);
        return blob;
        
      } catch (error) {
        console.error(`[StreamProcessor] Error downloading segment ${index} (attempt ${attempt + 1}):`, error.message);
        
        if (attempt === retries) {
          console.error(`[StreamProcessor] Failed to download segment ${index} after ${retries + 1} attempts`);
          return null;
        }
      }
    }
    return null;
  }
  
  getExtension(type) {
    const extensions = {
      'hls': 'ts',
      'dash': 'mp4',
      'mpd': 'mp4'
    };
    return extensions[type] || 'mp4';
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }
  
  extractVideoName(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
      
      // For Cloudflare Stream, extract video ID
      if (url.includes('cloudflarestream.com') || url.includes('videodelivery.net')) {
        // Find the token/ID part (usually a long alphanumeric string)
        const videoId = pathParts.find(part => part.length > 20 && !part.includes('.'));
        if (videoId) {
          return 'cloudflare_video_' + videoId.substring(0, 12);
        }
      }
      
      // Get last meaningful part
      const lastPart = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1] || 'video';
      return lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');
    } catch {
      return 'video';
    }
  }
  
  parseISO8601Duration(duration) {
    // Parse ISO 8601 duration format: PT1H2M3.4S
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    if (!match) return null;
    
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseFloat(match[3] || 0);
    
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  formatDuration(seconds) {
    if (!seconds) return null;
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }
  
  async calculateStreamSize(segments) {
    const totalSegments = segments.length;
    console.log(`[StreamProcessor] Calculating exact size from ${totalSegments} segments...`);
    
    let totalSize = 0;
    let successCount = 0;
    const maxConcurrent = 10; // Fetch 10 segments at a time
    
    // Show notification
    await this.showNotification('calc-size', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Video Download Helper',
      message: `Đang tính dung lượng ${totalSegments} segments...`
    });
    
    // Process segments in batches
    for (let i = 0; i < totalSegments; i += maxConcurrent) {
      const batch = segments.slice(i, i + maxConcurrent);
      
      const sizes = await Promise.all(
        batch.map(async (url) => {
          try {
            const response = await fetch(url, {
              method: 'HEAD',
              mode: 'cors',
              credentials: 'omit'
            });
            
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
              return parseInt(contentLength);
            }
            return 0;
          } catch (error) {
            // If HEAD fails, try GET with range
            try {
              const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                headers: { 'Range': 'bytes=0-0' }
              });
              
              const contentRange = response.headers.get('content-range');
              if (contentRange) {
                const match = contentRange.match(/\/([0-9]+)$/);
                if (match) {
                  return parseInt(match[1]);
                }
              }
            } catch (e) {
              // Ignore
            }
            return 0;
          }
        })
      );
      
      sizes.forEach(size => {
        if (size > 0) {
          totalSize += size;
          successCount++;
        }
      });
      
      // Update progress
      const progress = Math.round(((i + batch.length) / totalSegments) * 100);
      console.log(`[StreamProcessor] Size calculation: ${progress}% (${successCount}/${totalSegments})`);
    }
    
    // Clear notification
    await this.clearNotification('calc-size');
    
    if (successCount === 0) {
      console.warn('[StreamProcessor] Could not determine size for any segment');
      return null;
    }
    
    // If we couldn't get all segments, estimate the rest
    let finalSize = totalSize;
    if (successCount < totalSegments) {
      const avgSize = totalSize / successCount;
      const estimatedMissing = avgSize * (totalSegments - successCount);
      finalSize = Math.round(totalSize + estimatedMissing);
      console.log(`[StreamProcessor] Got ${successCount}/${totalSegments} segments. Estimated missing: ${this.formatBytes(estimatedMissing)}`);
    }
    
    console.log(`[StreamProcessor] Total size: ${this.formatBytes(finalSize)} (${successCount}/${totalSegments} segments)`);
    
    return finalSize;
  }
  
  async directDownload(url, options) {
    const filename = options.filename || this.generateFilename(url);
    
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: options.saveAs || false
    });
    
    return {
      downloadId: downloadId,
      filename: filename,
      requiresConversion: false
    };
  }
  
  generateFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      
      if (!filename || filename.length === 0) {
        filename = `video_${Date.now()}.mp4`;
      }
      
      return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch {
      return `video_${Date.now()}.mp4`;
    }
  }
}
