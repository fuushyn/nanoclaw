---
name: voice
description: Send WhatsApp voice messages (audio notes). Use when the user asks you to "say", "speak", "reply in voice", or "send a voice message". Wrap text in <voice> tags to send as an audio note.
allowed-tools: mcp__nanoclaw__send_message
---

# Voice Messages for WhatsApp

You can send voice notes (audio messages) directly in WhatsApp by wrapping text in `<voice>` tags. The text will be synthesized using Microsoft Edge TTS and delivered as a WhatsApp push-to-talk voice note.

## How to Send a Voice Message

Wrap the spoken text in `<voice>` tags inside your output or in `mcp__nanoclaw__send_message`:

```
<voice>Hey! This is Andy. Just wanted to let you know the backup is done.</voice>
```

Or use send_message explicitly:

```
mcp__nanoclaw__send_message(text="<voice>Hey! This is Andy speaking.</voice>")
```

## Rules for Voice Messages

- Write naturally spoken language — no markdown, no asterisks, no bullet points
- Keep it conversational and concise
- Don't include URLs or code in voice segments
- For longer content, break it into short punchy voice segments

## Combining Text and Voice

You can mix text and voice in a single send_message call:

```
mcp__nanoclaw__send_message(text="Here's your update:\n<voice>Backup completed. 25 files, 371 kilobytes, all good.</voice>")
```

## When the User Asks for a Voice Reply

When the user says "reply in voice", "say it", "voice message", or similar:
1. Compose what you want to say in natural spoken English
2. Wrap it in `<voice>` tags
3. Send via `mcp__nanoclaw__send_message`

Example:
User: "Andy, say good morning to me"
You: `mcp__nanoclaw__send_message(text="<voice>Good morning! Hope you have an awesome day ahead, bro.</voice>")`

## Voice Style

The default voice is en-US-AriaNeural (natural, friendly). Speak like Andy — casual, direct, helpful. Match the energy of the conversation.
