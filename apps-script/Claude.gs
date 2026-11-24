/**
 * Claudeによる企業分析と営業文案（承認待ちの「文案」行を作るだけ。送信はしない）
 * Apps Script には Anthropic 公式SDKがないため、HTTPで Messages API を呼ぶ。
 */

var ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'hypotheses', 'service_line', 'fit_score', 'confidence', 'subject', 'message_draft', 'human_review_required'],
  properties: {
    facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'source_url'],
      properties: { text: { type: 'string' }, source_url: { type: 'string' } } } },
    hypotheses: { type: 'array', items: { type: 'string' } },
    service_line: { type: 'string', enum: ['CAREER', 'WORKS_INDIVIDUAL', 'WORKS_COMPREHENSIVE', 'ACADEMY', 'DX', 'PRODUCTION'] },
    fit_score: { type: 'integer' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    subject: { type: 'string' },
    message_draft: { type: 'string' },
    human_review_required: { type: 'boolean' }
  }
};

var SYSTEM_PROMPT = [
  'あなたは大阪府門真市の合同会社Yoriaiの営業担当の下書き係です。',
  '与えられた企業の公式サイト本文だけを根拠に、企業の事実・仮説・Yoriaiの商品との適合度を整理し、初回の営業メール文案を書きます。',
  '守ること：',
  '- facts には本文で確認できたことだけを書き、source_url には与えられたURLを入れる。本文にないことは facts に入れない。',
  '- 推測は hypotheses に分け、文案では断定しない（「〜ではないかと考え」等）。',
  '- 実績・事例・数値・顧客名は、下の「使ってよい実績」にあるものだけ使う。無ければ書かない。',
  '- 価格は「使ってよい価格」にあるものだけ。案の価格には「（案）」と付ける。',
  '- 誇張・煽り・緊急性の演出をしない。300〜450字程度、丁寧で簡潔に。',
  '- 本文の最後に署名を入れない（署名と配信停止の案内はシステムが付ける）。',
  '- 判断に迷う点があれば human_review_required を true にする。'
].join('\n');

function analyzeSelectedCompanies() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.COMPANIES) throw new Error('「企業」シートで行を選択してから実行してください');
  var range = sh.getActiveRange();
  var header = HEADERS[SHEETS.COMPANIES];
  var rows = sh.getRange(range.getRow(), 1, range.getNumRows(), header.length).getValues();
  var done = 0, skipped = [];
  rows.forEach(function (row) {
    var co = {}; header.forEach(function (h, i) { co[h] = row[i]; });
    try {
      var r = analyzeCompany_(co);
      if (r.ok) done++; else skipped.push(co['企業名'] + '：' + r.reason);
    } catch (err) {
      skipped.push(co['企業名'] + '：' + err.message);
    }
  });
  SpreadsheetApp.getUi().alert('文案作成 ' + done + ' 件' + (skipped.length ? '\n見送り：\n' + skipped.join('\n') : ''));
}

