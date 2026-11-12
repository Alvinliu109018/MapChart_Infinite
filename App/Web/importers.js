(function(root){
  'use strict';
  const core=typeof require==='function'?require('./core.js'):root.MC;
  const zip=typeof require==='function'?require('./vendor/fflate.js'):root.fflate;
  const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
  function bmp(buffer){
    const view=new DataView(buffer);if(view.byteLength<54||view.getUint16(0,true)!==0x4d42)throw Error('不是有效的 BMP');
    const offset=view.getUint32(10,true),header=view.getUint32(14,true),width=view.getInt32(18,true),height=Math.abs(view.getInt32(22,true));
    const topDown=view.getInt32(22,true)<0,bits=view.getUint16(28,true),compression=view.getUint32(30,true);
    if(width<=0||height<=0||width*height>24000000)throw Error('BMP 尺寸超出此匯入器的 2,400 萬像素記憶體預算');
    if(![8,24,32].includes(bits)||compression!==0)throw Error('目前 BMP 解碼支援未壓縮的 8 位索引色、24 位與 32 位');
    const stride=Math.floor((width*bits+31)/32)*4;
    if(offset+stride*height>view.byteLength)throw Error('BMP 檔案不完整');
    const pixels=new Uint32Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let at=offset+(topDown?y:height-1-y)*stride+x*(bits/8);
      if(bits===8){at=14+header+view.getUint8(at)*4;if(at+3>=offset)throw Error('BMP 色盤不完整');}
      pixels[y*width+x]=(view.getUint8(at+2)<<16)|(view.getUint8(at+1)<<8)|view.getUint8(at);
    }
    return {width,height,pixels};
  }
  function clausewitz(source){
    const tokens=source.match(/"(?:\\.|[^"\\])*"|#[^\r\n]*|[{}=]|[^\s{}=#"]+/g)||[];
    let i=0;
    const value=t=>{if(t?.startsWith('"')){try{return JSON.parse(t);}catch{return t.slice(1,-1);}}if(/^-?\d+(\.\d+)?$/.test(t))return Number(t);return t;};
    function group(nested){const items=[],pairs={};let mixed=false;
      while(i<tokens.length){const token=tokens[i++];if(token.startsWith('#'))continue;if(token==='}'){if(!nested)throw Error('多餘的 }');return Object.keys(pairs).length?{...pairs,...(items.length?{_values:items}:{})}:items;}
        if(tokens[i]==='='){i++;let next=tokens[i++];while(next?.startsWith('#'))next=tokens[i++];const v=next==='{'?group(true):value(next);const key=value(token);if(['__proto__','constructor','prototype'].includes(key))throw Error('不支援的鍵名');if(Object.hasOwn(pairs,key)){if(!mixed)pairs._repeated=pairs._repeated||[];pairs._repeated.push({key,value:v});mixed=true;}else pairs[key]=v;}
        else items.push(token==='{'?group(true):value(token));
      }
      if(nested)throw Error('缺少 }');return Object.keys(pairs).length?{...pairs,...(items.length?{_values:items}:{})}:items;
    }
    return group(false);
  }
  function definitions(source){
    const byColor=new Map();for(const line of source.replace(/^\uFEFF/,'').split(/\r?\n/)){
      if(!line.trim()||line.trim().startsWith('#'))continue;
      const [id,r,g,b,type]=line.split(';');if(!/^\d+$/.test(id))continue;
      const rgb=[r,g,b].map(Number);if(rgb.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('definition.csv RGB 無效');
      const key=(rgb[0]<<16)|(rgb[1]<<8)|rgb[2];if(byColor.has(key))throw Error('definition.csv 有重複顏色');byColor.set(key,{id:'P'+id,rawId:Number(id),type});
    }return byColor;
  }
  async function lineRegions(raster,onProgress){
    const {width,height,pixels}=raster, labels=new Uint32Array(pixels.length),queue=new Uint32Array(pixels.length);
    let region=0;
    const isWall=i=>{const p=pixels[i];return (((p>>16)&255)+((p>>8)&255)+(p&255))/3<100;};
    for(let start=0;start<labels.length;start++){
      if(labels[start]||isWall(start))continue;region++;let head=0,tail=1;queue[0]=start;labels[start]=region;
      while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);for(const next of [x?at-1:-1,x<width-1?at+1:-1,y?at-width:-1,y<height-1?at+width:-1])if(next>=0&&!labels[next]&&!isWall(next)){labels[next]=region;queue[tail++]=next;}if(head%100000===0){onProgress('辨識封閉區域 '+region);await delay();}}
    }
    return {width,height,pixels:labels,line:true};
  }
  async function rasterWorld(raster,options={},onProgress=()=>{}){
    const {width,height,pixels}=raster,world=core.blank(options.name||'匯入像素地圖');
    world.coordinateSystem='pixel';world.bounds=[0,0,width,height];
    const target=options.layer||'Province',lookup=options.definitions||new Map(),regions=new Map();
    let previous=new Map();
    for(let y=0;y<height;y++){
      const next=new Map();let x=0;
      while(x<width){const rgb=pixels[y*width+x],start=x;while(x<width&&pixels[y*width+x]===rgb)x++;
        if(raster.line&&rgb===0)continue;
        const definition=lookup.get(rgb);if(definition&&['sea','lake'].includes(definition.type))continue;
        const key=rgb+':'+start+':'+x;
        if(previous.has(key)){const rect=previous.get(key);rect[3]=y+1;next.set(key,rect);continue;}
        const rect=[start,y,x,y+1];next.set(key,rect);if(!regions.has(rgb))regions.set(rgb,[]);regions.get(rgb).push(rect);
      }
      previous=next;if(y%64===0){onProgress(`解析像素 ${Math.round(y/height*100)}%`);await delay();}
    }
    for(const [rgb,rects] of regions){
      const d=lookup.get(rgb),id=d?.id||'RGB-'+rgb.toString(16).padStart(6,'0');
      const e=core.newEntity({id,name:id,layer:target});
      e.color=raster.line?'#7b9c8c':'#'+rgb.toString(16).padStart(6,'0');
      e.data.sourceRGB=rgb;e.data.provinceId=d?.rawId??null;
      e.geometry={type:'MultiPolygon',coordinates:rects.map(([x1,y1,x2,y2])=>[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]])};
      world.entities[id]=e;
    }
    world.provenance=[{kind:'user-import',name:options.name||'raster',note:'像素座標；縱向合併色帶，保留精確填色。'}];
    return world;
  }
  async function paradox(buffer,onProgress=()=>{}){
    onProgress('解開 map ZIP');
    const entries=await new Promise((resolve,reject)=>zip.unzip(new Uint8Array(buffer),{filter:f=>{
      if(f.originalSize>160000000)throw Error('ZIP 內單檔超出 160 MB 匯入預算');return /(^|\/)(provinces\.bmp|definition\.csv|.*\.txt|.*\.yml)$/i.test(f.name);
    }},(error,data)=>error?reject(error):resolve(data)));
    const names=Object.keys(entries);let total=0;for(const value of Object.values(entries))total+=value.byteLength;if(total>240000000)throw Error('ZIP 解壓內容超出 240 MB 匯入預算');
    const paths=names.filter(n=>/(^|\/)provinces\.bmp$/i.test(n));if(paths.length!==1)throw Error(`找到 ${paths.length} 張 provinces.bmp，請將要匯入的版本另存一個 ZIP`);
    const path=paths[0],directory=path.slice(0,path.lastIndexOf('/')+1),decoder=new TextDecoder();
    const csv=entries[directory+'definition.csv'];
    const world=await rasterWorld(bmp(entries[path].buffer.slice(entries[path].byteOffset,entries[path].byteOffset+entries[path].byteLength)),{definitions:csv?definitions(decoder.decode(csv)):new Map(),name:'Paradox 匯入世界'},onProgress);
    const warnings=[];
    if(!csv)warnings.push('缺少 definition.csv，使用 RGB 識別碼，無法連結原始 province 編號。');
    for(const file of names.filter(n=>/\/states\/.*\.txt$/i.test('/'+n))){
      let parsed;try{parsed=clausewitz(decoder.decode(entries[file]));}catch(error){warnings.push(file+' '+error.message);continue;}
      const state=parsed.state;if(!state||!Array.isArray(state.provinces))continue;
      const id='S'+state.id,e=core.newEntity({id,name:String(state.name||id),layer:'State'});world.entities[id]=e;
      const owner=state.history?.owner;
      if(owner){if(!world.entities[owner])world.entities[owner]=core.newEntity({id:owner,name:owner,layer:'Country'});e.parents=[owner];e.controller=owner;}
      for(const province of state.provinces){const p=world.entities['P'+province];if(p){if(p.parents.length)warnings.push(p.id+' 出現在多個 State；採用先讀取的 State');else{p.parents=[id];p.controller=owner||null;}}else warnings.push('找不到省份 P'+province);}
    }
    world.dataWarnings=warnings;world.provenance.push({kind:'paradox-zip',files:names,note:'已解析 HOI4 provinces.bmp、definition.csv 和 states；其他 Paradox 格式需要對應轉接器。'});
    return world;
  }
  const api={bmp,clausewitz,definitions,rasterWorld,lineRegions,paradox};if(typeof module!=='undefined')module.exports=api;else root.MCImport=api;
})(globalThis);
