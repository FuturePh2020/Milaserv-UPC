import assert from 'node:assert/strict';
import { base32Decode, totpCode } from '../../src/server/auth/totp.ts';
import type { Prompter } from '../../src/server/cli/prompt.ts';

/** TEST-ONLY scripted terminal: answers are consumed in order; an Error answer simulates Ctrl-C etc. */
export type Answer = string | Error | ((output: string[]) => string);

export function scriptedPrompter(answers: Answer[]): Prompter & { output: string[]; asked: string[]; closed: boolean } {
  const output: string[] = [];
  const asked: string[] = [];
  const next = (question: string): Promise<string> => {
    asked.push(question);
    output.push(question);
    const a = answers.shift();
    if (a === undefined) return Promise.reject(new Error(`unexpected prompt: ${question}`));
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve(typeof a === 'function' ? a(output) : a);
  };
  const p = {
    output,
    asked,
    closed: false,
    ask: next,
    askHidden: next,
    say: (line: string) => void output.push(line),
    close: () => {
      p.closed = true;
    },
  };
  return p;
}

/** Computes a code from the LAST secret the CLI displayed to the operator. */
export const codeFromOutput = (now: () => number, offsetSteps = 0) => (output: string[]) => {
  const line = [...output].reverse().find((l) => l.trim().startsWith('Secret:'));
  assert.ok(line, 'secret was displayed');
  return totpCode(base32Decode(line.replace(/^\s*Secret:\s*/, '').replace(/\s+/g, '')), now() + offsetSteps * 30_000);
};

export const secretFromOutput = (output: string[]): Buffer => {
  const line = [...output].reverse().find((l) => l.trim().startsWith('Secret:'));
  assert.ok(line, 'secret was displayed');
  return base32Decode(line.replace(/^\s*Secret:\s*/, '').replace(/\s+/g, ''));
};
