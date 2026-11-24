# Yoriai 営業MVP（Google Apps Script）

HPの問い合わせフォームの受付と、営業管理（企業台帳・重複/停止ルール・Claudeによる文案作成）の最初の実装です。
Googleスプレッドシートに紐付けて使います。HP（`yoriai-hp:/`）とは別物で、Vercelの公開には影響しません。

| ファイル | 役割 |
|---|---|
| `Form.gs` | HPフォームの受付（ウェブアプリ `doPost`）：記録、企業・担当者・案件の登録（重複は既存企業に紐付け）、社内通知、固定文面の自動返信 |
| `Rules.gs` | ルールエンジン：重複判定、接触可否、停止リスト、送信前チェック、停止語の検知（純粋関数。Nodeでテスト可） |
| `Claude.gs` | 公式サイト本文から事実（出典付き）・仮説・適合度・文案を作り、「文案」シートに承認待ちで登録。**送信はしない** |
| `Setup.gs` / `Sheets.gs` / `Import.gs` / `Config.gs` | シート作成・共通処理・企業台帳の取込・設定 |

## 設定
1. スプレッドシートを作り、拡張機能 → Apps Script にこのフォルダの `.gs` と `appsscript.json` を貼り付ける
2. スクリプト プロパティ：`NOTIFY_TO`（社内通知先）、`ANTHROPIC_API_KEY`（AI分析を使う場合）、`AI_MONTHLY_LIMIT_JPY`、`USD_JPY`、`APPROVED_CASES`（文案に使ってよい実績。無ければ設定しない）
3. スプレッドシートのメニュー「Yoriai営業」→「初期設定」
4. デプロイ → ウェブアプリ（実行ユーザー：自分／アクセス：全員）→ 発行URLを `yoriai-hp:/index.html` の `GAS_URL` に設定

APIキー等の秘密情報はスクリプト プロパティにだけ保存し、このリポジトリには入れないこと（公開リポジトリ）。

## テスト
```
node --test apps-script/tests/rules.test.js
```
