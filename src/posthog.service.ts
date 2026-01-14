import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
  if (posthogClient) {
    return posthogClient;
  }

  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey || apiKey.length === 0) {
    return null;
  }

  posthogClient = new PostHog(apiKey, {
    host: 'https://eu.i.posthog.com',
  });

  return posthogClient;
}

export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  client.capture({
    distinctId,
    event,
    properties,
  });
}

export function shutdownPostHog(): Promise<void> {
  return new Promise((resolve) => {
    if (posthogClient) {
      posthogClient.shutdown();
      posthogClient = null;
    }
    resolve();
  });
}

