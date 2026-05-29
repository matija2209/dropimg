import { spawn } from 'node:child_process';

export function runFfmpegTranscode(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i',
      input,
      '-vf',
      'scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,colorspace=all=bt709:range=tv:fast=1,format=yuv420p',
      '-c:v',
      'libx264',
      '-profile:v',
      'main',
      '-level',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      '-color_range',
      'tv',
      '-preset',
      'veryfast',
      '-b:v',
      '2M',
      '-maxrate',
      '2.5M',
      '-bufsize',
      '5M',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      '-y',
      output,
    ]);

    const stderr: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}:\n${stderr.slice(-10).join('')}`));
    });
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('ffmpeg not found — install with: apt install ffmpeg'));
      } else {
        reject(err);
      }
    });
  });
}

export function runFfmpegPosterFrame(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-ss', '1', '-i', input, '-vframes', '1', '-y', output]);

    const stderr: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg poster exited ${code}:\n${stderr.slice(-5).join('')}`));
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}
