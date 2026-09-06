/**
 * Text2Video & Image2Video Generator Engine
 * Capabilities:
 * 1. Image-to-Video (I2V): Transform any image into cinematic motion MP4 with Ken Burns 2.8K anti-jitter engine
 * 2. Text-to-Video (T2V): Synthesize high-res image via FLUX/Pollinations -> Auto-render kinetic video clip
 *
 * Zero external npm dependencies (Pure Node.js 18+ stdlib & FFmpeg).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Import text2image engine yang sudah teruji
import { generateImage } from '../../text2image-generator/src/index.js';

const RESOLUTIONS = {
  '16:9': { width: 1920, height: 1080, scaleW: 2880, scaleH: 1620 },
  '9:16': { width: 1080, height: 1920, scaleW: 1620, scaleH: 2880 },
  '1:1':  { width: 1080, height: 1080, scaleW: 1620, scaleH: 1620 }
};

/**
 * Membangun filtergraph FFmpeg untuk motion kamera
 */
function buildMotionFilter(motion, totalFrames, fps, res) {
  const { width, height, scaleW, scaleH } = res;
  const baseScale = `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH}`;

  let zoompan = '';
  switch (motion) {
    case 'zoom-out':
      zoompan = `zoompan=z='max(1.25-0.0015*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
      break;
    case 'pan-left':
      // Gerak dari kanan ke kiri
      zoompan = `zoompan=z=1.15:x='max((1-on/${totalFrames})*(iw-iw/zoom),0)':y='ih/2-(ih/zoom/2)'`;
      break;
    case 'pan-right':
      // Gerak dari kiri ke kanan
      zoompan = `zoompan=z=1.15:x='(on/${totalFrames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)'`;
      break;
    case 'tilt-up':
      // Gerak vertikal dari bawah ke atas
      zoompan = `zoompan=z=1.15:x='iw/2-(iw/zoom/2)':y='max((1-on/${totalFrames})*(ih-ih/zoom),0)'`;
      break;
    case 'tilt-down':
      // Gerak vertikal dari atas ke bawah
      zoompan = `zoompan=z=1.15:x='iw/2-(iw/zoom/2)':y='(on/${totalFrames})*(ih-ih/zoom)'`;
      break;
    case 'drone-drift':
      // Zoom in perlahan sambil panning diagonal halus
      zoompan = `zoompan=z='min(zoom+0.0012,1.2)':x='(on/${totalFrames})*(iw-iw/zoom)':y='(on/${totalFrames})*(ih-ih/zoom)'`;
      break;
    case 'zoom-in':
    default:
      // Default: Slow cinematic zoom in
      zoompan = `zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
      break;
  }

  return `${baseScale},${zoompan}:d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
}

/**
 * Image-to-Video (I2V): Mengubah file gambar lokal menjadi klip video MP4
 * @param {string} inputImagePath Path file gambar (jpg, png, webp)
 * @param {string} outputVideoPath Path output file .mp4
 * @param {Object} opts { duration, ratio, motion, fps }
 */
export async function imageToVideo(inputImagePath, outputVideoPath, opts = {}) {
  const duration = opts.duration || 3.5;
  const ratio = opts.ratio || '16:9';
  const motion = opts.motion || 'zoom-in';
  const fps = opts.fps || 30;
  const totalFrames = Math.round(duration * fps);

  const resConfig = RESOLUTIONS[ratio] || RESOLUTIONS['16:9'];
  const filtergraph = buildMotionFilter(motion, totalFrames, fps, resConfig);

  await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

  const ffmpegArgs = [
    '-y',
    '-loop', '1',
    '-i', inputImagePath,
    '-vf', filtergraph,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '22',
    outputVideoPath
  ];

  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';

    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-300)}`));
      }
      try {
        const stat = await fs.stat(outputVideoPath);
        resolve({
          success: true,
          input: inputImagePath,
          output: outputVideoPath,
          duration,
          ratio,
          resolution: `${resConfig.width}x${resConfig.height}`,
          motion,
          bytes: stat.size
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Text-to-Video (T2V): Generate high-res image dari prompt -> synthesize ke MP4
 * @param {string} prompt Deskripsi adegan video
 * @param {string} outputVideoPath Path output file .mp4
 * @param {Object} opts { duration, ratio, motion, provider, seed, tempImageDir }
 */
export async function textToVideo(prompt, outputVideoPath, opts = {}) {
  const ratio = opts.ratio || '16:9';
  const tempDir = opts.tempImageDir || '/tmp/t2v_frames';
  await fs.mkdir(tempDir, { recursive: true });

  const hash = Math.random().toString(36).substring(2, 8);
  const tempImagePath = path.join(tempDir, `t2v_frame_${hash}.webp`);

  // 1. Generate image still berkualitas tinggi
  const imgRes = await generateImage(prompt, {
    ratio,
    provider: opts.provider || 'flux-schnell',
    outputPath: tempImagePath,
    seed: opts.seed
  });

  // 2. Synthesize image still menjadi video klip sinematik bergerak
  try {
    const videoRes = await imageToVideo(tempImagePath, outputVideoPath, {
      duration: opts.duration,
      ratio,
      motion: opts.motion || 'zoom-in',
      fps: opts.fps || 30
    });

    // Cleanup temp image jika tidak diminta simpan
    if (!opts.keepImage) {
      await fs.unlink(tempImagePath).catch(() => {});
    }

    return {
      success: true,
      prompt,
      imageProvider: imgRes.provider,
      ...videoRes,
      imageSavedTo: opts.keepImage ? tempImagePath : null
    };
  } catch (err) {
    await fs.unlink(tempImagePath).catch(() => {});
    throw err;
  }
}
