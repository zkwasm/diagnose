import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Marked } from 'marked';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), out = join(root, '.site-dist');
await mkdir(join(out, 'guide'), { recursive: true });
await mkdir(join(out, 'media'), { recursive: true });
await mkdir(join(out, 'setup'), { recursive: true });
for (const name of ['setup-node.sh', 'setup-node.ps1']) await copyFile(join(root, 'scripts', name), join(out, 'setup', name));
for (const name of ['index.html', 'style.css', 'icon.svg']) await copyFile(join(root, 'site', name), join(out, name));
await copyFile(join(root, 'site/video-poster.svg'), join(out, 'media/video-poster.svg'));
await cp(join(root, 'site/media'), join(out, 'media'), { recursive: true });
const markdown = await readFile(join(root, 'USER_GUIDE.md'), 'utf8');
const headings: { title: string; id: string }[] = [];
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const marked = new Marked({ renderer: { heading({ tokens, depth }) { const content = this.parser.parseInline(tokens), title = content.replace(/<[^>]*>/g, '').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&'), id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/^-|-$/g, ''); if (depth === 2) headings.push({ title, id }); return `<h${depth} id="${id}">${content}</h${depth}>\n`; } } });
const article = await marked.parse(markdown);
const toc = headings.map(item => `<a href="#${item.id}">${escape(item.title)}</a>`).join('');
await writeFile(join(out, 'guide/index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>User guide — Diagnose</title><meta name="description" content="Connect a remote AI agent to IoT and industrial devices through an on-site computer. Device setup, local permissions, skills, recovery, and verification explained."><link rel="canonical" href="https://diagnose.fenginwind.com/guide/"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head><body><a class="skip" href="#main">Skip to content</a><header class="nav wrap"><a class="brand" href="/" aria-label="Diagnose home"><span class="brand-icon" aria-hidden="true">›_</span>diagnose<span class="wordmark-dot">.</span></a><nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#capabilities">Capabilities</a><a href="/guide/#quick-start">Quick start</a><a class="github" href="https://github.com/zkwasm/diagnose">GitHub ↗</a></nav></header><main class="wrap guide-layout" id="main"><aside class="guide-toc"><strong>ON THIS PAGE</strong>${toc}</aside><article class="guide-content">${article}</article></main><footer class="wrap footer"><a class="brand" href="/">diagnose<span class="wordmark-dot">.</span></a><span>Open source. Human permission.</span><nav aria-label="Footer"><a href="/">Home</a><a href="https://github.com/zkwasm/diagnose">GitHub ↗</a><a href="https://www.npmjs.com/package/@masstensor/diagnose">npm ↗</a></nav></footer></body></html>`);
await writeFile(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://diagnose.fenginwind.com/sitemap.xml\n');
await writeFile(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://diagnose.fenginwind.com/</loc></url><url><loc>https://diagnose.fenginwind.com/guide/</loc></url></urlset>');
const assets = await Promise.all(['style.css', 'site.js'].map(async name => ({ name, version: createHash('sha256').update(await readFile(join(out, name))).digest('hex').slice(0, 12) })));
for (const page of ['index.html', 'guide/index.html']) {
  const path = join(out, page);
  let html = await readFile(path, 'utf8');
  for (const { name, version } of assets) html = html.replaceAll(`"/${name}"`, `"/${name}?v=${version}"`);
  await writeFile(path, html);
}
console.log('Built landing page, English guide, and video assets in .site-dist/');
