/** スプレッドシート操作の共通処理（このスクリプトはスプレッドシートに紐付けて使う） */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートがありません：' + name + '（メニュー「初期設定」を実行してください）');
  return sh;
}

/** 見出し付きで全行をオブジェクト配列として読む */
function readRows_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    header.forEach(function (h, j) { o[h] = row[j]; });
    return o;
  });
}

function appendRow_(name, obj) {
  var sh = sheet_(name);
  var header = HEADERS[name];
  sh.appendRow(header.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
  return sh.getLastRow();
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function audit_(action, target, result) {
  var actor = Session.getActiveUser().getEmail() || 'system';
  appendRow_(SHEETS.AUDIT, { '日時': new Date(), '実行者': actor, '操作': action, '対象': target, '結果': result });
}

/** 既存企業一覧をルールエンジン用の形に変換 */
function companiesForRules_() {
  return readRows_(SHEETS.COMPANIES).map(function (r) {
    return { id: r['企業ID'], corporateNumber: r['法人番号'], domain: r['公式ドメイン'], phone: r['電話（正規化）'], name: r['企業名'] };
  });
}
