import { Hono } from 'hono';
import { config } from '../config.js';
import { dispatchInternalMediaFinalize } from '../lib/internal-media-finalize.js';
import { VideoProcessingError } from '../services/video-processing.js';

const internalMediaFinalized = new Hono();

internalMediaFinalized.post('/', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (config.internalUploadSecret) {
    if (bearer !== config.internalUploadSecret) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  try {
    const result = await dispatchInternalMediaFinalize(payload, c.req.raw.headers);
    return c.json(result);
  } catch (error) {
    if (error instanceof VideoProcessingError) {
      return c.json({ ok: false, error: error.message }, error.statusCode as 400 | 401 | 503);
    }
    console.error('[internal-media-finalized]', error);
    return c.json({ ok: false, error: 'Finalize failed' }, 500);
  }
});

export default internalMediaFinalized;
