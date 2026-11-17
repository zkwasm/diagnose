import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { Cases, caseInputSchema } from './cases.js';
import { Drafts, draftInputSchema } from './knowledge-drafts.js';
import { Vault } from './vault.js';
import { safeText } from './util.js';
import { SkillLibrary } from './skill-library.js';

export const knowledgeUsage = `diagnose cases create INPUT.json | list | show ID | export ID | remove ID
diagnose drafts create INPUT.json | list | show ID | review ID | accept ID | reject ID | remove ID
diagnose vault init BACKUP_FILE | restore BACKUP_FILE | backup NEW_FILE
diagnose vault status | push library:NAME@REVISION | pull | revoke | forget [--relay URL]`;
async function json(path: string) { if ((await stat(path)).size > 256 * 1024) throw new Error('Input JSON exceeds 256 KiB'); return JSON.parse(await readFile(path, 'utf8')); }
async function confirm(message: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Review requires an interactive diagnostician terminal');
  const rl = createInterface({ input: stdin, output: stdout });
  try { return (await rl.question(message + ' [y/N] ')).trim().toLowerCase() === 'y'; } finally { rl.close(); }
}
export async function knowledgeCommand(command: string, argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { relay: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log(knowledgeUsage); return; }
  const [action, argument] = positionals; if (positionals.length > 2) throw new Error(knowledgeUsage);
  const print = (value: unknown) => console.log(safeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
  if (command === 'cases') {
    const cases = new Cases();
    if (action === 'list') { print(cases.list()); return; }
    if (action === 'create' && argument) { const input = caseInputSchema.parse(await json(argument)); if (input.skill) await new SkillLibrary().load(input.skill); print(cases.create(input)); return; }
    if (action === 'show' && argument) { print(cases.get(argument)); return; }
    if (action === 'export' && argument) { print(cases.report(argument)); return; }
    if (action === 'remove' && argument) { if (await confirm('Delete this local case and its retained evidence?')) cases.remove(argument); return; }
  }
  if (command === 'drafts') {
    const drafts = new Drafts();
    if (action === 'list') { print(drafts.list()); return; }
    if (action === 'show' && argument) { print(drafts.get(argument)); return; }
    if (action === 'remove' && argument) { if (await confirm('Delete this local draft record? Imported skill versions remain.')) await drafts.remove(argument); return; }
    if (action === 'create' && argument) { print(await drafts.create(draftInputSchema.parse(await json(argument)))); return; }
    if (action === 'review' && argument) { print(await drafts.review(argument)); return; }
    if (action === 'accept' && argument) {
      const review = await drafts.review(argument); print(review);
      if (await confirm('Have you reviewed all instructions, evidence and privacy, and accept this exact draft?')) {
        if (await drafts.review(argument) !== review) throw new Error('Draft changed during review; review again');
        print(await drafts.accept(argument));
      } return;
    }
    if (action === 'reject' && argument) { drafts.reject(argument); print('Draft rejected; accepted versions unchanged.'); return; }
  }
  if (command === 'vault') {
    const vault = new Vault(undefined, undefined, values.relay);
    if (action === 'init' && argument) { await vault.initialize(); await vault.backup(argument); print('Library initialized. Recovery backup saved privately. Keep it outside this computer; it grants full library access. No data uploaded.'); return; }
    if (action === 'restore' && argument) { if ((await stat(argument)).size > 100) throw new Error('Invalid recovery file'); await vault.initialize((await readFile(argument, 'utf8')).trim()); print('Recovery key restored. Run diagnose vault pull to download verified versions.'); return; }
    if (action === 'backup' && argument) { await vault.backup(argument); print('Private recovery backup saved. Never send it to an agent or put it in command arguments.'); return; }
    if (action === 'status') { print({ objects: await vault.list() }); return; }
    if (action === 'push' && argument) {
      await new SkillLibrary().load(argument);
      if (await confirm(`Upload the complete ${argument} bundle, including references/scripts, encrypted to ${vault.relay}? Confirm it contains no customer secrets or raw logs.`)) { await vault.push(argument); print('Encrypted skill version uploaded.'); } return;
    }
    if (action === 'pull') { print({ downloaded: await vault.pull(), note: 'Versions are local; none were executed or selected automatically.' }); return; }
    if (action === 'revoke') { if (await confirm('Permanently delete this relay library and revoke this recovery credential on this relay? Local skills remain.')) { await vault.revoke(); print('Relay library revoked. Use a new key to share again.'); } return; }
    if (action === 'forget') { if (await confirm('Remove this computer’s library recovery credential? Ensure you have a backup. This does not revoke other computers.')) { await vault.forget(); print('Local recovery credential removed.'); } return; }
  }
  if (!action || action === 'help' || action === '--help') { print(knowledgeUsage); return; }
  throw new Error(knowledgeUsage);
}
