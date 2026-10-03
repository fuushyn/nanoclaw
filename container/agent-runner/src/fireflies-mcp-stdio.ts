/**
 * Fireflies MCP Server for NanoClaw
 *
 * Exposes Lakshya's Fireflies.ai meeting recordings (transcripts, summaries,
 * action items) to the container agent over the Fireflies GraphQL API.
 *
 * Auth is a single API key (FIREFLIES_API_KEY), threaded in via the MCP
 * server's `env` block in the group's container.json — never baked into the
 * image. Outbound calls go through the container's OneCLI egress proxy like
 * every other HTTP client in here.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = process.env.FIREFLIES_API_URL || 'https://api.fireflies.ai/graphql';
const API_KEY = process.env.FIREFLIES_API_KEY || '';

function log(msg: string): void {
  console.error(`[FIREFLIES] ${msg}`);
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

type GqlResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<GqlResult<T>> {
  if (!API_KEY) {
    return {
      ok: false,
      error:
        'FIREFLIES_API_KEY is not set for this MCP server. Ask the admin to re-add the fireflies server with the key in its env block.',
    };
  }

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return { ok: false, error: `Network error talking to Fireflies: ${String(err)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: `Fireflies rejected the API key (HTTP ${res.status}).` };
  }
  if (res.status === 429) {
    return { ok: false, error: 'Fireflies rate limit hit (HTTP 429). Wait a minute and retry.' };
  }

  const body = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  } | null;

  if (!body) return { ok: false, error: `Fireflies returned non-JSON (HTTP ${res.status}).` };
  if (body.errors?.length) {
    const msg = body.errors
      .map((e) => `${e.extensions?.code ? `${e.extensions.code}: ` : ''}${e.message ?? 'unknown error'}`)
      .join('; ');
    return { ok: false, error: `Fireflies API error: ${msg}` };
  }
  if (!body.data) return { ok: false, error: `Fireflies returned no data (HTTP ${res.status}).` };
  return { ok: true, data: body.data };
}

interface TranscriptSummary {
  id: string;
  title?: string | null;
  date?: number | null;
  dateString?: string | null;
  duration?: number | null;
  organizer_email?: string | null;
  participants?: string[] | null;
  transcript_url?: string | null;
}

interface TranscriptDetail extends TranscriptSummary {
  host_email?: string | null;
  speakers?: Array<{ name?: string | null }> | null;
  meeting_attendees?: Array<{ displayName?: string | null; email?: string | null }> | null;
  summary?: {
    gist?: string | null;
    short_summary?: string | null;
    overview?: string | null;
    keywords?: string[] | null;
    action_items?: string | null;
    bullet_gist?: string | null;
    topics_discussed?: string[] | null;
  } | null;
  sentences?: Array<{
    index?: number | null;
    speaker_name?: string | null;
    start_time?: number | null;
    text?: string | null;
  }> | null;
}

/** Fireflies returns duration in minutes (float). */
function fmtDuration(duration?: number | null): string {
  if (duration === undefined || duration === null) return '?';
  if (duration < 1) return `${Math.round(duration * 60)}s`;
  return `${duration.toFixed(0)}m`;
}

function fmtWhen(t: TranscriptSummary): string {
  if (t.dateString) return t.dateString;
  if (typeof t.date === 'number') return new Date(t.date).toISOString();
  return 'unknown date';
}

function fmtLine(t: TranscriptSummary): string {
  const people = t.participants?.length ? ` — ${t.participants.length} participant(s)` : '';
  return `- ${t.title || '(untitled)'} [${t.id}]\n  ${fmtWhen(t)} · ${fmtDuration(t.duration)}${people}${
    t.transcript_url ? `\n  ${t.transcript_url}` : ''
  }`;
}

