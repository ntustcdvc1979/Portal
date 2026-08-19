/**
 * 崇德志工社 — 志工人格測驗抽獎收件端
 *
 * 部署方式見同資料夾的 README.md。
 * 部署後把 /exec 網址貼到 quiz.html 最上方的 ENDPOINT 常數。
 */

// 收件試算表的分頁名稱，不存在時會自動建立
var SHEET_NAME = '報名資料';

var HEADERS = [
  '送出時間',
  '人格類型',
  '大名',
  '系級',
  '聯絡電話',
  'LINE / IG',
  '有興趣的活動',
  '未來活動建議',
  '作答內容'
];

/**
 * 網頁以 POST 送出 JSON。Content-Type 為 text/plain，
 * 屬於 CORS 安全清單，可避開 Apps Script 不支援的 preflight 請求。
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    // 併發送出時避免搶同一列
    lock.waitLock(20000);

    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();

    sheet.appendRow([
      data.submittedAt ? new Date(data.submittedAt) : new Date(),
      data.typeName   || '',
      data.name       || '',
      data.dept       || '',
      // 前面加上單引號，避免 09 開頭的電話被試算表當成數字吃掉前導 0
      data.phone ? "'" + data.phone : '',
      data.social     || '',
      data.interests  || '',
      data.suggest    || '',
      data.answers    || ''
    ]);

    return json_({ ok: true });

  } catch (err) {
    return json_({ ok: false, error: String(err) });

  } finally {
    lock.releaseLock();
  }
}

/** 直接用瀏覽器開啟部署網址時的健康檢查 */
function doGet() {
  return json_({ ok: true, service: 'cdvc-quiz' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
