import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { Marked } from 'marked';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), out = join(root, '.site-dist');
await mkdir(join(out, 'media'), { recursive: true });
await mkdir(join(out, 'setup'), { recursive: true });
for (const name of ['setup-node.sh', 'setup-node.ps1']) await copyFile(join(root, 'scripts', name), join(out, 'setup', name));
for (const name of ['index.html', 'style.css', 'icon.svg']) await copyFile(join(root, 'site', name), join(out, name));
await copyFile(join(root, 'site/video-poster.svg'), join(out, 'media/video-poster.svg'));
await cp(join(root, 'site/media'), join(out, 'media'), { recursive: true });
const guides = [
  { file: 'USER_GUIDE.md', url: '/guide/', title: 'Guide overview' },
  { file: 'docs/guide/on-site.md', url: '/guide/on-site/', title: 'Receive remote help' },
  { file: 'docs/guide/diagnose.md', url: '/guide/diagnose/', title: 'Diagnose a remote device' },
  { file: 'docs/guide/reconnect.md', url: '/guide/reconnect/', title: 'Return to a saved device' },
  { file: 'docs/guide/procedures.md', url: '/guide/procedures/', title: 'Reuse and improve procedures' },
  { file: 'docs/guide/automation.md', url: '/guide/automation/', title: 'Automation and tool reference' },
  { file: 'docs/guide/troubleshooting.md', url: '/guide/troubleshooting/', title: 'Troubleshoot and review' },
];
const guideUrls = new Map(guides.map(({ file, url }) => [join(root, file), url]));
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const guidePages: string[] = [];
for (const guide of guides) {
  const source = join(root, guide.file);
  const markdown = await readFile(source, 'utf8');
  const headings: { title: string; id: string }[] = [];
  const marked = new Marked({ renderer: {
    heading({ tokens, depth }) {
      const content = this.parser.parseInline(tokens);
      const title = content.replace(/<[^>]*>/g, '').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
      const id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/^-|-$/g, '');
      if (depth === 2) headings.push({ title, id });
      return `<h${depth} id="${id}">${content}</h${depth}>\n`;
    },
  } });
  const article = (await marked.parse(markdown)).replace(/href="((?![a-z]+:|\/)[^"#]+\.md)(#[^"]*)?"/g, (link, file, hash = '') => {
    const url = guideUrls.get(resolve(dirname(source), file));
    if (!url) throw new Error(`Unknown guide link in ${guide.file}: ${link}`);
    return `href="${url}${hash}"`;
  });
  const navigation = guides.map(({ url, title }) =>
    `<a href="${url}"${url === guide.url ? ' aria-current="page"' : ''}>${escape(title)}</a>`).join('');
  const toc = headings.map(({ id, title }) => `<a href="#${id}">${escape(title)}</a>`).join('');
  const page = join(guide.url.slice(1), 'index.html');
  guidePages.push(page);
  await mkdir(dirname(join(out, page)), { recursive: true });
  await writeFile(join(out, page), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(guide.title)} — Diagnose</title><meta name="description" content="Connect a remote AI agent to IoT and industrial devices through an on-site computer. Device setup, local permissions, skills, recovery, and verification explained."><link rel="canonical" href="https://diagnose.fenginwind.com${guide.url}"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head><body><a class="skip" href="#main">Skip to content</a><header class="nav wrap"><a class="brand" href="/" aria-label="Diagnose home"><span class="brand-icon" aria-hidden="true">›_</span>diagnose<span class="wordmark-dot">.</span></a><nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#capabilities">Capabilities</a><a href="/guide/#quick-start">Quick start</a><a class="github" href="https://github.com/zkwasm/diagnose">GitHub ↗</a></nav></header><main class="wrap guide-layout" id="main"><aside class="guide-toc"><nav aria-label="Guide scenarios"><strong>GUIDE SCENARIOS</strong>${navigation}</nav><nav aria-label="On this page"><strong>ON THIS PAGE</strong>${toc}</nav></aside><article class="guide-content">${article}</article></main><footer class="wrap footer"><a class="brand" href="/">diagnose<span class="wordmark-dot">.</span></a><span>Open source. Human permission.</span><nav aria-label="Footer"><a href="/">Home</a><a href="https://github.com/zkwasm/diagnose">GitHub ↗</a><a href="https://www.npmjs.com/package/@masstensor/diagnose">npm ↗</a></nav></footer></body></html>`);
}
await writeFile(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://diagnose.fenginwind.com/sitemap.xml\n');
await writeFile(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://diagnose.fenginwind.com/</loc></url>' + guides.map(({ url }) => '<url><loc>https://diagnose.fenginwind.com' + url + '</loc></url>').join('') + '</urlset>');
const assets = await Promise.all(['style.css', 'site.js'].map(async name => ({ name, version: createHash('sha256').update(await readFile(join(out, name))).digest('hex').slice(0, 12) })));
for (const page of ['index.html', ...guidePages]) {
  const path = join(out, page);
  let html = await readFile(path, 'utf8');
  for (const { name, version } of assets) html = html.replaceAll(`"/${name}"`, `"/${name}?v=${version}"`);
  await writeFile(path, html);
}
console.log('Built landing page, English guide, and video assets in .site-dist/');