function fmtTimestamp(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const LIST_FIELDS = `
  id
  title
  date
  dateString
  duration
  organizer_email
  participants
  transcript_url
`;

const listArgs = {
  limit: z.number().int().min(1).max(50).optional().describe('How many meetings to return (default 10, max 50).'),
  from_date: z
    .string()
    .optional()
    .describe('Only meetings on/after this ISO 8601 datetime, e.g. "2026-09-01T00:00:00.000Z".'),
  to_date: z.string().optional().describe('Only meetings on/before this ISO 8601 datetime.'),
  participant_email: z.string().optional().describe('Only meetings where this email was a participant.'),
  mine: z.boolean().optional().describe('Only meetings the API key owner (Lakshya) hosted or attended.'),
};

function listVariables(args: {
  limit?: number;
  from_date?: string;
  to_date?: string;
  participant_email?: string;
  mine?: boolean;
  keyword?: string;
}): Record<string, unknown> {
  return {
    limit: args.limit ?? 10,
    fromDate: args.from_date ?? null,
    toDate: args.to_date ?? null,
    participantEmail: args.participant_email ?? null,
    mine: args.mine ?? null,
    keyword: args.keyword ?? null,
  };
}

const LIST_QUERY = `
  query NanoclawTranscripts(
    $limit: Int
    $fromDate: DateTime
    $toDate: DateTime
    $participantEmail: String
    $mine: Boolean
    $keyword: String
  ) {
    transcripts(
      limit: $limit
      fromDate: $fromDate
      toDate: $toDate
      participant_email: $participantEmail
      mine: $mine
      keyword: $keyword
    ) {${LIST_FIELDS}}
  }
`;

const server = new McpServer({ name: 'fireflies', version: '1.0.0' });

server.tool(
  'fireflies_list_meetings',
  "List Lakshya's recent Fireflies meeting recordings, newest first. Returns title, transcript id, date, duration and participant count. Use the returned id with fireflies_get_meeting to read notes or the full transcript.",
  listArgs,
  async (args) => {
    log(`list_meetings limit=${args.limit ?? 10}`);
    const res = await gql<{ transcripts: TranscriptSummary[] }>(LIST_QUERY, listVariables(args));
    if (!res.ok) return textResult(res.error, true);
    const rows = res.data.transcripts ?? [];
    if (rows.length === 0) return textResult('No meetings matched those filters.');
    return textResult(`${rows.length} meeting(s):\n\n${rows.map(fmtLine).join('\n')}`);
  },
);

server.tool(
  'fireflies_search_meetings',
  'Search Fireflies meetings by keyword (matches meeting title and content). Use this when Lakshya refers to a meeting by topic or person rather than by date.',
  {
    keyword: z.string().min(1).describe('Keyword or phrase to search for, e.g. "pricing" or "Series A".'),
    ...listArgs,
  },
  async (args) => {
    log(`search_meetings keyword=${args.keyword}`);
    const res = await gql<{ transcripts: TranscriptSummary[] }>(LIST_QUERY, listVariables(args));
    if (!res.ok) return textResult(res.error, true);
    const rows = res.data.transcripts ?? [];
    if (rows.length === 0) return textResult(`No meetings matched "${args.keyword}".`);
    return textResult(`${rows.length} meeting(s) matching "${args.keyword}":\n\n${rows.map(fmtLine).join('\n')}`);
  },
);

server.tool(
  'fireflies_get_meeting',
  'Get one Fireflies meeting by transcript id: attendees, AI summary (gist, overview, action items, keywords) and, optionally, the full speaker-by-speaker transcript. Start without the transcript — summaries are usually enough and much shorter.',
  {
    transcript_id: z.string().min(1).describe('Transcript id from fireflies_list_meetings / fireflies_search_meetings.'),
    include_transcript: z
      .boolean()
      .optional()
      .describe('Include the verbatim transcript lines. Off by default — these can be thousands of lines.'),
    max_lines: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Cap on transcript lines when include_transcript is true (default 400).'),
  },
  async ({ transcript_id, include_transcript, max_lines }) => {
    log(`get_meeting id=${transcript_id} transcript=${include_transcript === true}`);
    const query = `
      query NanoclawTranscript($id: String!) {
        transcript(id: $id) {
          id
          title
          date
          dateString
          duration
          host_email
          organizer_email
          participants
          transcript_url
          speakers { name }
          meeting_attendees { displayName email }
          summary {
            gist
            short_summary
            overview
            keywords
            action_items
            bullet_gist
            topics_discussed
          }
          ${include_transcript === true ? 'sentences { index speaker_name start_time text }' : ''}
        }
      }
    `;
    const res = await gql<{ transcript: TranscriptDetail | null }>(query, { id: transcript_id });
    if (!res.ok) return textResult(res.error, true);
    const t = res.data.transcript;
    if (!t) return textResult(`No Fireflies meeting with id ${transcript_id}.`);

    const attendees = (t.meeting_attendees ?? [])
      .map((a) => a.displayName || a.email)
      .filter(Boolean)
      .join(', ');
    const parts: string[] = [
      `# ${t.title || '(untitled)'}`,
      `id: ${t.id}`,
      `when: ${fmtWhen(t)} · ${fmtDuration(t.duration)}`,
      t.organizer_email ? `organizer: ${t.organizer_email}` : '',
      attendees ? `attendees: ${attendees}` : t.participants?.length ? `participants: ${t.participants.join(', ')}` : '',
      t.transcript_url ? `link: ${t.transcript_url}` : '',
    ].filter(Boolean);

    const s = t.summary;
    if (s?.gist) parts.push(`\n## Gist\n${s.gist}`);
    if (s?.overview || s?.short_summary) parts.push(`\n## Overview\n${s.overview || s.short_summary}`);
    if (s?.bullet_gist) parts.push(`\n## Notes\n${s.bullet_gist}`);
    if (s?.action_items) parts.push(`\n## Action items\n${s.action_items}`);
    if (s?.keywords?.length) parts.push(`\n## Keywords\n${s.keywords.join(', ')}`);
    if (s?.topics_discussed?.length) parts.push(`\n## Topics\n${s.topics_discussed.join(', ')}`);
    if (!s) parts.push('\n(No AI summary on this meeting — try include_transcript: true.)');

    if (include_transcript === true) {
      const cap = max_lines ?? 400;
      const lines = t.sentences ?? [];
      const shown = lines.slice(0, cap);
      parts.push(
        `\n## Transcript${lines.length > cap ? ` (first ${cap} of ${lines.length} lines)` : ''}\n` +
          shown
            .map((l) => `[${fmtTimestamp(l.start_time)}] ${l.speaker_name || 'Speaker'}: ${l.text ?? ''}`)
            .join('\n'),
      );
    }

    return textResult(parts.join('\n'));
  },
);

server.tool(
  'fireflies_whoami',
  'Show which Fireflies account this agent is connected to (name, email, connected calendar/meeting integrations). Use it to check the connection is alive.',
  {},
  async () => {
    const res = await gql<{ user: { name?: string; email?: string; integrations?: string[] } }>(
      '{ user { user_id name email integrations num_transcripts } }',
      {},
    );
    if (!res.ok) return textResult(res.error, true);
    const u = res.data.user;
    return textResult(
      `Connected to Fireflies as ${u.name ?? '?'} <${u.email ?? '?'}>. Integrations: ${
        u.integrations?.length ? u.integrations.join(', ') : 'none'
      }.`,
    );
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Fireflies MCP server ready');
}

main().catch((err) => {
  log(`Fatal: ${String(err)}`);
  process.exit(1);
});
