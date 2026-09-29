import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('dashboard route compatibility', () => {
  it('redirects the legacy /dashboard path to the platform dashboard route', () => {
    expect(appSource).toContain('<Route path="/dashboard"><Redirect to="/" /></Route>');
  });
});