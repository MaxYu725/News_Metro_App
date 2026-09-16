import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readerSource = await readFile(new URL('../../reader-ui.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');

assert.match(
  readerSource,
  /img\.loading\s*=\s*index\s*===\s*0\s*\?\s*['"]eager['"]\s*:\s*['"]lazy['"]/
);
assert.match(readerSource, /img\.decoding\s*=\s*['"]async['"]/);

assert.match(readerSource, /function readerMediaSignature\(/);
assert.match(
  readerSource,
  /if \(readerMediaSignature\(article\) !== renderedMediaSignature\)/
);

assert.match(
  readerSource,
  /requestAnimationFrame\(\(\) => \{\s*if \(sequence !== openSequence/
);

const closeStart = readerSource.indexOf('function finalizeClose()');
const closeEnd = readerSource.indexOf('function closeReader(', closeStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart, 'finalizeClose() must exist');
const closeSource = readerSource.slice(closeStart, closeEnd);
assert.ok(
  closeSource.indexOf("overlay.classList.remove('open')") < closeSource.indexOf('refreshReaderViewAfterClose('),
  'Reader overlay should close before the feed refresh work begins'
);

assert.match(swSource, /const SHELL_CACHE = 'metro-news-shell-v\d+-[^']+'/);

console.log('Reader performance contract: PASS');
