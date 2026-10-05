const API_URL = "https://news-proxy.maxyu0725us.workers.dev/api/topic-ai";
const CACHE_KEY = "metro_topic_ai_snapshots_v1";
export const TOPIC_AI_MODES = Object.freeze([
  ["auto", "自動"],
  ["event", "事件追蹤"],
  ["digest", "主題摘要"],
  ["off", "關閉"],
]);
export function topicInsufficientMessage(analysis) {
  switch (analysis?.reasonCode) {
    case "insufficient_articles":
      return "可用的獨立新聞少於 3 篇；至少 3 篇才開始整理。";
    case "insufficient_text":
      return "已有匹配新聞，但可讀的已存內文不足，暫未整理。";
    case "insufficient_event_text":
      return "已辨識事件，但該事件的可讀內文不足，暫未整理。";
    case "low_cohesion":
      return "已有匹配新聞，但暫未辨識出單一事件；可改用「主題摘要」。";
    case "scattered":
      return "已有匹配新聞，但內容分散，暫未找到適合整理的事件或子議題。";
    default:
      return "相關資料不足或過於分散，暫不進行 AI 整理。";
  }
}
export function safeTopicSourceLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      [
        "hk01.com",
        "www.hk01.com",
        "bastillepost.com",
        "www.bastillepost.com",
      ].includes(u.hostname)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
function readCache(storage) {
  try {
    const data = JSON.parse(storage?.getItem(CACHE_KEY) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
export function createTopicAIController({
  fetch: fetcher = globalThis.fetch,
  storage = globalThis.localStorage,
  onChange,
}) {
  let sequence = 0,
    current = null,
    controller = null;
  const emit = () => {
    if (current) onChange({ ...current });
  };
  function keyFor(category, sourceIds) {
    return JSON.stringify([
      String(category.query || category.name || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
      category.aiMode || "auto",
      [...sourceIds].sort(),
    ]);
  }
  async function request(method) {
    if (!current || current.mode === "off" || current.loading) return;
    const task = current,
      seq = sequence;
    task.loading = true;
    emit();
    const requestController = new AbortController();
    controller = requestController;
    const params = new URLSearchParams({
      q: task.query,
      mode: task.mode,
      sources: task.sourceIds.join(","),
    });
    const timer = setTimeout(() => requestController.abort(), 60000);
    try {
      const response = await fetcher(`${API_URL}?${params}`, {
        method,
        signal: requestController.signal,
        cache: "no-store",
      });
      if (seq !== sequence) return;
      if (!response.ok) {
        task.result = {
          ...(task.result || {}),
          success: true,
          status:
            response.status === 429
              ? "rate_limited"
              : [404, 503].includes(response.status)
                ? "unavailable"
                : "service_error",
        };
        if (response.status === 429) {
          const retry = Number(response.headers?.get("Retry-After"));
          task.result.nextUpdateAt =
            Date.now() + (retry > 0 && retry <= 3600 ? retry : 60) * 1000;
        }
        return;
      }
      const data = await response.json().catch(() => null);
      if (seq !== sequence) return;
      if (!data?.success) {
        task.result = {
          ...(task.result || {}),
          success: true,
          status: "service_error",
        };
        return;
      }
      task.result = data;
      if (data.output) {
        try {
          const cache = readCache(storage);
          delete cache[task.key];
          cache[task.key] = data;
          while (Object.keys(cache).length > 20)
            delete cache[Object.keys(cache)[0]];
          storage?.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch {}
      } else if (["off", "insufficient"].includes(data.status)) {
        try {
          const cache = readCache(storage);
          delete cache[task.key];
          storage?.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch {}
      }
    } catch (error) {
      if (seq !== sequence) return;
      task.result = {
        ...(task.result || {}),
        success: true,
        status: "offline",
        error: String(error?.message || ""),
      };
    } finally {
      clearTimeout(timer);
      if (seq === sequence) {
        task.loading = false;
        emit();
      }
    }
  }
  return {
    async open(category, sourceIds) {
      sequence++;
      controller?.abort();
      const mode = category.aiMode || "auto";
      const key = keyFor(category, sourceIds);
      current = {
        query: String(category.query || category.name || "").trim(),
        mode,
        key,
        sourceIds,
        loading: false,
        result:
          mode === "off"
            ? { status: "off", mode: "NONE" }
            : readCache(storage)[key] || { status: "empty", mode: "NONE" },
      };
      emit();
      if (mode !== "off") await request("GET");
    },
    generate() {
      return request("POST");
    },
    close() {
      sequence++;
      controller?.abort();
      current = null;
    },
  };
}

export function topicFailureMessage(output) {
  return output?.sections?.length
    ? "整理未能完成，已保留上次結果。"
    : "整理未能完成，請稍後再試。";
}
