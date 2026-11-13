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
    await page.click('#home [data-action="catalog"]');
    await page.click('[data-action="tutorial"]');
    assert.match(await page.locator('#panelTitle').innerText(), /新手教學/);
    await page.click('#panel [data-action="maps"]');
    assert.match(await page.locator("#panel").innerText(), /現代世界底圖/);
    await page.click('[data-action="newModern"]');
    await page.waitForSelector("#editor:not([hidden])");
    await page.waitForTimeout(500);
    await page.click('.editor-header [data-action="search"]');
    await page.fill("#searchInput", "TWN");
    await page.waitForTimeout(200);
    const result = page.locator('[data-action="select"][data-id="TWN"]');
    assert.equal(await result.count(), 1);
    await result.click();
    assert.equal(await page.locator("#selection").isVisible(), true);
    assert.equal(await page.locator('#selection [data-action="focusSelection"]').isVisible(), true);
    await page.click('#selection [data-action="inspector"]');
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.drawImage;
      window.flagDrawCount = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.id === "map") window.flagDrawCount++;
        return original.apply(this, args);
      };
    });
    await page.fill("#entityName", "臺灣測試");
    await page.locator('#entityFlagFile').setInputFiles({
      name:'flag.png', mimeType:'image/png',
      buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAFUlEQVR4nGO8I2LznwEPYMInSR0FABsbAjNfNhR2AAAAAElFTkSuQmCC','base64'),
    });
    await page.click('[data-action="saveEntity"]');
    await page.waitForFunction(() => document.querySelector('#panelTitle').textContent.includes('臺灣測試'));
    await page.waitForFunction(() => window.flagDrawCount > 0);
    assert.match(await page.locator('#selection .name img.flag').getAttribute('src'), /^data:image\/png;base64,/);
    await page.click('[data-action="close"]');
    await page.click('[data-action="save"]');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#resume").isVisible(), true);
    await page.click('[data-action="resume"]');
    await page.waitForSelector("#editor:not([hidden])");
    await page.click('.editor-header [data-action="search"]');
    await page.fill("#searchInput", "臺灣測試");
    assert.equal(
      await page.locator('[data-action="select"][data-id="TWN"]').count(),
      1,
    );
    await page.locator('[data-action="select"][data-id="TWN"]').click();
    await page.click('#selection [data-action="inspector"]');
    await page.click('#panel [data-action="uiEditor"]');
    await page.click('[data-action="newScreenForm"]');
    await page.fill("#screenId", "country-screen");
    await page.fill("#screenName", "國家畫面");
    await page.click('[data-action="createScreen"]');
    await page.fill("#editScreenName", "國家資料面板");
    await page.selectOption("#screenColumns", "3");
    await page.click('[data-action="saveScreenSettings"]');
    await page.click('[data-action="newControl"]');
    await page.fill("#controlId", "population");
    await page.selectOption("#controlType", "number");
    await page.fill("#controlLabel", "人口");
    await page.fill("#controlKey", "population");
    await page.selectOption("#controlSpan", "2");
    await page.click('[data-action="saveControl"]');
    await page.click('[data-action="previewScreen"][data-id="country-screen"]');
    assert.equal(await page.locator(".ui-preview-grid.ui-columns-3").count(), 1);
    assert.equal(await page.locator(".ui-preview-item.ui-span-2").count(), 1);
    const countColumns = () => page.locator(".ui-preview-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    assert.equal(await countColumns(), 2);
    await page.fill('[data-ui-value="population"]', "123");
    await page.locator('[data-ui-value="population"]').blur();
    await page.setViewportSize({width: 844, height: 390});
    assert.equal(await countColumns(), 3);
    await page.setViewportSize({width: 390, height: 844});
    await page.click('[data-action="close"]');
    await page.click('#selection [data-action="inspector"]');
    await page.click('[data-action="entityData"]');
    assert.equal(JSON.parse(await page.locator("#entityDataInput").inputValue()).population, 123);
    await page.click('[data-action="close"]');
    await page.click('#primaryTools [data-action="code"]');
    await page.fill("#scriptId", "mobile-test");
    await page.fill("#scriptName", "手機腳本");
    await page.fill("#codeInput", "# 測試\nentity.rename {");
    assert.match(await page.locator("#codeStatus").innerText(), /第 2 行.*JSON 格式錯誤/);
    await page.fill("#codeInput", 'entity.rename {"id":"TWN","name":"腳本測試"}');
    assert.match(await page.locator("#codeStatus").innerText(), /語法正確/);
    await page.click('[data-action="saveCode"]');
    await page.click('[data-action="previewCode"]');
    await page.click('[data-action="applyPreview"]');
    assert.match(await page.locator("#selection").innerText(), /腳本測試/);
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

test("mobile map can draw a polygon to split a selected region", async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined, args:["--no-sandbox"]});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, {waitUntil:"load"});
    await page.click('[data-action="maps"]');
    await page.click('[data-action="newBlank"]');
    await page.waitForSelector('#editor:not([hidden])');
    await page.click('#primaryTools [data-action="code"]');
    await page.fill('#codeInput', 'entity.create {"id":"A","name":"原地塊","layer":"Country","geometry":{"type":"Polygon","coordinates":[[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]]]}}');
    await page.click('[data-action="previewCode"]');
    await page.click('[data-action="applyPreview"]');
    await page.click('.editor-header [data-action="search"]');
    await page.fill('#searchInput', '原地塊');
    await page.click('[data-action="select"][data-id="A"]');
    await page.click('#selection [data-action="inspector"]');
    await page.click('[data-action="cutForm"]');
    await page.fill('#cutId', 'A-east');
    await page.fill('#cutName', '東部');
    await page.click('[data-action="startCut"]');
    const box = await page.locator('#map').boundingBox();
    const scale = Math.max(0.02, Math.min(10000, box.width * 0.74 / 40, box.height * 0.60 / 40));
    for (const [lon, lat] of [[0,-22],[15,-22],[15,22],[0,22]]) {
      await page.mouse.click(box.x + box.width * 0.5 + lon * scale, box.y + box.height * 0.4 - lat * scale);
    }
    await page.click('[data-action="finishDraw"]');
    assert.equal(await page.locator('#drawTip').isHidden(), true, await page.locator('#toast').innerText());
    assert.match(await page.locator('#selection').innerText(), /東部/);
    assert.match(await page.locator('#selection').innerText(), /A-east/);
    await page.click('#primaryTools [data-action="layers"]');
    await page.click('[data-action="drawingList"]');
    await page.click('#panel [data-action="drawLine"]');
    await page.fill('#drawingId', 'border-1');
    await page.fill('#drawingName', '邊界線');
    await page.fill('#drawingWidth', '4');
    await page.fill('#drawingOpacity', '60');
    await page.selectOption('#drawingPreset', 'dashed');
    await page.check('#drawingCurve');
    await page.click('[data-action="startLine"]');
    for (const [x, y] of [[0.25,0.3],[0.52,0.35],[0.72,0.6]]) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    }
    await page.click('[data-action="finishDraw"]');
    await page.click('#primaryTools [data-action="layers"]');
    await page.click('[data-action="drawingList"]');
    assert.match(await page.locator('#panelBody').innerText(), /邊界線.*60%/s);
    assert.match(await page.locator('#panelBody').innerText(), /平滑曲線.*虛線/s);
    await page.click('[data-action="editDrawing"][data-id="border-1"]');
    await page.fill('#drawingOpacity', '35');
    await page.click('[data-action="saveDrawing"]');
    assert.match(await page.locator('#panelBody').innerText(), /35%/);
    await page.click('[data-action="close"]');
    await page.click('.editor-header [data-action="save"]');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('#resume:not([hidden])');
    await page.click('[data-action="resume"]');
    await page.waitForSelector('#editor:not([hidden])');
    await page.click('#primaryTools [data-action="layers"]');
    await page.click('[data-action="drawingList"]');
    assert.match(await page.locator('#panelBody').innerText(), /邊界線.*35%/s);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("mobile diplomacy supports module updates, invitations and civil war", async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined, args:["--no-sandbox"]});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base,{waitUntil:'load'});
    await page.click('[data-action="maps"]'); await page.click('[data-action="newBlank"]');
    await page.waitForSelector('#editor:not([hidden])');
    await page.click('#primaryTools [data-action="code"]');
    const cmd=(command,args)=>({command,args});
    const old={id:'diplomacy',name:'舊外交包',dependencies:[],actions:[{id:'war',name:'自訂宣戰',commands:[cmd('diplomacy.war',{from:'$target',to:'$param:other'})]}]};
    await page.fill('#codeInput',JSON.stringify([
      cmd('entity.create',{id:'U',name:'聯盟',layer:'Union'}),
      cmd('entity.create',{id:'A',name:'甲國',layer:'Country'}),
      cmd('entity.create',{id:'B',name:'乙國',layer:'Country'}),
      cmd('entity.flag',{id:'A',flag:'🇹🇼'}),cmd('entity.flag',{id:'B',flag:'🇯🇵'}),
      cmd('entity.create',{id:'S',name:'甲省',layer:'State',geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]}}),
      cmd('entity.create',{id:'P',name:'甲縣',layer:'Province',geometry:{type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]]]}}),
      cmd('entity.bind',{id:'A',parents:['U']}),cmd('entity.bind',{id:'S',parents:['A']}),
      cmd('entity.bind',{id:'P',parents:['S']}),cmd('entity.claim',{id:'S',claims:['A','B']}),cmd('entity.controller',{id:'P',controller:'B'}),cmd('plugin.install',old)
    ]));
    await page.click('[data-action="previewCode"]'); await page.click('[data-action="applyPreview"]');
    await page.click('[data-action="toggleDock"]'); await page.click('[data-action="plugins"]');
    await page.click('[data-action="extendPlugin"][data-id="diplomacy"]');
    assert.equal(await page.locator('[data-action="extendPlugin"][data-id="diplomacy"]').count(),0);
    await page.click('[data-action="close"]');
    async function selectCountry(id) {
      await page.click('.editor-header [data-action="search"]'); await page.fill('#searchInput',id);
      await page.click(`[data-action="select"][data-id="${id}"]`);
    }
    async function openActions() { await page.click('#selection [data-action="inspector"]'); await page.click('[data-action="actionsForEntity"]'); }
    async function runAction(id,params) {
      await page.click(`[data-action="pluginAction"][data-plugin="diplomacy"][data-id="${id}"]`);
      for(const [key,value] of Object.entries(params)) await page.fill(`[data-param="${key}"]`,value);
      await page.click('[data-action="runPluginAction"]'); await page.click('[data-action="applyPreview"]');
    }
    await selectCountry('A'); await openActions();
    assert.match(await page.locator('#panelBody').innerText(),/自訂宣戰/);
    await runAction('invite',{other:'B',union:'U'});
    await selectCountry('B'); await openActions();
    assert.match(await page.locator('#panelBody').innerText(),/待處理外交事項/);
    await page.click('[data-action="diplomacyDecision"][data-command="diplomacy.accept"]');
    await page.click('[data-action="applyPreview"]');
    assert.match(await page.locator('#selection').innerText(),/聯盟 → .*乙國/);
    await selectCountry('A'); await openActions(); await runAction('vassalize',{subject:'B'});
    await selectCountry('B');
    assert.match(await page.locator('#selection').innerText(),/宗主國.*甲國/);
    await selectCountry('A'); await openActions(); await runAction('civilwar',{rebel:'R',name:'地方勢力',regions:'S'});
    await selectCountry('S');
    assert.match(await page.locator('#selection').innerText(),/控制方.*地方勢力/);
    await page.click('[data-action="toggleDock"]');
    await page.click('#primaryTools [data-action="layers"]');
    await page.click('[data-action="editLayer"][data-id="State"]');
    await page.check('#layerAutoAggregate');
    await page.click('[data-action="saveLayer"][data-id="State"]');
    await page.click('[data-action="close"]');
    assert.match(await page.locator('#selection').innerText(),/控制方.*乙國/);
    await selectCountry('P');
    await page.click('#selection [data-action="inspector"]');
    await page.fill('#entityController','A');
    await page.click('[data-action="saveEntity"]');
    await page.click('[data-action="close"]');
    await page.evaluate(() => {
      const original=CanvasRenderingContext2D.prototype.fillText;
      window.regionFlagLabels=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){
        if(this.canvas.id==='map')window.regionFlagLabels.push(text);
        return original.call(this,text,...args);
      };
    });
    await selectCountry('S');
    assert.match(await page.locator('#selection').innerText(),/控制方.*甲國/);
    assert.match(await page.locator('#selection').innerText(),/宣稱方.*甲國.*乙國/);
    await page.waitForFunction(() => window.regionFlagLabels.includes('🇹🇼') && window.regionFlagLabels.includes('🇯🇵'));
    await page.click('.editor-header [data-action="save"]');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('#resume:not([hidden])');
    await page.click('[data-action="resume"]');
    await page.waitForSelector('#editor:not([hidden])');
    await page.click('#primaryTools [data-action="layers"]');
    await page.click('[data-action="editLayer"][data-id="State"]');
    assert.equal(await page.locator('#layerAutoAggregate').isChecked(),true);
    await page.click('[data-action="close"]');
    await selectCountry('S');
    assert.match(await page.locator('#selection').innerText(),/控制方.*甲國/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
