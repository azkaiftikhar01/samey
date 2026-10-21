import { describe, expect, it } from 'vitest';
import { assertLoopback, parseModelOutput } from '../src/ai/local-model.js';

describe('local model guard', () => {
  it('accepts only loopback endpoints', () => {
    expect(assertLoopback('http://127.0.0.1:11434').hostname).toBe('127.0.0.1');
    expect(assertLoopback('http://localhost:11434').hostname).toBe('localhost');
    expect(() => assertLoopback('https://api.example.com')).toThrow(/must be on this machine/);
    expect(() => assertLoopback('http://192.168.1.10:11434')).toThrow();
  });

  it('parses well-formed output and drops malformed items', () => {
    const raw = 'Sure! {"findings":[{"title":"Weak hierarchy","observation":"Three equal CTAs","recommendation":"Pick one"},{"nope":1}]}';
    expect(parseModelOutput(raw)).toEqual([{ title: 'Weak hierarchy', observation: 'Three equal CTAs', recommendation: 'Pick one' }]);
    expect(parseModelOutput('not json')).toEqual([]);
  });
});
