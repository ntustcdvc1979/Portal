/**
 * 崇德志工社 志工人格測驗抽獎收件端
 *
 * 部署方式見同資料夾的 README.md。
 * 部署後把 /exec 網址貼到 quiz.html 最上方的 ENDPOINT 常數。
 */

// 收件試算表的分頁名稱，不存在時會自動建立
var SHEET_NAME = '報名資料';

// 新欄位一律加在最後面：既有試算表的欄位對應才不會整排位移
var HEADERS = [
  '送出時間',
  '人格類型',
  '大名',
  '系級',
  '聯絡電話',
  'LINE / IG',
  '有興趣的活動',
  '未來活動建議',
  '作答內容',
  '參加抽獎',
  '作答編號'
];

/**
 * 每分鐘最多接受幾筆。防的是機器人洗版，不是擋正常使用者；
 * 茶會現場大家同時填也用不到 30 筆／分鐘。
 */
var RATE_PER_MIN = 30;

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

    // 蜜罐欄位：真人看不到也填不到，有值就是機器人。
    // 回 ok 讓對方以為成功，免得它換手法再來。
    if (data.website) {
      return json_({ ok: true });
    }

    if (overRateLimit_()) {
      return json_({ ok: false, error: 'rate limited' });
    }

    var bad = validate_(data);
    if (bad) {
      return json_({ ok: false, error: bad });
    }

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
      data.answers    || '',
      data.joinDraw ? '是' : '否',
      // 同一次作答會先留下一筆匿名結果，登記抽獎再送一筆，用這個編號對起來
      data.sessionId  || ''
    ]);

    return json_({ ok: true });

  } catch (err) {
    return json_({ ok: false, error: String(err) });

  } finally {
    lock.releaseLock();
  }
}

/**
 * 直接用瀏覽器開啟部署網址時的健康檢查。
 * 刻意不回傳任何報名資料，這支網址是公開的，讀取一律走試算表。
 */
function doGet() {
  return json_({ ok: true, service: 'cdvc-quiz' });
}

/**
 * 必填欄位與長度檢查。前端擋過一次，這裡是繞過前端時的第二道。
 * 沒有登記抽獎的匿名紀錄不含個人資料，只檢查長度。
 */
function validate_(data) {
  if (data.joinDraw) {
    if (!trim_(data.name)) { return 'name required'; }
    if (!trim_(data.dept)) { return 'dept required'; }

    var phone = trim_(data.phone).replace(/[\s()-]/g, '');
    if (!/^\+?\d{8,15}$/.test(phone)) { return 'phone invalid'; }
  } else if (!trim_(data.typeName)) {
    // 匿名紀錄至少要有測驗結果，否則就是空白請求
    return 'nothing to record';
  }

  // 避免有人塞超長字串把試算表撐爆（單格上限 5 萬字元）
  var limits = { name: 40, dept: 40, phone: 20, social: 60, suggest: 500, interests: 500, answers: 2000 };
  for (var k in limits) {
    if (limits.hasOwnProperty(k) && trim_(data[k]).length > limits[k]) {
      return k + ' too long';
    }
  }

  return '';
}

/** 全站層級的簡易流量上限。Apps Script 讀不到來源 IP，只能做總量控管。 */
function overRateLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'rl-' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  return n > RATE_PER_MIN;
}

function trim_(v) {
  return v == null ? '' : String(v).trim();
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

  } else if (sheet.getLastColumn() < HEADERS.length) {
    // 舊的表少了後來新增的欄位，補上標題就好，既有資料不動
    var from = sheet.getLastColumn() + 1;
    var missing = HEADERS.slice(from - 1);
    sheet.getRange(1, from, 1, missing.length)
         .setValues([missing])
         .setFontWeight('bold');
  }

  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
