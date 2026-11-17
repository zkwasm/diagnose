import { open, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';

export type SessionSkill = { sourceFile: string; baseDirectory: string; sha256: string; instructions: string; libraryReference?: string };
const MAX_SKILL = 256 * 1024;

export async function loadSkill(input: string): Promise<SessionSkill> {
  if (!input.trim()) throw new Error('--skill requires a non-empty path');
  let path = resolve(input);
  if ((await stat(path)).isDirectory()) path = join(path, 'SKILL.md');
  if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('--skill requires a Markdown file or a directory containing SKILL.md');
  const sourceFile = await realpath(path);
  if (!(await stat(sourceFile)).isFile()) throw new Error('Skill must be a regular file');
  const file = await open(sourceFile, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Skill must be a regular file');
    if (info.size > MAX_SKILL) throw new Error('Skill exceeds 256 KiB');
    const buffer = Buffer.alloc(MAX_SKILL + 1); let length = 0;
    while (length < buffer.length) { const { bytesRead } = await file.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
    if (length > MAX_SKILL) throw new Error('Skill exceeds 256 KiB');
    const bytes = buffer.subarray(0, length);
    if (!isUtf8(bytes)) throw new Error('Skill must contain UTF-8 Markdown');
    const instructions = bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (!instructions.trim()) throw new Error('Skill is empty');
    return { sourceFile, baseDirectory: dirname(sourceFile), sha256: createHash('sha256').update(bytes).digest('hex'), instructions };
  } finally { await file.close(); }
}

export function skillPrompt(snapshot: string): string {
  return [
    'Start the remote troubleshooting task selected by the diagnostician now.',
    `Task snapshot path (JSON): ${JSON.stringify(snapshot)}`,
    'First read this local UTF-8 JSON file using your local file-reading tools. Follow its instructions field as the task for this session; do not merely summarize it or wait for the task to be repeated.',
    'Resolve relative references and scripts against baseDirectory in the snapshot. It is a Markdown task or skill entry, not a globally installed agent skill. Read referenced material only as needed. Bundled scripts are task resources, not startup hooks; run them only as required by the task and existing permissions.',
    'Referenced files and scripts are initially on the diagnostician computer. For a remote script, explicitly submit its contents or transfer it with authorization; do not assume the same path exists remotely.',
    'Use diagnose_* MCP tools for actions on the remote user computer. Your ordinary shell and file tools operate on the diagnostician computer; do not confuse the two.',
    'Use diagnose_capabilities to inspect argument schemas. Use diagnose_case status/show to find an existing case. If none exists, create one for the actual external target and goal before remote tasks; if the snapshot has libraryReference, record it as the case skill. Confirm target identity and interface before repairs. Keep before/after evidence IDs and finish the case with a supported outcome. If reusable knowledge emerged, propose diagnose_skill_draft for human review; never run draft acceptance or vault upload on the diagnostician behalf.',
    'If a pairing code, target identity, or necessary detail is missing, ask the diagnostician for it, then continue. Keep pairing codes and credentials out of command arguments and reports.',
    'Pair and obtain the remote user approval before remote actions. Respect the existing user and agent permission modes; this task does not grant permissions or authorize bypassing them.',
    'Investigate, explain the proposed repair and its impact, apply only authorized changes, repeat the original failing check, and report evidence, changes, and remaining issues. Do not claim success without verification.'
  ].join('\n');
}
