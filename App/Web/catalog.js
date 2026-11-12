/* Built-in, data-defined actions and AI prompt templates. */
(function(root){
  'use strict';
  const action=(id,name,commands,inputs=[])=>({id,name,commands,inputs});
  const number=(key,label,initial=1)=>({key,label,type:'number',initial});
  const field=(key,label,initial='')=>({key,label,type:'text',initial});
  const c=(command,args)=>({command,args});
  const increment=(key)=>c('entity.increment',{id:'$target',key,amount:'$param:amount'});
  const set=(key)=>c('entity.data',{id:'$target',key,value:'$param:value'});
  root.MCCatalog={
    modules:[
      {id:'politics',name:'政治專精',description:'政黨、意識形態、宣傳與政府數值的可編輯操作。',coverage:'已提供資料操作，完整政治模擬尚待補齊。',dependencies:[],actions:[
        action('ideology','設定意識形態',[set('ideology')],[field('value','意識形態')]),
        action('party','設定政黨名稱',[set('rulingParty')],[field('value','執政黨名稱')]),
        action('government','設定政體',[set('governmentForm')],[field('value','政體')]),
        action('stability','調整穩定度',[increment('stability')],[number('amount','變化量',1)]),
        action('propaganda','調整宣傳影響',[increment('propagandaInfluence')],[number('amount','變化量',1)])]},
      {id:'cult',name:'崇拜系統',description:'設定精神領導人與個人崇拜、共和價值之間的數值。',coverage:'已提供資料操作，完整信仰與內鬥模擬尚待補齊。',dependencies:['politics'],actions:[
        action('leader','設定精神領導人',[set('spiritualLeader')],[field('value','領導人')]),
        action('balance','調整個人崇拜數值',[increment('cultBalance')],[number('amount','變化量',1)]),
        action('formalism','調整形式主義',[increment('formalism')],[number('amount','變化量',1)])]},
      {id:'military',name:'軍事專精',description:'保存兵力與組織部隊，詳見圖例／部隊。',coverage:'已有部隊、編組與位置資料。完整戰鬥與指揮模擬尚待補齊。',dependencies:[],actions:[
        action('mobilization','調整動員人口',[increment('mobilizedPopulation')],[number('amount','人數變化',1000)]),
        action('armyMorale','調整國家軍心',[increment('armyMorale')],[number('amount','變化量',1)])]},
      {id:'underground',name:'地下戰爭',description:'以遊戲數值記錄情報與心理戰狀態。',coverage:'提供資料操作，完整情報行動、逮捕和心理戰模擬尚待補齊。',dependencies:[],actions:[
        action('network','調整情報網',[increment('intelligenceNetwork')],[number('amount','變化量',1)]),
        action('psychology','調整心理戰壓力',[increment('psychologicalPressure')],[number('amount','變化量',1)])]},
      {id:'engineering',name:'系統工程',description:'為各國記錄科技、資源及基礎建設資料。',coverage:'已提供資料操作，1815–1991 各國科技樹與建設規則尚待補齊。',dependencies:[],actions:[
        action('research','記錄研究項目',[set('researchProject')],[field('value','研究項目')]),
        action('infrastructure','調整基建',[increment('infrastructure')],[number('amount','變化量',1)]),
        action('resources','調整資源儲備',[increment('resources')],[number('amount','變化量',1)])]},
      {id:'diplomacy',name:'強國遊戲',description:'關係改善、戰爭、和平與聯盟邀請可以作用於兩國。',coverage:'提供基礎外交操作，完整外交博弈尚待補齊。',dependencies:[],actions:[
        action('improve','調整兩國關係',[c('diplomacy.relation',{from:'$target',to:'$param:other',delta:'$param:delta'})],[field('other','對象國 ID'),number('delta','關係變化',10)]),
        action('war','宣戰',[c('diplomacy.war',{from:'$target',to:'$param:other'})],[field('other','對象國 ID')]),
        action('peace','和平',[c('diplomacy.peace',{from:'$target',to:'$param:other'})],[field('other','對象國 ID')]),
        action('invite','邀請加入聯盟',[c('diplomacy.invite',{from:'$target',to:'$param:other',union:'$param:union'})],[field('other','受邀國 ID'),field('union','聯盟 ID')])]},
      {id:'economics',name:'經濟系統',description:'記錄與編輯物價、通膨、信用及貨幣數值。',coverage:'提供資料操作，完整經濟演算模型尚待補齊。',dependencies:[],actions:[
        action('currency','設定貨幣名稱',[set('currency')],[field('value','貨幣名稱')]),
        action('prices','調整物價指數',[increment('priceIndex')],[number('amount','變化量',1)]),
        action('credit','調整信用',[increment('credit')],[number('amount','變化量',1)]),
        action('inflation','調整通膨率',[increment('inflation')],[number('amount','百分點',1)])]},
      {id:'misc',name:'雜項包',description:'調整作者自訂的國家數值。',coverage:'提供任意自訂數值，額外的現實數值與公式尚待擴充。',dependencies:[],actions:[
        action('custom','調整自訂數值',[c('entity.increment',{id:'$target',key:'$param:key',amount:'$param:amount'})],[field('key','數值名稱'),number('amount','變化量',1)])]}
    ],
    promptTemplates:[
      {id:'commands',name:'地圖與世界編輯',instruction:'將要求轉成已註冊的地圖與世界操作。若缺少目標 ID，先提出說明並回傳空 commands。'},
      {id:'layers',name:'圖層與行政綁定',instruction:'使用圖層與行政綁定操作。分清獨立、嵌套、單一上級和跨區共管。'},
      {id:'translation',name:'地名翻譯',instruction:'為現有 ID 建立繁體中文或指定語言譯名。只使用 entity.translate，不猜測未知實體 ID。'},
      {id:'diplomacy',name:'外交與劇情',instruction:'根據指定世界和國家建立外交操作。世界沒有相關資料時要求補充。'},
      {id:'events',name:'事件與時間',instruction:'產生 event.add 指令及事件內已註冊指令，日期以 YYYY-MM-DD 表示，使用者確定後才執行。'},
      {id:'mod',name:'資料模組',instruction:'用 plugin.install 建立模組，依賴必須存在，模組 actions 只能引用已註冊指令。'},
      {id:'territory',name:'地塊與爭議',instruction:'以 entity.controller、entity.claim 與 entity.bind 表達控制、宣稱與行政歸屬，保留多個爭議方。'},
      {id:'help',name:'教學與解釋',instruction:'用淺顯繁體中文介紹操作與一個範例。若不需要變更世界資料，commands 回傳空陣列。'}
    ]
  };
})(globalThis);
