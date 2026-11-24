# Shiftly-T QA 結合検証

QA の接続先は Firebase `shiftly-t-test`、Firestore `shiftly-qa-v1`、Functions `asia-northeast1`。QA のテスト用アカウント、App Check、QR、架空データを使う。Web の組み立てとプレビューは [QA統合手順](QA_INTEGRATION.md) を参照する。

## 実行版と接続先の確認

ローカルの契約・Chromiumテストはモックで実行する。QA の Firebase 認証、App Check、Rules、Functions と Firestore の統合結果は別に記録する。

1. `node tools/qa-hosting.mjs preflight --config "$WEB_JSON"` で、Firebase CLI が認識する QA の Web App 設定、Hosting サイト、名前付き Firestore、リージョン、対象関数を照合する。配布する Web に `shiftly-qa-v1` が指定されていることも確認する。Hosting の静的プレビューは外部サービス接続が遮断されているため、接続試験は下記の確認後に QA 結合用ビルドで実施する。
2. ブラウザが参照する `bookingAdminApi`、`bookingPublicApi`、`normalAuthorityApi`、`seasonalAuthorityApi` の、QA のリビジョンとトラフィック配分を記録する。Cloud Run のリビジョン、ビルド、配備ソースを対応付け、各関数が使用する Admin SDK の初期化と DB 選択を確認する。Admin SDK の `getFirestore(app)` は既定 DB を使用する。プロジェクト `shiftly-t-test` と DB `shiftly-qa-v1` を明示した実行経路を確認するまで、結合試験の更新操作は保留する。 [Admin SDK の DB 選択](https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore#getfirestore)
3. QA の既存ログで、対応する読み取り処理に Firestore のプロジェクト・DB が記録されていれば、該当リビジョンと合わせて照合する。一般の Functions メタデータは Admin SDK の接続先を示さないため、ログがなければソースと設定を照合する。共有用の結果は時刻、リビジョン、対象プロジェクト・DB、操作名、エラーコードに絞る。
4. QA 用の発行済み Rules と対象 DB を取得する。SDK の認証を利用するクライアントと、Rules の対象外であるサーバー側 Admin SDK を別々に確認する。配備構成にジョブ・トリガー・通知連携がある場合は、それらの接続先も同じ QA 環境に限定されていることを確認する。

Named Firestore の公開 Rules を確認する場合は、Cloud Shell で下記を実行する。Ruleset ID と更新時刻のみが出力される。

```bash
(
  set +x
  set -euo pipefail
  shiftly_qa_token=$(gcloud auth print-access-token)
  printf 'Authorization: Bearer %s\n' "$shiftly_qa_token" |
    curl --disable --proto '=https' --fail --silent --show-error --header @- \
      'https://firebaserules.googleapis.com/v1/projects/shiftly-t-test/releases/cloud.firestore/shiftly-qa-v1' |
    jq '{name, rulesetName, updateTime}'
)
```

## QA 結合試験

すべて **NOT TESTED（QA 実環境）**。QA 環境のロールと架空データが確認できた後、次の順に実施する。各試験で、コミット、Hosting リリース、Ruleset、応答リビジョン、結果を記録する。

| 順 | 試験 | 合格条件 |
|---|---|---|
| 1 | 接続とログイン | 管理画面・予約管理・QR の各入口がQAの Web App と Functions を使用。Firestore に直接接続する経路と Functions の両方が `shiftly-qa-v1` を参照する。権限別の表示と拒否が想定どおり。 |
| 2 | 講習予約管理 | 架空講習・生徒を切り替え、取得失敗時も表示と操作対象が一致する。ログアウト・再ログイン後の古い確認操作は送信されない。APIの前提条件エラーが対応する段階に表示される。 |
| 3 | システム管理 | 対応機能・停止状態・確定の各段階が判定できる。開始、告知更新、終了を個別に確認。状態が更新された場合や更新条件が欠けた場合は確定を中止する。 |
| 4 | バックアップ | 新形式の作成・一覧・エクスポートを確認。一覧だけが失敗した場合は作成完了を表示し、再取得で作成を重ねない。作成結果が不明なときは再送を止める。 |
| 5 | 予約と通常授業 | 同じ QA 枠での通常の並行操作、受付結果の照会、休校・欠席・担当変更を試し、枠使用数、講師負荷、公開済み時間割の件数と参照が一致する。 |
| 6 | 移行・復旧 | QA の架空データだけで移行の計画と再試行を検証する。旧書き込み経路が停止したことを確認する。新形式復旧の手順と照合結果を記録する。 |

## バックエンド修正に必要な資料

公開候補の通常授業アダプターは `db` を外部から受け取り、講習候補には非公開の予約 Functions と配備ラッパーが含まれていない。次の範囲の資料があれば、QA 接続の確認と追加3件の原因調査を進められる。 [通常授業アダプター](https://github.com/Shiftly-t/class-time-table/blob/8eb4000b7fbb7d309b3cea5e0dbe01a1b366a1bf/server-candidates/normal-authority/callable.cjs) · [講習APIの公開候補](https://github.com/Shiftly-t/class-time-table/blob/8eb4000b7fbb7d309b3cea5e0dbe01a1b366a1bf/server-candidates/seasonal-authority/README.md)

- QA と障害時の本番リビジョンに対応したソースの識別情報。Cloud Run のイメージダイジェストと Cloud Build、またはデプロイ記録とソース ZIP のハッシュを使用する。
- Admin SDK の初期化・Firestore DB の選択、`coordination.cjs` の設定読込とガード、予約の読取経路と講習 API の `capabilities`、`listSnapshots`、`inspectControl`、`setMaintenance` がガードを通る箇所。必要なときだけ依存モジュールとロックファイルを追加する。
- QA の名前付き DB に配備済みの Rules とその Ruleset ID。ソースやログには、認証情報、環境変数の値、QR、氏名や実データを含めない。
