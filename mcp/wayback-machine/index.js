#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const AVAILABILITY_API = 'https://archive.org/wayback/available';
const CDX_API = 'https://web.archive.org/cdx/search/cdx';
const WEB_API = 'https://web.archive.org/web';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

const server = new Server(
  { name: 'wayback-machine', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_latest_snapshot',
      description: 'Get the most recent archived snapshot of a URL from the Wayback Machine',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to look up' },
        },
        required: ['url'],
      },
    },
    {
      name: 'get_snapshot_at_date',
      description: 'Get the closest archived snapshot to a specific date',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to look up' },
          date: { type: 'string', description: 'Date in YYYYMMDD or YYYYMMDDHHMMSS format' },
        },
        required: ['url', 'date'],
      },
    },
    {
      name: 'search_snapshots',
      description: 'Search archived snapshots of a URL with optional date range filter',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to search (supports * wildcard)' },
          from: { type: 'string', description: 'Start date YYYYMMDD (optional)' },
          to: { type: 'string', description: 'End date YYYYMMDD (optional)' },
          limit: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'get_snapshot_content',
      description: 'Fetch the text content of an archived page',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The original URL' },
          timestamp: { type: 'string', description: 'Snapshot timestamp in YYYYMMDDHHMMSS format' },
        },
        required: ['url', 'timestamp'],
      },
    },
    {
      name: 'check_url_availability',
      description: 'Check if a URL has been archived and get its first/last snapshot dates',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to check' },
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'get_latest_snapshot') {
      const data = await fetchJson(`${AVAILABILITY_API}?url=${encodeURIComponent(args.url)}`);
      const snap = data.archived_snapshots?.closest;
      if (!snap) return { content: [{ type: 'text', text: `No snapshot found for ${args.url}` }] };
      return {
        content: [{
          type: 'text',
          text: `Latest snapshot:\nURL: ${snap.url}\nTimestamp: ${snap.timestamp}\nStatus: ${snap.status}\nArchive URL: ${snap.url}`,
        }],
      };
    }

    if (name === 'get_snapshot_at_date') {
      const data = await fetchJson(`${AVAILABILITY_API}?url=${encodeURIComponent(args.url)}&timestamp=${args.date}`);
      const snap = data.archived_snapshots?.closest;
      if (!snap) return { content: [{ type: 'text', text: `No snapshot found near ${args.date} for ${args.url}` }] };
      return {
        content: [{
          type: 'text',
          text: `Closest snapshot to ${args.date}:\nURL: ${snap.url}\nTimestamp: ${snap.timestamp}\nStatus: ${snap.status}`,
        }],
      };
    }

    if (name === 'search_snapshots') {
      const limit = args.limit || 10;
      let cdxUrl = `${CDX_API}?url=${encodeURIComponent(args.url)}&output=json&limit=${limit}&fl=timestamp,statuscode,mimetype,length`;
      if (args.from) cdxUrl += `&from=${args.from}`;
      if (args.to) cdxUrl += `&to=${args.to}`;
      const rows = await fetchJson(cdxUrl);
      if (!rows || rows.length <= 1) return { content: [{ type: 'text', text: `No snapshots found for ${args.url}` }] };
      const [header, ...results] = rows;
      const lines = results.map(r => `${r[0]} | status=${r[1]} | type=${r[2]} | size=${r[3]}b`);
      return { content: [{ type: 'text', text: `Found ${results.length} snapshots:\n${lines.join('\n')}` }] };
    }

    if (name === 'get_snapshot_content') {
      const archiveUrl = `${WEB_API}/${args.timestamp}if_/${args.url}`;
      const html = await fetchText(archiveUrl);
      // Strip tags crudely for plain text
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
      return { content: [{ type: 'text', text: `Content from ${archiveUrl}:\n\n${text}` }] };
    }

    if (name === 'check_url_availability') {
      const cdxUrl = `${CDX_API}?url=${encodeURIComponent(args.url)}&output=json&limit=1&fl=timestamp`;
      const cdxUrlLast = `${CDX_API}?url=${encodeURIComponent(args.url)}&output=json&limit=1&fl=timestamp&order=reverse`;
      const [first, last] = await Promise.all([fetchJson(cdxUrl), fetchJson(cdxUrlLast)]);
      const hasFirst = first && first.length > 1;
      const hasLast = last && last.length > 1;
      if (!hasFirst) return { content: [{ type: 'text', text: `${args.url} has never been archived.` }] };
      return {
        content: [{
          type: 'text',
          text: `${args.url} is archived.\nFirst snapshot: ${first[1][0]}\nLast snapshot: ${hasLast ? last[1][0] : 'unknown'}`,
        }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
