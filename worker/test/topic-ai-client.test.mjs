import test from "node:test";
import assert from "node:assert/strict";
const ui = await import("../../topic-ai-client.mjs").catch(() => ({}));
function memory() {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
  };
}
const snapshot = (title) => ({
  success: true,
  status: "ready",
  mode: "EVENT",
  generatedAt: 1,
  output: {
    sections: [{ heading: "概況", items: [{ text: title, sourceIds: ["1"] }] }],
  },
  sources: [{ id: "1", title: "來源", link: "https://hk01.com/sns/article/1" }],
});
test("opening a topic only reads cache; generating requires explicit POST", async () => {
  const methods = [],
    states = [];
  const c = ui.createTopicAIController({
    fetch: async (_url, { method }) => {
      methods.push(method);
      return { ok: true, json: async () => snapshot("內容") };
    },
    storage: memory(),
    onChange: (s) => states.push(s),
  });
  await c.open({ query: "案件", aiMode: "auto" }, ["hk01"]);
  assert.deepEqual(methods, ["GET"]);
  await c.generate();
  assert.deepEqual(methods, ["GET", "POST"]);
  assert.equal(states.at(-1).result.output.sections[0].items[0].text, "內容");
});
test("responses for abandoned topics cannot change panel or persist wrong topic data", async () => {
  let finish;
  const states = [];
  const c = ui.createTopicAIController({
    fetch: (url) =>
      url.includes("q=A")
        ? new Promise(
            (r) =>
              (finish = () => r({ ok: true, json: async () => snapshot("A") })),
          )
        : Promise.resolve({ ok: true, json: async () => snapshot("B") }),
    storage: memory(),
    onChange: (s) => states.push(s),
  });
  const a = c.open({ query: "A" }, ["hk01"]);
  await c.open({ query: "B" }, ["hk01"]);
  finish();
  await a;
  assert.equal(states.at(-1).query, "B");
  assert.equal(states.at(-1).result.output.sections[0].items[0].text, "B");
});
test("offline fallback keeps last successful snapshot with offline status", async () => {
  const storage = memory();
  let offline = false,
    last;
  const c = ui.createTopicAIController({
    storage,
    onChange: (s) => (last = s),
    fetch: async () => {
      if (offline) throw new Error("offline");
      return { ok: true, json: async () => snapshot("記錄") };
    },
  });
  await c.open({ query: "案件" }, ["hk01"]);
  c.close();
  offline = true;
  await c.open({ query: "案件" }, ["hk01"]);
  assert.equal(last.result.status, "offline");
  assert.equal(last.result.output.sections[0].items[0].text, "記錄");
});
test("off makes no network request; source selection separates local snapshots", async () => {
  let calls = 0,
    last;
  const c = ui.createTopicAIController({
    storage: memory(),
    onChange: (s) => (last = s),
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => snapshot("內容") };
    },
  });
  await c.open({ query: "案件", aiMode: "off" }, ["hk01"]);
  await c.generate();
  assert.equal(calls, 0);
  assert.equal(last.result.status, "off");
  await c.open({ query: "案件" }, ["hk01"]);
  assert.equal(calls, 1);
  await c.open({ query: "案件" }, ["bastille"]);
  assert.equal(calls, 2);
});
test("safe source links reject javascript, external hosts and hostname tricks", () => {
  assert.equal(ui.safeTopicSourceLink("javascript:alert(1)"), null);
  assert.equal(ui.safeTopicSourceLink("https://evil.example"), null);
  assert.equal(ui.safeTopicSourceLink("https://hk01.com.evil.example"), null);
  assert.equal(
    ui.safeTopicSourceLink("https://hk01.com/sns/article/1"),
    "https://hk01.com/sns/article/1",
  );
});
test("an abandoned request timeout cannot abort the next topic request", async () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout,
    timers = [];
  globalThis.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  globalThis.clearTimeout = () => {};
  try {
    let finishA, finishB, signalB;
    const c = ui.createTopicAIController({
      storage: memory(),
      onChange: () => {},
      fetch: (url, { signal }) =>
        new Promise((r) => {
          if (url.includes("q=A"))
            finishA = () => r({ ok: true, json: async () => snapshot("A") });
          else {
            signalB = signal;
            finishB = () => r({ ok: true, json: async () => snapshot("B") });
          }
        }),
    });
    const a = c.open({ query: "A" }, ["hk01"]);
    const b = c.open({ query: "B" }, ["hk01"]);
    timers[0]();
    assert.equal(signalB.aborted, false);
    finishA();
    finishB();
    await Promise.all([a, b]);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test("an undeployed route is unavailable rather than offline, even with a non-JSON 404", async () => {
  let last,
    unavailable = false;
  const c = ui.createTopicAIController({
    storage: memory(),
    onChange: (s) => (last = s),
    fetch: async () =>
      unavailable
        ? new Response("Not Found", { status: 404 })
        : new Response(JSON.stringify(snapshot("已有內容")), { status: 200 }),
  });
  await c.open({ query: "深圳好去處" }, ["hk01"]);
  unavailable = true;
  await c.generate();
  assert.equal(last.result.status, "unavailable");
  assert.equal(last.result.output.sections[0].items[0].text, "已有內容");
});

test("HTTP failures keep cached content and distinguish rate limits from service failures", async () => {
  for (const [code, status] of [
    [429, "rate_limited"],
    [500, "service_error"],
    [503, "unavailable"],
  ]) {
    let last;
    const c = ui.createTopicAIController({
      storage: memory(),
      onChange: (s) => (last = s),
      fetch: async () =>
        new Response(JSON.stringify({ success: false, error: "服務錯誤" }), {
          status: code,
        }),
    });
    await c.open({ query: "深圳好去處" }, ["hk01"]);
    assert.equal(last.result.status, status);
  }
});
