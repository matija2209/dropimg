import { spawn } from 'node:child_process';

type FfprobeSideData = {
  rotation?: number;
};

type FfprobeStream = {
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: FfprobeSideData[];
};

type FfprobeFormat = {
  duration?: string;
};

type FfprobeJson = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

export type VideoProbeInfo = {
  width: number;
  height: number;
  durationMs: number | null;
};

function parseRotationDegrees(stream: FfprobeStream): number {
  const tag = stream.tags?.rotate;
  if (tag) {
    const parsed = Number.parseInt(tag, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }

  for (const side of stream.side_data_list ?? []) {
    if (typeof side.rotation === 'number' && !Number.isNaN(side.rotation)) {
      return side.rotation;
    }
  }

  return 0;
}

function displayDimensionsFromRotation(width: number, height: number, rotation: number): { width: number; height: number } {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function runFfprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:stream_tags=rotate:stream_side_data=rotation',
      '-show_entries',
      'format=duration',
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

export async function probeVideoFile(filePath: string): Promise<VideoProbeInfo | undefined> {
  try {
    const raw = await runFfprobe(filePath);
    const parsed = JSON.parse(raw) as FfprobeJson;
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height || stream.width <= 0 || stream.height <= 0) {
      return undefined;
    }

    const rotation = parseRotationDegrees(stream);
    const { width, height } = displayDimensionsFromRotation(stream.width, stream.height, rotation);

    let durationMs: number | null = null;
    const durationRaw = parsed.format?.duration;
    if (durationRaw) {
      const seconds = Number.parseFloat(durationRaw);
      if (!Number.isNaN(seconds) && seconds > 0) {
        durationMs = Math.round(seconds * 1000);
      }
    }

    return { width, height, durationMs };
  } catch {
    return undefined;
  }
}
