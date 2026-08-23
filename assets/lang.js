/**
 * 中英切換：只改 <html data-lang>，顯示與隱藏交給 CSS。
 * 選擇會記住，兩個頁面共用同一個設定。
 *
 * 頁面上的雙語內容寫成：
 *   <span data-l="zh">中文</span><span data-l="en">English</span>
 *
 * quiz.html 另有從資料產生的文字，會監聽 cdvc:lang 事件重新繪製。
 */
(function () {
  "use strict";

  var KEY = "cdvc-lang";
  var root = document.documentElement;

  function current() {
    return root.getAttribute("data-lang") === "en" ? "en" : "zh";
  }

  function apply(lang, remember) {
    lang = (lang === "en") ? "en" : "zh";

    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang === "en" ? "en" : "zh-Hant");

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-set-lang]"),
      function (btn) {
        btn.setAttribute("aria-pressed", btn.getAttribute("data-set-lang") === lang ? "true" : "false");
      }
    );

    if (remember) {
      try { localStorage.setItem(KEY, lang); } catch (e) { /* 無痕模式會擋，忽略 */ }
    }

    document.dispatchEvent(new CustomEvent("cdvc:lang", { detail: lang }));
  }

  // 先套用記住的語言，沒有記錄就看瀏覽器語言
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* 同上 */ }

  if (!saved) {
    var nav = (navigator.language || "").toLowerCase();
    saved = (nav.indexOf("zh") === 0) ? "zh" : "en";
  }

  apply(saved, false);

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-set-lang]"),
    function (btn) {
      btn.addEventListener("click", function () {
        apply(btn.getAttribute("data-set-lang"), true);
      });
    }
  );

  window.cdvcLang = current;
})();
