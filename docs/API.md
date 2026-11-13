# MapChart ∞ 介面與資料格式

版本 0.1，對應專案目前的實作。完整功能仍在開發，請以程式中的指令註冊表為準。

## 1. 世界資料

世界以 `mapchart-infinity` 格式的 JSON 儲存。每個實體有穩定的 `id`、顯示 `name`、可修改的 `code`、圖層 `layer`、父級 `parents`、控制方 `controller`、宣稱方 `claims`、旗幟 `flag`、顏色 `color`、別名、翻譯、資料欄位及選用的幾何。

預設圖層依序為 `Union`、`Country`、`State`、`Province`。嵌套圖層的父級要位於所設定的上一層。開啟該層 `shared` 後，一個實體可綁定多個上級。獨立圖層可以有不同邊界與關係。世界存檔中的 `screens` 和 `scripts` 分別保存 UI 畫面及腳本；較早存檔缺少這兩個欄位時可繼續開啟。

幾何採用 GeoJSON 的 `Polygon` 或 `MultiPolygon`。`geographic` 的座標順序為經度、緯度；`pixel` 的原點位於左上角，X 向右、Y 向下。外環與洞均須封閉。`geometry.area` 在地理座標下回傳近似平方公尺，在像素／平面座標下回傳平方座標單位。

`layer.autobind` 計算子區與上級區的幾何交集，選擇交集面積最大的上級，無交集的子區保持原關係。面積相同時，依上級 ID 排序選取。`layer.aggregate` 以面積或指定資料欄位加權，記錄各方權重並更新上級控制方。

自動綁定會先比較外接範圍，跳過不可能相交的地塊，再對候選地塊計算精確交集；控制權匯總則先按上級整理子區，減少大型圖層的重複掃描。實際大型地圖的 iPhone 效能仍需實機測試。

`layer.configure {"id":"State","autoAggregate":true}` 可讓 State 層的上級自動依直接子區的控制方面積匯總。手機介面可在「地圖／圖層」→ 上級圖層「設定」中開啟。建立或刪除子區、修改上級綁定、控制方或幾何後會重新計算，若更高一層也開啟自動匯總則繼續向上更新。只計入具有有效面積與控制方的子區；若沒有可計算的子區，保留上級原控制方並移除過期的 `controlShares`。相同權重依控制方 ID 排序。這項設定預設關閉，可在單一交易中預覽、套用和復原；自動綁定上下級仍需另外執行 `layer.autobind`。

可在地塊資料畫面選擇「手繪切分地塊」，輸入新 ID 與名稱後，點選至少三個節點畫出切分範圍。範圍須與原地塊相交，且原地塊與新地塊都須有剩餘面積。切分失敗時保留節點供調整；切分成功後，新地塊繼承原本的行政關係、控制方及宣稱方。繪製時可撤銷上一個節點或取消。

地塊資料畫面可上傳不超過 1.4 MB 的 PNG、JPEG 或 WebP 旗幟；圖片會存入世界資料，在開啟旗幟顯示時繪製於地圖。可使用文字／emoji 旗幟或勾選清除。讀取圖片期間若世界資料已改變，需要重新儲存以避免覆蓋其他修改。

未自訂旗幟的行政區會依上級關係顯示所屬國旗；控制方及宣稱方有旗幟時也會加入地圖標示。為避免遮住地圖，地塊上最多直接排列三面旗，更多旗幟以 `+數量` 表示。點選地塊後，資訊卡會完整列出所有上級關係鏈、控制方與宣稱方，並顯示資料中已有的旗幟；缺少旗幟的對象仍會顯示名稱。

`drawing.add` 建立由地圖座標節點組成的線段。`drawing.update` 可修改節點、名稱、顏色、粗細、透明度、`dash` 虛線長度陣列及 `curve`／`soft` 開關，未提供的欄位保留原值；`drawing.remove` 移除線段。修改可復原，錯誤參數不會寫入存檔。

手機介面可從「地圖／圖層」→「繪製線段」設定顏色、寬度、不透明度、虛線間距、平滑曲線或柔性區域，之後在地圖上點選至少兩個節點並完成。已畫好的線段可在「管理線段與曲線」調整樣式或刪除；目前透過代碼修改節點，尚未提供拖曳節點與單條線的局部調色。

