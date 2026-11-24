/**
 * 設定。秘密情報（APIキー等）はここに書かず、
 * [プロジェクトの設定] > [スクリプト プロパティ] に保存する。
 *   ANTHROPIC_API_KEY   … Claude APIキー
 *   NOTIFY_TO           … 社内通知先（例 info@yoriai-info.jp）
 *   AI_MONTHLY_LIMIT_JPY… AIの月額上限（円、例 3000）
 *   USD_JPY             … 費用換算レート（例 150）
 */
var SHEETS = {
  COMPANIES: '企業',
  CONTACTS: '担当者',
  DEALS: '案件',
  ELIGIBILITY: '接触可否',
  SUPPRESSIONS: '停止',
  DRAFTS: '文案',
  INQUIRIES: '問い合わせ',
  AI_RUNS: 'AI実行記録',
  AUDIT: '監査ログ'
};

var HEADERS = {
  '企業': ['企業ID','企業名','法人番号','公式ドメイン','電話（正規化）','業種','所在地','規模','出典URL','出典取得日','顧客区分','HubSpot会社ID','作成日時','更新日時'],
  '担当者': ['担当者ID','企業ID','氏名','役職','メール','代表アドレス','公表場所URL','利用目的','保存期限','HubSpotコンタクトID','作成日時'],
  '案件': ['案件ID','企業ID','担当者ID','商品','経路','ステージ','金額','担当','HubSpot取引ID','予約日時','予約確定（相手）','作成日時','更新日時'],
  '接触可否': ['担当者ID','チャネル','根拠','根拠URL','広告拒否表示なしを確認','確認日','確認者','期限','判定','判定理由'],
  '停止': ['企業ID','担当者ID','メール','チャネル','理由','起点','登録日時','登録者'],
  '文案': ['文案ID','案件ID','企業ID','商品','事実（出典付き）','仮説','適合度','信頼度','件名','本文','人の確認が必要','承認','承認者','承認日時','状態','作成日時'],
  '問い合わせ': ['受信日時','会社名','氏名','電話','メール','業種','商品','希望プラン','内容','ページ','企業ID','案件ID','処理結果'],
  'AI実行記録': ['日時','処理','対象','モデル','入力トークン','出力トークン','概算費用（円）','結果'],
  '監査ログ': ['日時','実行者','操作','対象','結果']
};

// 商品区分（企業情報は共通、商品は案件ごとに別管理）
var PRODUCTS = ['CAREER', 'WORKS_INDIVIDUAL', 'WORKS_COMPREHENSIVE', 'ACADEMY', 'DX', 'PRODUCTION'];

// Claude API
var CLAUDE_MODEL = 'claude-opus-5-5';
var CLAUDE_PRICE_USD_PER_MTOK = { input: 4, output: 20 }; // 2026-11時点

function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}
