import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1, seedArticles } from "./helpers/sqlite-d1.mjs";
import entry from "../src/entry.js";
import { APP_ORIGIN } from "../src/security.js";
const s = await import("../src/topic-ai.js").catch(() => ({}));
const store = await import("../src/topic-ai-store.js").catch(() => ({}));
function env(DB, callback) {
  return {
    DB,
    FETCH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI: {
      run:
        callback ||
        (async (_model, { messages }) => {
          const data = JSON.parse(messages[1].content);
          return {
            response: JSON.stringify({
              sections: [
                {
                  heading: "事件概況",
                  items: [
                    {
                      text: "控方指稱，法庭尚未裁定。",
                      sourceIds: [data.articles[0].id],
                    },
                  ],
                },
              ],
            }),
          };
        }),
    },
  };
}
const spec = {
  query: "蔡天鳳案",
  preference: "auto",
  sourceIds: ["bastille", "hk01"],
};
test("cached NONE retains its insufficient status and measurable reason without AI", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  const e = env(db, () => {
    throw new Error("AI must not run");
  });
  const first = await s.getTopicOrganization(e, spec, true);
  assert.equal(first.status, "insufficient");
  assert.equal(first.analysis.reasonCode, "insufficient_articles");
  assert.equal(first.analysis.readableCount, 0);
  assert.equal(
    (await s.getTopicOrganization(e, spec, false)).status,
    "insufficient",
  );
  assert.equal(
    (await s.getTopicOrganization(e, spec, true)).status,
    "insufficient",
  );
});
test("empty POST body streams reach topic organization without invoking AI for CURATION", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  await seedArticles(db, 4, "美食優惠");
  let calls = 0;
  const e = env(db, () => {
    calls++;
    throw new Error("AI must not run");
  });
  for (const body of [
    "",
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array());
        c.close();
      },
    }),
  ]) {
    const request = new Request(
      "https://worker.example/api/topic-ai?q=美食優惠&mode=auto",
      {
        method: "POST",
        headers: { Origin: APP_ORIGIN },
        body,
        duplex: "half",
      },
    );
    assert.ok(request.body, "even an empty POST may have a stream");
    const response = await entry.fetch(request, e, {});
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, "CURATION");
    assert.ok(data.output.sections.length);
  }
  assert.equal(calls, 0);
});
test("nonempty POST is rejected at its first content byte without reading the rest", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array());
      c.enqueue(new TextEncoder().encode('{"text":"custom"}'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(
    "https://worker.example/api/topic-ai?q=案件&mode=off",
    {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Content-Length": "0" },
      body,
      duplex: "half",
    },
  );
  const response = await entry.fetch(
    request,
    env({
      prepare() {
        throw new Error("DB must not run");
      },
    }),
    {},
  );
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.equal((await response.json()).error, "不接受自訂文章或提示詞");
});
test("unreadable POST streams fail closed with JSON before DB or AI", async () => {
  const body = new ReadableStream({
    start(c) {
      c.error(new Error("aborted upload"));
    },
  });
  const request = new Request(
    "https://worker.example/api/topic-ai?q=案件&mode=off",
    {
      method: "POST",
      headers: { Origin: APP_ORIGIN },
      body,
      duplex: "half",
    },
  );
  const response = await entry.fetch(
    request,
    env({
      prepare() {
        throw new Error("DB must not run");
      },
    }),
    {},
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
  assert.equal(request.body.locked, false);
});
test("GET reads cache without search or AI, POST produces a shared sourced snapshot", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  await seedArticles(db);
  let calls = 0;
  const e = env(db, async (_m, { messages }) => {
    calls++;
    const a = JSON.parse(messages[1].content);
    return {
      response: {
        sections: [
          {
            heading: "進展",
            items: [{ text: "案件報道", sourceIds: [a.articles[0].id] }],
          },
        ],
      },
    };
  });
  assert.equal((await s.getTopicOrganization(e, spec, false)).status, "empty");
  assert.equal(calls, 0);
  const first = await s.getTopicOrganization(e, spec, true);
  assert.equal(first.mode, "EVENT");
  assert.equal(first.sources.length, 4);
  assert.equal(calls, 1);
  const second = await s.getTopicOrganization(e, spec, true);
  assert.equal(second.status, "cached");
  assert.equal(calls, 1);
  const read = await s.getTopicOrganization(e, spec, false);
  assert.deepEqual(read.output, first.output);
});
test("NONE and CURATION never invoke AI", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  const e = env(db, () => {
    throw new Error("AI must not run");
  });
  assert.equal((await s.getTopicOrganization(e, spec, true)).mode, "NONE");
  await seedArticles(db, 4, "美食優惠");
  const result = await s.getTopicOrganization(
    e,
    { ...spec, query: "美食優惠" },
    true,
  );
  assert.equal(result.mode, "CURATION");
  assert.ok(result.output.sections[0].items.length);
});
test("new evidence updates incrementally, article corrections rebuild and bad output preserves old cache", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  await seedArticles(db);
  const seen = [];
  const e = env(db, async (_m, { messages }) => {
    const data = JSON.parse(messages[1].content);
    seen.push(data);
    return {
      response: {
        sections: [
          {
            heading: "最新",
            items: [{ text: "控方指稱", sourceIds: [data.articles[0].id] }],
          },
        ],
      },
    };
  });
  await s.getTopicOrganization(e, spec, true);
  await db
    .prepare("UPDATE topic_ai_cache SET checked_at=0,generated_at=0")
    .run();
  await db
    .prepare(
      "INSERT INTO articles SELECT ?,?, ?,pubDate,description,category,source,NULL,NULL FROM articles WHERE id=?",
    )
    .bind(
      "5",
      "蔡天鳳案｜法庭審訊被告證供爭議新說法",
      "https://hk01.com/sns/article/5",
      "1",
    )
    .run();
  const next = await s.getTopicOrganization(e, spec, true);
  assert.deepEqual(
    seen[1].articles.map((a) => a.id),
    ["5"],
  );
  assert.ok(seen[1].previous);
  assert.equal(next.sources.length, 5);
  await db
    .prepare("UPDATE topic_ai_cache SET checked_at=0,generated_at=0")
    .run();
  await db
    .prepare("UPDATE articles SET description='更正報道內容。' WHERE id='1'")
    .run();
  await s.getTopicOrganization(e, spec, true);
  assert.equal(seen[2].previous, null);
  await db
    .prepare("UPDATE topic_ai_cache SET checked_at=0,generated_at=0")
    .run();
  await db
    .prepare("UPDATE articles SET description='再次更正報道。' WHERE id='2'")
    .run();
  e.AI.run = async () => ({
    response: {
      sections: [
        { heading: "錯誤", items: [{ text: "假的", sourceIds: ["unknown"] }] },
      ],
    },
  });
  const failed = await s.getTopicOrganization(e, spec, true);
  assert.equal(failed.status, "error");
  assert.ok(failed.output);
  assert.equal((await s.getTopicOrganization(e, spec, true)).status, "backoff");
});
test("atomic lease rejects concurrent owners and fences superseded writes", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  const repo = store.topicStore(db);
  const now = Date.now();
  assert.equal(await repo.claim("key", spec, "owner1", now), true);
  assert.equal(await repo.claim("key", spec, "owner2", now), false);
  assert.equal(await repo.claim("key", spec, "owner2", now + 120001), true);
  assert.equal(await repo.release("key", "owner1", now), false);
  assert.equal((await repo.read("key")).lease_token, "owner2");
});
test("global hourly and daily reservations are atomic across topics", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  const repo = store.topicStore(db);
  const start = Date.parse("2026-10-03T00:00:00Z");
  for (let h = 0; h < 5; h++) {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.reserveBudget(start + h * 3600000)),
    );
    assert.equal(results.filter(Boolean).length, 8);
  }
  assert.equal(await repo.reserveBudget(start + 5 * 3600000), false);
  assert.equal(await repo.reserveBudget(start + 86400000), true);
});
test("topic route validates origin, parameters, preflight, cache-only GET and off before DB", async () => {
  const DB = {
    prepare() {
      throw new Error("DB must not be used");
    },
  };
  const e = env(DB, () => {
    throw new Error("AI must not run");
  });
  const request = (suffix, method = "GET", origin = APP_ORIGIN) =>
    new Request(`https://worker.example/api/topic-ai${suffix}`, {
      method,
      headers: { Origin: origin },
    });
  assert.equal(
    (
      await entry.fetch(
        request("?q=案件", "POST", "https://evil.example"),
        e,
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (await entry.fetch(request("?q=案件&mode=bad", "POST"), e, {})).status,
    400,
  );
  assert.equal(
    (await entry.fetch(request("?q=案件", "OPTIONS"), e, {})).status,
    204,
  );
  const off = await entry.fetch(request("?q=案件&mode=off", "POST"), e, {});
  assert.equal(off.status, 200);
  assert.equal((await off.json()).mode, "NONE");
});
test("a delayed claimant re-reads the newly published snapshot instead of paying twice", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  await seedArticles(db);
  let resume, notify;
  const reached = new Promise((r) => (notify = r)),
    blocked = new Promise((r) => (resume = r));
  const delayed = {
    withSession() {
      return this;
    },
    batch: db.batch,
    prepare(sql) {
      const stmt = db.prepare(sql);
      if (!sql.startsWith("INSERT INTO topic_ai_cache")) return stmt;
      return {
        ...stmt,
        bind(...params) {
          const bound = stmt.bind(...params);
          return {
            ...bound,
            async run() {
              notify();
              await blocked;
              return bound.run();
            },
          };
        },
      };
    },
  };
  let calls = 0;
  const e = env(db, async (_m, { messages }) => {
    calls++;
    const data = JSON.parse(messages[1].content);
    return {
      response: {
        sections: [
          {
            heading: "進展",
            items: [{ text: "報道", sourceIds: [data.articles[0].id] }],
          },
        ],
      },
    };
  });
  const delayedJob = s.getTopicOrganization({ ...e, DB: delayed }, spec, true);
  await reached;
  await s.getTopicOrganization(e, spec, true);
  resume();
  const final = await delayedJob;
  assert.equal(calls, 1);
  assert.equal(final.status, "cached");
});

test("paid prompts skip title-only rows even when readable matches are farther down the result window", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  await seedArticles(db, 16);
  await db
    .prepare(
      "UPDATE articles SET description='' WHERE CAST(id AS INTEGER) <= 14",
    )
    .run();
  let submitted;
  const e = env(db, async (_m, { messages }) => {
    submitted = JSON.parse(messages[1].content).articles;
    return {
      response: {
        sections: [
          {
            heading: "概況",
            items: [{ text: "報道內容", sourceIds: [submitted[0].id] }],
          },
        ],
      },
    };
  });
  const result = await s.getTopicOrganization(e, spec, true);
  assert.equal(result.status, "ready");
  assert.equal(submitted.length, 2);
  assert.ok(submitted.every((a) => a.text.length >= 80));
});
