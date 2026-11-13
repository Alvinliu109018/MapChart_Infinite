/* MapChart Infinity model and transaction engine. No DOM dependencies. */
(function (root) {
  'use strict';
  const clip = typeof require === 'function' ? require('./vendor/polygon-clipping.js') : root.polygonClipping;
  const clone = value => structuredClone(value);
  const validatedGeometries = new WeakSet();
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  function safeKey(value) {
    if (typeof value !== 'string' || !value.trim() || forbidden.has(value)) fail('INVALID_ID', '識別碼必須是有效文字');
    return value;
  }
  function numeric(value, min = -Infinity, max = Infinity) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('INVALID_NUMBER', `數值必須介於 ${min} 和 ${max}`);
    return value;
  }
  function text(value) { if (typeof value !== 'string') fail('INVALID_TEXT', '需要文字'); return value; }
  function get(world, id) { return world.entities[safeKey(id)] || fail('NOT_FOUND', `找不到 ${id}`); }
  function layer(world, id) { return world.layers.find(item => item.id === id) || fail('LAYER_NOT_FOUND', `找不到圖層 ${id}`); }
  const LEVELS = ['Union', 'Country', 'State', 'Province'];
  function blank(name = '我的世界') {
    return {
      format: 'mapchart-infinity', version: 1, revision: 0, id: 'world-' + Date.now(), name,
      coordinateSystem: 'geographic', date: '2026-01-01', entities: {},
      layers: LEVELS.map((id, index) => ({ id, name: id, kind: 'nested', parentLayer: LEVELS[index - 1] || null, shared: false, visible: true, opacity: 1 })),
      settings: { workspace: 'Started', lite: false, colorMode: 'country', labels: true, flags: true, borders: true, puppetColors: true, historical: false, observer: false },
      relations: [], units: [], drawings: [], events: [], processedEvents: [], plugins: [], rules: [], folders: [],
      screens: [], scripts: [],
      history: [], provenance: [], coverage: { verifiedThrough: null, status: 'user-authored' }
    };
  }
  function geometry(value) {
    if (!value || !['Polygon', 'MultiPolygon'].includes(value.type)) fail('INVALID_GEOMETRY', '需要 Polygon 或 MultiPolygon');
    if (validatedGeometries.has(value)) return value;
    const polygons = value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
    if (!polygons.length) fail('INVALID_GEOMETRY', '地塊不能是空的');
    for (const polygon of polygons) {
      if (!polygon.length) fail('INVALID_GEOMETRY', '需要外環');
      for (const ring of polygon) {
        if (ring.length < 4) fail('INVALID_GEOMETRY', '封閉環至少需要四個座標');
        for (const point of ring) { if (!Array.isArray(point) || point.length < 2) fail('INVALID_GEOMETRY', '座標無效'); numeric(point[0]); numeric(point[1]); }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) fail('INVALID_GEOMETRY', '邊界必須封閉');
      }
    }
    // Clip operations perform their own topology checks. Reusing validated,
    // immutable geometry keeps edits responsive on large imported maps.
    validatedGeometries.add(value);
    return value;
  }
  function multi(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
  function area(g, geographic = false) {
    if (!g) return 0;
    function ringArea(ring) {
      let sum = 0;
      for (let i = 1; i < ring.length; i++) {
        const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
        sum += geographic ? (x2 - x1) * Math.PI / 180 * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180)) : x1 * y2 - x2 * y1;
      }
      return Math.abs(sum) / 2 * (geographic ? 6371008.8 ** 2 : 1);
    }
    return multi(g).reduce((sum, p) => sum + ringArea(p[0]) - p.slice(1).reduce((n, r) => n + ringArea(r), 0), 0);
  }
  function chains(world, id) {
    const result = [];
    function walk(current, path) {
      if (path.includes(current)) fail('CYCLE', '行政關係形成循環');
      const e = get(world, current), next = [...path, current];
      if (!e.parents.length) result.push(next); else e.parents.forEach(parent => walk(parent, next));
    }
    walk(id, []);
    return result;
  }
  function country(world, id, seen = new Set()) {
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const e = world.entities[id];
    if (!e) return null;
    if (e.layer === 'Country') return e;
    for (const parent of e.parents) { const c = country(world, parent, seen); if (c) return c; }
    return null;
  }
  function resolvedColor(world, id) {
    const e = get(world, id), c = country(world, id) || e;
    if (world.settings.colorMode === 'local') return e.color;
    if (world.settings.colorMode === 'controller') return world.entities[e.controller]?.color || e.color;
    if (world.settings.colorMode === 'party') return c.data.partyColor || c.color;
    if (world.settings.colorMode === 'union') return world.entities[c.parents[0]]?.color || c.color;
    if (world.settings.puppetColors && c.overlord) return world.entities[c.overlord]?.color || c.color;
    return c.color;
  }
  function color(value) { if (!/^#[0-9a-f]{6}$/i.test(value)) fail('INVALID_COLOR', '顏色格式為 #RRGGBB'); return value; }
  function newEntity(args) {
    return { id: safeKey(args.id), code: args.code || args.id, name: text(args.name), layer: safeKey(args.layer),
      parents: [], claims: [], controller: null, overlord: null, flag: '', color: '#648da5', aliases: [], tags: [], translations: {}, data: {}, geometry: args.geometry ? clone(geometry(args.geometry)) : null };
  }
  function validate(world) {
    if (world.format !== 'mapchart-infinity' || world.version !== 1) fail('FORMAT', '不支援的存檔格式或版本');
    if (!Array.isArray(world.layers) || !world.entities || Array.isArray(world.entities)) fail('FORMAT', '缺少圖層或實體');
    const ids = new Set();
    for (const l of world.layers) {
      safeKey(l.id); if (ids.has(l.id)) fail('DUPLICATE', '重複圖層 ID'); ids.add(l.id);
      numeric(l.opacity, 0, 1);
      if (!['nested', 'independent'].includes(l.kind)) fail('LAYER_TYPE', '圖層類型無效');
      const seen = new Set([l.id]); let p = l.parentLayer;
      while (p) { if (seen.has(p)) fail('CYCLE', '圖層循環'); seen.add(p); p = layer(world, p).parentLayer; }
    }
    for (const [id, e] of Object.entries(world.entities)) {
      safeKey(id); if (e.id !== id) fail('IDENTITY', '物件 ID 與索引不同');
      text(e.name); color(e.color); const l = layer(world, e.layer);
      if (!Array.isArray(e.parents) || !Array.isArray(e.claims)) fail('FORMAT', '關係應為陣列');
      if (new Set(e.parents).size !== e.parents.length) fail('DUPLICATE', '父級重複');
      if (l.kind === 'nested' && !l.shared && e.parents.length > 1) fail('PARENT_LIMIT', `${l.name} 尚未開啟跨區共管`);
      for (const p of e.parents) {
        const parent = get(world, p);
        if (l.kind === 'nested' && l.parentLayer !== parent.layer) fail('PARENT_LAYER', `${e.name} 必須綁定到 ${l.parentLayer}`);
      }
      for (const p of [...e.claims, e.controller, e.overlord].filter(Boolean)) get(world, p);
      chains(world, id);
      const seen = new Set([id]); let ruler = e.overlord;
      while (ruler) { if (seen.has(ruler)) fail('CYCLE', '宗主關係循環'); seen.add(ruler); ruler = get(world, ruler).overlord; }
      if (e.geometry) geometry(e.geometry);
    }
    for (const u of world.units || []) { get(world, u.owner); if(u.location) get(world,u.location); }
    const screenIds = new Set();
    for (const screen of world.screens || []) {
      safeKey(screen.id);
      if (screenIds.has(screen.id)) fail('DUPLICATE', '畫面 ID 重複');
      screenIds.add(screen.id);
      text(screen.name);
      if (!Array.isArray(screen.controls)) fail('UI_FORMAT', '畫面元件資料無效');
      const controlIds = new Set();
      for (const control of screen.controls) {
        safeKey(control.id);
        if (controlIds.has(control.id)) fail('DUPLICATE', '元件 ID 重複');
        controlIds.add(control.id);
        validateControl(world, control);
      }
    }
    const scriptIds = new Set();
    for (const script of world.scripts || []) {
      safeKey(script.id);
      if (scriptIds.has(script.id)) fail('DUPLICATE', '腳本 ID 重複');
      scriptIds.add(script.id);
      text(script.name);
      text(script.source);
    }
    return true;
  }
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase();
  function score(query, value) {
    const q = normalize(query), v = normalize(value);
    if (!q) return 1;
    if (v === q) return 1000;
    if (v.startsWith(q)) return 800;
    if (v.includes(q)) return 600;
    let at = 0;
    for (const ch of v) if (ch === q[at]) at++;
    if (at === q.length) return 300 - v.length;
    if (q.length > 2) {
      let previous = Array.from({ length: v.length + 1 }, (_, i) => i);
      for (let i = 1; i <= q.length; i++) {
        const row = [i];
        for (let j = 1; j <= v.length; j++) row[j] = Math.min(row[j-1]+1, previous[j]+1, previous[j-1]+(q[i-1] === v[j-1] ? 0 : 1));
        previous = row;
      }
      if (previous[v.length] <= 2) return 100 - previous[v.length];
    }
    return 0;
  }
  function search(world, query) {
    return Object.values(world.entities).map(e => ({ entity: e, score: Math.max(...[e.id,e.code,e.name,...e.aliases,...Object.values(e.translations)].map(v=>score(query,v))) }))
      .filter(r => r.score > 0).sort((a,b)=>b.score-a.score || a.entity.id.localeCompare(b.entity.id));
  }
  function aiContext(world, request, selectedId, limit = 350) {
    text(request);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('LIMIT', 'AI 資料數量限制無效');
    const entities = Object.values(world.entities), priorities = new Map();
    const selected = selectedId ? world.entities[selectedId] : null;
    function prioritize(id, weight) {
      if (!id || !world.entities[id]) return;
      priorities.set(id, Math.max(priorities.get(id) || 0, weight));
    }
    if (selected) {
      prioritize(selected.id, 10000);
      const queue = [...selected.parents, ...selected.claims, selected.controller, selected.overlord].filter(Boolean);
      const visited = new Set();
      while (queue.length && visited.size < 1000) {
        const id = queue.shift();
        if (visited.has(id) || !world.entities[id]) continue;
        visited.add(id);
        prioritize(id, 9000);
        queue.push(...world.entities[id].parents);
      }
    }
    const normalizedRequest = normalize(request);
    for (const entity of entities) {
      const names = [entity.id, entity.code, entity.name, ...entity.aliases, ...Object.values(entity.translations)];
      for (const name of names) {
        const needle = normalize(name || '');
        if (needle.length >= 2 && normalizedRequest.includes(needle)) {
          prioritize(entity.id, 5000 + Math.min(needle.length, 100));
        }
      }
    }
    const ordered = entities.map((entity, index) => ({entity, index, priority:priorities.get(entity.id) || 0}))
      .sort((a,b) => b.priority - a.priority || a.index - b.index);
    const included = ordered.slice(0,limit).map(({entity}) => ({
      id:entity.id, code:entity.code, name:entity.name, layer:entity.layer,
      parents:entity.parents, controller:entity.controller, claims:entity.claims
    }));
    const details = selected ? { id:selected.id, data:{}, omittedDataKeys:[] } : null;
    if (details) {
      let total = 0;
      for (const [key, value] of Object.entries(selected.data)) {
        const encoded = JSON.stringify(value);
        if (!encoded || encoded.length > 2000 || total + encoded.length > 12000) details.omittedDataKeys.push(key);
        else { details.data[key] = value; total += encoded.length; }
      }
    }
    return {
      selected: details,
      entities: included,
      totalEntities: entities.length,
      includedEntities: included.length,
      allEntitiesIncluded: included.length === entities.length,
      layers: world.layers.map(layer => ({id:layer.id,name:layer.name,parentLayer:layer.parentLayer,shared:layer.shared}))
    };
  }
  const registry = [];
  const handlers = new Map();
  function register(id, title, category, description, example, handler, readOnly = false) {
    registry.push({id,title,category,description,example,readOnly,status:'implemented'});
    handlers.set(id,handler);
  }
  class Engine {
    constructor(world) { validate(world); this.world = world; this.undoStack = []; this.redoStack = []; }
    execute(commands, expectedRevision = this.world.revision) {
      if (expectedRevision !== this.world.revision) fail('REVISION_CONFLICT','地圖已變更，請重新預覽');
      if (!Array.isArray(commands)) commands = [commands];
      if (commands.length > 500) fail('BUDGET','每批最多 500 個操作');
      const previous = this.world;
      const draft = { ...previous, entities: {...previous.entities}, layers: clone(previous.layers),
        settings: {...previous.settings}, relations: clone(previous.relations), units: clone(previous.units), drawings: clone(previous.drawings),
        events: clone(previous.events), processedEvents: [...previous.processedEvents], plugins: clone(previous.plugins),
        rules: clone(previous.rules), folders: clone(previous.folders), screens: clone(previous.screens || []),
        scripts: clone(previous.scripts || []), history: [...previous.history] };
      const edited = new Set();
      let invocations = 0, depth = 0;
      const ctx = { world: draft, edit: id => {
        const e = get(draft,id);
        if (!edited.has(id)) { draft.entities[id] = {...e, parents:[...e.parents],claims:[...e.claims],aliases:[...e.aliases],tags:[...e.tags],translations:{...e.translations},data:clone(e.data)}; edited.add(id); }
        return draft.entities[id];
      }, call: (id, args) => {
        if (!handlers.has(id)) fail('UNKNOWN_COMMAND', `未知指令 ${id}`);
        invocations += 1;
        if (invocations > 2000 || depth >= 32) fail('BUDGET', '指令執行超過安全限制');
        depth += 1;
        try { return handlers.get(id)(ctx, args || {}); }
        finally { depth -= 1; }
      } };
      const results = commands.map(command => ctx.call(command.command, command.args));
      validate(draft);
      const writes = commands.some(c => !registry.find(r=>r.id===c.command)?.readOnly);
      if (writes) {
        draft.revision = previous.revision + 1;
        draft.history.push({ revision:draft.revision, date:draft.date, commands:commands.map(c=>c.command) });
        draft.history = draft.history.slice(-200);
        this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift();
        this.redoStack=[]; this.world=draft;
      }
      return results;
    }
    preview(commands) { const trial = new Engine(this.world); const result=trial.execute(commands); return {revision:this.world.revision,result,world:trial.world}; }
    undo() { if (!this.undoStack.length) return false; const previous=this.undoStack.pop(); this.redoStack.push(this.world); this.world={...previous,revision:this.world.revision+1}; return true; }
    redo() { if (!this.redoStack.length) return false; const next=this.redoStack.pop(); this.undoStack.push(this.world); this.world={...next,revision:this.world.revision+1}; return true; }
  }
  register('entity.create','建立地塊／實體','地圖','建立具有穩定 ID 的物件，幾何可稍後補上。',{id:'TW-TPE',name:'臺北市',layer:'State'},(c,a)=>{if(c.world.entities[a.id])fail('DUPLICATE','識別碼已使用');layer(c.world,a.layer);c.world.entities[a.id]=newEntity(a);return a.id;});
  register('entity.rename','重新命名','地圖','修改名稱並保留 ID 與所有關係。',{id:'TW-TPE',name:'臺北'},(c,a)=>c.edit(a.id).name=text(a.name));
  register('entity.code','設定地塊代碼','代碼','設定給作者使用的代碼，可用搜尋找到。',{id:'TW-TPE',code:'TPE'},(c,a)=>c.edit(a.id).code=text(a.code));
  register('entity.color','設定地塊顏色','顯示','修改本地顏色，切換本地配色可查看。',{id:'TW-TPE',color:'#5388aa'},(c,a)=>c.edit(a.id).color=color(a.color));
  register('entity.flag','設定旗幟','顯示','使用 emoji 或 PNG/JPEG/WebP 的 data URL。',{id:'TW-TPE',flag:'🇹🇼'},(c,a)=>{text(a.flag);if(a.flag.length>2000000||a.flag.includes('<')||a.flag.includes('://')||(/^data:/.test(a.flag)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.flag)))fail('FLAG','請使用旗幟文字或本地圖片');c.edit(a.id).flag=a.flag;});
  register('entity.translate','編輯翻譯','語言','同一實體可保存多個語言名稱。',{id:'TW-TPE',language:'en',value:'Taipei'},(c,a)=>c.edit(a.id).translations[safeKey(a.language)]=text(a.value));
  register('entity.alias','加入別名','語言','別名會納入跨圖層搜尋。',{id:'TW-TPE',value:'Taipeh'},(c,a)=>{const e=c.edit(a.id);if(!e.aliases.includes(text(a.value)))e.aliases.push(a.value);});
  register('entity.tag','加入標籤','資料','分類標籤支援跨層級整理。',{id:'TW-TPE',tag:'首都'},(c,a)=>{const e=c.edit(a.id);if(!e.tags.includes(text(a.tag)))e.tags.push(a.tag);});
  register('entity.untag','移除標籤','資料','移除指定分類標籤。',{id:'TW-TPE',tag:'首都'},(c,a)=>{const e=c.edit(a.id);e.tags=e.tags.filter(t=>t!==a.tag);});
  register('entity.data','寫入自訂資料','資料','可保存數字、文字、陣列和物件。',{id:'TW-TPE',key:'population',value:2500000},(c,a)=>{safeKey(a.key);if(a.value===undefined)fail('VALUE','缺少 value');c.edit(a.id).data[a.key]=clone(a.value);});
  register('entity.increment','調整數值','資料','對已有的數值加減，避免把文字當數字。',{id:'TW-TPE',key:'population',amount:1000},(c,a)=>{const e=c.edit(a.id);e.data[safeKey(a.key)]=numeric(e.data[a.key]??0)+numeric(a.amount);numeric(e.data[a.key]);});
  register('entity.delete','刪除地塊／實體','地圖','被父級、控制權、部隊引用的實體須先解除引用。',{id:'TW-TPE'},(c,a)=>{get(c.world,a.id);for(const e of Object.values(c.world.entities))if([...e.parents,...e.claims,e.controller,e.overlord].includes(a.id))fail('REFERENCED','此實體仍被引用');if(c.world.units.some(u=>u.owner===a.id||u.location===a.id))fail('REFERENCED','部隊仍引用此實體');delete c.world.entities[a.id];});
  register('entity.get','查詢實體','查詢','讀取名稱、顏色、關係與自訂資料。',{id:'TW-TPE'},(c,a)=>clone(get(c.world,a.id)),true);
  register('entity.search','跨圖層搜尋','查詢','同時搜尋名稱、ID、代碼、翻譯和別名。',{query:'Taipei'},(c,a)=>search(c.world,text(a.query)).slice(0,100).map(r=>r.entity.id),true);
  register('entity.chain','完整關係鏈','查詢','跨區共管會回傳所有行政父級路徑。',{id:'TW-TPE'},(c,a)=>chains(c.world,a.id),true);
  register('entity.bind','綁定上級','圖層','嵌套層綁到上一層，跨區共管允許多個上級。',{id:'TW-TPE',parents:['TWN']},(c,a)=>{if(!Array.isArray(a.parents))fail('PARENTS','parents 需要陣列');c.edit(a.id).parents=[...a.parents];});
  register('entity.controller','變更控制方','模擬','控制權獨立保存，可據此為村、鄉及縣上色。',{id:'TW-TPE',controller:'TWN'},(c,a)=>{if(a.controller)get(c.world,a.controller);c.edit(a.id).controller=a.controller||null;});
  register('entity.claim','設定爭議方','模擬','保留每個宣稱方，供資訊卡和多方圖例使用。',{id:'TW-TPE',claims:['TWN']},(c,a)=>{if(!Array.isArray(a.claims))fail('CLAIMS','claims 需要陣列');a.claims.forEach(id=>get(c.world,id));c.edit(a.id).claims=[...new Set(a.claims)];});
  register('country.overlord','設定宗主國','外交','宗主國配色可即時傳到藩屬。',{id:'TWN',overlord:null},(c,a)=>{if(a.overlord)get(c.world,a.overlord);c.edit(a.id).overlord=a.overlord||null;});
  register('layer.create','建立圖層','圖層','建立獨立或嵌套圖層。',{id:'Village',name:'村',kind:'nested',parentLayer:'Province'},(c,a)=>{safeKey(a.id);if(c.world.layers.some(l=>l.id===a.id))fail('DUPLICATE','圖層已存在');c.world.layers.push({id:a.id,name:a.name||a.id,kind:a.kind||'independent',parentLayer:a.parentLayer||null,shared:false,visible:true,opacity:1});});
  register('layer.configure','圖層設定','圖層','修改透明度、可見度、嵌套及跨區共管設定。',{id:'State',shared:true,opacity:0.6},(c,a)=>{const l=layer(c.world,a.id);for(const k of ['name','kind','parentLayer','shared','visible','opacity'])if(a[k]!==undefined)l[k]=a[k];});
  register('layer.reorder','調整疊放順序','圖層','把圖層移到指定索引。',{id:'Country',index:0},(c,a)=>{numeric(a.index,0,c.world.layers.length-1);const i=c.world.layers.findIndex(l=>l.id===a.id);if(i<0)fail('NOT_FOUND','圖層不存在');c.world.layers.splice(a.index,0,c.world.layers.splice(i,1)[0]);});
  register('layer.delete','移除空圖層','圖層','清空內容與下層關係後可移除圖層。',{id:'Village'},(c,a)=>{layer(c.world,a.id);if(Object.values(c.world.entities).some(e=>e.layer===a.id)||c.world.layers.some(l=>l.parentLayer===a.id))fail('REFERENCED','圖層仍有內容或下級');c.world.layers=c.world.layers.filter(l=>l.id!==a.id);});
  register('layer.autobind','依最大面積自動綁定','圖層','計算子區與各上級的相交面積，選擇佔比最高者；平手按 ID 排序。',{id:'Province'},(c,a)=>{
    const l=layer(c.world,a.id);if(!l.parentLayer)fail('NO_PARENT','先指定上級圖層');
    const parents=Object.values(c.world.entities).filter(e=>e.layer===l.parentLayer&&e.geometry).sort((a,b)=>a.id.localeCompare(b.id));
    const changes=[];
    for(const e of Object.values(c.world.entities).filter(e=>e.layer===a.id&&e.geometry)) {
      let best=null, largest=0;
      for(const p of parents){const coords=clip.intersection(multi(e.geometry),multi(p.geometry));const n=coords.length?area({type:'MultiPolygon',coordinates:coords},c.world.coordinateSystem==='geographic'):0;if(n>largest){largest=n;best=p.id;}}
      if(best){c.edit(e.id).parents=[best];changes.push({id:e.id,parent:best,share:largest/area(e.geometry,c.world.coordinateSystem==='geographic')});}
    }return changes;
  });
  register('layer.aggregate','由子區推算控制權','圖層','以子區面積或自訂數值加權，保留各方比例；平手按 ID 排序。',{id:'State',weight:'area'},(c,a)=>{
    const results=[];
    for(const p of Object.values(c.world.entities).filter(e=>e.layer===a.id)){
      const votes={};for(const e of Object.values(c.world.entities).filter(e=>e.parents.includes(p.id)&&e.controller)) {const w=a.weight==='area'?area(e.geometry,c.world.coordinateSystem==='geographic'):numeric(e.data[a.weight]??0,0);votes[e.controller]=(votes[e.controller]||0)+w;}
      const ranked=Object.entries(votes).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));if(ranked.length){const e=c.edit(p.id);e.controller=ranked[0][0];e.data.controlShares=votes;results.push({id:p.id,votes});}
    }return results;
  });
  register('geometry.replace','修改地塊邊界','繪圖','保存封閉多邊形，可含洞與多個離島。',{id:'TW-TPE',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}},(c,a)=>c.edit(a.id).geometry=clone(geometry(a.geometry)));
  register('geometry.move','移動地塊','繪圖','對全部頂點平移，座標單位由地圖決定。',{id:'TW-TPE',dx:1,dy:0},(c,a)=>{numeric(a.dx);numeric(a.dy);const e=c.edit(a.id);if(!e.geometry)fail('NO_GEOMETRY','此實體沒有邊界');e.geometry=clone(e.geometry);for(const p of multi(e.geometry))for(const r of p)for(const xy of r){xy[0]+=a.dx;xy[1]+=a.dy;}});
  register('geometry.merge','合併地塊','繪圖','將同層地塊合併到目標，其他地塊及引用保留。',{target:'TW-TPE',ids:['TW-TPE','TW-NEW']},(c,a)=>{const target=c.edit(a.target);const items=a.ids.map(id=>get(c.world,id));if(items.some(e=>e.layer!==target.layer||!e.geometry))fail('GEOMETRY','合併需要同層且具有邊界');target.geometry={type:'MultiPolygon',coordinates:clip.union(...items.map(e=>multi(e.geometry)))};});
  register('geometry.cut','以遮罩切分地塊','繪圖','保留遮罩外部分，遮罩內部分建立新 ID，繼承資料與行政關係。',{id:'TW-TPE',newId:'TW-TPE-2',mask:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}},(c,a)=>{const e=c.edit(a.id);geometry(a.mask);if(c.world.entities[a.newId])fail('DUPLICATE','新 ID 已存在');safeKey(a.newId);if(!e.geometry)fail('GEOMETRY','缺少邊界');const inside=clip.intersection(multi(e.geometry),multi(a.mask)),outside=clip.difference(multi(e.geometry),multi(a.mask));if(!inside.length||!outside.length)fail('EMPTY_SPLIT','遮罩必須真正切分地塊');const other=clone(e);other.id=a.newId;other.code=a.newId;other.name=e.name+' 分區';other.geometry={type:'MultiPolygon',coordinates:inside};e.geometry={type:'MultiPolygon',coordinates:outside};c.world.entities[other.id]=other;});
  register('geometry.area','計算地塊面積','查詢','地理座標回傳近似平方公尺，平面座標回傳平方座標單位。',{id:'TW-TPE'},(c,a)=>area(get(c.world,a.id).geometry,c.world.coordinateSystem==='geographic'),true);
  register('map.settings','修改顯示與工作區','顯示','設定 Started／Developer、lite、國旗、名稱及配色。',{colorMode:'controller',flags:true},(c,a)=>{for(const k of Object.keys(a)){if(!(k in c.world.settings))fail('SETTING','未知設定 '+k);c.world.settings[k]=a[k];}if(!['Started','Developer'].includes(c.world.settings.workspace)||!['country','controller','party','union','local'].includes(c.world.settings.colorMode))fail('SETTING','設定值無效');});
  register('map.rename','命名世界','檔案','編輯存檔顯示名稱。',{name:'我的架空世界'},(c,a)=>c.world.name=text(a.name));
  register('map.validate','檢查世界資料','查詢','檢查 ID、圖層、父級循環與幾何格式。',{},c=>validate(c.world),true);
  register('diplomacy.relation','調整外交關係','外交','兩國關係值限制在 -100 至 100。',{from:'TWN',to:'JPN',delta:10},(c,a)=>{get(c.world,a.from);get(c.world,a.to);if(a.from===a.to)fail('SELF','不能對自己執行');let r=c.world.relations.find(r=>r.kind==='opinion'&&r.from===a.from&&r.to===a.to);if(!r){r={kind:'opinion',from:a.from,to:a.to,value:0};c.world.relations.push(r);}r.value=Math.max(-100,Math.min(100,r.value+numeric(a.delta)));return r.value;});
  register('diplomacy.war','宣戰','外交','新增戰爭關係及日期。',{from:'TWN',to:'JPN'},(c,a)=>{get(c.world,a.from);get(c.world,a.to);if(a.from===a.to)fail('SELF','不能對自己宣戰');if(c.world.relations.some(r=>r.kind==='war'&&[r.from,r.to].includes(a.from)&&[r.from,r.to].includes(a.to)))fail('DUPLICATE','已處於戰爭');c.world.relations.push({kind:'war',from:a.from,to:a.to,date:c.world.date});});
  register('diplomacy.peace','結束戰爭','外交','移除雙方間的戰爭關係，領土另行編輯。',{from:'TWN',to:'JPN'},(c,a)=>{c.world.relations=c.world.relations.filter(r=>!(r.kind==='war'&&[r.from,r.to].includes(a.from)&&[r.from,r.to].includes(a.to)));});
  register('diplomacy.invite','邀請加入聯盟','外交','建立邀請，受邀國接受後建立聯盟父級。',{from:'TWN',to:'JPN',union:'UNION-1'},(c,a)=>{get(c.world,a.from);get(c.world,a.to);if(get(c.world,a.union).layer!=='Union')fail('TYPE','請指定 Union');c.world.relations.push({kind:'invitation',from:a.from,to:a.to,union:a.union});});
  register('diplomacy.accept','接受聯盟邀請','外交','消耗匹配的邀請並綁定聯盟。',{id:'JPN',union:'UNION-1'},(c,a)=>{const i=c.world.relations.findIndex(r=>r.kind==='invitation'&&r.to===a.id&&r.union===a.union);if(i<0)fail('INVITATION','找不到邀請');c.call('entity.bind',{id:a.id,parents:[a.union]});c.world.relations.splice(i,1);});
  register('diplomacy.civilwar','建立內戰勢力','外交','把明確指定的地塊轉給新勢力，建立戰爭；遊戲規則操作。',{country:'TWN',rebelId:'REB',name:'地方勢力',regions:['TW-TPE']},(c,a)=>{const original=get(c.world,a.country);if(!a.regions?.length)fail('REGIONS','請指定地塊');if(a.regions.includes(a.country))fail('REGIONS','請選擇下級地塊');for(const id of a.regions){const e=get(c.world,id);if(country(c.world,id)?.id!==a.country&&e.controller!==a.country)fail('OWNERSHIP','地塊不屬於指定國家');}c.call('entity.create',{id:a.rebelId,name:a.name,layer:'Country'});c.edit(a.rebelId).color='#b35b58';c.edit(a.rebelId).parents=[...original.parents];for(const id of a.regions)c.edit(id).controller=a.rebelId;c.call('diplomacy.war',{from:a.rebelId,to:a.country});});
  register('unit.create','建立部隊','軍事','保存兵力、補給、士氣、SIDC 與所在位置。',{id:'unit-1',name:'衛戍營',owner:'TWN',location:'TW-TPE',strength:800},(c,a)=>{safeKey(a.id);if(c.world.units.some(u=>u.id===a.id))fail('DUPLICATE','部隊 ID 已存在');get(c.world,a.owner);get(c.world,a.location);c.world.units.push({id:a.id,name:text(a.name),owner:a.owner,location:a.location,strength:numeric(a.strength,0),supply:100,morale:100,parent:null,sidc:'SFGPUCI--------'});});
  register('unit.configure','修改部隊資料','軍事','編輯兵力、補給、士氣、名稱或 SIDC。',{id:'unit-1',supply:80},(c,a)=>{const u=c.world.units.find(u=>u.id===a.id);if(!u)fail('UNIT','找不到部隊');for(const k of ['strength','supply','morale'])if(a[k]!==undefined)u[k]=numeric(a[k],0,k==='strength'?Infinity:100);for(const k of ['name','sidc'])if(a[k]!==undefined)u[k]=text(a[k]);});
  register('unit.move','移動部隊','軍事','將部隊位置設定到指定地塊。',{id:'unit-1',location:'TW-TPE'},(c,a)=>{get(c.world,a.location);const u=c.world.units.find(u=>u.id===a.id);if(!u)fail('UNIT','找不到部隊');u.location=a.location;});
  register('unit.group','整編部隊','軍事','將多個同國部隊編入上級指揮編組，維持各自兵力與位置。',{id:'group-1',name:'柏林衛戍隊',members:['unit-1']},(c,a)=>{safeKey(a.id);if(c.world.units.some(u=>u.id===a.id))fail('DUPLICATE','編組已存在');const members=a.members.map(id=>c.world.units.find(u=>u.id===id));if(!members.length||members.some(u=>!u||u.owner!==members[0].owner))fail('UNIT','需要同國部隊');const leader={...members[0],id:a.id,name:text(a.name),strength:0,parent:null,group:true};members.forEach(u=>u.parent=a.id);c.world.units.push(leader);});
  register('drawing.add','繪製線段與曲線','繪圖','points 使用地圖座標，curve 開啟平滑曲線，soft 開啟柔性區域。',{id:'line-1',points:[[0,0],[10,10]],color:'#c19752',width:2,dash:[5,3]},(c,a)=>{safeKey(a.id);if(c.world.drawings.some(d=>d.id===a.id))fail('DUPLICATE','線段 ID 已存在');if(!a.points||a.points.length<2)fail('POINTS','至少兩個點');a.points.forEach(p=>{numeric(p[0]);numeric(p[1]);});c.world.drawings.push({id:a.id,points:clone(a.points),color:color(a.color||'#c19752'),width:numeric(a.width??2,0.1,100),dash:a.dash||[],curve:!!a.curve,soft:!!a.soft,opacity:numeric(a.opacity??1,0,1)});});
  register('drawing.remove','移除線段','繪圖','依 ID 移除線段或柔性區域。',{id:'line-1'},(c,a)=>c.world.drawings=c.world.drawings.filter(d=>d.id!==a.id));
  register('plugin.install','安裝資料模組','模組','安裝具備依賴與可執行操作的 JSON 模組。',{id:'my-mod',name:'我的模組',dependencies:[],actions:[]},(c,a)=>{safeKey(a.id);if(c.world.plugins.some(p=>p.id===a.id))fail('DUPLICATE','模組已安裝');for(const id of a.dependencies||[])if(!c.world.plugins.some(p=>p.id===id&&p.enabled))fail('DEPENDENCY','缺少仰賴包 '+id);for(const action of a.actions||[])for(const op of action.commands||[])if(!handlers.has(op.command))fail('UNKNOWN_COMMAND','模組使用未知指令');c.world.plugins.push({...clone(a),enabled:true});});
  register('plugin.toggle','啟用／停用模組','模組','停用時檢查其他已啟用模組的依賴。',{id:'my-mod',enabled:false},(c,a)=>{const p=c.world.plugins.find(p=>p.id===a.id);if(!p)fail('PLUGIN','找不到模組');if(!a.enabled&&c.world.plugins.some(p=>p.enabled&&p.dependencies?.includes(a.id)))fail('DEPENDENCY','其他模組依賴此包');if(a.enabled)for(const id of p.dependencies||[])if(!c.world.plugins.some(p=>p.id===id&&p.enabled))fail('DEPENDENCY','缺少已啟用仰賴包');p.enabled=!!a.enabled;});
  register('plugin.run','執行模組操作','模組','以同一交易執行模組指令，失敗時整批回復。',{id:'my-mod',action:'action-1',target:'TWN'},(c,a)=>{const p=c.world.plugins.find(p=>p.id===a.id&&p.enabled);const action=p?.actions?.find(x=>x.id===a.action);if(!action)fail('PLUGIN','找不到已啟用操作');for(const op of action.commands){if(op.command==='plugin.run')fail('RECURSION','模組操作不能遞迴呼叫');const resolve = value => {
      if (value === '$target') return a.target;
      if (typeof value === 'string' && value.startsWith('$param:')) {
        const key = safeKey(value.slice(7));
        if (!a.params || !Object.hasOwn(a.params, key)) fail('PARAMETER', '缺少模組參數 ' + key);
        return clone(a.params[key]);
      }
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [safeKey(key),resolve(item)]));
      return value;
    };
    c.call(op.command,resolve(op.args));}});
  register('event.add','新增時間事件','模擬','事件到期後按指令執行，存檔記錄已執行 ID。',{id:'event-1',date:'2026-02-01',title:'建設完成',commands:[{command:'entity.increment',args:{id:'TWN',key:'infrastructure',amount:1}}]},(c,a)=>{safeKey(a.id);if(c.world.events.some(e=>e.id===a.id))fail('DUPLICATE','事件 ID 已存在');validDate(a.date);for(const op of a.commands||[])if(!handlers.has(op.command)||['simulation.advance','event.add'].includes(op.command))fail('EVENT','事件含不支援的遞迴操作');c.world.events.push(clone(a));});
  register('simulation.advance','推進時間','模擬','按日期執行事件，史實模式受資料校驗日期限制。',{days:1},(c,a)=>{
    if(c.world.settings.lite)fail('LITE','請關閉 lite 模式以推進模擬');numeric(a.days,1,36525);if(!Number.isInteger(a.days))fail('DAYS','天數必須是整數');
    const date=new Date(c.world.date+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+a.days);const until=date.toISOString().slice(0,10);
    if(c.world.settings.historical&&(!c.world.coverage.verifiedThrough||until>c.world.coverage.verifiedThrough))fail('HISTORY_COVERAGE','此日期尚缺經校驗的史實事件與疆界資料');
    const due=c.world.events.filter(e=>e.date<=until&&!c.world.processedEvents.includes(e.id)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    for(const e of due){c.world.date=e.date;for(const op of e.commands)c.call(op.command,op.args);c.world.processedEvents.push(e.id);}c.world.date=until;return due.map(e=>e.id);
  });
  register('folder.create','建立樹狀分類','檔案','建立虛擬資料夾，不複製實體資料。',{id:'folder-1',name:'我的國家',parent:null,members:['TWN']},(c,a)=>{safeKey(a.id);if(c.world.folders.some(f=>f.id===a.id))fail('DUPLICATE','資料夾已存在');if(a.parent&&!c.world.folders.some(f=>f.id===a.parent))fail('FOLDER','父資料夾不存在');c.world.folders.push({id:a.id,name:text(a.name),parent:a.parent||null,members:a.members||[]});});

  function getScreen(world, id) {
    return (world.screens || []).find(screen => screen.id === safeKey(id))
      || fail('SCREEN_NOT_FOUND', `找不到畫面 ${id}`);
  }
  function getControl(screen, id) {
    return screen.controls.find(control => control.id === safeKey(id))
      || fail('CONTROL_NOT_FOUND', `找不到元件 ${id}`);
  }
  function validateControl(world, control) {
    if (!['label', 'button', 'number', 'text', 'toggle'].includes(control.type)) {
      fail('CONTROL_TYPE', '不支援的元件類型');
    }
    text(control.label);
    if (control.binding) {
      const binding = control.binding;
      safeKey(binding.key);
      if (binding.entity !== '$selected') get(world, binding.entity);
      if (!['number', 'text', 'toggle'].includes(control.type)) fail('BINDING', '此元件不能綁定數值');
    }
    if (control.action) {
      if (control.type !== 'button') fail('CONTROL_ACTION', '只有按鈕可綁定動作');
      if (!handlers.has(control.action.command)) fail('UNKNOWN_COMMAND', '元件動作使用未知指令');
      if (!control.action.args || typeof control.action.args !== 'object' || Array.isArray(control.action.args)) {
        fail('CONTROL_ACTION', '按鈕動作參數必須是物件');
      }
    }
  }
  function replaceVariables(value, variables) {
    if (typeof value === 'string' && Object.hasOwn(variables, value)) return clone(variables[value]);
    if (Array.isArray(value)) return value.map(item => replaceVariables(item, variables));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [safeKey(key), replaceVariables(item, variables)]));
    }
    return value;
  }
  register('ui.screen.create', '建立 UI 畫面', '介面', '新增可視化畫面，畫面儲存在世界存檔中。',
    {id:'country-panel',name:'國家面板'}, (c,a) => {
      safeKey(a.id); text(a.name);
      if (c.world.screens.some(screen => screen.id === a.id)) fail('DUPLICATE', '畫面 ID 已存在');
      c.world.screens.push({id:a.id,name:a.name,controls:[]});
    });
  register('ui.screen.rename', '更名 UI 畫面', '介面', '修改畫面名稱，保留元件與動作。',
    {id:'country-panel',name:'新面板'}, (c,a) => { getScreen(c.world,a.id).name=text(a.name); });
  register('ui.screen.delete', '刪除 UI 畫面', '介面', '刪除指定畫面及其中元件，可復原。',
    {id:'country-panel'}, (c,a) => { getScreen(c.world,a.id); c.world.screens=c.world.screens.filter(screen=>screen.id!==a.id); });
  register('ui.control.add', '新增 UI 元件', '介面', '加入文字、按鈕、數值、輸入框或開關。',
    {screen:'country-panel',id:'title',type:'label',label:'國家'}, (c,a) => {
      const screen=getScreen(c.world,a.screen);
      safeKey(a.id); text(a.label);
      if (screen.controls.some(control=>control.id===a.id)) fail('DUPLICATE','元件 ID 已存在');
      const control={id:a.id,type:a.type,label:a.label,value:a.value ?? null,binding:a.binding ?? null,action:a.action ?? null};
      validateControl(c.world,control);
      screen.controls.push(control);
    });
  register('ui.control.update', '修改 UI 元件', '介面', '修改元件標籤、類型、資料綁定與按鈕動作。',
    {screen:'country-panel',id:'title',label:'名稱'}, (c,a) => {
      const control=getControl(getScreen(c.world,a.screen),a.id);
      for (const key of ['type','label','value','binding','action']) if (Object.hasOwn(a,key)) control[key]=clone(a[key]);
      validateControl(c.world,control);
    });
  register('ui.control.move', '調整 UI 順序', '介面', '把畫面元件移到指定位置。',
    {screen:'country-panel',id:'title',index:0}, (c,a) => {
      const screen=getScreen(c.world,a.screen), control=getControl(screen,a.id);
      if (!Number.isInteger(a.index)) fail('INDEX','位置必須是整數');
      numeric(a.index,0,screen.controls.length-1);
      screen.controls.splice(screen.controls.indexOf(control),1);
      screen.controls.splice(a.index,0,control);
    });
  register('ui.control.delete', '刪除 UI 元件', '介面', '移除指定元件，可使用復原。',
    {screen:'country-panel',id:'title'}, (c,a) => {
      const screen=getScreen(c.world,a.screen); getControl(screen,a.id);
      screen.controls=screen.controls.filter(control=>control.id!==a.id);
    });
  register('ui.control.setValue', '設定 UI 元件值', '介面', '設定元件的值，資料綁定會即時寫回實體。',
    {screen:'country-panel',id:'population',selected:'TWN',value:100}, (c,a) => {
      const control=getControl(getScreen(c.world,a.screen),a.id);
      if (!['number','text','toggle'].includes(control.type)) fail('CONTROL_TYPE','元件不能輸入資料');
      if (control.type==='number') numeric(a.value);
      if (control.type==='text') text(a.value);
      if (control.type==='toggle' && typeof a.value!=='boolean') fail('VALUE','開關需要 true 或 false');
      if (control.binding) {
        const entity=control.binding.entity==='$selected'?safeKey(a.selected):control.binding.entity;
        c.call('entity.data',{id:entity,key:control.binding.key,value:a.value});
      } else control.value=clone(a.value);
    });
  register('ui.control.invoke', '執行 UI 按鈕', '介面', '以當前選取對象執行按鈕綁定指令。',
    {screen:'country-panel',id:'update',selected:'TWN'}, (c,a) => {
      const control=getControl(getScreen(c.world,a.screen),a.id);
      if (control.type!=='button'||!control.action) fail('CONTROL_ACTION','按鈕沒有設定動作');
      const args=replaceVariables(control.action.args,{'$selected':a.selected,'$value':a.value ?? null});
      return c.call(control.action.command,args);
    });
  register('code.save', '儲存腳本', '代碼', '保存中文或英文指令腳本，檢查語法後寫入世界存檔。',
    {id:'script-1',name:'改名',source:'entity.rename {"id":"TWN","name":"臺灣"}'}, (c,a) => {
      safeKey(a.id); text(a.name); text(a.source); parseCode(a.source);
      const existing=c.world.scripts.find(script=>script.id===a.id);
      if (existing) { existing.name=a.name; existing.source=a.source; }
      else c.world.scripts.push({id:a.id,name:a.name,source:a.source,language:'mapchart-command-v1'});
    });
  register('code.delete', '刪除腳本', '代碼', '移除指定腳本，可使用復原。',
    {id:'script-1'}, (c,a) => {
      if (!c.world.scripts.some(script=>script.id===a.id)) fail('SCRIPT_NOT_FOUND','找不到腳本');
      c.world.scripts=c.world.scripts.filter(script=>script.id!==a.id);
    });
  register('code.run', '執行腳本', '代碼', '按順序執行已保存的腳本；失敗時整批回復。',
    {id:'script-1'}, (c,a) => {
      const script=c.world.scripts.find(script=>script.id===a.id);
      if (!script) fail('SCRIPT_NOT_FOUND','找不到腳本');
      return parseCode(script.source).map(command=>c.call(command.command,command.args));
    });
  register('entity.replaceData', '更新自訂資料', '資料', '整體更新指定實體的自訂資料。',
    {id:'TWN',data:{population:100}}, (c,a) => {
      if (!a.data || typeof a.data!=='object' || Array.isArray(a.data)) fail('DATA','資料必須是物件');
      Object.keys(a.data).forEach(safeKey);
      c.edit(a.id).data=clone(a.data);
    });

  function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('DATE','日期格式為 YYYY-MM-DD');}
  function stripComments(line) { let quote=false, escape=false;for(let i=0;i<line.length;i++){const ch=line[i];if(escape){escape=false;continue;}if(ch==='\\'&&quote){escape=true;continue;}if(ch==='"')quote=!quote;if(ch==='#'&&!quote)return line.slice(0,i);}return line; }
  function parseCode(source) {
    text(source);
    function checked(name, args, location) {
      const definition = registry.find(item => item.id === name || item.title === name);
      if (!definition) fail('UNKNOWN_COMMAND', `${location}：未知指令 ${name}`);
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        fail('CODE_SYNTAX', `${location}：指令參數必須是 JSON 物件`);
      }
      return {command: definition.id, args};
    }
    const trimmed = source.trim();
    let commands;
    if (trimmed.startsWith('[')) {
      let input;
      try { input = JSON.parse(trimmed); }
      catch (error) { fail('CODE_SYNTAX', `JSON 陣列格式錯誤：${error.message}`); }
      if (!Array.isArray(input)) fail('CODE_SYNTAX', '需要指令陣列');
      commands = input.map((item, index) => {
        const location = `第 ${index + 1} 個指令`;
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.command !== 'string') {
          fail('CODE_SYNTAX', `${location}：需要 command 與 args`);
        }
        return checked(item.command, Object.hasOwn(item, 'args') ? item.args : {}, location);
      });
    } else {
      const names = registry.flatMap(item => [item.id, item.title]).sort((a, b) => b.length - a.length);
      commands = [];
      source.split('\n').forEach((raw, index) => {
        const line = stripComments(raw).trim();
        if (!line) return;
        const location = `第 ${index + 1} 行`;
        const name = names.find(candidate => line === candidate ||
          (line.startsWith(candidate) && /\s/.test(line[candidate.length] || '')));
        if (!name) fail('UNKNOWN_COMMAND', `${location}：未知指令 ${line.split(/\s/)[0]}`);
        const tail = line.slice(name.length).trim();
        let args = {};
        if (tail) {
          try { args = JSON.parse(tail); }
          catch (error) { fail('CODE_SYNTAX', `${location}：JSON 格式錯誤：${error.message}`); }
        }
        commands.push(checked(name, args, location));
      });
    }
    if (commands.length > 500) fail('BUDGET', '每份腳本最多 500 個操作');
    return commands;
  }
  function fromGeoJSON(json,name='匯入地圖',target='Province') {
    const world=blank(name);const features=json.type==='FeatureCollection'?json.features:[json];
    for(const [i,f] of features.entries()){
      if(!f.geometry||!['Polygon','MultiPolygon'].includes(f.geometry.type))continue;
      const p=f.properties||{}, id=String(p.ADM0_A3||p.id||f.id||'region-'+i);
      if(world.entities[id])fail('DUPLICATE','GeoJSON 含重複識別碼 '+id);
      const e=newEntity({id,name:p.NAME_ZH||p.name||p.ADMIN||p.NAME||id,layer:target,geometry:f.geometry});
      e.aliases=[p.ADMIN,p.NAME].filter(Boolean);const alpha=p.ISO_A2_EH||p.ISO_A2;
      if(/^[A-Z]{2}$/.test(alpha||''))e.flag=[...alpha].map(ch=>String.fromCodePoint(ch.charCodeAt(0)+127397)).join('');
      let hash=0;for(const ch of id)hash=(hash*31+ch.charCodeAt(0))>>>0;
      e.color=['#7b9c8c','#bd9875','#8e9fb9','#b18e9e','#a7aa7a','#729eae','#c0a783','#9b91b7'][hash%8];
      e.data.sourceProperties=p;world.entities[id]=e;
    }
    validate(world);return world;
  }
  const api={blank,Engine,registry,validate,geometry,area,multi,chains,country,resolvedColor,search,score,aiContext,parseCode,fromGeoJSON,newEntity,validDate};
  if(typeof module!=='undefined')module.exports=api;else root.MC=api;
})(globalThis);
