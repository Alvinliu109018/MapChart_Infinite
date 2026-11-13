# MapChart ∞ 介面與資料格式

版本 0.1，對應專案目前的實作。完整功能仍在開發，請以程式中的指令註冊表為準。

## 1. 世界資料

世界以 `mapchart-infinity` 格式的 JSON 儲存。每個實體有穩定的 `id`、顯示 `name`、可修改的 `code`、圖層 `layer`、父級 `parents`、控制方 `controller`、宣稱方 `claims`、旗幟 `flag`、顏色 `color`、別名、翻譯、資料欄位及選用的幾何。

預設圖層依序為 `Union`、`Country`、`State`、`Province`。嵌套圖層的父級要位於所設定的上一層。開啟該層 `shared` 後，一個實體可綁定多個上級。獨立圖層可以有不同邊界與關係。世界存檔中的 `screens` 和 `scripts` 分別保存 UI 畫面及腳本；較早存檔缺少這兩個欄位時可繼續開啟。

幾何採用 GeoJSON 的 `Polygon` 或 `MultiPolygon`。`geographic` 的座標順序為經度、緯度；`pixel` 的原點位於左上角，X 向右、Y 向下。外環與洞均須封閉。`geometry.area` 在地理座標下回傳近似平方公尺，在像素／平面座標下回傳平方座標單位。

`layer.autobind` 計算子區與上級區的幾何交集，選擇交集面積最大的上級，無交集的子區保持原關係。面積相同時，依上級 ID 排序選取。`layer.aggregate` 以面積或指定資料欄位加權，記錄各方權重並更新上級控制方。

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

`ui.screen.create`、`ui.screen.rename`、`ui.screen.delete` 管理畫面。`ui.control.add`、`ui.control.update`、`ui.control.move`、`ui.control.delete` 管理元件。

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
