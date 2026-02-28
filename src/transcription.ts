/**
 * Voice message transcription using Groq Whisper API.
 * Groq uses an OpenAI-compatible API, so we use the openai SDK with a custom base URL.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import OpenAI, { toFile } from 'openai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI | null {
  if (groqClient) return groqClient;
  const env = readEnvFile(['GROQ_API_KEY']);
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('GROQ_API_KEY not configured, voice transcription disabled');
    return null;
  }
  groqClient = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return groqClient;
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}

export async function transcribeVoiceMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  const client = getGroqClient();
  if (!client) return null;

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: logger as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.error('Failed to download voice message');
      return null;
    }

    logger.info({ bytes: buffer.length }, 'Downloaded voice message, transcribing');

    const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });

    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      response_format: 'text',
    });

    const text = (transcription as unknown as string).trim();
    logger.info({ length: text.length }, 'Voice message transcribed');
    return text;
  } catch (err) {
    logger.error({ err }, 'Voice transcription failed');
    return null;
  }
}
