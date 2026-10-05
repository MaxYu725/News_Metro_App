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
test("a named case remains one event across different reporting angles and stages", () => {
  const rows = [
    "蔡天鳳案．開案｜案發當日三父子分頭行事",
    "蔡天鳳案｜租村屋後買碎肉機",
    "蔡天鳳案｜失蹤前帶人睇樓",
    "蔡天鳳案陪審團法官宣布重新遴選",
    "蔡天鳳案｜審前法律爭辯",
    "蔡天鳳案｜控方指金錢糾紛",
    "蔡天鳳案｜現場電鋸聲及氣味",
  ].map((title, i) => article(String(i + 1), title, undefined, i * 100));
  const incidental = article(
    "20",
    "海洋公園鬼屋爭議",
    "影射蔡天鳳案。".repeat(20),
  );
  for (const query of ["蔡天鳳案", "蔡天鳳"]) {
    for (const preference of ["auto", "event"]) {
      const a = p.analyzeTopic(query, [...rows, incidental], preference, now);
      assert.equal(a.mode, "EVENT");
      assert.ok(a.cohesion >= 70);
      assert.deepEqual(
        a.selected.map((r) => r.id),
        rows.map((r) => r.id),
      );
      assert.equal(a.eventAnchor, "蔡天鳳案");
    }
  }
});
test("generic crime and proposal prefixes are not treated as specific case identities", () => {
  for (const query of [
    "香港命案",
    "香港罪案",
    "香港懸案",
    "香港綁架案",
    "香港強姦案",
    "香港欺詐案",
    "香港失蹤案",
    "香港非法集結案",
    "香港洗黑錢案",
    "香港貪污案",
    "交通意外案",
    "跨境走私案",
    "公共方案",
    "國安法案",
  ]) {
    const rows = [
      "工廠火警消防救援",
      "球員聯賽足球比賽",
      "樂壇歌手音樂演唱會",
    ].map((tail, i) => article(String(i + 1), `${query}｜${tail}`));
    assert.equal(p.analyzeTopic(query, rows, "event", now).mode, "NONE");
  }
});
test("insufficient analysis distinguishes article count, readable text and event grouping", () => {
  assert.equal(
    p.analyzeTopic("案件", cases.slice(0, 2), "event", now).reasonCode,
    "insufficient_articles",
  );
  assert.equal(
    p.analyzeTopic(
      "蔡天鳳案",
      cases.map((a) => ({ ...a, description: "" })),
      "event",
      now,
    ).reasonCode,
    "insufficient_text",
  );
  const rows = ["火警消防救援", "足球球隊比賽", "歌手音樂演唱會"].map(
    (title, i) => article(String(i + 1), title),
  );
  const a = p.analyzeTopic("香港", rows, "event", now);
  assert.equal(a.reasonCode, "low_cohesion");
  assert.equal(a.readableCount, 3);
  assert.equal(a.principalCount, 1);
});
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

test("readable incidental coverage cannot satisfy the principal event text gate", () => {
  const rows = cases.slice(0, 3).map((a) => ({ ...a, description: "" }));
  rows.push(article("10", "海洋公園鬼屋爭議"), article("11", "網上影片熱話"));
  const a = p.analyzeTopic("蔡天鳳案", rows, "event", now);
  assert.equal(a.mode, "NONE");
  assert.equal(a.reasonCode, "insufficient_event_text");
  assert.equal(a.readableCount, 2);
  assert.equal(a.principalReadableCount, 0);
});
test('model citations use short aliases and restore exact long IDs across incremental updates', () => {
  const id='archive:https://hk01.com/'+encodeURIComponent('蔡天鳳案長網址'.repeat(15));
  const sources=[{id,title:'舊新聞',pubDate:'2026-10-01'},{id:'new',title:'新新聞',pubDate:'2026-10-02'}];
  const aliases=p.topicSourceAliases(sources);
  const previous={sources:[sources[0]],output:{sections:[{heading:'概況',items:[{text:'舊內容',sourceIds:[id]}]}]}};
  const input=JSON.parse(p.buildTopicInput('EVENT','蔡天鳳案',[{...sources[1],text:'節錄'}],previous,aliases));
  assert.equal(input.articles[0].id,'S2');
  assert.equal(input.knownSources[0].id,'S1');
  assert.deepEqual(input.previous.sections[0].items[0].sourceIds,['S1']);
  assert.deepEqual(previous.output.sections[0].items[0].sourceIds,[id]);
  assert.ok(!JSON.stringify(input).includes(id));
  const raw={sections:[{heading:'概況',items:[{text:'有來源',sourceIds:['S1','S2']}]}]};
  const output=p.validateTopicOutput(raw,sources,aliases);
  assert.deepEqual(output.sections[0].items[0].sourceIds,[id,'new']);
  assert.deepEqual(raw.sections[0].items[0].sourceIds,['S1','S2']);
  for(const bad of ['S3',id])assert.throws(()=>p.validateTopicOutput({sections:[{heading:'概況',items:[{text:'來源錯誤',sourceIds:[bad]}]}]},sources,aliases),/invalid source evidence/);
});
test('restoring URL IDs does not spend the model content budget but stored output remains bounded',()=>{
  const id='archive:'+ 'x'.repeat(500), sources=[{id}], aliases=p.topicSourceAliases(sources);
  const raw={sections:[1,2,3].map(n=>({heading:'重點'+n,items:Array.from({length:8},()=>({text:'有來源的重點',sourceIds:['S1']}))}))};
  const output=p.validateTopicOutput(raw,sources,aliases);
  assert.ok(JSON.stringify(output).length>8000);
  assert.deepEqual(output.sections[0].items[0].sourceIds,[id]);
  const huge='x'.repeat(4000);
  assert.throws(()=>p.validateTopicOutput(raw,[{id:huge}],p.topicSourceAliases([{id:huge}])),/output too large/);
});
