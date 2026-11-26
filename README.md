# Shiftly-T

個別指導塾向けの授業時間割・講習予約管理Webアプリケーションです。

## 主な機能

- 生徒情報、通常授業、日別の担当振替、講師勤務時間の管理
- 休校日、特別開校日、講習期間の管理
- QRコードを利用した講習予約と予約状況の管理
- 講師の実績ランキング、バッジ・表彰、通知
- 運営向けの監査履歴、バックアップ、メンテナンス管理

## 技術構成

HTML / CSS / JavaScript（ES modules）を使用したブラウザアプリケーションです。Firebase Authentication、Cloud Firestore、Cloud Functions、App Check、Firebase Hostingを利用します。

アクセス権限は運営（owner）、管理者（admin）、講師（employee）に分かれます。データアクセスと更新の認可は、画面の表示制御だけでなく、バックエンドおよびSecurity Rulesで行います。

## ソース構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `app.js` / `style.css` | 管理画面の起点、状態管理、共通スタイル |
| `normal-editor.*` | 通常授業の配置・振替 |
| `teacher-work.*` | 講師勤務時間・日別例外 |
| `course-booking-admin.*` / `course-booking.*` | 講習予約管理・公開予約画面 |
| `ranking-live.*` / `ranking-correction-ui.js` | 実績・表彰・バッジ |
| `authority-commands.js` / `*-authority-client.js` / `booking-transport.js` | バックエンドAPI接続 |
| `shared-date-picker.js` / `workspace-ux.js` / `menu-scroll-hint.js` | 共通UI部品 |
| `help-guide.js` / `help-practice.js` | 利用ガイド・模擬操作 |
| `tests/` | 検証用テスト |
| `.github/workflows/` | Hostingの検証・デプロイ |

Cloud Functionsの実装および現行のFirestore Security Rulesの全文は、このmainブランチには含まれていません。本リポジトリのみではシステム全体を再構築できません。

## 開発・検証

Node.js 22を推奨します。以下の検証はネットワーク接続や本番データを必要としません。

```sh
node tests/check-static.cjs
node tests/workspace-ux.cjs
```

本番設定で実データの登録・削除を試さないでください。動作検証はモックまたは隔離されたQA環境で行います。

mainへの対象ファイルの変更はGitHub Actionsで検証された後、Firebase Hostingに反映されます。HostingのデプロイだけではFunctions、Firestore、Authentication、Security Rulesは更新されません。

詳しくは [開発ガイド](docs/development.md) を参照してください。
