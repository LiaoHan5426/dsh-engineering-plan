import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const p = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
for (const target of ['index.js', 'client.js', 'src/core.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'locale/en.json', 'locale/zh.json']) await fs.access(path.join(root, target));
if (!p.files.includes('skills')) throw new Error('Skills missing from package files');
for (const name of ['engineering-planning', 'architecture-design', 'engineering-review']) {
  const text = await fs.readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
  if (!text.trim()) throw new Error('Empty skill: ' + name);
}
for (const lang of ['en', 'zh']) {
  const { meta } = JSON.parse(await fs.readFile(path.join(root, 'locale', lang + '.json'), 'utf8'));
  if (!meta?.title || !meta?.description) throw new Error('Missing metadata: ' + lang);
}
if (!p.exports['./client'] || !p.exports['./icon'] || !p.exports['./locale/*.json'] || !p.dsh?.bundle?.patch) throw new Error('Missing manifest export');
const icon = await fs.readFile(path.join(root, 'icon.svg'), 'utf8');
if (!icon.startsWith('<svg ') || !icon.includes('viewBox="0 0 36 36"') || /<script|<image|<foreignObject|href=/.test(icon) || Buffer.byteLength(icon) > 256 * 1024) throw new Error('Unexpected SVG');
const packaged = relative => p.files.some(entry => relative === entry || relative.startsWith(entry.replace(/\/$/, '') + '/'));
const visited = new Set();
async function inspectModule(relative) {
  if (visited.has(relative)) return;
  if (!packaged(relative)) throw new Error('Runtime module excluded from package: ' + relative);
  visited.add(relative);
  const source = await fs.readFile(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(/(?:import|export)\s[^;]*?\bfrom\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
    if (target.startsWith('../')) throw new Error('Runtime import escapes package: ' + target);
    await inspectModule(target);
  }
}
await inspectModule('index.js');
for (const target of ['client.js', 'assets/mermaid-LICENSE', 'assets/mermaid-11.17.2.min.js']) {
  if (!packaged(target)) throw new Error('Client resource excluded from package: ' + target);
  await fs.access(path.join(root, target));
}
console.log(`Package resources, ${visited.size} static Host modules, offline renderer and bilingual metadata validated. This check does not establish runtime or visual acceptance.`);
