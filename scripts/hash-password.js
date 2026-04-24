#!/usr/bin/env node
/**
 * Generate a bcrypt hash for a password.
 *
 * Usage:
 *   node scripts/hash-password.js          # prompts from keyboard (hidden input)
 *   echo "mypassword" | node scripts/hash-password.js   # reads from stdin
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

async function main() {
  let password;

  if (process.stdin.isTTY) {
    // Interactive mode — hide input
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await new Promise(resolve => {
      rl.question('Enter password: ', resolve);
    });
    rl.close();
    process.stdout.write('\n');
  } else {
    // Piped stdin — read directly
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    password = Buffer.concat(chunks).toString('utf8').trimEnd();
  }

  if (!password) {
    console.error('Error: password cannot be empty');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  console.log(hash);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
