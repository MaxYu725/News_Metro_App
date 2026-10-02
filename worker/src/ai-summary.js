import {
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  rateLimitKey,
} from './security.js';

const AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const SIMPLE_TEXT_LIMIT = 3000;
const DETAILED_TEXT_LIMIT = 12000;
const REQUEST_BODY_LIMIT = 60000;

const SIMPLE_PROMPT = `你是一個專業新聞編輯。請只根據提供的新聞內文，以香港繁體中文製作簡潔的新聞撮要。
重點交代事件核心、最新進展、主要人物及重要數據；避免重複原文細節。
一般以 1 至 3 段短文或少量列點完成。直接輸出撮要，不要加入「以下是摘要」等導言、結尾或客套話，不要補充原文沒有的資料。`;

const DETAILED_PROMPT = `你是一個資深新聞編輯。請只根據提供的新聞內文，以香港繁體中文製作詳細撮要，目標是讓原本不熟悉事件的讀者也能理解完整脈絡。

按原文實際提供的資訊，優先整理以下內容；沒有資料的項目直接省略，不要為了填滿格式而推測：
事件核心、背景／前因、涉及人物及彼此關係、重要時間線、關鍵證供／數據／各方說法、控罪或爭議焦點、最新進展、仍未確定或有待釐清事項。

如屬法庭、刑事或爭議性新聞，必須清楚區分控方指稱、辯方說法、證人證供、法庭已確認的事實及已作出的裁決；不得把指控、推測或單方面說法寫成既定事實。

保留對理解事件有幫助的姓名、身份、日期、金額、地點、控罪及重要因果關係。不得加入新聞內文以外的背景知識或自行推斷。
直接輸出撮要內容。可使用純文字小標題及列點，但不要使用 Markdown 符號，不要加入導言、結語或客套話。`;

function jsonResponse(request, payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

async function guardAISummaryRequest(request, env) {
  if (!isTrustedAppRequest(request)) {
    return jsonResponse(request, { success: false, error: '禁止的請求來源' }, 403);
  }

  const allowed = await consumeRateLimit(
    env.AI_RATE_LIMITER,
    rateLimitKey(request, 'summarize'),
  );
  if (!allowed) {
    return jsonResponse(
      request,
      { success: false, error: '請求過於頻密，請稍後再試' },
      429,
      { 'Retry-After': '60' },
    );
  }

  return null;
}

export async function handleAISummaryRequest(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse(request, { success: false, error: '不支援的請求方法' }, 405, { Allow: 'POST' });
  }

  const guard = await guardAISummaryRequest(request, env);
  if (guard) return guard;

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonResponse(request, { success: false, error: '只接受 JSON 請求' }, 415);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > REQUEST_BODY_LIMIT) {
    return jsonResponse(request, { success: false, error: '新聞內文過長' }, 413);
  }

  try {
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const mode = body?.mode == null ? 'simple' : String(body.mode).trim().toLowerCase();

    if (!text) {
      return jsonResponse(request, { success: false, error: '缺少新聞內文' }, 400);
    }
    if (!['simple', 'detailed'].includes(mode)) {
      return jsonResponse(request, { success: false, error: 'AI 摘要模式無效' }, 400);
    }

    const limit = mode === 'detailed' ? DETAILED_TEXT_LIMIT : SIMPLE_TEXT_LIMIT;
    const prompt = mode === 'detailed' ? DETAILED_PROMPT : SIMPLE_PROMPT;
    const articleText = text.substring(0, limit);

    const aiResponse = await env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: articleText },
      ],
    });

    return jsonResponse(request, {
      success: true,
      summary: aiResponse.response,
      mode,
    });
  } catch {
    return jsonResponse(request, { success: false, error: 'AI 摘要服務暫時無法回應' }, 500);
  }
}

export const AI_SUMMARY_LIMITS = Object.freeze({
  simple: SIMPLE_TEXT_LIMIT,
  detailed: DETAILED_TEXT_LIMIT,
});
