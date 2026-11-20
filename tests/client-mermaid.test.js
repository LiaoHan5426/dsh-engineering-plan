import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const runtimeText = source.slice(source.indexOf('    function mermaidFrameRuntime('), source.indexOf('    function mermaidFrameDocument('));
const documentText = source.slice(source.indexOf('    function mermaidFrameDocument('), source.indexOf('    const words ='));
function frameDocument(base) {
  const runtime = Function(`return (${runtimeText})`)();
  return Function('window', 'mermaidFrameRuntime', `return (${documentText})`)({ location: { href: base } }, runtime);
}

test('offline preview isolates SVG and authenticates both message directions', () => {
  const html = frameDocument('http://localhost/')('http://localhost/mermaid.js', 'test-nonce');
  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.doesNotMatch(html, /script src=|unsafe-eval/);
  const tricky = frameDocument('http://localhost/')('window.example="</script>\u2028\u2029";', 'test-nonce');
  assert.equal((tricky.match(/<\/script>/gi) || []).length, 2);
  assert.match(tricky, /<\\\/script>/);
  assert.throws(() => frameDocument('http://localhost/')('', 'bad"nonce'), /Invalid preview nonce/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /img-src data:/);
  assert.match(html, /font-src 'none'/);
  assert.match(html, /event.source !== parent/);
  assert.match(html, /event.data\?\.nonce !== nonce/);
  assert.match(source, /event.source !== frame.current\?\.contentWindow/);
  assert.match(source, /sandbox: "allow-scripts"/);
  assert.doesNotMatch(source, /allow-same-origin/);
  assert.match(html, /securityLevel: "strict"/);
  assert.match(html, /encodeURIComponent\(result.svg\)/);
  assert.doesNotMatch(html, /bindFunctions\(/);
});

test('all three current draft sources retain editing and receive previews', () => {
  const view = source.slice(source.indexOf('          function architectureView()'), source.indexOf('          function evidenceMatrix()'));
  assert.match(view, /\["architecture", "sequence", "data-flow"\]/);
  assert.match(view, /h\(MermaidPreview, \{ source: draft.diagrams\[diagram\]/);
  assert.match(view, /edit\(\{ diagrams: \{ \.\.\.draft.diagrams/);
  assert.match(source, /t\("dependencyHint"\)\),\s*dependencyDiagram\(\)/);
  assert.match(source, /observer.disconnect\(\)/);
  assert.match(source, /removeEventListener\("message", receive\)/);
});

test('actual architecture component tree has unique sibling keys across repeated draft renders', () => {
  const editor = source.slice(source.indexOf('          function documentEditor('), source.indexOf('          function planningChecklist('));
  const view = source.slice(source.indexOf('          function architectureView('), source.indexOf('          function evidenceMatrix('));
  const h = (type, props, ...children) => ({ type, key: props?.key, children });
  const render = Function('h', 'React', 'draft', 'busy', 'editable', 't', 'field', 'edit', 'MermaidPreview', 'button', 'setDiagram', 'diagram', 'editingPlan', 'documentPreview', 'deliveredDecisionsView', `${editor}\n${view}\nreturn architectureView;`)(h, { Fragment: 'fragment' }, { mode: 'standard', documents: {}, diagrams: {} }, false, true, x => x, () => h('textarea'), () => {}, 'preview', (key, action, disabled, active, props) => h('button', props, key), () => {}, 'architecture', true, () => h('p'), () => null);
  let count = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'textarea') count++;
    const keys = node.children.filter(x => x && x.key !== undefined).map(x => x.key);
    assert.equal(new Set(keys).size, keys.length, `Duplicate sibling keys: ${keys}`);
    node.children.forEach(walk);
  }
  for (let i = 0; i < 30; i++) { count = 0; walk(render()); assert.equal(count, 5); }
});

test('real Chromium renders architecture, sequence, data flow and errors offline in opaque frame', { skip: !process.env.EP_MERMAID_BROWSER }, async () => {
  const { default: puppeteer } = await import(process.env.EP_MERMAID_BROWSER);
  const vendor = new URL('../assets/mermaid-11.17.2.min.js', import.meta.url);
  const server = createServer((req, res) => {
    if (req.url === '/mermaid.js') { res.setHeader('Content-Type', 'text/javascript'); createReadStream(vendor).pipe(res); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body></body>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: process.env.EP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    const unexpected = [];
    page.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('data:') && req.url() !== 'about:srcdoc') unexpected.push(req.url()); });
    await page.goto(base);
    await page.evaluate(html => {
      window.results = [];
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts'; frame.style.cssText = 'width:900px;height:500px'; frame.srcdoc = html;
      window.addEventListener('message', event => { if (event.source === frame.contentWindow && event.data.nonce === 'test-nonce') window.results.push(event.data); });
      document.body.append(frame);
    }, frameDocument(base)(readFileSync(vendor, 'utf8'), 'test-nonce'));
    await page.waitForFunction(() => window.results.some(x => x.status === 'loaded'));
    let revision = 0;
    for (const [diagram, dark, expected] of [
      ['flowchart LR\n A[Client] --> B[Service]', false, 'ready'],
      ['sequenceDiagram\n participant A\n participant B\n A->>B: Request\n B-->>A: Response', true, 'ready'],
      ['flowchart TD\n A[(Source)] --> B[Transform] --> C[(Store)]', false, 'ready'],
      ['flowchart LR\n A["<img src=https://example.invalid/track onerror=alert(1)>"] --> B[End]\n click B "https://example.invalid/escape"', false, 'ready'],
      ['not-a-mermaid-diagram', false, 'error'],
      ['flowchart LR\n A[Recovered] --> B[OK]', true, 'ready'],
    ]) {
      revision++;
      await page.evaluate(request => document.querySelector('iframe').contentWindow.postMessage(request, '*'), { kind: 'ep-mermaid-render', nonce: 'test-nonce', revision, source: diagram, dark, label: 'Preview' });
      await page.waitForFunction(rev => window.results.some(x => x.revision === rev), {}, revision);
      const result = await page.evaluate(rev => window.results.find(x => x.revision === rev), revision);
      assert.equal(result.status, expected, JSON.stringify(result));
      if (expected === 'ready') {
        const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
        await frame.waitForFunction(() => document.querySelector('img').complete && document.querySelector('img').naturalWidth > 0);
        const image = await frame.$eval('img', img => ({ width: img.naturalWidth, src: decodeURIComponent(img.src), background: document.body.style.background }));
        assert.ok(image.width > 0);
        assert.match(image.src, /<svg/);
        assert.match(image.src, /<path|<line/);
        assert.equal(image.background, dark ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
      }
    }
    assert.deepEqual(unexpected, []);
    assert.equal(await page.evaluate(() => { try { return document.querySelector('iframe').contentWindow.document.body != null; } catch { return false; } }), false);
    console.log('Mermaid vendor SHA256:', createHash('sha256').update(readFileSync(vendor)).digest('hex'));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
