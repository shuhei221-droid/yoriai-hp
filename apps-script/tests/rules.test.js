// 実行: node --test tests/rules.test.js  （Node 18+）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Rules.gs'), 'utf8'), ctx);
const R = ctx.module.exports;
const now = new Date('2026-11-24T00:00:00Z');

const okEligibility = { channel: 'email', basis: 'published_address', evidenceUrl: 'https://example.co.jp/company',
  refusalNoticeChecked: true, checkedAt: '2026-11-20', reviewer: '蛯原', expiresAt: '2027-05-20' };
const baseCtx = () => ({
  draft: { id: 'M1', approved: true, approver: '蛯原', humanReviewRequired: false,
    body: '本文\n合同会社Yoriai 大阪府門真市\n不要な場合は「配信停止」とご返信ください。' },
  company: { id: 'C1', customerStatus: 'prospect' },
  contact: { id: 'P1', email: 'info@example.co.jp' },
  eligibility: okEligibility, suppressions: [], sentKeys: [], sentToday: 0, dailyLimit: 10, now, aiSafeMode: false
});

test('重複判定：ドメイン→電話→社名の順で一致', () => {
  const cos = [{ id: 'C1', domain: 'sankyou-ss.jp', phone: '0728875220', name: '株式会社山協製作所' }];
  assert.deepStrictEqual({ ...R.findDuplicateCompany({ domain: 'sankyou-ss.jp' }, cos) }, { id: 'C1', matchedBy: 'domain' });
  assert.strictEqual(R.findDuplicateCompany({ phone: '072-887-5220' }, cos).matchedBy, 'phone');
  assert.strictEqual(R.findDuplicateCompany({ name: '山協製作所（本社）' }, cos).matchedBy, 'name');
  assert.strictEqual(R.findDuplicateCompany({ name: '別会社', phone: '0612345678' }, cos), null);
});

test('フリーメールのドメインは企業ドメインにしない', () => {
  assert.strictEqual(R.domainFromEmail('harada.jyuu@gmail.com'), '');
  assert.strictEqual(R.domainFromEmail('info@nishimura-works.co.jp'), 'nishimura-works.co.jp');
});

test('接触可否：根拠不足は必ず不可', () => {
  assert.strictEqual(R.evaluateEligibility(okEligibility, now).allowed, true);
  assert.strictEqual(R.evaluateEligibility(null, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, basis: 'none' }, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, refusalNoticeChecked: false }, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, evidenceUrl: '' }, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, reviewer: '' }, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, expiresAt: '2026-01-01' }, now).allowed, false);
  assert.strictEqual(R.evaluateEligibility({ ...okEligibility, channel: 'form' }, now).allowed, false);
});

test('送信前チェック：全条件OKなら送信可', () => {
  const r = R.preSendCheck(baseCtx());
  assert.strictEqual(r.ok, true, r.reasons.join(','));
});

test('送信前チェック：未承認・停止・既存顧客・二重送信・上限・安全停止・必須表示なしは送らない', () => {
  const cases = [
    c => { c.draft.approved = false; },
    c => { c.suppressions = [{ companyId: 'C1', reason: 'opt_out' }]; },
    c => { c.suppressions = [{ email: 'INFO@example.co.jp', reason: 'complaint' }]; },
    c => { c.company.customerStatus = 'customer'; },
    c => { c.sentKeys = [R.idempotencyKey('M1', 'P1', 'email', 1)]; },
    c => { c.sentToday = 10; },
    c => { c.aiSafeMode = true; },
    c => { c.draft.body = '本文のみ'; },
    c => { c.eligibility = null; },
    c => { c.contact.email = 'not-an-email'; }
  ];
  cases.forEach((mut, i) => {
    const c = baseCtx(); mut(c);
    assert.strictEqual(R.preSendCheck(c).ok, false, 'case ' + i);
  });
});

test('停止の意思を検知（AIの分類に関係なく停止）', () => {
  assert.strictEqual(R.detectStopIntent('今後は配信停止でお願いします'), true);
  assert.strictEqual(R.detectStopIntent('不要です。'), true);
  assert.strictEqual(R.detectStopIntent('資料をお送りください'), false);
});

test('フォーム検証：必須・メール形式・ハニーポット・商品区分', () => {
  const ok = { company: 'A社', name: '山田', phone: '0612345678', email: 'a@example.jp' };
  assert.deepStrictEqual([...R.validateInquiry(ok)], []);
  assert.ok(R.validateInquiry({ ...ok, email: 'x' }).includes('invalid_email'));
  assert.ok(R.validateInquiry({ ...ok, website: 'spam' }).includes('honeypot'));
  assert.ok(R.validateInquiry({ ...ok, company: '' }).includes('missing:company'));
  assert.ok(R.validateInquiry({ ...ok, product: 'XXX' }).includes('invalid_product'));
  assert.deepStrictEqual([...R.validateInquiry({ ...ok, product: 'CAREER' })], []);
});

test('AI分析の検証：出典URLのない事実は要確認', () => {
  const good = { facts: [{ text: '製造業', source_url: 'https://a.jp/' }], fit_score: 70, confidence: 'medium' };
  assert.deepStrictEqual([...R.validateAnalysis(good)], []);
  assert.ok(R.validateAnalysis({ ...good, facts: [{ text: 'x', source_url: '' }] }).length > 0);
  assert.ok(R.validateAnalysis({ ...good, fit_score: 150 }).length > 0);
});