function analyzeCompany_(co) {
  if (co['顧客区分'] !== 'prospect') return { ok: false, reason: '見込み客ではない' };
  var sup = isSuppressed({ companyId: co['企業ID'], channel: 'email' }, suppressionsForRules_());
  if (sup.suppressed) return { ok: false, reason: '停止リスト' };
  if (aiSpentThisMonthJpy_() >= Number(prop_('AI_MONTHLY_LIMIT_JPY', 3000))) return { ok: false, reason: 'AIの月額上限に到達' };
  var url = normalizeText(co['出典URL']) || (co['公式ドメイン'] ? 'https://' + co['公式ドメイン'] + '/' : '');
  if (!/^https?:\/\//.test(url)) return { ok: false, reason: '公式サイトURLなし' };
  var page = fetchPageText_(url);
  if (!page.ok) return { ok: false, reason: page.reason };

  var userText = [
    '企業名：' + co['企業名'], '業種（台帳）：' + co['業種'], '所在地：' + co['所在地'],
    '公式サイトURL：' + url, '', '公式サイト本文（抜粋）：', page.text, '',
    'Yoriaiの商品：WORKS_INDIVIDUAL＝個別事務代行（月1.5万〜3万円、6プラン、契約縛りなし）／WORKS_COMPREHENSIVE＝包括的業務支援（案）／CAREER＝採用支援（新規追加予定・案）／ACADEMY＝企業見学・インターン受入設計（案）／DX＝CRM・業務フロー構築（案）',
    '使ってよい実績：' + prop_('APPROVED_CASES', 'なし'),
    '使ってよい価格：個別事務代行 月1.5万〜3万円（公開中）'
  ].join('\n');

  var res = callClaude_(SYSTEM_PROMPT, userText, ANALYSIS_SCHEMA, 'medium');
  logAiRun_('企業分析', co['企業ID'], res);
  if (!res.ok) return { ok: false, reason: 'AI：' + res.reason };
  var a = res.json;
  var problems = validateAnalysis(a);
  var now = new Date();
  appendRow_(SHEETS.DRAFTS, {
    '文案ID': newId_('M'), '案件ID': '', '企業ID': co['企業ID'], '商品': a.service_line,
    '事実（出典付き）': a.facts.map(function (f) { return '・' + f.text + '（' + f.source_url + '）'; }).join('\n'),
    '仮説': a.hypotheses.map(function (h) { return '・' + h; }).join('\n'),
    '適合度': a.fit_score, '信頼度': a.confidence, '件名': a.subject,
    '本文': a.message_draft + '\n\n' + signature_(),
    '人の確認が必要': a.human_review_required || problems.length > 0 || a.confidence === 'low',
    '承認': false, '状態': problems.length ? '要確認：' + problems.join('／') : '承認待ち', '作成日時': now
  });
  audit_('AI文案作成', co['企業ID'], problems.length ? '要確認' : '承認待ち');
  return { ok: true };
}

function signature_() {
  return ['――', '合同会社Yoriai', '大阪府門真市　TEL 080-5360-8397　info@yoriai-info.jp',
    '今後このようなご案内が不要な場合は、本メールに「配信停止」とご返信ください。以後お送りしません。'].join('\n');
}

/** 公式サイトのトップページ本文を取得（robots.txt で全体が拒否されていれば取得しない） */
function fetchPageText_(url) {
  var origin = url.match(/^https?:\/\/[^\/]+/)[0];
  try {
    var robots = UrlFetchApp.fetch(origin + '/robots.txt', { muteHttpExceptions: true, followRedirects: true });
    if (robots.getResponseCode() === 200 && /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/mi.test(robots.getContentText())) {
      return { ok: false, reason: 'robots.txtで取得が拒否されている' };
    }
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return { ok: false, reason: 'サイト取得エラー ' + res.getResponseCode() };
    var text = res.getContentText()
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return { ok: true, text: text.slice(0, 12000) };
  } catch (err) {
    return { ok: false, reason: 'サイト取得失敗' };
  }
}

/** Claude Messages API（構造化出力）。失敗・拒否・切り捨て時は ok:false で返し、送信側に進ませない */
function callClaude_(system, userText, schema, effort) {
  var key = prop_('ANTHROPIC_API_KEY', '');
  if (!key) return { ok: false, reason: 'APIキー未設定' };
  var body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: system,
    messages: [{ role: 'user', content: userText }],
    output_config: { effort: effort || 'medium', format: { type: 'json_schema', schema: schema } },
    fallbacks: 'default'
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(body)
  });
  var code = res.getResponseCode();
  var data = {};
  try { data = JSON.parse(res.getContentText()); } catch (_) {}
  var usage = data.usage || {};
  if (code !== 200) return { ok: false, reason: 'HTTP ' + code + ' ' + ((data.error && data.error.type) || ''), usage: usage };
  if (data.stop_reason === 'refusal') return { ok: false, reason: '拒否', usage: usage };
  if (data.stop_reason === 'max_tokens') return { ok: false, reason: '出力が途中で切れた', usage: usage };
  var textBlock = (data.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) return { ok: false, reason: '本文なし', usage: usage };
  try {
    return { ok: true, json: JSON.parse(textBlock.text), usage: usage, model: data.model };
  } catch (err) {
    return { ok: false, reason: 'JSON解析失敗', usage: usage };
  }
}

function logAiRun_(task, target, res) {
  var u = res.usage || {};
  var rate = Number(prop_('USD_JPY', 150));
  var jpy = ((u.input_tokens || 0) * CLAUDE_PRICE_USD_PER_MTOK.input + (u.output_tokens || 0) * CLAUDE_PRICE_USD_PER_MTOK.output) / 1e6 * rate;
  appendRow_(SHEETS.AI_RUNS, { '日時': new Date(), '処理': task, '対象': target, 'モデル': res.model || CLAUDE_MODEL,
    '入力トークン': u.input_tokens || 0, '出力トークン': u.output_tokens || 0,
    '概算費用（円）': Math.round(jpy * 100) / 100, '結果': res.ok ? 'OK' : res.reason });
}

function aiSpentThisMonthJpy_() {
  var now = new Date();
  return readRows_(SHEETS.AI_RUNS).reduce(function (sum, r) {
    var d = new Date(r['日時']);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() ? sum + Number(r['概算費用（円）'] || 0) : sum;
  }, 0);
}

function suppressionsForRules_() {
  return readRows_(SHEETS.SUPPRESSIONS).map(function (r) {
    return { companyId: r['企業ID'], contactId: r['担当者ID'], email: r['メール'], channel: r['チャネル'], reason: r['理由'] };
  });
}
