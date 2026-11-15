// Builds the app as one self-contained HTML file for hosting as a single page
// (inline JS/CSS, bundled sample clip). Output: artifact/website-recorder.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npx vite build --outDir dist-hosted --emptyOutDir', { stdio: 'inherit', env: { ...process.env, VITE_HOSTED: '1' } });
const dir = 'dist-hosted/assets/';
const files = readdirSync(dir);
const read = (ext) => readFileSync(dir + files.find((f) => f.endsWith(ext)), 'utf8');
// A literal "</script" inside the bundle would end the inline script early.
const js = read('.js').replace(/<\/script/gi, '<\\/script');
const sample = readFileSync('artifact/sample.webm').toString('base64');

writeFileSync(
  'artifact/website-recorder.html',
  `<title>Website Recorder</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${read('.css')}</style>
<div id="root"></div>
<script>window.__SAMPLE_VIDEO__="${sample}";</script>
<script type="module">${js}</script>
`,
);
console.log('artifact/website-recorder.html written');
