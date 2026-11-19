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
console.log('Package resources, exports and bilingual metadata validated. Rendered UI/icon pending host verification.');
