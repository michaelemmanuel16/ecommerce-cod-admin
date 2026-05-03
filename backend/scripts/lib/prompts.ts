import * as readline from 'readline';

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(127);

export async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let password = '';
    process.stdout.write(question);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('data', (char) => {
      const str = char.toString('utf-8');
      if (str === '\n' || str === '\r' || str === CTRL_D) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        process.stdout.write('\n');
        resolve(password);
      } else if (str === CTRL_C) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(0);
      } else if (str === DEL || str === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (str >= ' ' && str <= '~') {
        password += str;
        process.stdout.write('*');
      }
    });
  });
}
