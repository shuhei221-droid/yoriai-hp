/** 初期設定：必要なシートと見出しを作る（既存のシート・データは消さない） */
function setupSheets() {
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    }
  });
  // 承認列を承認者だけが編集できるよう保護（承認者はシートの保護設定で追加）
  var drafts = sheet_(SHEETS.DRAFTS);
  var col = HEADERS[SHEETS.DRAFTS].indexOf('承認') + 1;
  var range = drafts.getRange(2, col, drafts.getMaxRows() - 1, 1);
  range.insertCheckboxes();
  var p = range.protect().setDescription('承認列：承認者のみ編集');
  p.removeEditors(p.getEditors());
  if (p.canDomainEdit()) p.setDomainEdit(false);
  p.addEditor(Session.getEffectiveUser());
  audit_('初期設定', 'シート作成', 'OK');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Yoriai営業')
    .addItem('初期設定（シート作成）', 'setupSheets')
    .addItem('「取込」シートから企業台帳に取り込む', 'importCompaniesFromSheet')
    .addSeparator()
    .addItem('選択した企業をClaudeで分析・文案作成', 'analyzeSelectedCompanies')
    .addToUi();
}
