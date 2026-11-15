const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// When stdin is piped (non-TTY), read all input upfront into lines so prompts
// consume reliably (readline + piped stdin on Windows is unreliable).
let stdinLines = [];
let stdinIdx = 0;
let interactive = process.stdin.isTTY;
if (!interactive) {
  const raw = fs.readFileSync(0, 'utf8');
  stdinLines = raw.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
}

/** Ask a question and return the trimmed answer. */
function ask(q) {
  const prompt = (q.endsWith('?') ? q : q + ' ') + ' ';
  if (!interactive && stdinIdx < stdinLines.length) {
    const ans = stdinLines[stdinIdx++];
    process.stdout.write(prompt + ans + '\n');
    return Promise.resolve(ans.trim());
  }
  return new Promise((resolve) => {
    rl.question(prompt, (a) => resolve((a || '').trim()));
  });
}

/** Close the readline interface. */
function close() {
  rl.close();
}

module.exports = { ask, close, rl };
