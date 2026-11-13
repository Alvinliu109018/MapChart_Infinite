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
  w.drawLabels = [];
  const drawing = new Proxy(
    {},
    {
      get: (o, k) => k === "setTransform" ? (...args) => w.drawTransforms.push(args) : k === "measureText" ? (value) => ({width:String(value).length * 6}) : k === "fillText" ? (value) => w.drawLabels.push(value) : (k in o ? o[k] : noop),
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
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAFUlEQVR4nGO8I2LznwEPYMInSR0FABsbAjNfNhR2AAAAAElFTkSuQmCC','base64');
  const image = new w.File([png], 'flag.png', {type:'image/png'});
  Object.defineProperty($("#entityFlagFile"), 'files', {value:[image], configurable:true});
  click('[data-action="saveEntity"]');
  await until(() => $("#panelTitle").textContent === "臺灣測試");
  assert.equal($("#panelTitle").textContent, "臺灣測試");
  assert.match($('#selection img.flag').getAttribute('src'), /^data:image\/png;base64,/);
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
  click('[data-action="close"]');
  click('#primaryTools [data-action="layers"]');
  click('[data-action="drawingList"]');
  assert.match($("#panelBody").textContent, /尚未繪製線段/);
  click('#panel [data-action="drawLine"]');
  $("#drawingId").value = "border-line";
  $("#drawingName").value = "自訂邊界";
  $("#drawingWidth").value = "0";
  click('[data-action="startLine"]');
  assert.match($("#toast").textContent, /請檢查/);
  $("#drawingWidth").value = "4";
  $("#drawingOpacity").value = "60";
  $("#drawingPreset").value = "dashed";
  $("#drawingPreset").dispatchEvent(new w.Event("change"));
  assert.equal($("#drawingDash").value, "8,5");
  $("#drawingCurve").checked = true;
  click('[data-action="startLine"]');
  tap(-10,-10); tap(10,10);
  click('[data-action="finishDraw"]');
  assert.equal($("#drawTip").hidden, true, $("#toast").textContent);
  click('#primaryTools [data-action="layers"]');
  click('[data-action="drawingList"]');
  assert.match($("#panelBody").textContent, /自訂邊界.*60%/s);
  assert.match($("#panelBody").textContent, /平滑曲線.*虛線/);
  click('[data-action="editDrawing"][data-id="border-line"]');
  assert.equal($("#drawingWidth").value, "4");
  $("#drawingOpacity").value = "35";
  $("#drawingColor").value = "#ff0000";
  click('[data-action="saveDrawing"]');
  assert.match($("#panelBody").textContent, /35%/);
  w.confirm = () => true;
  click('[data-action="deleteDrawing"][data-id="border-line"]');
  assert.match($("#panelBody").textContent, /尚未繪製線段/);
  click('[data-action="close"]');
  click('[data-action="undo"]');
  click('#primaryTools [data-action="layers"]');
  click('[data-action="drawingList"]');
  assert.match($("#panelBody").textContent, /自訂邊界.*35%/s);
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

test("version-two world indexes upgrade to folder storage without losing saves", async () => {
  const factory=new IDBFactory(),legacy=MC.blank('第二版世界');legacy.id='version-two-world';
  await new Promise((resolve,reject)=>{
    const request=factory.open('mapchart-infinity',2);
    request.onupgradeneeded=()=>{request.result.createObjectStore('worlds',{keyPath:'id'});request.result.createObjectStore('worldIndex',{keyPath:'id'});};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,t=db.transaction(['worlds','worldIndex'],'readwrite');
      t.objectStore('worlds').put(legacy);
      t.objectStore('worldIndex').put({id:legacy.id,name:legacy.name,date:legacy.date,revision:legacy.revision,entityCount:0});
      t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);
    };
  });
  const w=makeApp(factory),$=(selector)=>w.document.querySelector(selector);
  await until(()=>$("#modeBadge").textContent==='Started');
  $('[data-action="files"]').click();
  await until(()=>$("#panelTitle").textContent==='管理檔案');
  assert.match($("#panelBody").textContent,/第二版世界/);
  $('[data-action="newFolderForm"]').click();$("#folderName").value='升級後資料夾';$('[data-action="saveFolder"]').click();
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&$("#panelBody").textContent.includes('升級後資料夾'));
  assert.match($("#panelBody").textContent,/第二版世界/);
  await w.happyDOM.abort();w.close();
});

