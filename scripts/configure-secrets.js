// Run locally after `vercel link`. Secrets travel only on child-process stdin.
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync } from 'node:fs';
import { parseEnv } from 'node:util';
const run = (cmd, args, input) => execFileSync(cmd, args, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
const scope = ['--scope', 'nusnos-projects'];
for (const target of ['production', 'preview', 'development']) {
  const secret = randomBytes(32).toString('base64url');
  run('vercel', ['env', 'add', 'APP_SECRET', target, ...scope], secret);
  if (target === 'development') appendFileSync('.env.local', `\nAPP_SECRET=${secret}\n`);
  console.log(`Configured APP_SECRET for ${target}`);
}
const cron = randomBytes(32).toString('base64url');
run('vercel', ['env', 'update', 'CRON_SECRET', 'production', ...scope], cron);
// Read back Vercel's actual saved value: CLI handling of an existing CRON_SECRET
// can differ from a new env add. Never assume the supplied value was stored.
const verificationFile = '.vercel/bootstrap-production.env';
run('vercel', ['env', 'pull', verificationFile, '--environment=production', '--yes', ...scope]);
const actualCron = parseEnv(readFileSync(verificationFile, 'utf8')).CRON_SECRET;
unlinkSync(verificationFile);
if (!actualCron) throw Error('Production CRON_SECRET readback failed');
run('gh', ['secret', 'set', 'CRON_SECRET', '--repo', 'Nusnos/woningzoeker'], actualCron);
console.log('Configured matching production cron and GitHub Actions secret');
for (const target of ['production', 'preview', 'development']) {
  run('vercel', ['env', 'add', 'APP_URL', target, ...scope], 'https://woningzoeker-one.vercel.app');
}
console.log('Configured canonical APP_URL');
