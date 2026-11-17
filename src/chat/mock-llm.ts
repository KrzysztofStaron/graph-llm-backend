const CHUNK_DELAY_MS = 80;

type MockStreamChunk = {
  choices: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Local and preview smoke tests only. Production deployments ignore the flag
 * so a stray env var cannot replace the real model.
 */
export function isMockLlmEnabled(): boolean {
  return (
    process.env.GRAPH_LLM_MOCK === '1' &&
    process.env.VERCEL_ENV !== 'production'
  );
}

export function mockChatText(): string {
  return 'Mock reply.';
}

export async function* mockChatStream(): AsyncGenerator<MockStreamChunk> {
  await wait(CHUNK_DELAY_MS);
  yield { choices: [{ delta: { content: 'Mock ' } }] };

  await wait(CHUNK_DELAY_MS);
  yield { choices: [{ delta: { content: 'reply.' } }] };

  await wait(CHUNK_DELAY_MS);
  yield {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_mock',
              type: 'function',
              function: { name: 'generate_image', arguments: '' },
            },
          ],
        },
      },
    ],
  };

  await wait(CHUNK_DELAY_MS);
  yield {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"prompt":"a red circle"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}