test("diplomacy module upgrades without overwriting and handles invitations and civil wars", async () => {
  const w = makeApp(new IDBFactory());
  const $ = (selector) => w.document.querySelector(selector);
  const click = (selector) => { assert.ok($(selector), "Missing " + selector); $(selector).click(); };
  await until(() => $("#modeBadge").textContent === "Started");
  click('[data-action="maps"]'); click('[data-action="newBlank"]');
  await until(() => !$("#editor").hidden);
  click('#primaryTools [data-action="code"]');
  const cmd=(command,args)=>({command,args});
  const old={id:'diplomacy',name:'舊外交包',dependencies:[],actions:[{id:'war',name:'自訂宣戰',commands:[cmd('diplomacy.war',{from:'$target',to:'$param:other'})]}]};
  $("#codeInput").value=JSON.stringify([
    cmd('entity.create',{id:'U',name:'聯盟',layer:'Union'}),
    cmd('entity.create',{id:'A',name:'甲國',layer:'Country'}),
    cmd('entity.create',{id:'B',name:'乙國',layer:'Country'}),
    cmd('entity.create',{id:'S',name:'甲省',layer:'State'}),
    cmd('entity.bind',{id:'A',parents:['U']}),cmd('entity.bind',{id:'S',parents:['A']}),
    cmd('plugin.install',old),
  ]);
  $("#codeInput").dispatchEvent(new w.Event("input"));
  click('[data-action="previewCode"]'); click('[data-action="applyPreview"]');
  click('[data-action="toggleDock"]'); click('[data-action="plugins"]');
  click('[data-action="extendPlugin"][data-id="diplomacy"]');
  assert.equal($('[data-action="extendPlugin"][data-id="diplomacy"]'),null);
  click('[data-action="close"]');
  function selectCountry(id) {
    click('.editor-header [data-action="search"]');
    $("#searchInput").value=id; $("#searchInput").dispatchEvent(new w.Event("input"));
    click(`[data-action="select"][data-id="${id}"]`);
  }
  function openActions() { click('#selection [data-action="inspector"]'); click('[data-action="actionsForEntity"]'); }
  function runAction(id,params) {
    click(`[data-action="pluginAction"][data-plugin="diplomacy"][data-id="${id}"]`);
    for(const [key,value] of Object.entries(params)) $(`[data-param="${key}"]`).value=value;
    click('[data-action="runPluginAction"]');
    assert.match($("#panelTitle").textContent,/預覽/);
    click('[data-action="applyPreview"]');
  }
  selectCountry('A'); openActions();
  assert.match($("#panelBody").textContent,/自訂宣戰/);
  runAction('invite',{other:'B',union:'U'});
  selectCountry('B'); openActions();
  assert.match($("#panelBody").textContent,/待處理外交事項.*甲國.*聯盟/s);
  click('[data-action="diplomacyDecision"][data-command="diplomacy.accept"]');
  assert.match($("#panelBody").textContent,/diplomacy.accept/);
  click('[data-action="applyPreview"]');
  assert.match($("#selection").textContent,/聯盟 → 乙國/);
  selectCountry('A'); openActions(); runAction('vassalize',{subject:'B'});
  selectCountry('B');
  assert.match($("#selection").textContent,/宗主國.*甲國/);
  selectCountry('A'); openActions(); runAction('civilwar',{rebel:'R',name:'地方勢力',regions:'S'});
  selectCountry('S');
  assert.match($("#selection").textContent,/控制方.*地方勢力/);
  await w.happyDOM.abort(); w.close();
});

