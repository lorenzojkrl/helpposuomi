import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Fetches the latest Yle article text by visiting https://yle.fi/ and
 * clicking the most recent element with class "underlay-link".
 * Returns structured data (title, url, text, fetchedAt).
 */
async function fetchLatestYleArticle() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("https://yle.fi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for any underlay-link to appear
    await page.waitForSelector(".underlay-link", { timeout: 30000 });

    // Grab the first (most recent) link element
    const firstLink = await page.locator(".underlay-link").first();

    // Prefer href to avoid potential navigation blockers
    const href = await firstLink.getAttribute("href");
    if (!href) {
      throw new Error("No href found on the most recent .underlay-link");
    }

    const targetUrl = href.startsWith("http")
      ? href
      : new URL(href, "https://yle.fi").toString();

    // Navigate to the article page
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Try common containers for Yle articles
    const articleLocator = page.locator("article");
    const contentLocator = page.locator("div.yle__article__content");

    // Wait for probable content to appear (one of them)
    await Promise.race([
      articleLocator
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {}),
      contentLocator
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {}),
    ]);

    // Prefer article, fallback to content container, else entire main
    let text = "";
    const title =
      (
        await page
          .locator("h1")
          .first()
          .textContent()
          .catch(() => null)
      )?.trim() || "";

    if (await articleLocator.count()) {
      text = (
        await articleLocator
          .first()
          .innerText()
          .catch(() => "")
      )?.trim();
    }
    if (!text && (await contentLocator.count())) {
      text = (
        await contentLocator
          .first()
          .innerText()
          .catch(() => "")
      )?.trim();
    }
    if (!text) {
      const mainLocator = page.locator("main");
      if (await mainLocator.count()) {
        text = (
          await mainLocator
            .first()
            .innerText()
            .catch(() => "")
        )?.trim();
      }
    }

    // Light cleanup: collapse whitespace; keep paragraphs
    const cleaned = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

    return {
      title,
      url: targetUrl,
      text: cleaned,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Scrape failed:", error?.message || error);
    process.exitCode = 1;
    return null;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function renderHtml({ title, url, text, fetchedAt }) {
  const paragraphs = text
    ? text
        .split("\n")
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("\n")
    : "<p>(No article text extracted)</p>";
  return `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "Yle uusin artikkeli")}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem auto; padding: 0 1rem; max-width: 820px; line-height: 1.6; color: #111; }
    header { margin-bottom: 1.5rem; }
    h1 { font-size: 1.8rem; margin: 0 0 .5rem 0; }
    .meta { color: #666; font-size: .95rem; }
    a { color: #0a63c6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    footer { margin-top: 2rem; color: #666; font-size: .9rem; }
  </style>
  <meta name="robots" content="noindex" />
  <meta property="og:title" content="${escapeHtml(
    title || "Yle uusin artikkeli"
  )}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta name="description" content="Viimeisin Ylen artikkeli. Päivitetty: ${escapeHtml(
    fetchedAt
  )}" />
  <link rel="icon" href="data:," />
  </head>
<body>
  <header>
    <h1>${escapeHtml(title || "Viimeisin Ylen artikkeli")}</h1>
    <div class="meta">Lähde: <a href="${escapeHtml(url)}">${escapeHtml(
    url
  )}</a> · Päivitetty: ${escapeHtml(fetchedAt)}</div>
  </header>
  <main>
    ${paragraphs}
  </main>
  <footer>
    Rakennettu automaattisesti Playwright-selaimella.
  </footer>
</body>
</html>`;
}

function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function writeSite(data, outPath = "dist/index.html") {
  const outDir = path.dirname(outPath);
  await fs.mkdir(outDir, { recursive: true });
  const html = renderHtml(data);
  await fs.writeFile(outPath, html, "utf8");
  await fs.writeFile(
    path.join(outDir, "latest.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const data = await fetchLatestYleArticle();
    if (!data) return;
    const outFlagIndex = process.argv.indexOf("--out");
    const outPath =
      outFlagIndex !== -1 ? process.argv[outFlagIndex + 1] : undefined;
    if (outPath) {
      await writeSite(data, outPath);
      console.log(`Wrote site to ${outPath}`);
    } else {
      const output = [
        data.title ? `TITLE: ${data.title}` : null,
        `URL: ${data.url}`,
        "---",
        data.text || "(No article text extracted)",
      ]
        .filter(Boolean)
        .join("\n");
      console.log(output);
    }
  })();
}
