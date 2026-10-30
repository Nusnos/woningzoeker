// Transfer the generated automation credential directly from Vercel to GitHub.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const stdout = execFileSync('vercel', ['api', '/v1/projects/prj_IXOllcEZR8t5aaH98fRM4yHDvDbR/protection-bypass', '--method', 'PATCH', '--input', '-', '--scope', 'nusnos-projects'], {
  input: JSON.stringify({ generate: { note: 'Woningzoeker dagelijkse controle en releasetest' } }), stdio: ['pipe', 'pipe', 'pipe']
}).toString();
const response = JSON.parse(stdout);
const secrets = response.protectionBypass || response.result?.protectionBypass;
if (!secrets || !Object.keys(secrets).length) throw Error(`Unrecognized response structure: ${Object.keys(response).join(', ')}`);
const secret = Object.keys(secrets).sort((a,b) => (secrets[b].createdAt || 0) - (secrets[a].createdAt || 0))[0];
execFileSync('gh', ['secret', 'set', 'VERCEL_PROTECTION_BYPASS', '--repo', 'Nusnos/woningzoeker'], { input: secret, stdio: ['pipe', 'pipe', 'pipe'] });
writeFileSync('.vercel/automation-bypass.json', JSON.stringify({ secret }), { mode: 0o600 });
console.log('Configured GitHub automation access; deployment protection preserved');