test("layer settings enable automatic control updates from child regions", async () => {
  const w = makeApp(new IDBFactory());
  const $ = (selector) => w.document.querySelector(selector);
  const click = (selector) => { assert.ok($(selector), "Missing " + selector); $(selector).click(); };
  await until(() => $("#modeBadge").textContent === "Started");
  click('[data-action="maps"]'); click('[data-action="newBlank"]');
  await until(() => !$("#editor").hidden);
  click('#primaryTools [data-action="code"]');
  const cmd=(command,args)=>({command,args});
  const geo={type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]]]};
  $("#codeInput").value=JSON.stringify([
    cmd('entity.create',{id:'A',name:'甲國',layer:'Country'}),cmd('entity.create',{id:'B',name:'乙國',layer:'Country'}),
    cmd('entity.create',{id:'S',name:'甲省',layer:'State'}),cmd('entity.create',{id:'P',name:'甲縣',layer:'Province',geometry:geo}),
    cmd('entity.bind',{id:'S',parents:['A']}),cmd('entity.bind',{id:'P',parents:['S']}),cmd('entity.controller',{id:'P',controller:'B'})
  ]);
  $("#codeInput").dispatchEvent(new w.Event("input"));
  click('[data-action="previewCode"]'); click('[data-action="applyPreview"]');
  click('#primaryTools [data-action="layers"]'); click('[data-action="editLayer"][data-id="State"]');
  $("#layerAutoAggregate").checked=true;
  click('[data-action="saveLayer"][data-id="State"]');
  assert.equal($("#panelTitle").textContent, "地圖／圖層", $("#toast").textContent);
  assert.match($("#panelBody").textContent,/自動匯總控制權/);
  click('[data-action="close"]');
  function select(id){click('.editor-header [data-action="search"]');$("#searchInput").value=id;$("#searchInput").dispatchEvent(new w.Event('input'));click(`[data-action="select"][data-id="${id}"]`);}
  select('S'); assert.match($("#selection").textContent,/控制方.*乙國/);
  select('P'); click('#selection [data-action="inspector"]');
  $("#entityController").value='A'; click('[data-action="saveEntity"]');
  select('S'); assert.match($("#selection").textContent,/控制方.*甲國/);
  await w.happyDOM.abort(); w.close();
});