## 2. 指令執行接口

Web 核心載入 `App/Web/core.js` 後提供全域 `MC`。Node.js 可用 `require()` 取得相同接口。

```js
const engine = new MC.Engine(MC.blank('我的世界'));
engine.execute({
  command: 'entity.create',
  args: {id: 'TWN', name: '臺灣', layer: 'Country'}
});
engine.execute({
  command: 'entity.rename',
  args: {id: 'TWN', name: '新名稱'}
});
```

`engine.execute(commands, expectedRevision)` 接受單一指令或陣列，回傳依序排列的結果。批次內任一指令失敗時，整批資料不會寫入。`expectedRevision` 可用於防止以過期預覽覆蓋新資料，省略時採用目前版本。`engine.preview(commands)` 回傳預覽版本、結果和預覽世界，之後可在版本未變動時套用。`engine.undo()`、`engine.redo()` 提供最近 20 次可復原狀態。

外交指令使用 `Country` 圖層中的國家與 `Union` 圖層中的聯盟。`diplomacy.invite` 要求邀請方已是成員；受邀國可用 `diplomacy.accept` 或 `diplomacy.reject` 回覆，成員可用 `diplomacy.leave` 退出。Country 層開啟跨區共管時，接受新邀請或退出單一聯盟會保留其他上級；未開啟時，已有上級的國家須先退出。`country.overlord` 設定或解除宗主關係，並檢查循環。`diplomacy.civilwar` 接收明確指定的地塊 ID 陣列，建立新勢力、設定地塊控制方並開戰；目前這是手動操作，並非自動推演。

國家也可以用 `diplomacy.apply` 向聯盟成員提出申請，由收件國用 `diplomacy.approve` 或 `diplomacy.decline` 處理；申請階段不會立即改變上級。`diplomacy.vassalize` 為尚無宗主的國家建立藩屬關係，`diplomacy.release` 僅允許原宗主解除關係。這些操作是作者手動觸發，不包含 AI 談判或成功率推演。

安裝「強國遊戲」後，可從選取國家的「模組操作」使用外交功能。待處理的邀請及入盟申請會顯示在收件國頁面，決定前先預覽。舊存檔中已安裝的內建模組可在模組清單按「補入新操作」；`plugin.extend` 只增加缺少的操作 ID，不覆寫已有自訂操作或變更模組的啟用狀態。

每批最多 500 個最外層指令，包含模組和腳本在內最多 2,000 次調用，巢狀深度最多 32。錯誤會以 `Error` 回傳，部分錯誤帶有 `code`，例如 `NOT_FOUND`、`DUPLICATE`、`REVISION_CONFLICT`、`PARENT_LIMIT`、`INVALID_GEOMETRY` 與 `BUDGET`。

完整的目前已註冊指令、分類、用途和參數範例見 [command-catalog.json](command-catalog.json)。範例使用示意 ID，執行前請換成目前世界存在的 ID，或先建立所需對象。

## 3. 文字代碼與腳本

每行一個指令，英文 ID 或繁體中文指令名稱後接 JSON 參數。`#` 可作行內註解，雙引號字串內的 `#` 會保留。

```text
# 先建立國家
entity.create {"id":"TWN","name":"臺灣","layer":"Country"}
重新命名 {"id":"TWN","name":"台灣"}
entity.translate {"id":"TWN","language":"en","value":"Taiwan"}
```

也可使用由 `{ "command", "args" }` 組成的 JSON 陣列。`MC.parseCode(source)` 解析並檢查指令名稱及參數是否為 JSON 物件；英文 ID 和中文指令名稱都可使用。逐行語法出錯時會顯示行號，陣列會顯示第幾個指令。`code.save` 保存並檢查語法，`code.run` 在單一交易中執行，`code.delete` 刪除腳本。語法檢查無法保證資料中的 ID 存在或各指令參數有效，仍須執行預覽。

## 4. UI 編輯器接口

