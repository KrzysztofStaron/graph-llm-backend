const base = (process.env.BASE_URL || 'http://127.0.0.1:9955').replace(
  /\/+$/,
  '',
);

const root = await fetch(`${base}/`);
const rootText = await root.text();
if (!root.ok || !rootText.includes('Graph LLM Backend')) {
  console.error('Root check failed', root.status, rootText.slice(0, 200));
  process.exit(1);
}

const started = Date.now();
const response = await fetch(`${base}/api/v1/chat/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Client-Id': 'serverless-verify',
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Draw a red circle' }],
  }),
});

if (!response.ok || !response.body) {
  console.error(
    'Stream request failed',
    response.status,
    await response.text(),
  );
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
const reads = [];
let buffered = '';
let sawContent = false;
let sawImage = false;
let sawDone = false;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  reads.push(Date.now());
  buffered += decoder.decode(value, { stream: true });
  const parts = buffered.split('\n\n');
  buffered = parts.pop() ?? '';
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);
    if (data === '[DONE]') {
      sawDone = true;
      continue;
    }
    const event = JSON.parse(data);
    if (event.error) {
      console.error('Stream error event', event);
      process.exit(1);
    }
    if (typeof event.content === 'string' && event.content.length > 0) {
      sawContent = true;
    }
    if (event.type === 'image' && event.prompt === 'a red circle') {
      sawImage = true;
    }
  }
}

const spread = reads.length > 1 ? reads[reads.length - 1] - reads[0] : 0;
const summary = {
  reads: reads.length,
  spreadMs: spread,
  elapsedMs: Date.now() - started,
  sawContent,
  sawImage,
  sawDone,
};

if (!sawContent || !sawImage || !sawDone || reads.length < 2 || spread < 40) {
  console.error('Streaming tool-call check failed', summary);
  process.exit(1);
}

console.log('Streaming tool-call check passed', summary);
