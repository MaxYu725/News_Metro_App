import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/entry.js';
import { APP_ORIGIN } from '../src/security.js';

function limiter(success = true) {
  return { limit: async () => ({ success }) };
}

function baseEnv(aiRun) {
  return {
    FETCH_RATE_LIMITER: limiter(true),
    AI_RATE_LIMITER: limiter(true),
    SYNC_RATE_LIMITER: limiter(true),
    AI: { run: aiRun },
    API_KEY: 'test-key',
    DB: {
      prepare() {
        throw new Error('DB should not be touched by AI summary tests');
      },
    },
  };
}

function ctx() {
  return { waitUntil() {} };
}

async function requestSummary(body, aiRun) {
  return worker.fetch(
    new Request('https://worker.example/api/summarize', {
      method: 'POST',
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.30',
      },
      body: JSON.stringify(body),
    }),
    baseEnv(aiRun),
    ctx(),
  );
}

test('detailed AI summary uses the detailed editorial prompt and a larger article window', async () => {
  let captured;
  const text = '甲'.repeat(5000);
  const response = await requestSummary(
    { text, mode: 'detailed' },
    async (model, options) => {
      captured = { model, options };
      return { response: '詳細撮要' };
    },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.match(captured.options.messages[0].content, /時間線/);
  assert.match(captured.options.messages[0].content, /控方/);
  assert.match(captured.options.messages[0].content, /辯方/);
  assert.equal(captured.options.messages[1].content.length, 5000);
  assert.deepEqual(await response.json(), {
    success: true,
    summary: '詳細撮要',
    mode: 'detailed',
  });
});

test('simple AI summary stays concise and caps the submitted article text', async () => {
  let captured;
  const response = await requestSummary(
    { text: '乙'.repeat(5000), mode: 'simple' },
    async (_model, options) => {
      captured = options;
      return { response: '簡單撮要' };
    },
  );

  assert.equal(response.status, 200);
  assert.match(captured.messages[0].content, /簡潔/);
  assert.equal(captured.messages[1].content.length, 3000);
  assert.deepEqual(await response.json(), {
    success: true,
    summary: '簡單撮要',
    mode: 'simple',
  });
});

test('AI summary rejects an unknown mode before invoking Workers AI', async () => {
  let called = false;
  const response = await requestSummary(
    { text: '新聞內文', mode: 'verbose' },
    async () => {
      called = true;
      return { response: 'unexpected' };
    },
  );

  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'AI 摘要模式無效',
  });
});

test('detailed lifestyle summary asks for article-appropriate sections without empty case headings', async () => {
  let prompt;
  const response = await requestSummary(
    { text: '深圳好去處｜五個景點。教堂免費入場，開放時間9時至17時，地鐵16號線可到達。', mode: 'detailed' },
    async (_model, { messages }) => {
      prompt = messages[0].content;
      return { response: '景點與實用資料' };
    },
  );
  assert.equal(response.status, 200);
  assert.match(prompt, /先判斷文章類型/);
  assert.match(prompt, /旅遊、好去處、美食、優惠/);
  assert.match(prompt, /地址、交通、價錢、開放時間/);
  assert.match(prompt, /不得固定套用案件/);
  assert.match(prompt, /不要寫「無涉及人物」、「沒有時間線」/);
  assert.doesNotMatch(prompt, /優先整理以下內容/);
});
