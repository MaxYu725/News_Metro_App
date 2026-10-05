import { articleTextFromHtml } from "./article-content.js";
import { parseAllowedArticleUrl } from "./security.js";

export const TOPIC_POLICY_VERSION = "topic-v3";
export const TOPIC_LIMITS = Object.freeze({
  candidates: 60,
  initial: 12,
  delta: 6,
  sources: 60,
  input: 22000,
  metadataTTL: 300000,
  lease: 120000,
  backoff: 900000,
});
const BROAD = /天氣|天文台|熱話|新聞|weather|trending/i;
const CURATION =
  /好去處|美食|優惠|折扣|餐廳|食譜|旅遊|購物|景點|酒店|放題|自助餐|discount|food|travel/i;
const STOP = new Set([
  "香港",
  "最新",
  "新聞",
  "報道",
  "表示",
  "指出",
  "今日",
  "昨日",
  "有關",
  "事件",
  "消息",
  "進展",
  "the",
  "and",
  "with",
  "from",
]);
const clean = (value) =>
  articleTextFromHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
export const normalizeTopicQuery = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
export async function hashTopic(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function tokens(text, query) {
  const excluded = new Set();
  const pieces = query.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) || [];
  for (const s of pieces)
    for (let i = 0; i < s.length - 1; i++) excluded.add(s.slice(i, i + 2));
  const result = new Set();
  for (const part of text
    .toLowerCase()
    .replaceAll(query, " ")
    .match(/[\p{Script=Han}]+|[a-z0-9]{3,}/gu) || []) {
    if (/^[a-z0-9]+$/.test(part)) {
      if (!STOP.has(part)) result.add(part);
      continue;
    }
    for (let i = 0; i < part.length - 1; i++) {
      const t = part.slice(i, i + 2);
      if (!STOP.has(t) && !excluded.has(t)) result.add(t);
    }
  }
  return result;
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / Math.max(a.size, b.size);
}
function namedCaseAnchor(query) {
  const candidate = query.endsWith("案") ? query : `${query}案`;
  // A specific case label is a subject identity, not repeated headline wording.
  // Broad crimes and legislative/proposal topics must still use normal grouping.
  if (!/^(?:[\p{Script=Han}]{3,17}|[a-z][a-z0-9-]{2,24})案$/u.test(candidate))
    return "";
  if (
    /^(?:香港|中國|中国|澳門|澳门|台灣|台湾|美國|美国|英國|英国|日本|韓國|韩国|全球|本港|本地|跨境)/u.test(
      candidate,
    )
  )
    return "";
  if (
    /命案|兇案|凶案|劫案|騙案|奸案|姦案|綁架案|绑架案|欺詐案|失蹤案|非法集結案|罪案|懸案|刑事案|民事案|兇殺案|凶殺案|盜竊案|殺人案|謀殺案|詐騙案|洗黑錢案|洗錢案|貪污案|賄賂案|走私案|販毒案|毒品案|交通意外案|車禍案|性侵案|性罪行案|傷人案|襲擊案|虐兒案|家庭暴力案|縱火案|勒索案|搶劫案|爆竊案|報案|立案|備案|教案|檔案|法案|草案|方案|提案|議案|預算案/.test(
      candidate,
    )
  )
    return "";
  return candidate;
}
export function analyzeTopic(
  query,
  input,
  preference = "auto",
  now = Date.now(),
) {
  const q = normalizeTopicQuery(query);
  let intent =
    preference === "digest"
      ? "DIGEST"
      : preference === "event"
        ? "EVENT"
        : CURATION.test(q)
          ? "CURATION"
          : BROAD.test(q)
            ? "DIGEST"
            : "";
  const windowDays = intent === "CURATION" ? 30 : intent === "DIGEST" ? 14 : 0;
  const seenLinks = new Set(),
    seenTitles = new Set();
  const rows = [];
  for (const a of input || []) {
    const link = parseAllowedArticleUrl(a?.link)?.toString();
    const title = clean(a?.title).slice(0, 240),
      key = title.toLowerCase().replace(/[\s\p{P}]/gu, "");
    const date = Date.parse(a?.pubDate);
    if (!link || !title || !a?.id || seenLinks.has(link) || seenTitles.has(key))
      continue;
    if (
      windowDays &&
      (!Number.isFinite(date) ||
        date < now - windowDays * 86400000 ||
        date > now + 86400000)
    )
      continue;
    seenLinks.add(link);
    seenTitles.add(key);
    rows.push({ ...a, link, title, description: clean(a.description) });
    if (rows.length === TOPIC_LIMITS.candidates) break;
  }
  const features = rows.map((a) => tokens(a.title, q));
  const anchor = namedCaseAnchor(q);
  const anchored = rows.map((a) =>
    Boolean(anchor && normalizeTopicQuery(a.title).startsWith(anchor)),
  );
  const pairSimilarity = (i, j) => {
    if (anchor && (anchored[i] || anchored[j]))
      return anchored[i] && anchored[j] ? 1 : 0;
    return similarity(features[i], features[j]);
  };
  const groups = [];
  for (let i = 0; i < rows.length; i++) {
    let target = null,
      best = 0.28;
    for (const g of groups) {
      const s = pairSimilarity(i, g.indices[0]);
      if (s >= best) {
        best = s;
        target = g;
      }
    }
    if (target) target.indices.push(i);
    else groups.push({ indices: [i] });
  }
  groups.sort((a, b) => b.indices.length - a.indices.length);
  const principal = groups[0]?.indices || [];
  const density =
    principal.length > 1
      ? principal
          .slice(1)
          .reduce((sum, i) => sum + pairSimilarity(i, principal[0]), 0) /
        (principal.length - 1)
      : 0;
  const cohesion = rows.length
    ? Math.round((60 * principal.length) / rows.length + 40 * density)
    : 0;
  const readable = rows.filter((a) => a.description.length >= 80).length;
  const principalReadable = principal.filter(
    (i) => rows[i].description.length >= 80,
  ).length;
  let mode = "NONE",
    reason = "資料不足",
    reasonCode =
      rows.length < 3 ? "insufficient_articles" : "insufficient_text";
  if (preference === "off") {
    reason = "已關閉";
    reasonCode = "off";
  } else if (rows.length >= 3 && readable >= 2) {
    if (intent === "CURATION" || intent === "DIGEST") mode = intent;
    else if (principal.length >= 3 && cohesion >= 70)
      mode = principalReadable >= 2 ? "EVENT" : "NONE";
    else if (
      preference !== "event" &&
      (cohesion >= 45 ||
        groups.filter(
          (g) =>
            g.indices.filter((i) => rows[i].description.length >= 80).length >=
            2,
        ).length >= 2)
    )
      mode = "DIGEST";
    reason = mode === "NONE" ? "文章過於分散" : "metadata 分群";
    reasonCode =
      mode !== "NONE"
        ? "classified"
        : principal.length >= 3 && cohesion >= 70
          ? "insufficient_event_text"
          : preference === "event"
            ? "low_cohesion"
            : "scattered";
  }
  // A discovered digest also gets a recent-only window, even without broad keyword hints.
  if (mode === "DIGEST" && !windowDays)
    return analyzeTopic(query, rows, "digest", now);
  const selected = mode === "EVENT" ? principal.map((i) => rows[i]) : rows;
  return {
    mode,
    cohesion,
    reason,
    reasonCode,
    readableCount: readable,
    principalCount: principal.length,
    principalReadableCount: principalReadable,
    eventAnchor: anchored[principal[0]] ? anchor : null,
    windowDays: mode === "DIGEST" ? 14 : windowDays,
    count: rows.length,
    selected,
    groups: groups.map((g) => ({
      label: rows[g.indices[0]].category || "其他",
      ids: g.indices.map((i) => String(rows[i].id)),
    })),
  };
}
export async function prepareEvidence(rows) {
  return Promise.all(
    rows.map(async (a) => ({
      id: String(a.id),
      title: clean(a.title).slice(0, 240),
      link: String(a.link),
      source: String(a.source || "").slice(0, 50),
      pubDate: String(a.pubDate || "").slice(0, 40),
      category: String(a.category || "").slice(0, 40),
      text: clean(a.description).slice(0, 900),
      fingerprint: await hashTopic(
        JSON.stringify([a.title, a.description, a.pubDate, a.link]),
      ),
    })),
  );
}
export function planEvidence(evidence, previous, mode) {
  const members = previous?.members || [];
  const known = new Map(members.map((a) => [a.id, a.fingerprint]));
  const current = new Map(evidence.map((a) => [a.id, a.fingerprint]));
  const corrected = evidence.some(
    (a) => known.has(a.id) && known.get(a.id) !== a.fingerprint,
  );
  const expired = members.some((a) => !current.has(a.id));
  const delta = evidence.filter((a) => known.get(a.id) !== a.fingerprint);
  const rebuild =
    !previous?.output ||
    previous.mode !== mode ||
    corrected ||
    expired ||
    members.length + delta.length > TOPIC_LIMITS.sources;
  const batch = (rebuild ? evidence : delta).slice(
    0,
    rebuild ? TOPIC_LIMITS.initial : TOPIC_LIMITS.delta,
  );
  return {
    rebuild,
    batch,
    pending: Math.max(0, (rebuild ? evidence : delta).length - batch.length),
  };
}
export function buildTopicInput(mode, query, batch, previous) {
  const input = {
    mode,
    query: String(query).slice(0, 100),
    previous: previous?.output ? structuredClone(previous.output) : null,
    knownSources: (previous?.sources || []).map(({ id, title, pubDate }) => ({
      id,
      title,
      pubDate,
    })),
    articles: batch.map(({ id, title, source, pubDate, text, category }) => ({
      id,
      title,
      source,
      pubDate,
      text,
      category,
    })),
  };
  // Drop complete historical sections, never slice serialized JSON.
  while (
    JSON.stringify(input).length > TOPIC_LIMITS.input &&
    input.previous?.sections?.length
  )
    input.previous.sections.pop();
  if (JSON.stringify(input).length > TOPIC_LIMITS.input)
    throw new Error("topic input exceeds limit");
  return JSON.stringify(input);
}
export function validateTopicOutput(raw, sources) {
  const value =
    typeof raw === "string"
      ? JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""))
      : raw;
  if (
    !value ||
    !Array.isArray(value.sections) ||
    value.sections.length < 1 ||
    value.sections.length > 8
  )
    throw new Error("invalid sections");
  const ids = new Set(sources.map((s) => s.id));
  const sections = value.sections.map((section) => {
    if (
      typeof section.heading !== "string" ||
      !section.heading.trim() ||
      section.heading.length > 60 ||
      !Array.isArray(section.items) ||
      !section.items.length ||
      section.items.length > 8
    )
      throw new Error("invalid section");
    return {
      heading: section.heading.trim(),
      items: section.items.map((item) => {
        if (
          typeof item.text !== "string" ||
          !item.text.trim() ||
          item.text.length > 600 ||
          !Array.isArray(item.sourceIds) ||
          !item.sourceIds.length ||
          item.sourceIds.length > 8 ||
          item.sourceIds.some((id) => typeof id !== "string" || !ids.has(id))
        )
          throw new Error("invalid source evidence");
        return {
          text: item.text.trim(),
          sourceIds: [...new Set(item.sourceIds)],
        };
      }),
    };
  });
  if (JSON.stringify(sections).length > 8000)
    throw new Error("output too large");
  return { sections };
}
export function curateEvidence(evidence) {
  const categories = new Map();
  for (const a of evidence) {
    const label = /優惠|折扣|減價|免費|買一送一|特價/.test(a.title)
      ? "折扣與優惠"
      : /餐廳|美食|咖啡|甜品|放題|自助餐|小食/.test(a.title)
        ? "餐廳與美食"
        : /展覽|活動|演出|市集/.test(a.title)
          ? "展覽與活動"
          : /行山|公園|海灘|戶外|景點/.test(a.title)
            ? "戶外與景點"
            : /酒店|旅遊|旅行|機票|住宿/.test(a.title)
              ? "住宿與旅行"
              : "其他精選";
    if (!categories.has(label)) categories.set(label, []);
    categories.get(label).push({ text: a.title, sourceIds: [a.id] });
  }
  return {
    sections: [...categories]
      .slice(0, 8)
      .map(([heading, items]) => ({ heading, items })),
  };
}
