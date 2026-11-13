"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Window } = require("happy-dom");
const { indexedDB } = require("fake-indexeddb");
const root = path.join(__dirname, "../App/Web");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(20);
  }
  throw Error("Timed out waiting for interface");
}

test("mobile-facing flows select, edit, persist, install module and change layout", async () => {
  const w = new Window({
    url: "https://local.test/",
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  w.indexedDB = indexedDB;
  w.structuredClone = structuredClone;
  w.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  w.Path2D = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  const noop = () => {};
  const drawing = new Proxy(
    {},
    {
      get: (o, k) => (k in o ? o[k] : noop),
      set: (o, k, v) => ((o[k] = v), true),
    },
  );
  w.HTMLCanvasElement.prototype.getContext = () => drawing;
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    width: 390,
    height: 420,
    left: 0,
    top: 0,
    right: 390,
    bottom: 420,
  });
  const html = fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .replace(/<script[^>]*><\/script>/g, "");
  w.document.write(html);
  for (const file of [
    "vendor/polygon-clipping.js",
    "vendor/fflate.js",
    "vendor/milsymbol.js",
    "data/world.js",
    "core.js",
    "importers.js",
    "catalog.js",
    "app.js",
  ])
    w.eval(fs.readFileSync(path.join(root, file), "utf8"));
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => {
    assert.ok($(s), "Missing " + s);
    $(s).click();
  };
  await until(() => $("#modeBadge").textContent === "Started");
  click('[data-action="maps"]');
  assert.match($("#panel").textContent, /現代世界底圖/);
  click('[data-action="newModern"]');
  await wait(300);
  assert.equal($("#editor").hidden, false, $("#toast").textContent);
  assert.match($("#worldName").textContent, /現代世界底圖/);
  click('[data-action="search"]');
  $("#searchInput").value = "TWN";
  $("#searchInput").dispatchEvent(new w.Event("input"));
  click('[data-action="select"][data-id="TWN"]');
  assert.equal($("#selection").hidden, false);
  click('[data-action="inspector"]');
  $("#entityName").value = "臺灣測試";
  click('[data-action="saveEntity"]');
  assert.equal($("#panelTitle").textContent, "臺灣測試");
  click('[data-action="close"]');
  click('[data-action="toggleDock"]');
  click('[data-action="plugins"]');
  click('[data-action="installPlugin"][data-id="politics"]');
  assert.ok($('[data-action="togglePlugin"][data-id="politics"]'));
  await wait(800);
  assert.ok(w.localStorage.getItem("lastWorld"));
  await w.happyDOM.abort();
  w.close();
});
