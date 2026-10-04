import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
  );
}
const { chromium } = playwright;
const root = new URL("../../", import.meta.url).pathname;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = join(
      root,
      url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname),
    );
    const types = {
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".json": "application/json",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "text/plain",
    });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(8123, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || undefined,
    args: [
      "--no-sandbox",
      "--no-zygote",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem(
      "metro_news_custom_cats",
      JSON.stringify([
        {
          id: "custom_qa",
          name: "蔡天鳳案",
          query: "蔡天鳳案",
          isCustom: true,
          aiMode: "auto",
        },
      ]),
    );
  });
  await page.route(
    "https://news-proxy.maxyu0725us.workers.dev/**",
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/api/topic-ai") {
        requests.push(request.method());
        const snapshot =
          request.method() === "POST"
            ? {
                success: true,
                status: "ready",
                mode: "EVENT",
                generatedAt: Date.now(),
                analysis: { covered: 3, pending: 2 },
                output: {
                  sections: [
                    {
                      heading: "最新進展",
                      items: [
                        {
                          text: "控方指稱，被告否認；法庭未有裁決。",
                          sourceIds: ["1"],
                        },
                        {
                          text: '<img src=x onerror="alert(1)">',
                          sourceIds: ["1"],
                        },
                      ],
                    },
                  ],
                },
                sources: [
                  {
                    id: "1",
                    title: "蔡天鳳案｜法庭審訊",
                    link: "https://hk01.com/sns/article/1",
                    source: "香港01",
                  },
                ],
              }
            : { success: true, status: "empty", mode: "NONE", sources: [] };
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(snapshot),
        });
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: "1",
              title: "新聞標題",
              description: "新聞內容",
              link: "https://hk01.com/sns/article/1",
              source: "香港01",
              pubDate: new Date().toISOString(),
              category: "local",
            },
          ],
          hasMore: false,
        }),
      });
    },
  );
  await page.goto("http://127.0.0.1:8123/");
  await page.locator(".nav-link").filter({ hasText: "蔡天鳳案" }).click();
  await page.waitForFunction(
    () => document.querySelector(".topic-ai-generate")?.disabled === false,
  );
  assert.deepEqual(requests, ["GET"]);
  await page.locator(".topic-ai-generate").click();
  await page.waitForFunction(() =>
    document.querySelector(".topic-ai-panel")?.textContent.includes("控方指稱"),
  );
  assert.deepEqual(requests, ["GET", "POST"]);
  assert.equal(await page.locator(".topic-ai-content img").count(), 0);
  assert.equal(
    await page.locator(".topic-ai-sources a").first().getAttribute("href"),
    "https://hk01.com/sns/article/1",
  );
  assert.ok(
    await page
      .locator(".topic-ai-panel")
      .textContent()
      .then((x) => x.includes("2 篇待整理")),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  if (process.env.TOPIC_QA_SCREENSHOT)
    await page.screenshot({
      path: process.env.TOPIC_QA_SCREENSHOT,
      fullPage: true,
    });
  await page.locator('.bottom-nav-btn[data-section="search"]').click();
  assert.equal(await page.locator(".topic-ai-panel").isVisible(), false);
  await page.locator('.bottom-nav-btn[data-section="news"]').click();
  await page.locator(".topic-ai-header select").selectOption("off");
  await page.waitForFunction(() =>
    document.querySelector(".topic-ai-panel")?.textContent.includes("已關閉"),
  );
  assert.equal(await page.locator(".topic-ai-generate").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Mobile topic UI: explicit POST, safe rendering, sources, pending count, no horizontal overflow, section hide and off preference PASS",
  );
} finally {
  await browser?.close();
  server.close();
}
