import { execFile } from 'child_process';
import { EdgeTTS, Constants } from '@andresaya/edge-tts';
import { logger } from './logger.js';

const DEFAULT_VOICE = process.env.TTS_VOICE || 'en-US-AriaNeural';

/** Remux WebM/Opus → OGG/Opus via ffmpeg (no re-encoding, instant). */
function webmToOgg(webm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = execFile('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'copy',
      '-f', 'ogg',
      'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
    proc.stdin!.end(webm);
  });
}

/**
 * Synthesize text to OGG/Opus audio buffer using Microsoft Edge TTS.
 */
export async function synthesize(text: string): Promise<Buffer> {
  const tts = new EdgeTTS();
  await tts.synthesize(text, DEFAULT_VOICE, {
    outputFormat: Constants.OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS,
  });
  const webm = tts.toBuffer();
  const ogg = await webmToOgg(webm);
  logger.info({ voice: DEFAULT_VOICE, textLength: text.length, audioBytes: ogg.length }, 'TTS synthesized');
  return ogg;
}
