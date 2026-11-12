import { createInterface } from 'node:readline';

/**
 * Interactive terminal input for trusted-operator commands. Hidden input uses
 * raw mode and echoes nothing; it is never trimmed or truncated (input beyond
 * MAX_HIDDEN_CHARS is reported as too long, not cut). Ctrl-C / Ctrl-D cancel.
 */

export interface Prompter {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  say(line: string): void;
  close(): void;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled by the operator.');
    this.name = 'CancelledError';
  }
}

export class NotInteractiveError extends Error {
  constructor() {
    super('This command must be run in an interactive terminal (stdin is not a TTY). Secrets are never read from pipes or arguments.');
    this.name = 'NotInteractiveError';
  }
}

export class InputTooLongError extends Error {
  constructor() {
    super('Input is too long.');
    this.name = 'InputTooLongError';
  }
}

const MAX_HIDDEN_CHARS = 4096;

type TtyInput = NodeJS.ReadStream & { setRawMode(mode: boolean): void; isTTY?: boolean };

export function createTerminalPrompter(input: TtyInput = process.stdin as TtyInput, output: NodeJS.WritableStream = process.stdout): Prompter {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new NotInteractiveError();

  return {
    say(line) {
      output.write(line + '\n');
    },

    ask(question) {
      return new Promise((resolve, reject) => {
        const rl = createInterface({ input, output, terminal: true });
        let answered = false;
        rl.on('SIGINT', () => {
          rl.close();
        });
        rl.on('close', () => {
          if (!answered) reject(new CancelledError());
        });
        rl.question(question, (answer) => {
          answered = true;
          rl.close();
          resolve(answer);
        });
      });
    },

    askHidden(question) {
      return new Promise((resolve, reject) => {
        let value = '';
        let overflow = false;
        const finish = (err: Error | null) => {
          input.removeListener('data', onData);
          input.setRawMode(false);
          input.pause();
          output.write('\n');
          if (err) reject(err);
          else if (overflow) reject(new InputTooLongError());
          else resolve(value);
        };
        const onData = (chunk: Buffer | string) => {
          const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          if (s.startsWith('\u001b')) return; // ignore escape sequences (arrow keys etc.)
          for (const ch of s) {
            if (ch === '\u0003' || (ch === '\u0004' && value.length === 0)) return finish(new CancelledError());
            if (ch === '\r' || ch === '\n') return finish(null);
            if (ch === '\u007f' || ch === '\b') {
              value = Array.from(value).slice(0, -1).join('');
              continue;
            }
            if (ch < ' ') continue; // other control characters are not part of a password
            if (value.length >= MAX_HIDDEN_CHARS) overflow = true;
            else value += ch;
          }
        };
        // Raw mode BEFORE the prompt is shown: a key pressed as soon as the prompt
        // appears (including Ctrl-C) must never be echoed or turned into a signal.
        input.setRawMode(true);
        input.setEncoding('utf8');
        input.on('data', onData);
        input.resume();
        output.write(question);
      });
    },

    close() {
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    },
  };
}
