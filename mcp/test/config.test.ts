import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, DEFAULT_RUN_TIMEOUT_MS, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    const { config, warnings } = loadConfig({});
    expect(config).toEqual({ apiUrl: DEFAULT_API_URL, runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS });
    expect(warnings).toEqual([]);
  });

  it('strips a trailing slash and accepts a valid timeout', () => {
    const { config } = loadConfig({
      DEVDIGEST_API_URL: 'https://api.example.com/',
      DEVDIGEST_RUN_TIMEOUT_MS: '20000',
    });
    expect(config).toEqual({ apiUrl: 'https://api.example.com', runTimeoutMs: 20000 });
  });

  it('falls back to defaults with warnings on bad values instead of throwing', () => {
    const { config, warnings } = loadConfig({
      DEVDIGEST_API_URL: 'ftp://nope',
      DEVDIGEST_RUN_TIMEOUT_MS: '999999999',
    });
    expect(config).toEqual({ apiUrl: DEFAULT_API_URL, runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS });
    expect(warnings).toHaveLength(2);
  });
});
