/**
 * ルールエンジン（純粋関数のみ。Google固有のAPIを使わないので Node でテストできる）
 * 接触可否・重複・停止・送信前チェックはここで決定し、AIには判断させない。
 */

var STOP_WORDS = ['配信停止', '停止して', '送らないで', '送信しないで', '不要です', '結構です', '迷惑', '二度と', 'unsubscribe', 'opt out', 'オプトアウト', '削除してください'];
var ELIGIBLE_BASES = ['consent', 'business_relationship', 'published_address', 'inbound_inquiry'];

function normalizeText(s) {
  return String(s == null ? '' : s).normalize('NFKC').trim();
}

function normalizePhone(s) {
  var d = normalizeText(s).replace(/\D/g, '');
  return d.length >= 9 && d.length <= 11 ? d : '';
}

function normalizeEmail(s) {
  var e = normalizeText(s).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

function domainFromUrl(url) {
  var m = normalizeText(url).toLowerCase().match(/^https?:\/\/([^\/?#:]+)/);
  if (!m) return '';
  return m[1].replace(/^www\./, '');
}

var FREE_MAIL = ['gmail.com', 'yahoo.co.jp', 'hotmail.com', 'outlook.com', 'outlook.jp', 'icloud.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp'];

function domainFromEmail(email) {
  var e = normalizeEmail(email);
  if (!e) return '';
  var d = e.split('@')[1];
  return FREE_MAIL.indexOf(d) >= 0 ? '' : d;
}

function companyNameKey(name) {
  return normalizeText(name)
    .replace(/[（(].*?[)）]/g, '')
    .replace(/株式会社|有限会社|合同会社|医療法人|税理士法人|社会福祉法人/g, '')
    .replace(/[\s・\/／]/g, '');
}

/**
 * 既存企業から一致するものを探す。順序：法人番号 → ドメイン → 電話 → 社名
 * companies: [{id, corporateNumber, domain, phone, name}]
 * 戻り値: {id, matchedBy} または null
 */
function findDuplicateCompany(candidate, companies) {
  var keys = [
    ['corporateNumber', function (c) { return normalizeText(c.corporateNumber); }],
    ['domain', function (c) { return normalizeText(c.domain).toLowerCase(); }],
    ['phone', function (c) { return normalizePhone(c.phone); }],
    ['name', function (c) { return companyNameKey(c.name); }]
  ];
  for (var i = 0; i < keys.length; i++) {
    var get = keys[i][1];
    var v = get(candidate);
    if (!v) continue;
    for (var j = 0; j < companies.length; j++) {
      if (get(companies[j]) === v) return { id: companies[j].id, matchedBy: keys[i][0] };
    }
  }
  return null;
}

/**
 * 接触可否の判定。根拠が不十分なら必ず false。
 * rec: {channel, basis, evidenceUrl, refusalNoticeChecked, checkedAt, reviewer, expiresAt}
 */
function evaluateEligibility(rec, now) {
  now = now || new Date();
  if (!rec) return { allowed: false, reason: '接触可否の記録なし' };
  if (rec.channel !== 'email') return { allowed: false, reason: 'メール以外のチャネルは自動送信しない' };
  if (ELIGIBLE_BASES.indexOf(rec.basis) < 0) return { allowed: false, reason: '根拠なし' };
  if (!normalizeText(rec.evidenceUrl) && rec.basis !== 'inbound_inquiry') return { allowed: false, reason: '根拠URLなし' };
  if (rec.basis === 'published_address' && rec.refusalNoticeChecked !== true) {
    return { allowed: false, reason: '広告メール拒否の表示がないことを未確認' };
  }
  if (!rec.checkedAt || !normalizeText(rec.reviewer)) return { allowed: false, reason: '確認日または確認者なし' };
  if (rec.expiresAt && new Date(rec.expiresAt) < now) return { allowed: false, reason: '確認の期限切れ' };
  return { allowed: true, reason: 'OK' };
}

/** 停止リストに該当するか（企業・担当者・メールのいずれか。チャネル空欄は全チャネル） */
function isSuppressed(target, suppressions) {
  var email = normalizeEmail(target.email);
  for (var i = 0; i < suppressions.length; i++) {
    var s = suppressions[i];
    var chOk = !s.channel || s.channel === target.channel;
    if (!chOk) continue;
    if (s.companyId && s.companyId === target.companyId) return { suppressed: true, reason: s.reason || '停止（企業）' };
    if (s.contactId && s.contactId === target.contactId) return { suppressed: true, reason: s.reason || '停止（担当者）' };
    if (email && normalizeEmail(s.email) === email) return { suppressed: true, reason: s.reason || '停止（メール）' };
  }
  return { suppressed: false, reason: '' };
}

function idempotencyKey(draftId, contactId, channel, step) {
  return [draftId, contactId, channel, step || 1].join(':');
}

/** 返信本文に停止の意思が含まれるか（AIの分類に関係なく安全側で停止） */
function detectStopIntent(text) {
  var t = normalizeText(text).toLowerCase();
  for (var i = 0; i < STOP_WORDS.length; i++) {
    if (t.indexOf(STOP_WORDS[i].toLowerCase()) >= 0) return true;
  }
  return false;
}

var REQUIRED_FOOTER_ITEMS = ['合同会社Yoriai', '門真市', '配信停止'];

/**
 * 送信直前チェック。1つでもNGなら送らない。
 * ctx: {draft, company, contact, eligibility, suppressions, sentKeys, sentToday, dailyLimit, now, aiSafeMode}
 */
function preSendCheck(ctx) {
  var reasons = [];
  var d = ctx.draft || {};
  if (d.approved !== true || !normalizeText(d.approver)) reasons.push('未承認');
  if (d.humanReviewRequired === true && d.approved !== true) reasons.push('人の確認待ち');
  if (!ctx.company || ctx.company.customerStatus !== 'prospect') reasons.push('見込み客ではない（既存顧客・商談中など）');
  var el = evaluateEligibility(ctx.eligibility, ctx.now);
  if (!el.allowed) reasons.push('接触不可：' + el.reason);
  var sup = isSuppressed({ companyId: ctx.company && ctx.company.id, contactId: ctx.contact && ctx.contact.id,
                           email: ctx.contact && ctx.contact.email, channel: 'email' }, ctx.suppressions || []);
  if (sup.suppressed) reasons.push('停止：' + sup.reason);
  if (!normalizeEmail(ctx.contact && ctx.contact.email)) reasons.push('メールアドレス不正');
  var key = idempotencyKey(d.id, ctx.contact && ctx.contact.id, 'email', 1);
  if ((ctx.sentKeys || []).indexOf(key) >= 0) reasons.push('送信済み（二重送信防止）');
  if ((ctx.sentToday || 0) >= (ctx.dailyLimit || 0)) reasons.push('本日の送信上限');
  if (ctx.aiSafeMode) reasons.push('安全停止モード');
  var body = normalizeText(d.body);
  REQUIRED_FOOTER_ITEMS.forEach(function (item) {
    if (body.indexOf(item) < 0) reasons.push('必須表示なし：' + item);
  });
  return { ok: reasons.length === 0, reasons: reasons, key: key };
}

/** フォーム入力の検証 */
function validateInquiry(data) {
  var errors = [];
  ['company', 'name', 'phone', 'email'].forEach(function (k) {
    if (!normalizeText(data[k])) errors.push('missing:' + k);
  });
  if (normalizeText(data.email) && !normalizeEmail(data.email)) errors.push('invalid_email');
  if (normalizeText(data.website)) errors.push('honeypot');
  var product = normalizeText(data.product);
  if (product && PRODUCTS_FOR_FORM.indexOf(product) < 0) errors.push('invalid_product');
  return errors;
}

var PRODUCTS_FOR_FORM = ['', 'CAREER', 'WORKS_INDIVIDUAL', 'WORKS_COMPREHENSIVE', 'ACADEMY', 'DX', 'PRODUCTION'];

/** Claudeの分析結果の検証：事実には必ず出典URL */
function validateAnalysis(a) {
  var problems = [];
  if (!a || typeof a !== 'object') return ['結果なし'];
  (a.facts || []).forEach(function (f, i) {
    if (!/^https?:\/\//.test(normalizeText(f.source_url))) problems.push('事実' + (i + 1) + 'に出典URLがない');
  });
  if (typeof a.fit_score !== 'number' || a.fit_score < 0 || a.fit_score > 100) problems.push('適合度が範囲外');
  if (['low', 'medium', 'high'].indexOf(a.confidence) < 0) problems.push('信頼度が不正');
  return problems;
}

if (typeof module !== 'undefined') {
  module.exports = { normalizePhone: normalizePhone, normalizeEmail: normalizeEmail, domainFromUrl: domainFromUrl,
    domainFromEmail: domainFromEmail, companyNameKey: companyNameKey, findDuplicateCompany: findDuplicateCompany,
    evaluateEligibility: evaluateEligibility, isSuppressed: isSuppressed, idempotencyKey: idempotencyKey,
    detectStopIntent: detectStopIntent, preSendCheck: preSendCheck, validateInquiry: validateInquiry,
    validateAnalysis: validateAnalysis };
}
