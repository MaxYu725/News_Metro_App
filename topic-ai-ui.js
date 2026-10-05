import { LocalDB } from "./utils.js";
import { getTrackedAIMode, setTrackedAIMode } from "./tracking.js";
import {
  createTopicAIController,
  TOPIC_AI_MODES,
  safeTopicSourceLink,
  topicInsufficientMessage,
  topicFailureMessage,
} from "./topic-ai-client.mjs";
let panel = null,
  category = null,
  retryTimer = null;
const labels = {
  EVENT: "事件追蹤",
  DIGEST: "主題摘要",
  CURATION: "分類精選",
  NONE: "暫未整理",
};
const messages = {
  empty: "按「整理」查看這個主題的重點。",
  off: "已關閉主題整理。",
  insufficient: "相關資料不足或過於分散，暫不進行 AI 整理。",
  busy: "正在整理，稍後按更新查看結果。",
  budget: "整理服務本時段的額度已用完，稍後再試。",
  backoff: "上次整理未能完成，稍後再試。",
  offline: "未能連接服務，顯示本機保存的結果。",
  unavailable: "整理服務暫時未能提供，請稍後再試。",
  rate_limited: "請求過於頻密，請稍後再試。",
  service_error: "整理服務暫時出現問題，請稍後再試。",
  cooldown: "已保留最近的整理；稍後可再檢查更新。",
  unchanged: "資料沒有改變，沿用現有整理。",
  cached: "已載入上次整理。",
  ready: "整理已更新。",
};
const controller = createTopicAIController({ onChange: render });
function element(tag, text, className = "") {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
}
function render(state) {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!panel || panel.hidden) return;
  const result = state.result || {},
    output = result.output,
    analysis = result.analysis;
  if (result.nextUpdateAt > Date.now()) {
    retryTimer = setTimeout(
      () => render(state),
      Math.min(result.nextUpdateAt - Date.now() + 50, 2147483647),
    );
  }
  const mode = state.mode === "off" ? "NONE" : result.mode;
  const header = element("div", "", "topic-ai-header");
  const title = element(
    "h2",
    `${mode === "CURATION" ? "分類精選" : "✦ 主題整理"} · ${state.query}`,
  );
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${state.query} 的整理模式`);
  for (const [value, label] of TOPIC_AI_MODES) {
    const option = element("option", label);
    option.value = value;
    select.append(option);
  }
  select.value = state.mode;
  select.disabled = state.loading;
  select.addEventListener("change", () => {
    if (category) setTrackedAIMode(category.id, select.value);
  });
  header.append(title, select);
  const meta = element("p", labels[mode] || "主題整理", "topic-ai-meta");
  if (result.generatedAt)
    meta.textContent += ` · ${new Date(result.generatedAt).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  if (analysis && mode !== "NONE") {
    meta.textContent += ` · 涵蓋 ${analysis.covered ?? result.sources?.length ?? 0} 篇`;
    if (analysis.pending) meta.textContent += ` · ${analysis.pending} 篇待整理`;
    if (analysis.windowDays)
      meta.textContent += ` · 近 ${analysis.windowDays} 日`;
  }
  if (analysis && mode === "NONE" && state.mode !== "off") {
    meta.textContent += ` · 本次 ${analysis.count ?? 0} 篇`;
    if (Number.isFinite(analysis.readableCount))
      meta.textContent += ` · 可讀節錄 ${analysis.readableCount} 篇`;
  }
  const status = element(
    "p",
    state.loading
      ? "正在讀取／整理…"
      : result.status === "insufficient"
        ? topicInsufficientMessage(analysis)
        : result.status === "error"
          ? topicFailureMessage(output)
        : result.status === "offline" && !output
          ? "未能連接服務，暫無可用的整理結果。"
          : messages[result.status] || "",
    "topic-ai-status",
  );
  status.setAttribute("role", "status");
  if (result.nextUpdateAt > Date.now())
    status.textContent += `（${new Date(result.nextUpdateAt).toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" })} 後可再試）`;
  const button = element(
    "button",
    output ? "檢查更新" : "整理",
    "topic-ai-generate",
  );
  button.type = "button";
  button.disabled =
    state.loading || state.mode === "off" || result.nextUpdateAt > Date.now();
  button.addEventListener("click", () => controller.generate());
  const nodes = [header, meta, status];
  if (output?.sections?.length && state.mode !== "off") {
    const details = document.createElement("details");
    details.className = "topic-ai-content";
    details.open = true;
    details.append(element("summary", "查看整理及來源"));
    const sources = new Map(
      (result.sources || []).map((source) => [source.id, source]),
    );
    for (const section of output.sections) {
      details.append(element("h3", section.heading));
      const list = document.createElement("ul");
      for (const item of section.items || []) {
        const li = element("li", item.text);
        const references = element("div", "", "topic-ai-sources");
        for (const id of item.sourceIds || []) {
          const source = sources.get(id),
            href = safeTopicSourceLink(source?.link);
          if (!href) continue;
          const link = element(
            "a",
            `${source.source || "來源"} · ${source.title || "原文"}`,
          );
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          references.append(link);
        }
        li.append(references);
        list.append(li);
      }
      details.append(list);
    }
    nodes.push(details);
  }
  if (state.mode !== "off") {
    nodes.push(
      element(
        "p",
        mode === "CURATION"
          ? "按已有新聞分類及去重；優惠內容和期限請查原文。"
          : "根據已存新聞節錄整理，並非完整報道。只在按整理／更新時處理，重點可按來源回查原文。",
        "topic-ai-note",
      ),
    );
    if (analysis?.limited)
      nodes.push(
        element("p", "本次只分析最近 60 篇匹配新聞。", "topic-ai-note"),
      );
    nodes.push(button);
  }
  panel.replaceChildren(...nodes);
}
export function showTopicAI(currentCategory, grid) {
  if (!currentCategory?.isCustom || !grid) {
    hideTopicAI();
    return;
  }
  if (!panel) {
    panel = element("section", "", "topic-ai-panel");
    panel.setAttribute("aria-label", "追蹤主題整理");
  }
  if (panel.nextElementSibling !== grid)
    grid.insertAdjacentElement("beforebegin", panel);
  panel.hidden = false;
  category = currentCategory;
  controller.open(
    { ...currentCategory, aiMode: getTrackedAIMode(currentCategory) },
    LocalDB.getVisibleSources(),
  );
}
export function hideTopicAI() {
  clearTimeout(retryTimer);
  retryTimer = null;
  controller.close();
  category = null;
  if (panel) panel.hidden = true;
}
