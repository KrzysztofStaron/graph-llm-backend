import { corsAllowOrigin, isAllowedOrigin } from './cors';

describe('isAllowedOrigin', () => {
  it('allows requests with no origin', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('allows listed localhost and production origins', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('https://graphai.one')).toBe(true);
    expect(isAllowedOrigin('https://graph-llm-seven.vercel.app')).toBe(true);
  });

  it('allows this project Vercel preview host from the failing PR', () => {
    expect(
      isAllowedOrigin(
        'https://graph-llm-git-fix-generation-e121f9-krzysztof-starons-projects.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects other sites and http vercel hosts', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('https://other-app.vercel.app')).toBe(false);
    expect(isAllowedOrigin('http://graph-llm-seven.vercel.app')).toBe(false);
    expect(isAllowedOrigin('not a url')).toBe(false);
  });
});

describe('corsAllowOrigin', () => {
  it('echoes an allowed origin and uses * when origin is missing', () => {
    expect(corsAllowOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
    expect(corsAllowOrigin(undefined)).toBe('*');
  });

  it('does not fall back to localhost for a disallowed origin', () => {
    expect(corsAllowOrigin('https://evil.com')).toBeUndefined();
  });
});
