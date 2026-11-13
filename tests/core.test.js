'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const MC=require('../App/Web/core.js');
const I=require('../App/Web/importers.js');
const zip=require('../App/Web/vendor/fflate.js');
const box=(x,y,w,h)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
const command=(command,args={})=>({command,args});
function example(){const w=MC.blank('測試');w.coordinateSystem='pixel';const e=new MC.Engine(w);e.execute([
 command('entity.create',{id:'A',name:'甲國',layer:'Country'}),
 command('entity.create',{id:'B',name:'乙國',layer:'Country'}),
 command('entity.create',{id:'S1',name:'甲州',layer:'State',geometry:box(0,0,8,10)}),
 command('entity.create',{id:'S2',name:'乙州',layer:'State',geometry:box(8,0,2,10)}),
 command('entity.create',{id:'P1',name:'村一',layer:'Province',geometry:box(6,0,4,10)}),
 command('entity.bind',{id:'S1',parents:['A']}),command('entity.bind',{id:'S2',parents:['B']})]);return e;}

test('batch validation fails atomically and undo/redo keep monotonic revisions',()=>{
 const e=example(),old=e.world;assert.throws(()=>e.execute([command('entity.rename',{id:'P1',name:'changed'}),command('entity.bind',{id:'P1',parents:['A']})]),/State/);
 assert.equal(e.world,old);assert.equal(e.world.entities.P1.name,'村一');
 e.execute(command('entity.rename',{id:'P1',name:'新村'}));const rev=e.world.revision;
 assert(e.undo());assert.equal(e.world.entities.P1.name,'村一');assert(e.world.revision>rev);
 const n=e.world.revision;assert(e.redo());assert.equal(e.world.entities.P1.name,'新村');assert(e.world.revision>n);
 assert.throws(()=>e.execute(command('entity.rename',{id:'P1',name:'x'}),rev),/變更/);
});
test('largest intersection binding and area weighted control aggregation',()=>{
 const e=example();const r=e.execute(command('layer.autobind',{id:'Province'}))[0];
 assert.equal(e.world.entities.P1.parents[0],'S1');assert.equal(r[0].share,.5);
 e.execute([command('entity.create',{id:'P2',name:'村二',layer:'Province',geometry:box(0,0,2,2)}),command('entity.bind',{id:'P2',parents:['S1']}),command('entity.controller',{id:'P1',controller:'A'}),command('entity.controller',{id:'P2',controller:'B'}),command('layer.aggregate',{id:'State',weight:'area'})]);
 assert.equal(e.world.entities.S1.controller,'A');assert.equal(e.world.entities.S1.data.controlShares.A,40);assert.equal(e.world.entities.S1.data.controlShares.B,4);
});
test('autobinding skips non-overlapping regions while retaining weighted aggregation',()=>{
 const w=MC.blank('多地塊測試');w.coordinateSystem='pixel';const e=new MC.Engine(w),ops=[];
 ops.push(command('entity.create',{id:'OWNER',name:'控制國',layer:'Country'}));
 for(let i=0;i<80;i++){
  ops.push(command('entity.create',{id:'S'+i,name:'州'+i,layer:'State',geometry:box(i*20,0,10,10)}));
  ops.push(command('entity.create',{id:'P'+i,name:'村'+i,layer:'Province',geometry:box(i*20+1,1,4,4)}));
  ops.push(command('entity.controller',{id:'P'+i,controller:'OWNER'}));
 }
 e.execute(ops);
 const clipping=require('../App/Web/vendor/polygon-clipping.js'),original=clipping.intersection;
 let intersections=0,result;
 try{clipping.intersection=(...args)=>{intersections++;return original(...args);};result=e.execute(command('layer.autobind',{id:'Province'}))[0];}
 finally{clipping.intersection=original;}
 assert.equal(result.length,80);assert.equal(intersections,80);
 for(let i=0;i<80;i++)assert.deepEqual(e.world.entities['P'+i].parents,['S'+i]);
 const aggregate=e.execute(command('layer.aggregate',{id:'State',weight:'area'}))[0];
 assert.equal(aggregate.length,80);assert.equal(e.world.entities.S42.controller,'OWNER');
 assert.equal(e.world.entities.S42.data.controlShares.OWNER,16);
});
test('optional automatic control aggregation follows changes and cascades to parent layers',()=>{
 const e=example();
 e.execute([
  command('entity.create',{id:'P2',name:'村二',layer:'Province',geometry:box(0,0,2,2)}),
  command('entity.bind',{id:'P1',parents:['S1']}),command('entity.bind',{id:'P2',parents:['S1']}),
  command('entity.controller',{id:'P1',controller:'A'}),command('entity.controller',{id:'P2',controller:'B'}),
  command('layer.configure',{id:'State',autoAggregate:true}),command('layer.configure',{id:'Country',autoAggregate:true})
 ]);
 assert.equal(e.world.entities.S1.controller,'A');
 assert.equal(e.world.entities.A.controller,'A');
 assert.deepEqual(e.world.entities.S1.data.controlShares,{A:40,B:4});
 const before=e.world;
 const preview=e.preview(command('entity.controller',{id:'P1',controller:'B'}));
 assert.equal(preview.world.entities.S1.controller,'B');assert.equal(preview.world.entities.A.controller,'B');
 assert.equal(e.world,before);
 e.execute(command('entity.controller',{id:'P1',controller:'B'}));
 assert.equal(e.world.entities.S1.controller,'B');assert.equal(e.world.entities.A.controller,'B');
 assert(e.undo());assert.equal(e.world.entities.S1.controller,'A');assert.equal(e.world.entities.A.controller,'A');
 assert(e.redo());assert.equal(e.world.entities.S1.controller,'B');
 e.execute(command('entity.bind',{id:'P1',parents:['S2']}));
 assert.equal(e.world.entities.S1.controller,'B');assert.equal(e.world.entities.S2.controller,'B');
 assert.equal(e.world.entities.B.controller,'B');
 e.execute(command('entity.delete',{id:'P1'}));
 assert.equal(e.world.entities.S2.controller,'B');
 assert.equal(e.world.entities.S2.data.controlShares,undefined);
 assert.throws(()=>e.execute(command('layer.configure',{id:'State',autoAggregate:'yes'})),/true 或 false/);
});
test('automatic aggregation updates on geometry changes and can be disabled',()=>{
 const e=example();
 e.execute([
  command('entity.create',{id:'P2',name:'村二',layer:'Province',geometry:box(0,0,2,2)}),
  command('entity.bind',{id:'P1',parents:['S1']}),command('entity.bind',{id:'P2',parents:['S1']}),
  command('entity.controller',{id:'P1',controller:'A'}),command('entity.controller',{id:'P2',controller:'B'}),
  command('layer.configure',{id:'State',autoAggregate:true})
 ]);
 assert.equal(e.world.entities.S1.controller,'A');
 e.execute(command('geometry.replace',{id:'P1',geometry:box(0,0,1,1)}));
 assert.equal(e.world.entities.S1.controller,'B');
 e.execute(command('layer.configure',{id:'State',autoAggregate:false}));
 e.execute(command('entity.controller',{id:'P2',controller:'A'}));
 assert.equal(e.world.entities.S1.controller,'B');
});
test('joint administration and complete ancestry',()=>{
 const e=example();assert.throws(()=>e.execute(command('entity.bind',{id:'P1',parents:['S1','S2']})),/跨區共管/);
 e.execute([command('layer.configure',{id:'Province',shared:true}),command('entity.bind',{id:'P1',parents:['S1','S2']}),command('entity.claim',{id:'P1',claims:['A','B']})]);
 assert.deepEqual(MC.chains(e.world,'P1'),[['P1','S1','A'],['P1','S2','B']]);assert.deepEqual(e.world.entities.P1.claims,['A','B']);
 assert.throws(()=>e.execute(command('layer.configure',{id:'Province',shared:false})),/跨區共管/);
});
test('geometry cut and merge produce correct area',()=>{
 const e=example();e.execute(command('geometry.cut',{id:'P1',newId:'P3',mask:box(6,0,2,10)}));
 assert.equal(MC.area(e.world.entities.P1.geometry),20);assert.equal(MC.area(e.world.entities.P3.geometry),20);
 e.execute(command('geometry.merge',{target:'P1',ids:['P1','P3']}));assert.equal(MC.area(e.world.entities.P1.geometry),40);
});
test('line styles can be edited safely and restored without changing their geometry',()=>{
 const e=example();
 const points=[[1,1],[4,5],[9,2]];
 e.execute(command('drawing.add',{id:'border',name:'爭議界線',points,color:'#aabbcc',width:2,dash:[5,3],curve:true,opacity:0.8}));
 e.execute(command('drawing.update',{id:'border',name:'新邊界',color:'#cc3344',dash:[1,3],width:4,opacity:0.5,soft:true}));
 const line=e.world.drawings[0];
 assert.equal(line.name,'新邊界');assert.equal(line.color,'#cc3344');assert.equal(line.opacity,0.5);
 assert.deepEqual(line.points,points);assert.deepEqual(line.dash,[1,3]);assert.equal(line.soft,true);
 const current=e.world;
 assert.throws(()=>e.execute(command('drawing.update',{id:'border',dash:[2,-1]})),/數值必須/);
 assert.equal(e.world,current);
 assert.throws(()=>e.execute(command('drawing.add',{id:'bad',points:[[0,0],[1,1]],dash:[0,0]})),/不可全為零/);
 assert.throws(()=>e.execute(command('drawing.update',{id:'missing',width:1})),/找不到線段/);
 assert(e.undo());assert.equal(e.world.drawings[0].name,'爭議界線');assert.deepEqual(e.world.drawings[0].points,points);
});
test('fuzzy search considers translations, aliases and code',()=>{
 const e=example();e.execute([command('entity.translate',{id:'P1',language:'en',value:'Village One'}),command('entity.alias',{id:'P1',value:'小村'}),command('entity.code',{id:'P1',code:'ABC123'})]);
 assert.equal(MC.search(e.world,'Villag One')[0].entity.id,'P1');assert.equal(MC.search(e.world,'小村')[0].entity.id,'P1');assert.equal(MC.search(e.world,'abc123')[0].entity.id,'P1');
});
test('code parser supports Chinese, English, and comments inside strings',()=>{
 const commands=MC.parseCode('重新命名 {"id":"P1","name":"A#B"} # comment\nentity.code {"id":"P1","code":"XX"}');
 assert.equal(commands[0].command,'entity.rename');assert.equal(commands[0].args.name,'A#B');assert.equal(commands.length,2);
});
test('code parser validates spaced Chinese names, JSON arrays and precise error locations',()=>{
 const commands=MC.parseCode('# 註解\n建立 UI 畫面\t{"id":"panel","name":"面板"}\n重新命名 {"id":"A","name":"A#B"}');
 assert.equal(commands[0].command,'ui.screen.create');
 assert.equal(commands[1].args.name,'A#B');
 const json=MC.parseCode('[{"command":"重新命名","args":{"id":"A","name":"甲"}}]');
 assert.equal(json[0].command,'entity.rename');
 assert.throws(()=>MC.parseCode('# 第一行\n\nentity.rename {"id":'),/第 3 行.*JSON 格式錯誤/);
 assert.throws(()=>MC.parseCode('entity.rename []'),/第 1 行.*物件/);
 assert.throws(()=>MC.parseCode('[{"command":"does.not.exist","args":{}}]'),/第 1 個指令.*未知指令/);
 assert.throws(()=>MC.parseCode('[{"command":"entity.rename","args":null}]'),/第 1 個指令.*物件/);
 const e=example(),original=e.world;
 assert.throws(()=>e.execute(command('code.save',{id:'invalid',name:'無效',source:'[{"command":"bad"}]'})),/未知指令/);
 assert.equal(e.world,original);
});
test('date events execute once, and historical coverage rejects unverified time',()=>{
 const e=example();e.execute([command('entity.data',{id:'A',key:'infrastructure',value:1}),command('event.add',{id:'build',date:'2026-01-03',title:'建設',commands:[command('entity.increment',{id:'A',key:'infrastructure',amount:1})]})]);
 e.execute(command('simulation.advance',{days:3}));assert.equal(e.world.entities.A.data.infrastructure,2);e.execute(command('simulation.advance',{days:3}));assert.equal(e.world.entities.A.data.infrastructure,2);
 e.execute(command('map.settings',{historical:true}));assert.throws(()=>e.execute(command('simulation.advance',{days:1})),/校驗/);
});
test('diplomacy and grouping preserve distinct unit positions and owners',()=>{
 const e=example();e.execute([command('entity.bind',{id:'P1',parents:['S1']}),command('diplomacy.relation',{from:'A',to:'B',delta:130}),command('diplomacy.war',{from:'A',to:'B'}),command('unit.create',{id:'U1',name:'第1營',owner:'A',location:'P1',strength:300}),command('unit.create',{id:'U2',name:'第2營',owner:'A',location:'S1',strength:200}),command('unit.group',{id:'G1',name:'衛戍隊',members:['U1','U2']})]);
 assert.equal(e.world.relations.find(r=>r.kind==='opinion').value,100);assert.equal(e.world.units.find(u=>u.id==='U1').location,'P1');assert.equal(e.world.units.find(u=>u.id==='U2').parent,'G1');
});
test('alliance invitations require membership and preserve other unions when shared',()=>{
 const e=example();
 e.execute([
  command('entity.create',{id:'U1',name:'甲聯盟',layer:'Union'}),
  command('entity.create',{id:'U2',name:'乙聯盟',layer:'Union'}),
  command('entity.bind',{id:'A',parents:['U1']}),
  command('entity.bind',{id:'B',parents:['U2']})
 ]);
 assert.throws(()=>e.execute(command('diplomacy.invite',{from:'B',to:'A',union:'U1'})),/尚未加入/);
 e.execute(command('diplomacy.invite',{from:'A',to:'B',union:'U1'}));
 assert.throws(()=>e.execute(command('diplomacy.invite',{from:'A',to:'B',union:'U1'})),/待處理/);
 e.execute(command('diplomacy.reject',{id:'B',union:'U1'}));
 assert.equal(e.world.relations.filter(r=>r.kind==='invitation').length,0);
 e.execute(command('diplomacy.invite',{from:'A',to:'B',union:'U1'}));
 assert.throws(()=>e.execute(command('diplomacy.accept',{id:'B',union:'U1'})),/已有聯盟/);
 assert.deepEqual(e.world.entities.B.parents,['U2']);
 assert.equal(e.world.relations.filter(r=>r.kind==='invitation').length,1);
 e.execute([command('layer.configure',{id:'Country',shared:true}),command('diplomacy.accept',{id:'B',union:'U1'})]);
 assert.deepEqual(e.world.entities.B.parents,['U2','U1']);
 e.execute(command('diplomacy.leave',{id:'B',union:'U1'}));
 assert.deepEqual(e.world.entities.B.parents,['U2']);
 assert.throws(()=>e.execute(command('diplomacy.leave',{id:'B',union:'U1'})),/未加入/);
 e.execute([command('diplomacy.invite',{from:'A',to:'B',union:'U1'}),command('diplomacy.leave',{id:'A',union:'U1'})]);
 assert.throws(()=>e.execute(command('diplomacy.accept',{id:'B',union:'U1'})),/邀請方已不在/);
 e.execute(command('diplomacy.reject',{id:'B',union:'U1'}));
});
test('join requests require an authorized decision and do not silently replace membership',()=>{
 const e=example();
 e.execute([
  command('entity.create',{id:'U1',name:'甲聯盟',layer:'Union'}),
  command('entity.create',{id:'U2',name:'乙聯盟',layer:'Union'}),
  command('entity.bind',{id:'A',parents:['U1']}),command('entity.bind',{id:'B',parents:['U2']})
 ]);
 e.execute(command('diplomacy.apply',{from:'B',to:'A',union:'U1'}));
 assert.deepEqual(e.world.entities.B.parents,['U2']);
 assert.throws(()=>e.execute(command('diplomacy.apply',{from:'B',to:'A',union:'U1'})),/待處理/);
 assert.throws(()=>e.execute(command('diplomacy.approve',{id:'B',applicant:'B',union:'U1'})),/不在該聯盟/);
 e.execute(command('diplomacy.decline',{id:'A',applicant:'B',union:'U1'}));
 assert(!e.world.relations.some(r=>r.kind==='application'));
 e.execute(command('diplomacy.apply',{from:'B',to:'A',union:'U1'}));
 assert.throws(()=>e.execute(command('diplomacy.approve',{id:'A',applicant:'B',union:'U1'})),/已有聯盟/);
 assert(e.world.relations.some(r=>r.kind==='application'));
 e.execute([command('layer.configure',{id:'Country',shared:true}),command('diplomacy.approve',{id:'A',applicant:'B',union:'U1'})]);
 assert.deepEqual(e.world.entities.B.parents,['U2','U1']);
 assert(!e.world.relations.some(r=>r.kind==='application'));
});
test('vassalization and release protect existing relationships',()=>{
 const e=example();
 e.execute(command('diplomacy.vassalize',{overlord:'A',subject:'B'}));
 assert.equal(e.world.entities.B.overlord,'A');
 assert.throws(()=>e.execute(command('diplomacy.vassalize',{overlord:'A',subject:'B'})),/已有宗主/);
 assert.throws(()=>e.execute(command('diplomacy.release',{overlord:'B',subject:'A'})),/並非/);
 e.execute(command('diplomacy.release',{overlord:'A',subject:'B'}));
 assert.equal(e.world.entities.B.overlord,null);
});
test('war, vassal and civil war actions validate countries and roll back invalid requests',()=>{
 const e=example();
 assert.throws(()=>e.execute(command('diplomacy.war',{from:'A',to:'S1'})),/Country/);
 assert.throws(()=>e.execute(command('diplomacy.peace',{from:'A',to:'B'})),/沒有戰爭/);
 e.execute([command('entity.color',{id:'A',color:'#ff0000'}),command('entity.color',{id:'B',color:'#0000ff'}),command('country.overlord',{id:'B',overlord:'A'})]);
 assert.equal(MC.resolvedColor(e.world,'B'),e.world.entities.A.color);
 assert.throws(()=>e.execute(command('country.overlord',{id:'A',overlord:'B'})),/循環/);
 e.execute(command('country.overlord',{id:'B',overlord:null}));
 assert.equal(e.world.entities.B.overlord,null);
 assert.equal(MC.resolvedColor(e.world,'B'),'#0000ff');
 e.execute(command('entity.bind',{id:'P1',parents:['S1']}));
 assert.throws(()=>e.execute(command('diplomacy.civilwar',{country:'A',rebelId:'R',name:'新勢力',regions:'P1'})),/地塊清單/);
 e.execute(command('diplomacy.civilwar',{country:'A',rebelId:'R',name:'新勢力',regions:['P1']}));
 assert.equal(e.world.entities.P1.controller,'R');
 assert(e.world.relations.some(r=>r.kind==='war'&&r.from==='R'&&r.to==='A'));
 e.execute(command('diplomacy.peace',{from:'A',to:'R'}));
 assert(!e.world.relations.some(r=>r.kind==='war'));
});
test('BMP and Paradox state fixture preserve IDs and ownership',async()=>{
 const bytes=Buffer.alloc(70);bytes.write('BM');bytes.writeUInt32LE(70,2);bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(2,18);bytes.writeInt32LE(2,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);bytes.writeUInt32LE(16,34);
 for(const start of [54,62]){bytes.set([3,2,1],start);bytes.set([6,5,4],start+3);}
 const bmp=I.bmp(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.deepEqual([...bmp.pixels],[0x010203,0x040506,0x010203,0x040506]);
 const files={'map/provinces.bmp':new Uint8Array(bytes),'map/definition.csv':zip.strToU8('1;1;2;3;land\n2;4;5;6;land\n'),'history/states/1.txt':zip.strToU8('state={ id=1 name="STATE_1" provinces={ 1 2 } history={ owner=GER } }')};
 const packed=zip.zipSync(files);const w=await I.paradox(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength));
 assert.equal(Object.keys(w.entities).length,4);assert.deepEqual(w.entities.P1.parents,['S1']);assert.equal(w.entities.P2.controller,'GER');assert(MC.validate(w));
});
test('line-art produces distinct enclosed regions',async()=>{
 const r={width:5,height:3,pixels:Uint32Array.from([0,0,0,0,0,0,0xffffff,0,0xffffff,0,0,0,0,0,0])};
 const labelled=await I.lineRegions(r,()=>{});const w=await I.rasterWorld(labelled,{layer:'Province'});assert.equal(Object.keys(w.entities).length,2);
});
test('data-defined plugin actions substitute parameters inside an atomic transaction',()=>{
 const e=example();e.execute(command('plugin.install',{id:'demo',name:'Demo',dependencies:[],actions:[{id:'modify',commands:[command('entity.increment',{id:'$target',key:'influence',amount:'$param:amount'})]}]}));
 assert.throws(()=>e.execute(command('plugin.run',{id:'demo',action:'modify',target:'A'})),/缺少模組參數/);
 e.execute(command('plugin.run',{id:'demo',action:'modify',target:'A',params:{amount:4}}));assert.equal(e.world.entities.A.data.influence,4);
});
test('plugin updates add only missing actions and preserve custom definitions',()=>{
 const e=example();
 const custom={id:'existing',name:'自訂名稱',commands:[command('entity.increment',{id:'$target',key:'value',amount:3})]};
 const added={id:'new',name:'新功能',commands:[command('entity.increment',{id:'$target',key:'value',amount:'$param:amount'})]};
 e.execute(command('plugin.install',{id:'demo',name:'示例',dependencies:[],actions:[custom]}));
 const result=e.execute(command('plugin.extend',{id:'demo',actions:[{...custom,name:'不應覆蓋'},added]}));
 assert.deepEqual(result[0],['new']);
 assert.equal(e.world.plugins[0].actions[0].name,'自訂名稱');
 const preview=e.preview(command('plugin.run',{id:'demo',action:'new',target:'A',params:{amount:5}}));
 assert.equal(preview.result[0][0].command,'entity.increment');
 assert.equal(preview.result[0][0].args.amount,5);
 assert.equal(e.world.entities.A.data.value,undefined);
 e.execute(command('plugin.run',{id:'demo',action:'new',target:'A',params:{amount:5}}));
 assert.equal(e.world.entities.A.data.value,5);
 const original=e.world;
 assert.throws(()=>e.execute(command('plugin.extend',{id:'demo',actions:[{id:'ok',name:'有效',commands:[command('entity.get',{id:'A'})]},{id:'bad',name:'無效',commands:[command('not.registered')]}]})),/未知/);
 assert.equal(e.world,original);
});

