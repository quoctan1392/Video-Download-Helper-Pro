// MP4 Merger - Merge audio and video MP4 files into one
// Pure JavaScript implementation without external dependencies

export class MP4Merger {
  
  /**
   * Merge audio and video MP4 blobs into a single MP4
   * @param {Blob} videoBlob - Video-only MP4 blob
   * @param {Blob} audioBlob - Audio-only MP4 blob
   * @returns {Promise<Blob>} Merged MP4 blob
   */
  async merge(videoBlob, audioBlob) {
    console.log('[MP4Merger] Starting merge...');
    console.log(`[MP4Merger] Video: ${videoBlob.size} bytes, Audio: ${audioBlob.size} bytes`);
    
    try {
      // Read both blobs as ArrayBuffers
      const videoBuffer = await videoBlob.arrayBuffer();
      const audioBuffer = await audioBlob.arrayBuffer();
      
      const videoData = new Uint8Array(videoBuffer);
      const audioData = new Uint8Array(audioBuffer);
      
      // Merge using fragment interleaving
      const merged = this.interleaveFragments(videoData, audioData);
      
      console.log('[MP4Merger] Merge complete:', merged.byteLength, 'bytes');
      return new Blob([merged], { type: 'video/mp4' });
      
    } catch (error) {
      console.error('[MP4Merger] Merge failed:', error);
      throw error;
    }
  }
  
  /**
   * Interleave video and audio fragments
   */
  interleaveFragments(videoData, audioData) {
    const boxes = [];
    let offset = 0;
    
    while (offset < data.length) {
      if (offset + 8 > data.length) break;
      
      const size = this.readUint32(data, offset);
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      );
      
      if (size === 0) break; // Last box
      if (size === 1) {
        // 64-bit size (not handling for now)
        console.warn('[MP4Merger] 64-bit box size not supported');
        break;
      }
      
      const boxData = data.slice(offset, offset + size);
      boxes.push({ type, size, data: boxData, offset });
      
      offset += size;
    }
    
    return { boxes, data };
  }
  
  /**
   * Interleave video and audio fragments
   */
  interleaveFragments(videoData, audioData) {
    const videoBoxes = this.parseBoxes(videoData);
    const audioBoxes = this.parseBoxes(audioData);
    
    console.log('[MP4Merger] Video boxes:', videoBoxes.map(b => b.type).join(', '));
    console.log('[MP4Merger] Audio boxes:', audioBoxes.map(b => b.type).join(', '));
    
    const result = [];
    
    // 1. Add ftyp from video
    const ftypBox = videoBoxes.find(b => b.type === 'ftyp');
    if (ftypBox) {
      result.push(ftypBox.data);
    }
    
    // 2. Merge moov boxes (metadata)
    const videoMoov = videoBoxes.find(b => b.type === 'moov');
    const audioMoov = audioBoxes.find(b => b.type === 'moov');
    
    if (videoMoov) {
      // For now, use video moov
      // TODO: Properly merge track information from both
      result.push(videoMoov.data);
    }
    
    // 3. Extract and interleave fragments (moof+mdat pairs)
    const videoFragments = this.extractFragmentPairs(videoBoxes);
    const audioFragments = this.extractFragmentPairs(audioBoxes);
    
    console.log(`[MP4Merger] Video fragments: ${videoFragments.length}, Audio: ${audioFragments.length}`);
    
    // Interleave: v1, a1, v2, a2, v3, a3...
    const maxFragments = Math.max(videoFragments.length, audioFragments.length);
    for (let i = 0; i < maxFragments; i++) {
      if (i < videoFragments.length) {
        result.push(...videoFragments[i]);
      }
      if (i < audioFragments.length) {
        result.push(...audioFragments[i]);
      }
    }
    
    // Concatenate all
    const totalSize = result.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const arr of result) {
      merged.set(arr, offset);
      offset += arr.length;
    }
    
    console.log(`[MP4Merger] Interleaved ${totalSize} bytes`);
    return merged;
  }
  
  /**
   * Parse MP4 boxes
   */
  parseBoxes(data) {
    const boxes = [];
    let offset = 0;
    
    while (offset < data.length) {
      if (offset + 8 > data.length) break;
      
      const size = this.readUint32(data, offset);
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      );
      
      if (size === 0 || size > data.length - offset) break;
      
      const boxData = data.slice(offset, offset + size);
      boxes.push({ type, size, data: boxData });
      
      offset += size;
    }
    
    return boxes;
  }
  
  /**
   * Extract moof+mdat fragment pairs
   */
  extractFragmentPairs(boxes) {
    const fragments = [];
    let currentMoof = null;
    
    for (const box of boxes) {
      if (box.type === 'moof') {
        currentMoof = box.data;
      } else if (box.type === 'mdat' && currentMoof) {
        fragments.push([currentMoof, box.data]);
        currentMoof = null;
      }
    }
    
    return fragments;
  }
  
  /**
   * Read 32-bit unsigned integer (big-endian)
   */
  readUint32(data, offset) {
    return (
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]
    );
  }
  
  /**
   * Write 32-bit unsigned integer (big-endian)
   */
  writeUint32(value) {
    return new Uint8Array([
      (value >> 24) & 0xff,
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff
    ]);
  }
}
