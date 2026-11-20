import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positional = args.filter((arg) => !arg.startsWith('--'));
const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--check');
if (unknown.length || positional.length > 1) {
  throw new Error('Usage: node scripts/embed-mermaid.mjs [--check] [client.js]');
}

const vendor = readFileSync(new URL('../assets/mermaid-11.17.2.min.js', import.meta.url), 'utf8');
const digest = createHash('sha256').update(vendor).digest('hex');
if (digest !== '581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8') throw new Error('Unexpected Mermaid vendor checksum');

const file = new URL('../client.js', import.meta.url);
if (positional.length && resolve(positional[0]) !== fileURLToPath(file)) {
  throw new Error(`Refusing to rebuild an unexpected client file: ${positional[0]}`);
}
const source = readFileSync(file, 'utf8');

// JSON.stringify already escapes quotes and backslashes. The only characters it
// leaves raw that are unsafe inside a JS string literal are U+2028/U+2029 line
// separators, so escape those (and nothing else: matching the two-character text
// "\u2028" would corrupt escapes that appear inside the vendor source itself).
const literal = JSON.stringify(vendor).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const startMarker = '    /* BEGIN EMBEDDED MERMAID 11.17.2 */';
const endMarker = '    /* END EMBEDDED MERMAID */';
const block = `${startMarker}\n    const mermaidAsset = ${literal};\n${endMarker}`;

// Content equality, not byte equality: the literal may escape the same text
// differently (for example \uXXXX versus the raw character) while parsing back
// to identical vendor text. Only real content drift is reported or rewritten.
function embeddedMatches(text) {
  const start = text.indexOf(startMarker);
  if (start < 0) return { present: false, matches: false };
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error('Missing embedded end marker');
  const match = text.slice(start, end).match(/const mermaidAsset = (".*");\n?$/s);
  if (!match) return { present: true, matches: false };
  try {
    return { present: true, matches: JSON.parse(match[1]) === vendor };
  } catch {
    return { present: true, matches: false };
  }
}

const state = embeddedMatches(source);
const changed = !state.matches;

let output = source;
if (changed) {
  const start = source.indexOf(startMarker);
  if (start >= 0) {
    const end = source.indexOf(endMarker, start);
    if (end < 0) throw new Error('Missing embedded end marker');
    output = source.slice(0, start) + block + source.slice(end + endMarker.length);
  } else {
    const placeholder = '    const mermaidAsset = "__EP_MERMAID_VENDOR_SOURCE__";';
    if (!source.includes(placeholder)) throw new Error('Missing embedding placeholder');
    output = source.replace(placeholder, () => block);
  }
  if (!embeddedMatches(output).matches) throw new Error('Rebuilt client.js still does not embed the vendor asset');
}

if (checkOnly) {
  if (changed) throw new Error('Embedded Mermaid content differs from the vendor asset; run node scripts/embed-mermaid.mjs to rebuild');
} else if (changed) {
  writeFileSync(file, output);
}

console.log(JSON.stringify({
  check: checkOnly,
  changed,
  vendorVersion: '11.17.2',
  sha256: digest,
  clientBytes: Buffer.byteLength(checkOnly ? source : output)
}));
