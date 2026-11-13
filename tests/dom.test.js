"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Window } = require("happy-dom");
const { indexedDB, IDBFactory } = require("fake-indexeddb");
const MC = require("../App/Web/core.js");
const root = path.join(__dirname, "../App/Web");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(20);
  }
  throw Error("Timed out waiting for interface");
}

function makeApp(factory) {
  const w = new Window({
    url: "https://local.test/",
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  w.indexedDB = factory;
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
  w.drawTransforms = [];
  const drawing = new Proxy(
    {},
    {
      get: (o, k) => k === "setTransform" ? (...args) => w.drawTransforms.push(args) : (k in o ? o[k] : noop),
      set: (o, k, v) => ((o[k] = v), true),
    },
  );
  w.HTMLCanvasElement.prototype.getContext = () => drawing;
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
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
  return w;
}

test("mobile-facing flows select, edit, persist, install module and change layout", async () => {
  const w = makeApp(indexedDB);
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => {
    assert.ok($(s), "Missing " + s);
    $(s).click();
  };
  await until(() => $("#modeBadge").textContent === "Started");
  click('#home [data-action="catalog"]');
  click('[data-action="tutorial"]');
  assert.match($("#panelTitle").textContent, /新手教學/);
  assert.match($("#panelBody").textContent, /手繪切分/);
  click('#panel [data-action="maps"]');
  assert.match($("#panel").textContent, /現代世界底圖/);
  click('[data-action="newModern"]');
  await wait(300);
  assert.equal($("#editor").hidden, false, $("#toast").textContent);
  assert.match($("#worldName").textContent, /現代世界底圖/);
  click('[data-action="search"]');
  $("#searchInput").value = "TWN";
  $("#searchInput").dispatchEvent(new w.Event("input"));
  const beforeFocus = w.drawTransforms.at(-2);
  click('[data-action="select"][data-id="TWN"]');
  assert.equal($("#selection").hidden, false);
  assert.ok(w.drawTransforms.at(-2)[0] > beforeFocus[0]);
  assert.ok($('[data-action="focusSelection"]'));
  click('[data-action="inspector"]');
  $("#entityName").value = "臺灣測試";
  click('[data-action="saveEntity"]');
  assert.equal($("#panelTitle").textContent, "臺灣測試");
  click('[data-action="uiEditor"]');
  click('[data-action="newScreenForm"]');
  $("#screenId").value = "country-screen";
  $("#screenName").value = "國家畫面";
  click('[data-action="createScreen"]');
  $("#editScreenName").value = "國家資料面板";
  $("#screenColumns").value = "3";
  click('[data-action="saveScreenSettings"]');
  assert.equal($("#panelTitle").textContent, "國家資料面板");
  click('[data-action="newControl"]');
  $("#controlId").value = "population";
  $("#controlType").value = "number";
  $("#controlLabel").value = "人口";
  $("#controlKey").value = "population";
  $("#controlSpan").value = "2";
  click('[data-action="saveControl"]');
  click('[data-action="previewScreen"][data-id="country-screen"]');
  assert.ok($(".ui-preview-grid.ui-columns-3"));
  assert.ok($(".ui-preview-item.ui-span-2"));
  const population = $('[data-ui-value="population"]');
  population.value = "123";
  population.dispatchEvent(new w.Event("change"));
  population.value = "";
  population.dispatchEvent(new w.Event("change"));
  assert.equal(population.value, "123");
  click('[data-action="close"]');
  click('[data-action="inspector"]');
  click('[data-action="entityData"]');
  assert.equal(JSON.parse($("#entityDataInput").value).population, 123);
  click('[data-action="close"]');
  click('[data-action="code"]');
  $("#scriptId").value = "example-script";
  $("#scriptName").value = "改名腳本";
  $("#codeInput").value = '# 註解\nentity.rename {';
  $("#codeInput").dispatchEvent(new w.Event("input"));
  assert.match($("#codeStatus").textContent, /第 2 行.*JSON 格式錯誤/);
  $("#codeInput").value = 'entity.rename {"id":"TWN","name":"新臺灣"}';
  $("#codeInput").dispatchEvent(new w.Event("input"));
  assert.match($("#codeStatus").textContent, /1 個指令 · 語法正確/);
  click('[data-action="saveCode"]');
  assert.match($("#scriptList").textContent, /改名腳本/);
  click('[data-action="previewCode"]');
  click('[data-action="applyPreview"]');
  assert.match($("#selection").textContent, /新臺灣/);
  click('[data-action="toggleDock"]');
  click('[data-action="plugins"]');
  click('[data-action="installPlugin"][data-id="politics"]');
  assert.ok($('[data-action="togglePlugin"][data-id="politics"]'));
  await wait(800);
  assert.ok(w.localStorage.getItem("lastWorld"));
  click('[data-action="close"]');
  click('[data-action="home"]');
  click('[data-action="files"]');
  await until(() => $("#panelTitle").textContent === "管理檔案");
  assert.match($("#panelBody").textContent, /177 個實體/);
  await w.happyDOM.abort();
  w.close();
});

test("drawing a cut on the map creates a named region and preserves the original", async () => {
  const w = makeApp(new IDBFactory());
  const $ = (selector) => w.document.querySelector(selector);
  const click = (selector) => {
    assert.ok($(selector), "Missing " + selector);
    $(selector).click();
  };
  await until(() => $("#modeBadge").textContent === "Started");
  click('[data-action="maps"]');
  click('[data-action="newBlank"]');
  await until(() => !$("#editor").hidden);
  click('[data-action="code"]');
  $("#codeInput").value = 'entity.create {"id":"A","name":"原地塊","layer":"Country","geometry":{"type":"Polygon","coordinates":[[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]]]}}';
  $("#codeInput").dispatchEvent(new w.Event("input"));
  click('[data-action="previewCode"]');
  click('[data-action="applyPreview"]');
  click('.editor-header [data-action="search"]');
  $("#searchInput").value = "原地塊";
  $("#searchInput").dispatchEvent(new w.Event("input"));
  click('[data-action="select"][data-id="A"]');
  const transform = w.drawTransforms.at(-2), dpr = Math.min(w.devicePixelRatio || 1, 2);
  const scale = transform[0] / dpr, x = transform[4] / dpr, y = transform[5] / dpr;
  click('#selection [data-action="inspector"]');
  click('[data-action="cutForm"]');
  $("#cutId").value = "A-east";
  $("#cutName").value = "東部";
  click('[data-action="startCut"]');
  assert.equal($("#selection").hidden, true);
  const canvas = $("#map");
  function tap(lon, lat) {
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new w.Event(type, {bubbles:true});
      Object.defineProperties(event, {
        pointerId: {value:1},
        offsetX: {value:lon * scale + x},
        offsetY: {value:(90 - lat) * scale + y},
      });
      canvas.dispatchEvent(event);
    }
  }
  for (const point of [[0,-30],[30,-30],[30,30],[0,30]]) tap(...point);
  click('[data-action="undoDrawPoint"]');
  tap(0,30);
  click('[data-action="finishDraw"]');
  assert.equal($("#drawTip").hidden, true, $("#toast").textContent);
  assert.match($("#selection").textContent, /東部/);
  assert.match($("#selection").textContent, /A-east/);
  click('.editor-header [data-action="search"]');
  $("#searchInput").value = "原地塊";
  $("#searchInput").dispatchEvent(new w.Event("input"));
  assert.ok($('[data-action="select"][data-id="A"]'));
  await w.happyDOM.abort();
  w.close();
});

test("version-one world saves migrate into a lightweight index", async () => {
  const factory = new IDBFactory();
  const legacy = MC.blank("舊版世界");
  legacy.id = "legacy-world";
  await new Promise((resolve, reject) => {
    const request = factory.open("mapchart-infinity", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("worlds", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("worlds", "readwrite");
      transaction.objectStore("worlds").put(legacy);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  const w = makeApp(factory);
  w.localStorage.setItem("lastWorld", "legacy-world");
  const $ = (selector) => w.document.querySelector(selector);
  await until(() => !$("#resume").hidden);
  $('[data-action="files"]').click();
  await until(() => $("#panelTitle").textContent === "管理檔案");
  assert.match($("#panelBody").textContent, /舊版世界/);
  assert.match($("#panelBody").textContent, /0 個實體/);
  await w.happyDOM.abort();
  w.close();
});
