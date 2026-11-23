import { open, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type SessionSkill = { sourceFile: string; baseDirectory: string; sha256: string; instructions: string; libraryReference?: string };
const MAX_SKILL = 256 * 1024;
const readLocale = promisify(execFile);
export type PromptLanguage = 'en' | 'zh' | 'es';

export function selectLanguage(value: string): PromptLanguage {
  if (value === 'en' || value === 'zh' || value === 'es') return value;
  throw new Error('Use --lang en, zh, or es');
}

export async function promptLanguage(env = process.env): Promise<PromptLanguage> {
  let locale = [env.LC_ALL, env.LC_MESSAGES].map(value => value?.trim())
    .find(value => value && !/^(?:C|POSIX)(?:[.@]|$)/i.test(value));
  if (!locale) {
    const options = { timeout: 3000, windowsHide: true };
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await readLocale('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], options);
        locale = /^\s*\(\s*"?([\w-]+)/.exec(stdout)?.[1];
      } else if (process.platform === 'win32') {
        const executable = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const { stdout } = await readLocale(executable, ['-NoProfile', '-NonInteractive', '-Command', '(Get-UICulture).Name'], options);
        locale = stdout.trim();
      } else {
        locale = env.LANGUAGE?.split(':')[0]?.trim() || env.LANG?.trim();
      }
    } catch { /* A missing or restricted OS locale reader falls back to the runtime locale. */ }
  }
  const language = (locale || Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().split(/[-_.@]/)[0];
  return language === 'zh' || language === 'es' ? language : 'en';
}

export const caseInstructions = {
  en: 'Use diagnose_case show to read the selected case. Confirm the external target identity, inspect interfaces conservatively, diagnose the stated goal, apply only authorized repairs, and record evidence-backed verification. Propose a reusable skill draft if useful.',
  zh: '调用 diagnose_case show 读取所选案例。确认外接设备身份，谨慎检查接口，围绕给定目标开展诊断。仅实施已获授权的修复，并记录验证证据。如果发现可复用的流程，可提交 Skill 草稿供审核。',
  es: 'Consultá diagnose_case show para leer el caso seleccionado. Confirmá la identidad del equipo externo, inspeccioná sus interfaces y aplicá solo las reparaciones autorizadas. Registrá la evidencia de la verificación.',
};

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

export function skillPrompt(snapshot: string, language: PromptLanguage, device?: string): string {
  if (language === 'zh') return [
    '现在开始诊断者选定的远程诊断任务。默认用中文提问和汇报，用户指定其他语言时采用其选择。',
    `任务快照路径 (JSON): ${JSON.stringify(snapshot)}`,
    '先用本地文件工具读取此 UTF-8 JSON 文件。立即按 instructions 字段执行本会话的任务。',
    '这是当前会话的 Markdown 任务或 Skill 入口。相对路径以快照中的 baseDirectory 为准。按需读取引用资料。随附脚本是任务资源，仅在任务需要且现有权限允许时运行。',
    '引用的文件和脚本初始位于诊断者电脑。若需在现场电脑运行脚本，经授权后提交脚本内容或传输文件，再执行。',
    '通过 diagnose_* MCP 工具操作现场电脑。常规 shell 和文件工具访问的是诊断者电脑。',
    '先用 diagnose_case status 检查会话。连接恢复中时，沿用原会话，等候重连。进度只用简明语言说明现状和现场下一步。需要重启外接设备以采集串口日志时，等 diagnose_wait 报告 serial-ready 后再提示。',
    'CPU 占用高或磁盘空间下降时，先用 system.performance 做只读检查。提交诊断任务前生成并保留 requestId。查询进度时用原编号调用 diagnose_wait。若结果未知，先检查实际状态，再决定是否重试已获授权的修改。',
    '用 diagnose_capabilities 查看参数。用 diagnose_case status/show 查找现有案例。如果没有，为实际目标和任务目标建立案例，再开始远程操作。如果快照含 libraryReference，把它记为案例所用 Skill。修复前确认设备身份和接口。保留前后证据 ID，依据证据结束案例。可用 diagnose_skill_draft 提交改进草稿供人工审核。草稿接受和资料库上传由诊断者本人执行。',
    '缺少邀请码、目标身份或必要信息时，先向诊断者询问再继续。命令参数和报告中应省略邀请码与凭据。',
    '配对后按现场用户的授权开展远程操作，同时遵循 Agent 自身的权限设置。',
    '先调查，再解释拟议修复及影响。仅实施已获授权的变更。重复原先失败的检查，并报告证据、变更和仍待解决的问题。验证通过后再报告修复成功。',
    ...(device ? [`Diagnose MCP 已为保存的设备 ${JSON.stringify(device)} 配置完成。直接使用其工具，无需索取邀请码。连接不可用时，请现场用户启动或恢复探针。`] : []),
  ].join('\n');
  return [
    'Start the remote troubleshooting task selected by the diagnostician now.',
    language === 'es' ? 'Usá español para las preguntas y los informes, salvo que el usuario elija otro idioma.' : 'Use English for questions and reports unless the user asks for another language.',
    `Task snapshot path (JSON): ${JSON.stringify(snapshot)}`,
    'First read this local UTF-8 JSON file using your local file-reading tools. Follow its instructions field as the task for this session; do not merely summarize it or wait for the task to be repeated.',
    'Resolve relative references and scripts against baseDirectory in the snapshot. It is a Markdown task or skill entry, not a globally installed agent skill. Read referenced material only as needed. Bundled scripts are task resources, not startup hooks; run them only as required by the task and existing permissions.',
    'Referenced files and scripts are initially on the diagnostician computer. For a remote script, explicitly submit its contents or transfer it with authorization; do not assume the same path exists remotely.',
    'Use diagnose_* MCP tools for actions on the remote user computer. Your ordinary shell and file tools operate on the diagnostician computer; do not confuse the two.',
    'Check diagnose_case status before asking for an invitation. Keep the current session during a transient drop. Report the current step and next on-site action in plain language. Wait for diagnose_wait to report serial-ready before asking the user to restart equipment for capture.',
    'For high CPU or shrinking disk space, start with the read-only system.performance operation. Keep a requestId for each submitted task. On progress questions, poll its original ID with diagnose_wait. If the outcome is unknown, inspect actual state before retrying an authorized change.',
    'Use diagnose_capabilities to inspect argument schemas. Use diagnose_case status/show to find an existing case. If none exists, create one for the actual external target and goal before remote tasks; if the snapshot has libraryReference, record it as the case skill. Confirm target identity and interface before repairs. Keep before/after evidence IDs and finish the case with a supported outcome. If reusable knowledge emerged, propose diagnose_skill_draft for human review; never run draft acceptance or vault upload on the diagnostician behalf.',
    'If a pairing code, target identity, or necessary detail is missing, ask the diagnostician for it, then continue. Keep pairing codes and credentials out of command arguments and reports.',
    'Pair and obtain the remote user approval before remote actions. Respect the existing user and agent permission modes; this task does not grant permissions or authorize bypassing them.',
    'Investigate, explain the proposed repair and its impact, apply only authorized changes, repeat the original failing check, and report evidence, changes, and remaining issues. Do not claim success without verification.',
    ...(device ? [`Diagnose MCP is already configured for the saved device ${JSON.stringify(device)}. Use its tools directly; do not ask for a pairing code. If unavailable, ask the user to start or resume their probe.`] : []),
  ].join('\n');
}