test('visual UI binds controls to entity data and button actions', () => {
  const e = example();
  e.execute([
    command('ui.screen.create', {id:'country-screen',name:'國家面板'}),
    command('ui.control.add', {screen:'country-screen',id:'population',type:'number',label:'人口',binding:{entity:'$selected',key:'population'}}),
    command('ui.control.add', {screen:'country-screen',id:'rename',type:'button',label:'改名',action:{command:'entity.rename',args:{id:'$selected',name:'測試國'}}}),
    command('ui.control.setValue', {screen:'country-screen',id:'population',selected:'A',value:123}),
    command('ui.control.invoke', {screen:'country-screen',id:'rename',selected:'A'})
  ]);
  assert.equal(e.world.entities.A.name, '測試國');
  assert.equal(e.world.entities.A.data.population, 123);
  assert.equal(e.world.screens[0].controls.length, 2);
});

test('UI layouts and control widths persist, validate atomically and support old saves', () => {
  const e=example();
  e.execute([
    command('ui.screen.create',{id:'layout',name:'面板'}),
    command('ui.screen.layout',{id:'layout',columns:3}),
    command('ui.control.add',{screen:'layout',id:'label',type:'label',label:'標題',span:0}),
    command('ui.control.add',{screen:'layout',id:'amount',type:'number',label:'數值',span:2}),
  ]);
  assert.equal(e.world.screens[0].columns,3);
  assert.deepEqual(e.world.screens[0].controls.map(control=>control.span),[0,2]);
  const original=e.world;
  assert.throws(()=>e.execute([
    command('ui.screen.rename',{id:'layout',name:'不應保存'}),
    command('ui.control.update',{screen:'layout',id:'amount',span:4}),
  ]),/元件寬度/);
  assert.equal(e.world,original);
  assert.throws(()=>e.execute(command('ui.screen.layout',{id:'layout',columns:0})),/欄數/);
  const old=structuredClone(e.world);
  delete old.screens[0].columns;
  for(const control of old.screens[0].controls) delete control.span;
  const loaded=new MC.Engine(old);
  loaded.execute(command('ui.screen.rename',{id:'layout',name:'舊面板'}));
  assert.equal(loaded.world.screens[0].name,'舊面板');
});

