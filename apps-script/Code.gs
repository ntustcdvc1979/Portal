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
 * 固定欄位後面，每一題各佔一欄，標題由網頁送過來的題目文字產生。
 * 題目增加時會自動補上新欄位；既有欄位不會改名，順序也不會動。
 */
function headersWith_(questions) {
  return HEADERS.concat((questions || []).map(function (q, i) {
    return (i + 1) + '. ' + q;
  }));
}

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

    // 文昌祈福報名有自己的分頁與檢查，不跟測驗資料混在一起
    if (data.form === 'wenchang') {
      return saveWenchang_(data);
    }

    var bad = validate_(data);
    if (bad) {
      return json_({ ok: false, error: bad });
    }

    var answerList = Array.isArray(data.answerList) ? data.answerList : [];
    var sheet = getSheet_(data.questions);

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
      // 一欄式的完整作答，只是備份，日常閱讀請看後面一題一欄的部分
      summarise_(data.questions, answerList),
      data.joinDraw ? '是' : '否',
      // 同一次作答會先留下一筆匿名結果，登記抽獎再送一筆，用這個編號對起來
      data.sessionId  || ''
    ].concat(answerList));

    return json_({ ok: true });

  } catch (err) {
    return json_({ ok: false, error: String(err) });

  } finally {
    lock.releaseLock();
  }
}

/**
 * GET 請求。
 * - 預設：健康檢查。
 * - ?action=quota：回傳各活動的名額與目前報名人數，給首頁顯示「剩幾名／額滿」。
 * 只回傳數字，不回傳任何個人資料；這支網址是公開的，報名內容一律只在試算表裡看。
 */
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';

  if (action === 'quota') {
    try {
      return json_({ ok: true, events: quotaSummaryCached_() });
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }

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
  var limits = { name: 40, dept: 40, phone: 20, social: 60, suggest: 500, interests: 500 };
  for (var k in limits) {
    if (limits.hasOwnProperty(k) && trim_(data[k]).length > limits[k]) {
      return k + ' too long';
    }
  }

  // 題數與每題作答長度也要有上限，否則等於留了一個沒有欄位限制的入口
  if (data.questions && data.questions.length > 40) { return 'too many questions'; }

  var list = data.answerList || [];
  for (var i = 0; i < list.length; i++) {
    if (trim_(list[i]).length > 600) { return 'answer ' + (i + 1) + ' too long'; }
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

/** 把題目與作答併成一格，當作備份用的完整紀錄 */
function summarise_(questions, answerList) {
  if (!Array.isArray(questions)) { return ''; }

  return questions.map(function (q, i) {
    return q + '：' + (answerList[i] || '（未答）');
  }).join(' | ');
}

/**
 * 在 Apps Script 編輯器選這個函式按「執行」，執行紀錄會印出
 * 收件試算表的名稱、網址與目前筆數。找不到試算表時也會講清楚原因。
 */
function checkSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    Logger.log('這支腳本沒有綁定任何試算表（可能是用「新增專案」建立的獨立腳本）。');
    Logger.log('請改從試算表的「擴充功能 → Apps Script」建立，或在下面的 SPREADSHEET_ID 填入試算表 ID。');
    return;
  }

  var sheet = getSheet_([]);
  var rows = Math.max(0, sheet.getLastRow() - 1);

  Logger.log('試算表名稱：' + ss.getName());
  Logger.log('試算表網址：' + ss.getUrl());
  Logger.log('分頁：' + SHEET_NAME + '，目前 ' + rows + ' 筆資料');

  var wc = ss.getSheetByName(WENCHANG_SHEET);
  Logger.log('分頁：' + WENCHANG_SHEET + '，' +
             (wc ? '目前 ' + Math.max(0, wc.getLastRow() - 1) + ' 筆報名' : '尚未有人報名（第一筆送出時會自動建立）'));
}

/**
 * 想把資料寫到「別的」試算表時，把它的 ID 填在這裡（網址中 /d/ 與 /edit 之間那段）。
 * 留空就寫進這支腳本所綁定的試算表。
 */
var SPREADSHEET_ID = '';

function getSheet_(questions) {
  return sheetNamed_(SHEET_NAME, headersWith_(questions));
}

/** 取得指定名稱的分頁，不存在就建立；標題列不足時只補後面缺的欄位 */
function sheetNamed_(name, headers) {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('找不到試算表：腳本未綁定試算表，且 SPREADSHEET_ID 是空的');
  }

  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

  } else if (sheet.getLastColumn() < headers.length) {
    // 舊的表少了後來新增的欄位，補上標題就好，既有資料不動
    var from = sheet.getLastColumn() + 1;
    var missing = headers.slice(from - 1);
    sheet.getRange(1, from, 1, missing.length)
         .setValues([missing])
         .setFontWeight('bold');
  }

  return sheet;
}

/* ============================================================
   三段體驗報名（Tao.html；送出時 form 欄位為 wenchang）
   ============================================================ */

var WENCHANG_SHEET = '文昌祈福';

