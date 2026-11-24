/**
 * HP問い合わせフォームの受付（ウェブアプリ）
 * 記録 → 企業・担当者・案件を作成（重複は既存に紐付け）→ 社内通知 → 自動返信（固定文面）
 * HubSpot連携はアカウント作成後に追加する（Hubspot.gs 予定）。
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var errors = validateInquiry(data);
    if (errors.indexOf('honeypot') >= 0) return json_({ status: 'ok' }); // ボットには成功を装う
    if (errors.length) return json_({ status: 'error', message: errors.join(',') });

    var c = {};
    ['company','name','phone','email','industry','product','plan','message','page'].forEach(function (k) {
      c[k] = normalizeText(data[k]).slice(0, 2000);
    });
    var result = registerInquiry_(c);
    notifyInternal_(c, result);
    sendAutoReply_(c);
    audit_('問い合わせ受付', result.companyId + '/' + result.dealId, result.note);
    return json_({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return json_({ status: 'error', message: 'server_error' });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function registerInquiry_(c) {
  var now = new Date();
  var candidate = { name: c.company, domain: domainFromEmail(c.email), phone: c.phone };
  var dup = findDuplicateCompany(candidate, companiesForRules_());
  var companyId, note;
  if (dup) {
    companyId = dup.id; note = '既存企業に紐付け（' + dup.matchedBy + '一致）';
  } else {
    companyId = newId_('C');
    appendRow_(SHEETS.COMPANIES, { '企業ID': companyId, '企業名': c.company, '公式ドメイン': candidate.domain,
      '電話（正規化）': normalizePhone(c.phone), '業種': c.industry, '出典URL': c.page, '出典取得日': now,
      '顧客区分': 'prospect', '作成日時': now, '更新日時': now });
    note = '新規企業';
  }
  var contact = readRows_(SHEETS.CONTACTS).filter(function (r) { return normalizeEmail(r['メール']) === normalizeEmail(c.email); })[0];
  var contactId = contact ? contact['担当者ID'] : newId_('P');
  if (!contact) {
    appendRow_(SHEETS.CONTACTS, { '担当者ID': contactId, '企業ID': companyId, '氏名': c.name, 'メール': normalizeEmail(c.email),
      '代表アドレス': false, '公表場所URL': '', '利用目的': 'お問い合わせへの回答', '作成日時': now });
    appendRow_(SHEETS.ELIGIBILITY, { '担当者ID': contactId, 'チャネル': 'email', '根拠': 'inbound_inquiry', '根拠URL': c.page,
      '確認日': now, '確認者': 'フォーム', '判定': '問い合わせへの返信のみ', '判定理由': 'プライバシーポリシー整備前のため営業メールは不可' });
  }
  var dealId = newId_('D');
  appendRow_(SHEETS.DEALS, { '案件ID': dealId, '企業ID': companyId, '担当者ID': contactId, '商品': c.product || 'WORKS_INDIVIDUAL',
    '経路': 'inbound', 'ステージ': 'リード', '作成日時': now, '更新日時': now });
  appendRow_(SHEETS.INQUIRIES, { '受信日時': now, '会社名': c.company, '氏名': c.name, '電話': c.phone, 'メール': c.email,
    '業種': c.industry, '商品': c.product, '希望プラン': c.plan, '内容': c.message, 'ページ': c.page,
    '企業ID': companyId, '案件ID': dealId, '処理結果': note });
  return { companyId: companyId, contactId: contactId, dealId: dealId, note: note };
}

function notifyInternal_(c, r) {
  MailApp.sendEmail({
    to: prop_('NOTIFY_TO', 'info@yoriai-info.jp'),
    subject: '【HP問い合わせ】' + c.company + '／' + c.name,
    body: ['会社名：' + c.company, '氏名：' + c.name, '電話：' + c.phone, 'メール：' + c.email,
      '業種：' + c.industry, '商品：' + (c.product || '未選択'), '希望プラン：' + c.plan, '', '内容：', c.message, '',
      '企業ID：' + r.companyId + '（' + r.note + '）', '案件ID：' + r.dealId, 'ページ：' + c.page].join('\n'),
    replyTo: c.email, name: '合同会社Yoriai'
  });
}

function sendAutoReply_(c) {
  MailApp.sendEmail({
    to: c.email,
    subject: '【合同会社Yoriai】お問い合わせを受け付けました',
    body: [c.company, c.name + ' 様', '',
      'このたびは合同会社Yoriaiへお問い合わせいただき、ありがとうございます。',
      '以下の内容で受け付けました。担当者より平日24時間以内にご連絡いたします。', '',
      '―――――――――――――', '希望プラン：' + (c.plan || '未選択'), 'お問い合わせ内容：', c.message || '（記入なし）', '―――――――――――――', '',
      '※本メールは自動返信です。お心当たりのない場合は破棄してください。', '',
      '合同会社Yoriai', '大阪府門真市', 'TEL 080-5360-8397', 'info@yoriai-info.jp'].join('\n'),
    replyTo: prop_('NOTIFY_TO', 'info@yoriai-info.jp'), name: '合同会社Yoriai'
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
