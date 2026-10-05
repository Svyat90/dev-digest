import { describe, expect, it } from 'vitest';
import { notFoundMessage } from '../src/platform/errors.js';

describe('notFoundMessage', () => {
  it('names the entity and the id', () => {
    expect(notFoundMessage('Agent', 'a1')).toBe('Agent a1 not found');
  });
});