// 新欄位一律加在最後面，理由同上方 HEADERS
var WENCHANG_HEADERS = [
  '送出時間',
  '姓名',
  '性別',
  '功德費選項',
  '功德費金額',
  '場次',
  '希望時間'
];

var WENCHANG_GENDERS = ['生理男', '生理女'];
var WENCHANG_FEES = ['100', '200', '隨喜'];
var WENCHANG_OTHER_TIME = '預約其他時間';

function saveWenchang_(data) {
  var bad = validateWenchang_(data);
  if (bad) {
    return json_({ ok: false, error: bad });
  }

  sheetNamed_(WENCHANG_SHEET, WENCHANG_HEADERS).appendRow([
    data.submittedAt ? new Date(data.submittedAt) : new Date(),
    trim_(data.name),
    trim_(data.gender),
    trim_(data.feeOption),
    Number(data.fee),
    trim_(data.session),
    trim_(data.preferred)
  ]);

  return json_({ ok: true });
}

function validateWenchang_(data) {
  if (!trim_(data.name)) { return 'name required'; }
  if (WENCHANG_GENDERS.indexOf(trim_(data.gender)) < 0) { return 'gender invalid'; }
  if (WENCHANG_FEES.indexOf(trim_(data.feeOption)) < 0) { return 'fee option invalid'; }

  var fee = Number(data.fee);
  if (!isFinite(fee) || fee < 0 || fee > 1000000 || Math.floor(fee) !== fee) {
    return 'fee invalid';
  }

  // 選了固定金額，金額就必須一致，免得有人改請求送進不相符的數字
  if (data.feeOption !== '隨喜' && String(fee) !== data.feeOption) {
    return 'fee does not match option';
  }

  if (!trim_(data.session)) { return 'session required'; }
  if (data.session === WENCHANG_OTHER_TIME && !trim_(data.preferred)) {
    return 'preferred time required';
  }

  var limits = { name: 40, session: 80, preferred: 120 };
  for (var k in limits) {
    if (limits.hasOwnProperty(k) && trim_(data[k]).length > limits[k]) {
      return k + ' too long';
    }
  }

  return '';
}

/* ============================================================
   活動名額
   ------------------------------------------------------------
   幹部在試算表「活動名額」分頁維護每個活動的表單與名額：
     活動名稱｜報名連結（網站上的 forms.gle）｜表單編輯網址｜名額
   - 首頁用 doGet?action=quota 讀人數，按鈕顯示「剩 N 名」或「額滿」。
   - 每份 Google 表單掛一個送出觸發器（installQuotaTriggers 建立），
     有人送出時算出他的順位、寄信通知是否報名成功、記到「錄取名單」，
     名額滿了就自動關閉表單。不設備取：額滿就是額滿。
   ============================================================ */

var QUOTA_SHEET = '活動名額';
// 舊版的表有第 5 欄「備取名額」，現在不再讀取；第 4 欄一律當作名額
var QUOTA_HEADERS = ['活動名稱', '報名連結（網站上的 forms.gle）', '表單編輯網址', '名額'];

var ROSTER_SHEET = '錄取名單';
var ROSTER_HEADERS = ['送出時間', '活動名稱', '順位', '結果', '姓名', 'Email', '通知'];

var QUOTA_CACHE_SECONDS = 60;
var FULL_MESSAGE = '本活動名額已滿，感謝你的關注！歡迎追蹤崇德志工社 IG @ntustcdvc 留意下次活動。';

/** 讀「活動名額」分頁；沒有這個分頁時建立空白表頭，回傳空清單 */
function quotaRows_() {
  var sheet = sheetNamed_(QUOTA_SHEET, QUOTA_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) { return []; }

  return sheet.getRange(2, 1, last - 1, QUOTA_HEADERS.length).getValues()
    .map(function (r) {
      return {
        name: trim_(r[0]),
        link: normaliseLink_(r[1]),
        editUrl: trim_(r[2]),
        quota: Math.max(0, Math.floor(Number(r[3]) || 0))
      };
    })
    .filter(function (r) { return r.link && r.editUrl && r.quota > 0; });
}

/** 網址統一去掉結尾斜線與查詢字串，比對網站上的連結時才不會因為小差異對不上 */
function normaliseLink_(v) {
  return trim_(v).replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** 由目前回覆數判斷狀態 */
function quotaState_(row, count) {
  return {
    quota: row.quota,
    count: count,
    left: Math.max(0, row.quota - count),
    full: count >= row.quota
  };
}

function quotaSummary_() {
  var out = {};
  quotaRows_().forEach(function (row) {
    try {
      var form = FormApp.openByUrl(row.editUrl);
      out[row.link] = quotaState_(row, form.getResponses().length);
    } catch (err) {
      // 單一表單打不開（網址錯、沒權限）不影響其他活動
      out[row.link] = { error: 'cannot open form' };
    }
  });
  return out;
}

/** 首頁每次載入都會呼叫，結果快取一分鐘，避免一直開表單耗用配額 */
function quotaSummaryCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('quota-summary');
  if (hit) { return JSON.parse(hit); }

  var data = quotaSummary_();
  cache.put('quota-summary', JSON.stringify(data), QUOTA_CACHE_SECONDS);
  return data;
}