test('invalid UI action rolls back the whole transaction', () => {
  const e = example();
  const original = e.world;
  assert.throws(() => e.execute([
    command('ui.screen.create', {id:'screen',name:'畫面'}),
    command('ui.control.add', {screen:'screen',id:'run',type:'button',label:'執行',action:{command:'unknown.command',args:{}}})
  ]), /未知指令/);
  assert.equal(e.world, original);
  assert.deepEqual(e.world.screens, []);
});

test('scripts are editable, execute atomically and limit recursive execution', () => {
  const e = example();
  e.execute(command('code.save', {id:'s1',name:'改名',source:'entity.rename {"id":"A","name":"新名稱"}'}));
  e.execute(command('code.run', {id:'s1'}));
  assert.equal(e.world.entities.A.name, '新名稱');
  e.execute(command('code.save', {id:'cycle',name:'循環',source:'code.run {"id":"cycle"}'}));
  assert.throws(() => e.execute(command('code.run', {id:'cycle'})), /限制/);
  assert.equal(e.world.entities.A.name, '新名稱');
});

test('older world saves without screen or script arrays remain editable', () => {
  const old = MC.blank('舊存檔');
  delete old.screens;
  delete old.scripts;
  const e = new MC.Engine(old);
  e.execute(command('ui.screen.create', {id:'new',name:'新畫面'}));
  assert.equal(e.world.screens[0].name, '新畫面');
  assert.deepEqual(e.world.scripts, []);
});

test('AI context prioritizes named entities beyond the default limit and discloses truncation', () => {
  const w = MC.blank('大型世界');
  for (let i = 0; i < 500; i++) {
    const id = 'REGION-' + i;
    w.entities[id] = MC.newEntity({id,name:'測試地區'+i,layer:'Country'});
  }
  w.entities['REGION-499'].data = {population:123,huge:'a'.repeat(3000)};
  const context = MC.aiContext(w,'請編輯測試地區499', 'REGION-499', 5);
  assert.equal(context.entities[0].id, 'REGION-499');
  assert.equal(context.totalEntities,500);
  assert.equal(context.includedEntities,5);
  assert.equal(context.allEntitiesIncluded,false);
  assert.equal(context.selected.data.population,123);
  assert.deepEqual(context.selected.omittedDataKeys,['huge']);
  const withoutSelection=MC.aiContext(w,'請處理測試地區499',null,5);
  assert.equal(withoutSelection.entities[0].id, 'REGION-499');
});
