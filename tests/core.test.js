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
test('fuzzy search considers translations, aliases and code',()=>{
 const e=example();e.execute([command('entity.translate',{id:'P1',language:'en',value:'Village One'}),command('entity.alias',{id:'P1',value:'小村'}),command('entity.code',{id:'P1',code:'ABC123'})]);
 assert.equal(MC.search(e.world,'Villag One')[0].entity.id,'P1');assert.equal(MC.search(e.world,'小村')[0].entity.id,'P1');assert.equal(MC.search(e.world,'abc123')[0].entity.id,'P1');
});
test('code parser supports Chinese, English, and comments inside strings',()=>{
 const commands=MC.parseCode('重新命名 {"id":"P1","name":"A#B"} # comment\nentity.code {"id":"P1","code":"XX"}');
 assert.equal(commands[0].command,'entity.rename');assert.equal(commands[0].args.name,'A#B');assert.equal(commands.length,2);
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
