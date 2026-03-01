// GIF Recorder - Captures screenshots and creates GIF using ffmpeg

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

export interface GifRecordingOptions {
  fps?: number;       // Frames per second (default: 10)
  quality?: number;   // 1-100 (default: 80)
  width?: number;     // Output width (maintains aspect ratio)
}

// Screenshot function type - returns PNG buffer
export type ScreenshotFn = () => Promise<Buffer>;

interface GifRecording {
  id: string;
  frames: string[];
  startTime: number;
  options: Required<GifRecordingOptions>;
  intervalId: NodeJS.Timeout | null;
  tempDir: string;
  screenshotFn: ScreenshotFn;
}

export class GifRecorder {
  private recordings: Map<string, GifRecording> = new Map();
  private static MAX_FRAMES = 300; // 30 seconds at 10fps

  async startRecording(
    screenshotFn: ScreenshotFn,
    options: GifRecordingOptions = {}
  ): Promise<string> {
    const recordingId = randomUUID();
    const tempDir = path.join(os.tmpdir(), `circuit-gif-${recordingId}`);
    await fs.mkdir(tempDir, { recursive: true });

    const recording: GifRecording = {
      id: recordingId,
      frames: [],
      startTime: Date.now(),
      options: {
        fps: options.fps || 10,
        quality: options.quality || 80,
        width: options.width || 800
      },
      intervalId: null,
      tempDir,
      screenshotFn,
    };

    const frameInterval = 1000 / recording.options.fps;

    recording.intervalId = setInterval(async () => {
      if (recording.frames.length >= GifRecorder.MAX_FRAMES) {
        this.stopRecording(recordingId);
        return;
      }

      try {
        const frameNum = recording.frames.length.toString().padStart(5, '0');
        const framePath = path.join(tempDir, `frame-${frameNum}.png`);

        const buffer = await recording.screenshotFn();
        await fs.writeFile(framePath, buffer);
        recording.frames.push(framePath);
      } catch (error) {
        console.error('[GIF-RECORDER] Frame capture error:', error);
      }
    }, frameInterval);

    this.recordings.set(recordingId, recording);
    console.error(`[GIF-RECORDER] Recording started: ${recordingId}`);

    return recordingId;
  }

  stopRecording(recordingId: string): void {
    const recording = this.recordings.get(recordingId);
    if (recording?.intervalId) {
      clearInterval(recording.intervalId);
      recording.intervalId = null;
      console.error(`[GIF-RECORDER] Recording stopped: ${recordingId}, ${recording.frames.length} frames`);
    }
  }

  async saveGif(recordingId: string, outputPath?: string): Promise<string> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    this.stopRecording(recordingId);

    if (recording.frames.length === 0) {
      await this.cleanupRecording(recording);
      this.recordings.delete(recordingId);
      throw new Error('No frames recorded');
    }

    const finalPath = outputPath || `recording-${Date.now()}.gif`;
    const { fps, width } = recording.options;

    try {
      await this.createGifWithFfmpeg(recording, finalPath, fps, width);
    } finally {
      await this.cleanupRecording(recording);
      this.recordings.delete(recordingId);
    }

    return finalPath;
  }

  private async createGifWithFfmpeg(
    recording: GifRecording,
    outputPath: string,
    fps: number,
    width: number
  ): Promise<void> {
    const inputPattern = path.join(recording.tempDir, 'frame-%05d.png');

    return new Promise((resolve, reject) => {
      // Single-pass encoding with inline palette generation
      const filters = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`;

      const args = [
        '-y',
        '-framerate', String(fps),
        '-i', inputPattern,
        '-vf', filters,
        '-loop', '0',
        outputPath
      ];

      const proc = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg not found or failed to start: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.error(`[GIF-RECORDER] GIF saved: ${outputPath}`);
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  private async cleanupRecording(recording: GifRecording): Promise<void> {
    try {
      // Remove temp directory and all files
      await fs.rm(recording.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('[GIF-RECORDER] Cleanup error:', error);
    }
  }

  getRecordingStatus(recordingId: string): { active: boolean; frames: number; duration: number } | null {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      return null;
    }

    return {
      active: recording.intervalId !== null,
      frames: recording.frames.length,
      duration: Date.now() - recording.startTime,
    };
  }

  async cancelRecording(recordingId: string): Promise<void> {
    const recording = this.recordings.get(recordingId);
    if (recording) {
      this.stopRecording(recordingId);
      await this.cleanupRecording(recording);
      this.recordings.delete(recordingId);
    }
  }
}
