import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDirectory = join(root, 'public');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function loadEnvironment() {
  try {
    const contents = await readFile(join(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !match[2].startsWith('#')) {
        process.env[match[1]] ??= match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const emergencyPattern = /\b(being followed|someone is following|following me|stalking me|being stalked|in immediate danger|immediate danger|in danger right now|unsafe right now|being attacked|attacking me|threatened me|threatening me|violence|assault|weapon|trapped|can't leave|cannot leave|won't let me leave|held against my will|restrained)\b/i;
const emergencyReply = "I'm glad you told me. Press SOS or call 911 now. Move toward a staffed or public place if you can do so safely.";
const systemPrompt = `You are Boundary Buddy, the supportive safety companion in Aura. Use plain language, be rapid-scannable and direct, with no conversational filler. Every response must be at most 3 sentences and validate the user's feelings without judgment; treat their account as real, never contradict or dismiss it. Do not provide legal, medical, or mental health advice, diagnoses, liability claims, or graphic descriptions of violence. For immediate danger, stalking, being followed, active violence, or being trapped, do not answer the ordinary request; immediately tell the user to press SOS or call 911. Never claim you have contacted emergency services or a trusted person. For requests to leave an uncomfortable situation, provide exactly one ready-to-copy SMS and one short deployment rule. For verbal boundaries, give concise, respectful, non-apologetic scripts. For campus safety, suggest practical staffed/public resource anchors and safer routes; do not claim to know the nearest resource or the user's campus unless they told you. Keep all responses within 3 sentences.`;
const recordingAnalysisPrompt = `You are Boundary Buddy reviewing a student-provided speech transcript at the student's request. Use plain language and no more than 3 short sentences. Validate the student's feelings without judging or deciding who is at fault; describe only clearly transcribed words, do not identify speakers or infer intent, identity, emotion, or events not present in the transcript. Do not provide legal, medical, or mental health advice. If the transcript indicates immediate danger, stalking, being followed, violence, or being trapped, immediately tell the student to press SOS or call 911. Otherwise give a brief neutral summary and one practical boundary or safety option. State uncertainty when the transcript is unclear.`;
const maxRecordingBytes = 20 * 1024 * 1024;
const allowedAudioTypes = new Map([
  ['audio/webm', 'webm'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/ogg', 'ogg'],
  ['audio/flac', 'flac'],
]);

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

async function readAudio(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRecordingBytes) throw Object.assign(new Error('Recording exceeds the 20 MB limit.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function limitSentences(text) {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.slice(0, 3).join(' ').trim() || "I'm here with you. What would feel helpful right now?";
}

async function handleChat(request, response) {
  const { message, history = [], safeWordActivated = false } = await readJson(request);
  if (typeof message !== 'string' || !message.trim() || message.length > 4_000) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Please send a message under 4,000 characters.' }));
    return;
  }

  if (safeWordActivated === true || emergencyPattern.test(message)) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      reply: emergencyReply,
      emergency: true,
      ui_takeover: 'EMERGENCY_DRAWER_ACTIVE',
      trigger_911_hook: true,
    }));
    return;
  }

  if (!process.env.NVIDIA_NIM_API_KEY) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Boundary Buddy is not connected yet. Add NVIDIA_NIM_API_KEY to your local .env file.' }));
    return;
  }

  const safeHistory = Array.isArray(history)
    ? history.filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
      .slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 4_000) }))
    : [];
  const baseUrl = (process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.2-90b-vision-instruct',
        messages: [{ role: 'system', content: systemPrompt }, ...safeHistory, { role: 'user', content: message }],
        max_tokens: 220,
        temperature: 0.35,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!upstream.ok) throw new Error(`NIM request failed (${upstream.status})`);
    const data = await upstream.json();
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('NIM returned an empty response');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ reply: limitSentences(reply) }));
  } catch (error) {
    console.error('NIM request failed:', error.message);
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Boundary Buddy could not respond just now. If you are in immediate danger, press SOS or call 911.' }));
  }
}

async function handleRecordingAnalysis(request, response) {
  if (!process.env.NVIDIA_NIM_API_KEY) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Recording analysis is unavailable until NVIDIA_NIM_API_KEY is configured on the server.' }));
    return;
  }

  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const extension = allowedAudioTypes.get(contentType);
  if (!extension) {
    response.writeHead(415, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Unsupported recording format. Use WebM, WAV, MP3, MP4, OGG, or FLAC audio.' }));
    return;
  }

  let audio;
  try {
    audio = await readAudio(request);
  } catch (error) {
    response.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.statusCode === 413 ? error.message : 'Could not read the recording.' }));
    return;
  }
  if (!audio.length) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'The recording is empty.' }));
    return;
  }

  const baseUrl = (process.env.NVIDIA_NIM_ASR_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
  try {
    const form = new FormData();
    form.set('model', process.env.NVIDIA_NIM_ASR_MODEL || 'nvidia/parakeet-ctc-1.1b-asr');
    form.set('response_format', 'json');
    form.set('file', new Blob([audio], { type: contentType }), `aura-recording.${extension}`);
    const transcriptionResponse = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!transcriptionResponse.ok) throw new Error(`NIM transcription failed (${transcriptionResponse.status})`);
    const transcription = await transcriptionResponse.json();
    const transcript = transcription.text;
    if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('NIM returned an empty transcript');

    const summaryResponse = await fetch(`${(process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.2-90b-vision-instruct',
        messages: [
          { role: 'system', content: recordingAnalysisPrompt },
          { role: 'user', content: `Review this speech-recognition transcript. It may be incomplete or inaccurate; do not infer beyond its words.\n\n${transcript.slice(0, 8_000)}` },
        ],
        max_tokens: 220,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!summaryResponse.ok) throw new Error(`NIM summary failed (${summaryResponse.status})`);
    const summaryData = await summaryResponse.json();
    const summary = summaryData.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('NIM returned an empty summary');

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ transcript: transcript.slice(0, 8_000), summary: limitSentences(summary) }));
  } catch (error) {
    console.error('NIM recording analysis failed:', error.message);
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'NVIDIA could not analyze this recording. Aura does not save the uploaded audio; try again later.' }));
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");

  try {
    if (request.method === 'POST' && request.url === '/api/chat') {
      await handleChat(request, response);
      return;
    }
    if (request.method === 'POST' && request.url === '/api/analyze-recording') {
      await handleRecordingAnalysis(request, response);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      response.end();
      return;
    }

    const requestedPath = request.url === '/' ? '/index.html' : decodeURIComponent(request.url.split('?')[0]);
    const filePath = normalize(join(publicDirectory, requestedPath));
    const relativePath = relative(publicDirectory, filePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const contents = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    const status = error.statusCode || (error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: status === 404 ? 'Not found' : 'Something went wrong.' }));
  }
});

await loadEnvironment();
const port = Number(process.env.PORT) || 3000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Aura is running at http://localhost:${port}`);
});