import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const COOLDOWN_FILE = path.join(STORE_DIR, 'last-alert.txt');

/**
 * Send an alert email via Resend API.
 * Respects a 30-minute cooldown to avoid spamming across restart cycles.
 * Never throws — alert failure should not crash the app.
 */
export async function sendAlert(subject: string, body: string): Promise<void> {
  try {
    // Check cooldown
    try {
      const last = fs.readFileSync(COOLDOWN_FILE, 'utf-8').trim();
      if (Date.now() - Number(last) < COOLDOWN_MS) {
        logger.info('Alert skipped — cooldown active');
        return;
      }
    } catch {
      // No cooldown file — proceed
    }

    const env = readEnvFile(['RESEND_API_KEY', 'ALERT_EMAIL']);
    if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) {
      logger.warn('RESEND_API_KEY or ALERT_EMAIL not set in .env — skipping alert');
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'NanoClaw <onboarding@resend.dev>',
        to: [env.ALERT_EMAIL],
        subject,
        text: body,
      }),
    });

    if (res.ok) {
      fs.writeFileSync(COOLDOWN_FILE, String(Date.now()));
      logger.info({ subject }, 'Alert email sent');
    } else {
      const text = await res.text();
      logger.error({ status: res.status, body: text }, 'Failed to send alert email');
    }
  } catch (err) {
    logger.error({ err }, 'Alert sending failed');
  }
}
