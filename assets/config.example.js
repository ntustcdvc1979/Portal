/* 執行時設定的範本。
   本機測試：複製成 assets/config.js，把 endpoint 填成 Apps Script 的 /exec 網址。
   config.js 列在 .gitignore，不會被推上 git。
   線上網站：不用手動放，部署時 GitHub Actions 會依 repository secret APPS_SCRIPT_URL 自動產生。 */
window.CDVC_CONFIG = {
  endpoint: ""
};
