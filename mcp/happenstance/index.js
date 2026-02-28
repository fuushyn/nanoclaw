#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_BASE = 'https://api.happenstance.ai/v1';
const API_KEY = process.env.HAPPENSTANCE_API_KEY;

async function apiRequest(method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * Poll an async endpoint until status is COMPLETED or FAILED.
 * Happenstance searches take 30-60s, research takes 1-3min.
 */
async function pollUntilDone(path, maxWaitMs = 180000) {
  const start = Date.now();
  const intervals = [2000, 3000, 5000, 5000, 10000]; // escalating backoff
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    const data = await apiRequest('GET', path);
    if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'FAILED_AMBIGUOUS') {
      return data;
    }
    const delay = intervals[Math.min(attempt, intervals.length - 1)];
    await new Promise(r => setTimeout(r, delay));
    attempt++;
  }
  throw new Error(`Timed out after ${maxWaitMs / 1000}s waiting for ${path}`);
}

const server = new Server(
  { name: 'happenstance', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_network',
      description:
        'Search for people in your professional network using a natural language query. ' +
        'Returns up to 30 matched people with names, titles, companies, match scores, ' +
        'and AI-generated summaries of why they matched. Costs 2 credits per search. ' +
        'Takes 30-60 seconds to complete.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query, e.g. "SWEs in SF who have worked at startups"',
          },
          group_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: limit search to specific groups by ID',
          },
          include_my_connections: {
            type: 'boolean',
            description: 'Include your direct connections in results (default false)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'research_person',
      description:
        'Deep-research a specific person. Provide as many details as possible ' +
        '(full name, company, title, location, LinkedIn/Twitter handles) for best results. ' +
        'Returns a comprehensive profile with employment history, education, projects, ' +
        'writings, hobbies, and an AI summary. Costs 1 credit. Takes 1-3 minutes.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'Detailed description of the person to research. Include name, company, ' +
              'title, location, social media handles — the more the better.',
          },
        },
        required: ['description'],
      },
    },
    {
      name: 'list_groups',
      description: 'List all your Happenstance groups (communities, networks). Use to get group IDs for filtered searches.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'check_credits',
      description: 'Check your Happenstance credit balance and recent usage.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!API_KEY) {
    return {
      content: [{ type: 'text', text: 'Error: HAPPENSTANCE_API_KEY not set' }],
      isError: true,
    };
  }

  try {
    if (name === 'search_network') {
      const body = {
        text: args.query,
        include_my_connections: args.include_my_connections || false,
      };
      if (args.group_ids) body.group_ids = args.group_ids;

      const created = await apiRequest('POST', '/search', body);
      const result = await pollUntilDone(`/search/${created.id}`);

      if (result.status === 'FAILED') {
        return { content: [{ type: 'text', text: `Search failed: ${JSON.stringify(result)}` }], isError: true };
      }

      const people = (result.results || []).map((p, i) => {
        const parts = [`${i + 1}. ${p.name}`];
        if (p.current_title) parts.push(`   Title: ${p.current_title}`);
        if (p.current_company) parts.push(`   Company: ${p.current_company}`);
        if (p.summary) parts.push(`   Why: ${p.summary}`);
        if (p.socials?.linkedin) parts.push(`   LinkedIn: ${p.socials.linkedin}`);
        if (p.socials?.twitter) parts.push(`   Twitter: ${p.socials.twitter}`);
        if (p.socials?.happenstance) parts.push(`   Profile: ${p.socials.happenstance}`);
        return parts.join('\n');
      });

      const header = `Found ${people.length} results for "${args.query}"${result.has_more ? ' (more available)' : ''}`;
      return {
        content: [{ type: 'text', text: `${header}\n\n${people.join('\n\n')}` }],
      };
    }

    if (name === 'research_person') {
      const created = await apiRequest('POST', '/research', { description: args.description });
      const result = await pollUntilDone(`/research/${created.id}`);

      if (result.status === 'FAILED') {
        return { content: [{ type: 'text', text: `Research failed — person not found or ambiguous.` }], isError: true };
      }
      if (result.status === 'FAILED_AMBIGUOUS') {
        return { content: [{ type: 'text', text: `Research failed — multiple people matched. Add more details (company, location, social handles) to disambiguate.` }], isError: true };
      }

      const p = result.profile || {};
      const lines = [];

      if (p.person_metadata) {
        const m = p.person_metadata;
        if (m.full_name) lines.push(`# ${m.full_name}`);
        if (m.tagline) lines.push(m.tagline);
        if (m.current_locations?.length) lines.push(`Location: ${m.current_locations.join(', ')}`);
        if (m.profile_urls?.length) lines.push(`Profiles: ${m.profile_urls.join(', ')}`);
        lines.push('');
      }

      if (p.summary?.text) {
        lines.push('## Summary');
        lines.push(p.summary.text);
        lines.push('');
      }

      if (p.employment?.length) {
        lines.push('## Employment');
        for (const e of p.employment) {
          const dates = [e.start_date, e.end_date].filter(Boolean).join(' - ') || '';
          lines.push(`- **${e.job_title || 'Role'}** at ${e.company || 'Unknown'} ${dates ? `(${dates})` : ''}`);
          if (e.description) lines.push(`  ${e.description}`);
        }
        lines.push('');
      }

      if (p.education?.length) {
        lines.push('## Education');
        for (const e of p.education) {
          lines.push(`- **${e.degree || 'Degree'}** at ${e.university || 'Unknown'}`);
        }
        lines.push('');
      }

      if (p.projects?.length) {
        lines.push('## Projects');
        for (const pr of p.projects) {
          lines.push(`- **${pr.title}**: ${pr.description || ''}`);
        }
        lines.push('');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'list_groups') {
      const data = await apiRequest('GET', '/groups');
      const groups = (data.groups || []).map(g => `- ${g.name} (ID: ${g.id})`);
      return {
        content: [{ type: 'text', text: groups.length ? `Your groups:\n${groups.join('\n')}` : 'No groups found.' }],
      };
    }

    if (name === 'check_credits') {
      const data = await apiRequest('GET', '/usage');
      const lines = [`Credits: ${data.balance_credits}`, `Has credits: ${data.has_credits}`];
      if (data.usage?.length) {
        lines.push('', 'Recent usage:');
        for (const u of data.usage.slice(0, 5)) {
          lines.push(`  ${u.created_at}: ${u.credits_used} credit(s) — ${u.resource_type}`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
