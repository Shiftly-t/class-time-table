# 開発ガイド

## 管理画面の構成

`app.js` は画面の起点です。Firebaseと機能モジュールを初期化し、セッション、画面遷移、業務データの取得と各画面の描画をつなぎます。

| モジュール | 責務 |
| --- | --- |
| `calendar-date.js` / `school-calendar.js` | 日付キー、週・月の移動、祝日・休校・特別開校の優先順位 |
| `timetable.js` | 保存済み授業と毎週授業の表示解決、コマ分割、次回来塾予定 |
| `workspace-state.js` / `workspace-subscriptions.js` | セッションごとの初期値、購読解除、古い購読の応答の破棄 |
| `workspace-dashboard.js` / `workspace-ux.js` | 管理ダッシュボード、検索、集計、表示設定 |
| `workspace-dialogs.js` / `workspace-messages.js` / `workspace-scroll.js` | 下書きとダイアログ、操作結果と確認ボタン、画面別スクロール位置 |
| `normal-editor.js` / `teacher-work.js` | 通常授業編集、講師勤務時間・日別例外 |
| `normal-authority-client.js` / `seasonal-authority-client.js` / `booking-transport.js` | Callableの入力・応答、保存結果が不明なときの確認 |
| `firebase-target.js` / `config.js` / `booking-config.js` | 接続先の判定、配布するWeb設定 |

表示用の通常授業は、同じ授業IDを開く複数のコマに分かれる場合があります。講習期間中に通常授業を非表示にする判定と、休校・開校・模試の優先順位は時間割モジュールを参照してください。

管理画面の `isAdmin()` は管理機能を使える `owner` と `admin` を指します。担当講師に割り当てられるロールは `isAssignableTeacher()` で別に判定します。

セッション変更時は業務購読と勤務希望購読を解除します。購読の再開では作業中の画面を引き継ぎます。Callableの結果確認はAPIごとに契約が異なり、通常授業の同一リクエスト再送と予約系の状態照会を個別に扱います。

## ローカル検証

Node.js 22とGitを用意します。ブラウザ依存の取得にはネットワークが必要です。テスト中はローカルサーバーで実際のHTML・CSS・JavaScriptを配信し、Firebase SDKのモジュール要求をローカルのフィクスチャで満たし、他の外部要求を遮断します。

```sh
npm ci
npm test
npx playwright install --with-deps chromium webkit
npm run test:browser
```

- `npm test` はルートの JavaScript 構文、Hosting 配布対象と参照、時間割・休校日、ダイアログ、スクロール、購読、表示設定を検証します。
- ブラウザ試験は `SHIFTLY_TEST_BROWSER=chromium` または `SHIFTLY_TEST_BROWSER=webkit` で絞り込めます。既設の Chromium を使う場合は `SHIFTLY_CHROMIUM_PATH` に実行ファイルを指定します。
- 画面幅とタッチ操作はエミュレーションです。実機固有の Safari、仮想キーボード、本番限定のランキング起動、実際のFirebase認可とバックエンド更新は別途検証対象です。

Pull Requestでは構文・単体テストと両ブラウザの回帰試験が起動します。旧 `tests/pr1-review.cjs` は当時の記録です。importを取り除く旧モックが現行モジュールの初期化と衝突するため、現在の回帰試験は `tests/browser/` を使用します。

## 配布と公開情報

Hostingは、Gitで追跡しているルート直下のHTML・CSS・JavaScriptを配布します。新しいブラウザモジュールはルート直下に配置し、HTMLの参照、ES modulesのimport、iframeのURLを検証してください。文書、テスト、開発用パッケージは配布範囲外です。

Firebase Web設定とreCAPTCHAサイトキーはブラウザに配布されます。データアクセスの認可はFirebase Authentication、Firestore Security Rules、App Check、Callableの検証に依存します。現行のRulesとFunctions実装はこのリポジトリに含まれていません。

対象ファイルの変更が `main` に入ると、GitHub Actionsで本番Hostingの検証と更新が開始されます。反映前にワークフローの対象ファイルと、公開予約・管理画面の両入口を確認してください。Firebaseの業務データやバックエンドの変更は別の運用手順で扱います。

## 過去の開発記録

- [Firestore変更ガイド（2026-11-12）](../FIRESTORE_CHANGE_GUIDE.md)
- [PRレビュー（2026-11-12）](../REVIEW_PR1_20261112.md)
- [改善メモ（2026-11-12）](../UPGRADE_NOTES_20261112.md)
- [リリース候補記録（2026-11-24）](../RELEASE_NOTES_20261124.md)
