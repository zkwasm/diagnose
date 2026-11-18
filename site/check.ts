import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
const root = '.site-dist', pages = ['index.html', 'guide/index.html'];
const guideDirectories = await readdir(join(root, 'guide'), { withFileTypes: true });
for (const directory of guideDirectories) {
  if (directory.isDirectory()) pages.push(`guide/${directory.name}/index.html`);
}
assert.equal(pages.length, 8, 'Expected the landing page, guide overview, and six scenario pages');
for (const file of pages) {
  const html = await readFile(join(root, file), 'utf8'); const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length, `Duplicate IDs in ${file}`); assert.match(html, /<html lang="en">/); assert.doesNotMatch(html, /\p{Script=Han}/u);
  if (file.startsWith('guide/')) {
    assert.ok(html.includes(`href="/${file.replace('index.html', '')}" aria-current="page"`), `Missing current scenario in ${file}`);
  }
  for (const [, link] of html.matchAll(/(?:href|src|poster)="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [resource, anchor] = link.split('#'), path = resource.split('?')[0]; let target = path.startsWith('/') ? path.slice(1) : path ? path : file;
    if (!target || target.endsWith('/')) target += 'index.html';
    await access(join(root, target));
    if (anchor) assert.ok((await readFile(join(root, target), 'utf8')).includes(`id="${anchor}"`), `Missing anchor ${link} in ${file}`);
  }
}
// Exercise the actual compiled interaction module without browser automation.
class Element {
  textContent = ''; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; tabIndex = 0; id = ''; focused = false;
  events: Record<string, (event: any) => unknown> = {};
  classList = { add() {}, remove() {} };
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener(name: string, handler: (event: any) => unknown) { this.events[name] = handler; }
  focus() { this.focused = true; }
}
const tabs = ['codex', 'claude', 'gemini'].map(agent => { const element = new Element(); element.dataset.agent = agent; element.id = `tab-${agent}`; return element; });
const copy = new Element(), command = new Element(), panel = new Element(), status = new Element(); let copied = '';
const elements: Record<string, Element> = { '#agent-copy': copy, '#agent-command': command, '#agent-panel': panel, '#copy-status': status };
const context = vm.createContext({ document: { querySelector: (selector: string) => elements[selector], querySelectorAll: (selector: string) => selector === '.copy' ? [copy] : tabs }, navigator: { clipboard: { writeText: async (value: string) => { copied = value; } } }, window: { setTimeout() {} } });
vm.runInContext((await readFile(join(root, 'site.js'), 'utf8')).replace(/export\s*\{\s*\};?/, ''), context);
for (const tab of tabs) { tab.events.click({}); assert.equal(command.textContent, `npx @masstensor/diagnose@latest agent ${tab.dataset.agent}`); assert.equal(tab.attrs['aria-selected'], 'true'); await copy.events.click({}); assert.equal(copied, command.textContent); }
let prevented = false; tabs[2].events.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } }); assert.ok(prevented && tabs[0].focused); assert.equal(panel.attrs['aria-labelledby'], 'tab-codex');
console.log('Site checks passed: English pages, local links/assets, guide anchors, agent tabs, keyboard navigation, and clipboard commands.');