/**
 * 表單送出觸發器（由 installQuotaTriggers 掛到每份表單上）。
 * 函式名稱不能以底線結尾，否則觸發器呼叫不到。
 */
function onQuotaFormSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var form = e.source;
    var response = e.response;
    var row = rowForForm_(form);
    if (!row) { return; }

    // 依送出時間排序後，這筆是第幾個；同時送出也不會搶到同一個順位
    var responses = form.getResponses();
    var rank = 1;
    for (var i = 0; i < responses.length; i++) {
      if (responses[i].getId() === response.getId()) { rank = i + 1; break; }
    }

    // 名額內就是報名成功；超過的（表單關閉前同時送出的人）就是額滿
    var result = (rank <= row.quota) ? '報名成功' : '額滿未錄取';

    var who = respondent_(response);
    var notice = notifyRespondent_(row, who, result);

    sheetNamed_(ROSTER_SHEET, ROSTER_HEADERS).appendRow([
      response.getTimestamp(),
      row.name,
      rank,
      result,
      who.name,
      who.email,
      notice
    ]);

    // 名額滿了：關閉表單，直接拿到連結的人也報不進來
    if (responses.length >= row.quota && form.isAcceptingResponses()) {
      form.setAcceptingResponses(false);
      form.setCustomClosedFormMessage(FULL_MESSAGE);
    }

    CacheService.getScriptCache().remove('quota-summary');

  } finally {
    lock.releaseLock();
  }
}

/**
 * 編輯網址長這樣：https://docs.google.com/forms/d/<表單ID>/edit
 * 分享出去的填答網址是 /forms/d/e/<另一組ID>/viewform，那組 ID 打不開表單，所以排除。
 */
function formIdFromUrl_(url) {
  var m = String(url).match(/\/forms\/d\/(?!e\/)([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

function rowForForm_(form) {
  var id = form.getId();
  var rows = quotaRows_();
  for (var i = 0; i < rows.length; i++) {
    if (formIdFromUrl_(rows[i].editUrl) === id) { return rows[i]; }
  }
  return null;
}

/** 從回覆中找出姓名與 Email：Email 以表單「收集電子郵件地址」為準，否則找題目名稱 */
function respondent_(response) {
  var who = { name: '', email: '' };

  try { who.email = trim_(response.getRespondentEmail()); } catch (err) { /* 表單沒收集 */ }

  response.getItemResponses().forEach(function (ir) {
    var title = trim_(ir.getItem().getTitle());
    var answer = trim_(ir.getResponse());
    if (!who.name && /姓名|名字|大名|name/i.test(title)) { who.name = answer; }
    if (!who.email && /e-?mail|信箱|電子郵件/i.test(title) && /@/.test(answer)) { who.email = answer; }
  });

  return who;
}

function notifyRespondent_(row, who, result) {
  if (!who.email) { return '未寄出（表單沒有收集 Email）'; }

  var hello = (who.name ? who.name + ' 你好，' : '你好，');
  var subject, body;

  if (result === '報名成功') {
    subject = '【崇德志工社】' + row.name + '：報名成功';
    body = hello + '\n\n你已成功報名「' + row.name + '」，期待在活動見到你！\n' +
           '如果之後無法參加，請盡早私訊社團 IG @ntustcdvc，讓名額留給其他同學。';
  } else {
    subject = '【崇德志工社】' + row.name + '：名額已滿';
    body = hello + '\n\n很抱歉，「' + row.name + '」名額已滿，這次無法錄取。\n' +
           '歡迎追蹤社團 IG @ntustcdvc，留意下次活動！';
  }

  body += '\n\n台科大崇德志工社 NTUST CDVC\n（此信由系統自動寄出）';

  try {
    MailApp.sendEmail(who.email, subject, body);
    return '已寄出';
  } catch (err) {
    return '寄送失敗：' + String(err).slice(0, 80);
  }
}

/**
 * 在「活動名額」填好之後，在編輯器選這個函式按「執行」一次。
 * 會替每份表單掛上送出觸發器；重複執行不會重複掛。之後新增活動再執行一次即可。
 */
function installQuotaTriggers() {
  var existing = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onQuotaFormSubmit') { existing[t.getTriggerSourceId()] = true; }
  });

  quotaRows_().forEach(function (row) {
    if (!formIdFromUrl_(row.editUrl)) {
      Logger.log('「表單編輯網址」要貼編輯頁的網址（.../forms/d/<ID>/edit），不是分享出去的填答網址：' + row.name);
      return;
    }
    try {
      var form = FormApp.openByUrl(row.editUrl);
      if (existing[form.getId()]) {
        Logger.log('已有觸發器：' + row.name);
        return;
      }
      ScriptApp.newTrigger('onQuotaFormSubmit').forForm(form).onFormSubmit().create();
      Logger.log('已掛上觸發器：' + row.name);
    } catch (err) {
      Logger.log('打不開表單（檢查編輯網址與權限）：' + row.name + '，' + err);
    }
  });

  // 順便建好兩個分頁，讓幹部看得到欄位
  sheetNamed_(ROSTER_SHEET, ROSTER_HEADERS);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
