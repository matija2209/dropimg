import { spawn } from 'node:child_process';

type FfprobeVideoStream = {
  codec_name?: string;
  pix_fmt?: string;
};

type FfprobeJson = {
  streams?: FfprobeVideoStream[];
};

function runFfprobeCodec(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt',
      '-of',
      'json',
      filePath,
    ]);

    const stdout: string[] = [];
    const stderr: string[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.join(''));
      else reject(new Error(`ffprobe exited ${code}:\n${stderr.slice(-5).join('')}`));
    });

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('ffprobe not found — install with: apt install ffmpeg'));
      } else {
        reject(err);
      }
    });
  });
}

export async function assertTvReadyOutput(filePath: string): Promise<void> {
  const raw = await runFfprobeCodec(filePath);
  const parsed = JSON.parse(raw) as FfprobeJson;
  const stream = parsed.streams?.[0];

  const codec = stream?.codec_name?.toLowerCase() ?? '';
  const pixFmt = stream?.pix_fmt?.toLowerCase() ?? '';

  if (codec !== 'h264') {
    throw new Error(`Transcoded video is not H.264 (got ${codec || 'unknown'})`);
  }
  if (pixFmt === 'yuvj420p') {
    throw new Error('Transcoded video is full-range yuvj420p (TV needs limited-range yuv420p)');
  }
  if (!pixFmt.includes('yuv420p')) {
    throw new Error(`Transcoded video is not yuv420p (got ${pixFmt || 'unknown'})`);
  }
}
