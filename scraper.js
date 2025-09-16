import { chromium } from "playwright";

/**
 * Fetches the latest Yle article text by visiting https://yle.fi/ and
 * clicking the most recent element with class "underlay-link".
 * Prints the article title and text to stdout.
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

    const output = [
      title ? `TITLE: ${title}` : null,
      `URL: ${targetUrl}`,
      "---",
      cleaned || "(No article text extracted)",
    ]
      .filter(Boolean)
      .join("\n");

    console.log(output);
  } catch (error) {
    console.error("Scrape failed:", error?.message || error);
    process.exitCode = 1;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchLatestYleArticle();
}
