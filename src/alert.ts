import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { log } from './log.js';

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const COOLDOWN_FILE = path.join(STORE_DIR, 'last-alert.txt');

/**
 * Send an alert email via the Resend API.
 * Respects a 30-minute cooldown to avoid spamming across restart cycles.
 * Never throws — alert failure should not crash the app.
 */
export async function sendAlert(subject: string, body: string): Promise<void> {
  try {
    // Check cooldown
    try {
      const last = fs.readFileSync(COOLDOWN_FILE, 'utf-8').trim();
      if (Date.now() - Number(last) < COOLDOWN_MS) {
        log.info('Alert skipped — cooldown active');
        return;
      }
    } catch {
      // No cooldown file — proceed
    }

    const env = readEnvFile(['RESEND_API_KEY', 'ALERT_EMAIL']);
    if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) {
      log.warn('RESEND_API_KEY or ALERT_EMAIL not set in .env — skipping alert');
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
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
      log.info('Alert email sent', { subject });
    } else {
      const text = await res.text();
      log.error('Failed to send alert email', { status: res.status, body: text });
    }
  } catch (err) {
    log.error('Alert sending failed', { err });
  }
}
