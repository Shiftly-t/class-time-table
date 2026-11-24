# Shiftly-T QA統合版

`production-hosting/` がこのブランチのQAビルド元です。先行High 2件とシステム管理・予約管理・バックアップの診断改善を含みます。QA用の公開Web設定とApp Checkサイトキーはステージング時に生成します。

## ローカル検証

```bash
node --test tests/operations-contract.test.mjs tests/qa-firebase-target.test.mjs tests/qa-hosting.test.mjs
node tests/course-booking-admin.cjs
node tests/owner-backup.cjs
```

Node.js 20以上が必要です。ブラウザテストは Playwright と Chromium を使います。Chromium を指定する場合は実行ファイルのパスを `SHIFTLY_CHROMIUM` に設定します。ブラウザテストはFirebase SDKをスタブに差し替え、外部通信を遮断します。

## Cloud ShellでQAの配備前確認と画面プレビュー

この開発ブランチを取得したディレクトリで実行します。Firebase CLIとgcloudの既存資格情報は、QAプロジェクト `shiftly-t-test` を参照できるものを使用します。QAのWebアプリIDと、同じWebアプリ用の公開reCAPTCHA Enterpriseサイトキーを入力します。

```bash
(
  set +x
  set -euo pipefail
  umask 077
  shiftly_inputs=$(mktemp -d "$HOME/shiftly-qa-inputs.XXXXXX")
  firebase apps:list WEB --project shiftly-t-test --non-interactive
  read -r -p 'QA Web App ID: ' shiftly_app
  firebase apps:sdkconfig WEB "$shiftly_app" --project shiftly-t-test --non-interactive --json > "$shiftly_inputs/web.json"
  read -r -s -p 'QA reCAPTCHA Enterprise site key: ' shiftly_key
  printf '\n'
  printf '%s\n' "$shiftly_key" > "$shiftly_inputs/site-key"
  unset shiftly_key
  node tools/qa-hosting.mjs preview --config "$shiftly_inputs/web.json" \
    --site-key-file "$shiftly_inputs/site-key" --out "$shiftly_inputs/preview"
)
```

`preview` はQA Webアプリ、Hostingサイト、`shiftly-qa-v1`、`asia-northeast1` の対象Functionsを照合してから、1日間のQA Hostingプレビューを配備します。画面表示用のプレビューはJavaScript実行とAPI接続を停止し、Authの承認済みドメインは更新しません。読み取り確認だけ行う場合は、`node tools/qa-hosting.mjs preflight --config WEB_JSON` を使います。

## Firebase結合テストへ進む条件

QA Functionsの実配信リビジョンが、Admin SDKから `shiftly-t-test` の `shiftly-qa-v1` を選ぶことをソース・設定と照合します。適用中Rules、QA専用App Check、架空データを確認した後、`node tools/qa-hosting.mjs stage --mode integration --config WEB_JSON --site-key-file SITE_KEY --out NEW_DIRECTORY` で通常のWeb処理を含むQA成果物を生成します。生成された `firebase.json` は QA Hosting 専用です。QA実環境での判定順は [QA結合検証](QA_BACKEND.md) に記載しています。
