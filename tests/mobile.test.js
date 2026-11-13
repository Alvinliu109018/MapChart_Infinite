"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = "http://127.0.0.1:8765/";
test("mobile editor search, edit, persistence, module actions and orientation", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: "load" });
    await page.waitForSelector('[data-action="maps"]');
    await page.click('[data-action="maps"]');
    assert.match(await page.locator("#panel").innerText(), /現代世界底圖/);
    await page.click('[data-action="newModern"]');
    await page.waitForSelector("#editor:not([hidden])");
    await page.waitForTimeout(500);
    await page.click('[data-action="search"]');
    await page.fill("#searchInput", "TWN");
    await page.waitForTimeout(200);
    const result = page.locator('[data-action="select"][data-id="TWN"]');
    assert.equal(await result.count(), 1);
    await result.click();
    assert.equal(await page.locator("#selection").isVisible(), true);
    await page.click('[data-action="inspector"]');
    await page.fill("#entityName", "臺灣測試");
    await page.click('[data-action="saveEntity"]');
    assert.match(await page.locator("#panelTitle").innerText(), /臺灣測試/);
    await page.click('[data-action="close"]');
    await page.click('[data-action="save"]');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#resume").isVisible(), true);
    await page.click('[data-action="resume"]');
    await page.waitForSelector("#editor:not([hidden])");
    await page.click('[data-action="search"]');
    await page.fill("#searchInput", "臺灣測試");
    assert.equal(
      await page.locator('[data-action="select"][data-id="TWN"]').count(),
      1,
    );
    await page.locator('[data-action="select"][data-id="TWN"]').click();
    await page.click('[data-action="toggleDock"]');
    await page.click('[data-action="plugins"]');
    await page
      .locator('[data-action="installPlugin"][data-id="politics"]')
      .click();
    assert.equal(
      await page
        .locator('[data-action="togglePlugin"][data-id="politics"]')
        .count(),
      1,
    );
    await page.click('[data-action="close"]');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#map").isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