`ui.screen.create`、`ui.screen.rename`、`ui.screen.layout`、`ui.screen.delete` 管理畫面，可設定 1 至 3 欄；螢幕較窄時會自動減少欄數。`ui.control.add`、`ui.control.update`、`ui.control.move`、`ui.control.delete` 管理元件。元件的 `span` 設為 1、2 或 3 表示佔用格數，設為 0 表示滿版；未指定時使用 1 格。舊存檔沒有欄數及寬度設定時，會以單欄與 1 格顯示。

目前元件類型為 `label`、`button`、`number`、`text`、`toggle`。輸入型元件可設定 `binding: {"entity":"$selected","key":"population"}`，`$selected` 使用地圖當前選取的實體，也可改填固定 ID。`ui.control.setValue` 寫入綁定的自訂資料欄位。

按鈕可設定 `action: {"command":"entity.rename","args":{"id":"$selected","name":"新名稱"}}`。`ui.control.invoke` 執行按鈕動作，並以當前選取 ID 取代參數中的 `$selected`。由 UI 與文字代碼執行的操作使用相同交易引擎。

```json
[
  {"command":"ui.screen.create","args":{"id":"country-panel","name":"國家面板"}},
  {"command":"ui.control.add","args":{"screen":"country-panel","id":"population","type":"number","label":"人口","binding":{"entity":"$selected","key":"population"}}}
]
```

## 5. AI 請求與回傳

使用者在設定中輸入 HTTPS 接口、模型名稱及金鑰。iOS 版將金鑰存入該裝置的鑰匙圈，並以完整接口網址區分。請求使用 `POST`、`Authorization: Bearer <金鑰>` 和 `Content-Type: application/json`，資料格式為支援 Chat Completions 的 `model`、`messages`、`temperature`。

應答讀取 `choices[0].message.content`。內容須能解析為以下 JSON 物件：

```json
{
  "explanation": "已找到指定地區，準備更新名稱。",
  "commands": [
    {"command":"entity.rename","args":{"id":"TWN","name":"臺灣"}}
  ]
}
```

模型可選擇不提出修改，回傳空的 `commands` 陣列。App 先使用實際引擎預覽，只有預覽成功且使用者套用時才更改資料。若資料版本在預覽後改變，引擎要求重新預覽。回傳結構參考 [ai-response.schema.json](ai-response.schema.json)，各任務提示詞見 [AI-prompts.md](AI-prompts.md)。

為控制資料量，預設最多傳送 350 個實體摘要。被選取對象、它的父級與爭議／控制關係，以及名稱或 ID 被使用者要求提到的實體優先。`totalEntities`、`includedEntities` 和 `allEntitiesIncluded` 描述截取情況。所選實體過大的資料欄位會列在 `omittedDataKeys`。世界資料可能含作者自訂文字，提示詞要求模型將其視為資料。

## 6. iOS 原生橋接

Web 畫面透過 `window.webkit.messageHandlers.native.postMessage({id,method,args})` 發送請求，完成後呼叫 `window.nativeReceive(id,result,error)`。目前方法如下。

| 方法 | 參數 | 作用 |
|---|---|---|
| `saveKey` | `endpoint`, `key` | 將金鑰保存於 iOS 鑰匙圈。 |
| `ai` | `endpoint`, `payload` | 使用已保存金鑰對 HTTPS 接口發送 JSON。 |
| `share` | `name`, `content`, `mime` | 接收 base64 檔案內容並開啟 iOS 檔案匯出。 |
| `openExternal` | `url` | 開啟允許的 symbol.army 網址。 |

## 7. 目前匯入範圍

`MCImport.bmp(buffer)` 支援未壓縮 8 位索引色、24 位及 32 位 BMP。圖像匯入提供顏色地塊與封閉線稿兩種用途。單張上限為 2,400 萬像素，ZIP 中單檔及總解壓量另有記憶體限制。

`MCImport.paradox(buffer)` 解析 ZIP 中一張 `provinces.bmp`、同目錄 `definition.csv`，以及 `states/*.txt` 的省份與初始 `history.owner`。若 ZIP 中有多張同名地圖，請先分開。不同 Paradox 遊戲的其他 State 語法、歷史日期與高度／地形資料仍需增加對應解析器。

地圖與符號的外部來源與授權列於 `App/Web/vendor/manifest.json` 及各套件授權檔。Natural Earth 世界底圖的範圍為國家級，2026 行政區與 1816 劇本資料仍待建立與核驗。
