import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../app.js', import.meta.url), 'utf8');

assert.match(appSource, /let mainScrollFrame\s*=\s*0/);
assert.match(appSource, /function processMainScroll\(/);
assert.match(appSource, /function scheduleMainScroll\(/);
assert.match(appSource, /requestAnimationFrame\(processMainScroll\)/);
assert.match(
  appSource,
  /DOM\.mainContainer\?\.addEventListener\('scroll',\s*scheduleMainScroll,\s*\{ passive: true \}\)/
);

const processStart = appSource.indexOf('function processMainScroll(');
const processEnd = appSource.indexOf('function scheduleMainScroll(', processStart);
assert.ok(processStart >= 0 && processEnd > processStart, 'processMainScroll() must exist');
const processSource = appSource.slice(processStart, processEnd);

const scrollTopRead = processSource.indexOf('const scrollTop = main.scrollTop');
const clientHeightRead = processSource.indexOf('const clientHeight = main.clientHeight');
const scrollHeightRead = processSource.indexOf('const scrollHeight = main.scrollHeight');
const firstClassWrite = processSource.indexOf("classList.toggle('hidden-fab'");

assert.ok(scrollTopRead >= 0 && clientHeightRead >= 0 && scrollHeightRead >= 0, 'scroll geometry must be snapshotted once per frame');
assert.ok(firstClassWrite > scrollTopRead && firstClassWrite > clientHeightRead && firstClassWrite > scrollHeightRead,
  'all scroll geometry reads must happen before DOM class writes');

console.log('Scroll reflow contract: PASS');