test("shared and disputed regions show all country chains and inherited flags", async () => {
  const w=makeApp(new IDBFactory()),$=(selector)=>w.document.querySelector(selector);
  const click=(selector)=>{assert.ok($(selector),'Missing '+selector);$(selector).click();};
  await until(()=>$("#modeBadge").textContent==='Started');
  click('[data-action="maps"]');click('[data-action="newBlank"]');await until(()=>!$("#editor").hidden);
  click('#primaryTools [data-action="code"]');
  const cmd=(command,args)=>({command,args});
  $("#codeInput").value=JSON.stringify([
    cmd('entity.create',{id:'A',name:'甲國',layer:'Country'}),cmd('entity.create',{id:'B',name:'乙國',layer:'Country'}),
    cmd('entity.flag',{id:'A',flag:'🇹🇼'}),cmd('entity.flag',{id:'B',flag:'🇯🇵'}),
    cmd('entity.create',{id:'S',name:'爭議省',layer:'State',geometry:{type:'Polygon',coordinates:[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}}),
    cmd('layer.configure',{id:'State',shared:true}),cmd('entity.bind',{id:'S',parents:['A','B']}),
    cmd('entity.controller',{id:'S',controller:'B'}),cmd('entity.claim',{id:'S',claims:['A','B']})
  ]);
  $("#codeInput").dispatchEvent(new w.Event('input'));click('[data-action="previewCode"]');click('[data-action="applyPreview"]');
  click('.editor-header [data-action="search"]');$("#searchInput").value='S';$("#searchInput").dispatchEvent(new w.Event('input'));
  w.drawLabels.length=0;click('[data-action="select"][data-id="S"]');
  const summary=$("#selection").textContent;
  assert.match(summary,/🇹🇼 甲國 → 爭議省/);assert.match(summary,/🇯🇵 乙國 → 爭議省/);
  assert.match(summary,/宣稱方.*甲國.*乙國/);assert.match(summary,/控制方.*乙國/);
  assert(w.drawLabels.includes('🇹🇼'));assert(w.drawLabels.includes('🇯🇵'));
  await w.happyDOM.abort();w.close();
});

test("world files can be organized into persistent nested folders without deleting contents", async () => {
  const factory=new IDBFactory();
  let w=makeApp(factory),$=(selector)=>w.document.querySelector(selector);
  const click=(selector)=>{assert.ok($(selector),'Missing '+selector);$(selector).click();};
  await until(()=>$("#modeBadge").textContent==='Started');
  click('[data-action="maps"]');click('[data-action="newBlank"]');await until(()=>!$("#editor").hidden);
  click('.editor-header [data-action="home"]');click('#home [data-action="files"]');
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$('[data-world-id]'));
  const worldId=$('[data-world-id]').dataset.worldId;
  click('[data-action="newFolderForm"]');$("#folderName").value='我的世界觀';click('[data-action="saveFolder"]');
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$('[data-folder-id]'));
  const rootId=$('[data-folder-id]').dataset.folderId;
  click(`[data-action="newFolderForm"][data-parent="${rootId}"]`);$("#folderName").value='歷史存檔';click('[data-action="saveFolder"]');
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&w.document.querySelectorAll('[data-folder-id]').length===2);
  const childId=[...w.document.querySelectorAll('[data-folder-id]')].find((element)=>element.dataset.folderId!==rootId).dataset.folderId;
  click(`[data-action="moveWorldForm"][data-id="${worldId}"]`);$("#worldFolder").value=childId;click(`[data-action="moveWorld"][data-id="${worldId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$(`[data-folder-id="${childId}"] [data-world-id="${worldId}"]`));
  click(`[data-action="editFolderForm"][data-id="${rootId}"]`);
  assert.equal($(`#folderParent option[value="${childId}"]`),null);
  w.confirm=()=>true;click(`[data-action="deleteFolder"][data-id="${rootId}"]`);
  await until(()=>$("#toast").textContent.includes('還有存檔或子資料夾'));
  assert.equal($("#panelTitle").textContent,'資料夾設定');
  await w.happyDOM.abort();w.close();
  w=makeApp(factory);$=(selector)=>w.document.querySelector(selector);
  await until(()=>$("#modeBadge").textContent==='Started');
  click('#home [data-action="files"]');
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$(`[data-folder-id="${childId}"] [data-world-id="${worldId}"]`));
  assert.match($("#panelBody").textContent,/我的世界觀.*歷史存檔.*我的新世界/s);
  click(`[data-action="moveWorldForm"][data-id="${worldId}"]`);$("#worldFolder").value='';click(`[data-action="moveWorld"][data-id="${worldId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!$(`[data-folder-id="${childId}"] [data-world-id="${worldId}"]`));
  w.confirm=()=>true;click(`[data-action="editFolderForm"][data-id="${childId}"]`);click(`[data-action="deleteFolder"][data-id="${childId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!$(`[data-folder-id="${childId}"]`));
  click(`[data-action="editFolderForm"][data-id="${rootId}"]`);click(`[data-action="deleteFolder"][data-id="${rootId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!$(`[data-folder-id="${rootId}"]`));
  assert.ok($(`[data-world-id="${worldId}"]`));
  click('[data-action="newFolderForm"]');$("#folderName").value='刪除測試';click('[data-action="saveFolder"]');
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$('[data-folder-id]'));
  const cleanupId=$('[data-folder-id]').dataset.folderId;
  click(`[data-action="moveWorldForm"][data-id="${worldId}"]`);$("#worldFolder").value=cleanupId;click(`[data-action="moveWorld"][data-id="${worldId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!!$(`[data-folder-id="${cleanupId}"] [data-world-id="${worldId}"]`));
  click(`[data-action="deleteWorld"][data-id="${worldId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!$(`[data-world-id="${worldId}"]`));
  click(`[data-action="editFolderForm"][data-id="${cleanupId}"]`);click(`[data-action="deleteFolder"][data-id="${cleanupId}"]`);
  await until(()=>$("#panelTitle").textContent==='管理檔案'&&!$(`[data-folder-id="${cleanupId}"]`));
  await w.happyDOM.abort();w.close();
});
