import test from "node:test";
import assert from "node:assert/strict";
const p = await import("../src/topic-ai-policy.js").catch(() => ({}));
const now = Date.parse("2026-10-03T12:00:00Z");
const article = (
  id,
  title,
  description = "警方調查發現重要資料，控方指出案中被告涉及爭議，辯方反對指控，法庭仍未裁定。".repeat(
    5,
  ),
  age = 0,
) => ({
  id,
  title,
  description,
  link: `https://hk01.com/sns/article/${id}`,
  source: "香港01",
  category: "local",
  pubDate: new Date(now - age * 86400000).toISOString(),
});
const cases = [
  article("1", "蔡天鳳案｜法庭審訊被告證供爭議"),
  article("2", "蔡天鳳案｜法庭審訊被告證供最新進展"),
  article("3", "蔡天鳳案｜法庭審訊被告證供控方說法"),
  article("4", "蔡天鳳案｜法庭審訊被告證供辯方回應"),
];
test("coherent legal reporting becomes EVENT with traceable principal group", () => {
  const a = p.analyzeTopic("蔡天鳳案", cases, "auto", now);
  assert.equal(a.mode, "EVENT");
  assert.ok(a.cohesion >= 70);
  assert.equal(a.selected.length, 4);
});
test("broad weather and lifestyle keywords override deceptively high cohesion", () => {
  assert.equal(p.analyzeTopic("天氣", cases, "auto", now).mode, "DIGEST");
  assert.equal(p.analyzeTopic("美食優惠", cases, "auto", now).mode, "CURATION");
});
test("sparse, duplicate-only and disabled topics consume no AI", () => {
  assert.equal(
    p.analyzeTopic("案件", cases.slice(0, 2), "auto", now).mode,
    "NONE",
  );
  assert.equal(
    p.analyzeTopic(
      "案件",
      cases.map((a) => ({ ...a, title: "完全相同標題" })),
      "auto",
      now,
    ).mode,
    "NONE",
  );
  assert.equal(p.analyzeTopic("案件", cases, "off", now).mode, "NONE");
});
test("shared query alone cannot turn unrelated reporting into an event", () => {
  const rows = [
    article("1", "香港：荃灣工廠火警"),
    article("2", "香港：足球球隊獲勝"),
    article("3", "香港：樂壇歌手演唱會"),
  ].map((a, i) => ({
    ...a,
    description: [
      "消防救火".repeat(30),
      "球員比賽".repeat(30),
      "樂迷音樂".repeat(30),
    ][i],
  }));
  const a = p.analyzeTopic("香港", rows, "auto", now);
  assert.ok(a.cohesion < 45);
  assert.equal(a.mode, "NONE");
  assert.equal(p.analyzeTopic("香港", rows, "event", now).mode, "NONE");
});
test("digest drops old reports, but event can use historical case evidence", () => {
  const old = cases.map((a) => ({ ...a, pubDate: "2025-01-01T00:00:00Z" }));
  assert.equal(p.analyzeTopic("天氣", old, "auto", now).mode, "NONE");
  assert.equal(p.analyzeTopic("蔡天鳳案", old, "auto", now).mode, "EVENT");
});
test("incremental planner sends only new evidence and rebuilds corrected evidence", async () => {
  const a = await p.prepareEvidence(cases);
  const cache = {
    mode: "EVENT",
    members: a.slice(0, 3).map(({ id, fingerprint }) => ({ id, fingerprint })),
    sources: a.slice(0, 3),
    output: {
      sections: [
        { heading: "最新進展", items: [{ text: "待裁決", sourceIds: ["1"] }] },
      ],
    },
  };
  const delta = p.planEvidence(a, cache, "EVENT");
  assert.equal(delta.rebuild, false);
  assert.deepEqual(
    delta.batch.map((x) => x.id),
    ["4"],
  );
  const changed = await p.prepareEvidence([
    { ...cases[0], description: "新證供更正原報道" },
    ...cases.slice(1),
  ]);
  assert.equal(p.planEvidence(changed, cache, "EVENT").rebuild, true);
});
test("payload remains valid bounded JSON even for huge article identities", async () => {
  const evidence = await p.prepareEvidence(
    cases.map((a) => ({
      ...a,
      title: "甲".repeat(10000),
      description: "乙".repeat(10000),
    })),
  );
  const payload = p.buildTopicInput("EVENT", "案件", evidence, null);
  assert.ok(payload.length <= 22000);
  assert.equal(JSON.parse(payload).articles.length, 4);
});
test("output rejects unknown or absent references and never accepts model supplied URLs", () => {
  const sources = [{ id: "1" }];
  const output = {
    sections: [
      {
        heading: "事件概況",
        items: [
          { text: "控方指稱", sourceIds: ["1"], url: "javascript:alert(1)" },
        ],
      },
    ],
  };
  assert.deepEqual(
    p.validateTopicOutput(output, sources).sections[0].items[0],
    { text: "控方指稱", sourceIds: ["1"] },
  );
  assert.throws(() =>
    p.validateTopicOutput(
      {
        sections: [
          { heading: "事件", items: [{ text: "假資料", sourceIds: ["999"] }] },
        ],
      },
      sources,
    ),
  );
  assert.throws(() =>
    p.validateTopicOutput(
      {
        sections: [
          { heading: "事件", items: [{ text: "未引來源", sourceIds: [] }] },
        ],
      },
      sources,
    ),
  );
});
test("EVENT requires readable evidence inside its selected principal group", () => {
  const principal = cases.map((a, i) => ({
    ...a,
    title: `蔡天鳳案｜法庭審訊被告證供爭議原文 ${i}`,
    description: "",
  }));
  const side = [
    article("8", "足球球隊球員進球比賽"),
    article("9", "樂壇音樂歌手演唱會"),
  ];
  assert.equal(
    p.analyzeTopic("蔡天鳳案", [...principal, ...side], "auto", now).mode,
    "NONE",
  );
});
test("EVENT rebuilds when an old event leaves the selected principal group", async () => {
  const old = await p.prepareEvidence(cases.slice(0, 3));
  const previous = {
    mode: "EVENT",
    members: old.map(({ id, fingerprint }) => ({ id, fingerprint })),
    sources: old,
    output: {
      sections: [
        { heading: "案件", items: [{ text: "舊案情", sourceIds: ["1"] }] },
      ],
    },
  };
  const current = await p.prepareEvidence(
    cases.slice(0, 3).map((a, i) => ({
      ...a,
      id: String(i + 10),
      link: `https://hk01.com/sns/article/${i + 10}`,
      title: `劫案｜警方拘捕嫌疑男子調查 ${i}`,
    })),
  );
  assert.equal(p.planEvidence(current, previous, "EVENT").rebuild, true);
});
test("CURATION displays all retained evidence instead of silently hiding items after eight", async () => {
  const evidence = await p.prepareEvidence(
    Array.from({ length: 20 }, (_, i) =>
      article(String(i + 1), `餐廳美食推介 ${i}`),
    ),
  );
  const output = p.curateEvidence(evidence);
  assert.equal(
    output.sections.reduce((sum, s) => sum + s.items.length, 0),
    20,
  );
  assert.ok(output.sections.some((s) => s.heading === "餐廳與美食"));
});

test("low cohesion DIGEST needs readable subgroups rather than title-only clusters", () => {
  const clusters = [
    article("1", "香港｜足球球隊聯賽進球甲", ""),
    article("2", "香港｜足球球隊聯賽進球乙", ""),
    article("3", "香港｜樂壇歌手音樂演唱會甲", ""),
    article("4", "香港｜樂壇歌手音樂演唱會乙", ""),
  ];
  const singletons = [
    "工廠火警消防",
    "天文台強風雷暴",
    "地鐵工程隧道",
    "樓市成交價格",
    "花卉展覽公園",
    "醫院手術病人",
    "學校課程學生",
    "巴士車費調整",
    "銀行利率存款",
    "漁船碼頭海港",
  ].map((title, i) => article(String(i + 5), `香港｜${title}`));
  const a = p.analyzeTopic("香港", [...clusters, ...singletons], "auto", now);
  assert.ok(a.cohesion < 45);
  assert.equal(a.mode, "NONE");
  const readable = clusters.map((a) => ({
    ...a,
    description: "足夠的原文內容。".repeat(20),
  }));
  assert.equal(
    p.analyzeTopic("香港", [...readable, ...singletons], "auto", now).mode,
    "DIGEST",
  );
});
