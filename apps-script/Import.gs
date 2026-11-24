/**
 * 「取込」シート（企業台帳_初期整理.xlsx の「企業台帳」シートを貼り付けたもの）から
 * 「企業」シートへ取り込む。重複は既存企業に統合し、件数を監査ログに残す。
 * メール送信の可否はここでは許可しない（接触可否は人が根拠を記録してから）。
 */
function importCompaniesFromSheet() {
  var src = ss_().getSheetByName('取込');
  if (!src) throw new Error('「取込」シートを作り、企業台帳を貼り付けてください');
  var values = src.getDataRange().getValues();
  var header = values.shift();
  var col = function (name) { return header.indexOf(name); };
  var existing = companiesForRules_();
  var added = 0, merged = 0, now = new Date();
  values.forEach(function (row) {
    var name = normalizeText(row[col('企業名')]);
    if (!name) return;
    var cand = { name: name, domain: normalizeText(row[col('公式ドメイン')]), phone: row[col('電話')] };
    if (findDuplicateCompany(cand, existing)) { merged++; return; }
    var id = normalizeText(row[col('企業ID')]) || newId_('C');
    appendRow_(SHEETS.COMPANIES, { '企業ID': id, '企業名': name, '公式ドメイン': cand.domain,
      '電話（正規化）': normalizePhone(cand.phone), '業種': row[col('業種')], '所在地': row[col('所在地')],
      '出典URL': row[col('公式サイト')], '顧客区分': 'prospect', '作成日時': now, '更新日時': now });
    existing.push({ id: id, domain: cand.domain, phone: cand.phone, name: name });
    added++;
  });
  audit_('企業台帳取込', '取込シート', '追加 ' + added + ' 件／重複統合 ' + merged + ' 件');
  SpreadsheetApp.getUi().alert('追加 ' + added + ' 件、重複のため統合 ' + merged + ' 件');
}
