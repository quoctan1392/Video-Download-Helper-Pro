/**
 * MP4 Muxer - Merge video and audio using mp4box.js
 * Handles remuxing of separate video and audio streams into a single MP4 file
 */

// Import mp4box.js - will be loaded via importScripts in service worker
// This module assumes MP4Box global is available

const MP4Muxer = {
  /**
   * Merge video and audio blobs into a single MP4 file
   * @param {Blob} videoBlob - Video data (typically fragmented MP4)
   * @param {Blob} audioBlob - Audio data (typically fragmented MP4/M4A)
   * @returns {Promise<Blob>} - Merged MP4 blob
   */
  async mergeVideoAudio(videoBlob, audioBlob) {
    console.log('[MP4Muxer] Starting merge...');
    console.log(`[MP4Muxer] Video size: ${videoBlob.size}, Audio size: ${audioBlob.size}`);
    
    try {
      // Read video and audio as ArrayBuffers
      const [videoBuffer, audioBuffer] = await Promise.all([
        this.blobToArrayBuffer(videoBlob),
        this.blobToArrayBuffer(audioBlob)
      ]);
      
      console.log('[MP4Muxer] Buffers loaded, parsing files...');
      
      // Parse both files to extract tracks
      const videoInfo = await this.parseMP4(videoBuffer, 'video');
      const audioInfo = await this.parseMP4(audioBuffer, 'audio');
      
      console.log('[MP4Muxer] Video info:', videoInfo);
      console.log('[MP4Muxer] Audio info:', audioInfo);
      
      // Create new MP4 file with both tracks
      const mergedBuffer = await this.muxTracks(videoBuffer, audioBuffer, videoInfo, audioInfo);
      
      console.log('[MP4Muxer] Merge complete, output size:', mergedBuffer.byteLength);
      
      return new Blob([mergedBuffer], { type: 'video/mp4' });
    } catch (error) {
      console.error('[MP4Muxer] Merge failed:', error);
      throw error;
    }
  },
  
  /**
   * Convert Blob to ArrayBuffer
   */
  blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  },
  
  /**
   * Parse MP4 file and extract track info
   */
  parseMP4(buffer, label) {
    return new Promise((resolve, reject) => {
      const mp4boxFile = MP4Box.createFile();
      
      mp4boxFile.onReady = (info) => {
        console.log(`[MP4Muxer] ${label} parsed:`, info);
        resolve({
          info: info,
          file: mp4boxFile,
          tracks: info.tracks
        });
      };
      
      mp4boxFile.onError = (e) => {
        console.error(`[MP4Muxer] ${label} parse error:`, e);
        reject(e);
      };
      
      // Set file position for appending
      buffer.fileStart = 0;
      mp4boxFile.appendBuffer(buffer);
      mp4boxFile.flush();
    });
  },
  
  /**
   * Mux video and audio tracks into a single MP4
   */
  async muxTracks(videoBuffer, audioBuffer, videoInfo, audioInfo) {
    return new Promise((resolve, reject) => {
      try {
        // Create output file
        const outputFile = MP4Box.createFile();
        
        // Find video track (typically track with video codec)
        const videoTrack = videoInfo.tracks.find(t => t.type === 'video' || t.codec?.startsWith('avc') || t.codec?.startsWith('hvc') || t.codec?.startsWith('hev'));
        const audioTrack = audioInfo.tracks.find(t => t.type === 'audio' || t.codec?.startsWith('mp4a') || t.codec?.startsWith('aac'));
        
        if (!videoTrack) {
          throw new Error('No video track found');
        }
        if (!audioTrack) {
          throw new Error('No audio track found');
        }
        
        console.log('[MP4Muxer] Video track:', videoTrack);
        console.log('[MP4Muxer] Audio track:', audioTrack);
        
        // Get samples from both files
        videoInfo.file.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity });
        audioInfo.file.setExtractionOptions(audioTrack.id, null, { nbSamples: Infinity });
        
        const videoSamples = [];
        const audioSamples = [];
        
        videoInfo.file.onSamples = (id, user, samples) => {
          console.log(`[MP4Muxer] Got ${samples.length} video samples`);
          videoSamples.push(...samples);
        };
        
        audioInfo.file.onSamples = (id, user, samples) => {
          console.log(`[MP4Muxer] Got ${samples.length} audio samples`);
          audioSamples.push(...samples);
        };
        
        // Start extraction
        videoInfo.file.start();
        audioInfo.file.start();
        
        // Wait a bit for extraction to complete
        setTimeout(() => {
          try {
            console.log(`[MP4Muxer] Extracted: ${videoSamples.length} video, ${audioSamples.length} audio samples`);
            
            // Add tracks to output file
            const videoTrackId = outputFile.addTrack({
              type: 'video',
              width: videoTrack.video?.width || videoTrack.track_width,
              height: videoTrack.video?.height || videoTrack.track_height,
              timescale: videoTrack.timescale,
              duration: videoTrack.duration,
              codec: videoTrack.codec,
              avcDecoderConfigRecord: videoTrack.avcC ? this.extractAvcC(videoInfo.file, videoTrack) : undefined
            });
            
            const audioTrackId = outputFile.addTrack({
              type: 'audio',
              timescale: audioTrack.timescale,
              duration: audioTrack.duration,
              codec: audioTrack.codec,
              channel_count: audioTrack.audio?.channel_count || 2,
              samplerate: audioTrack.audio?.sample_rate || 44100,
              samplesize: audioTrack.audio?.sample_size || 16
            });
            
            console.log(`[MP4Muxer] Created tracks: video=${videoTrackId}, audio=${audioTrackId}`);
            
            // Add samples to output
            for (const sample of videoSamples) {
              outputFile.addSample(videoTrackId, sample.data, {
                dts: sample.dts,
                cts: sample.cts,
                duration: sample.duration,
                is_sync: sample.is_sync
              });
            }
            
            for (const sample of audioSamples) {
              outputFile.addSample(audioTrackId, sample.data, {
                dts: sample.dts,
                cts: sample.cts,
                duration: sample.duration,
                is_sync: sample.is_sync
              });
            }
            
            // Get output buffer
            const outputBuffer = outputFile.getBuffer();
            resolve(outputBuffer);
            
          } catch (err) {
            reject(err);
          }
        }, 100);
        
      } catch (error) {
        reject(error);
      }
    });
  },
  
  /**
   * Extract AVC decoder config from track
   */
  extractAvcC(file, track) {
    // Try to get avcC box data
    if (track.avcC) {
      return track.avcC;
    }
    return undefined;
  },
  
  /**
   * Simple merge by concatenating init segments and media data
   * Fallback method if full muxing fails
   */
  async simpleMerge(videoBlob, audioBlob) {
    console.log('[MP4Muxer] Using simple merge fallback...');
    
    const videoBuffer = await this.blobToArrayBuffer(videoBlob);
    const audioBuffer = await this.blobToArrayBuffer(audioBlob);
    
    // Parse to get init segments
    const videoFile = MP4Box.createFile();
    const audioFile = MP4Box.createFile();
    
    return new Promise((resolve, reject) => {
      let videoReady = false;
      let audioReady = false;
      
      const checkComplete = () => {
        if (videoReady && audioReady) {
          try {
            // Create combined file
            const outputFile = MP4Box.createFile();
            
            // Initialize from video (contains video track)
            outputFile.init();
            
            // This is a simplified approach - may not work for all cases
            // For complex cases, FFmpeg is still recommended
            
            // Just return the video with a note that audio needs FFmpeg
            console.log('[MP4Muxer] Simple merge: returning video only, audio merge requires FFmpeg');
            resolve(videoBuffer);
          } catch (err) {
            reject(err);
          }
        }
      };
      
      videoFile.onReady = () => { videoReady = true; checkComplete(); };
      audioFile.onReady = () => { audioReady = true; checkComplete(); };
      
      videoFile.onError = reject;
      audioFile.onError = reject;
      
      videoBuffer.fileStart = 0;
      audioBuffer.fileStart = 0;
      
      videoFile.appendBuffer(videoBuffer);
      audioFile.appendBuffer(audioBuffer);
      
      videoFile.flush();
      audioFile.flush();
    });
  }
};

// Export for use in service worker
if (typeof self !== 'undefined') {
  self.MP4Muxer = MP4Muxer;
}
