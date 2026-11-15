# 第3段階：実Firebase結合テストの準備結果（2026-11-13）

**有効化・正式導入の判定は保留。** テストprojectは作成しておらず、プラン変更・サービス設定・配備・Firebaseアクセス・本番/実データ/mainの変更は行っていない。teacherWorkFeatureEnabledとnormalAuthorityApiEnabledはfalseを維持。公開PRにはWeb準備ツール、テスト、手順書だけを追加し、私有Functionsソース・差分・秘密情報は追加しない。

## 棚卸し結果

全ルートWeb JavaScriptを調査し、Firestore直接writeを36操作群・122呼出箇所に整理した。122にはtransaction/batch生成、commit、監査への委譲も含む。API接続済み4群、一部接続9群、API未移行6群、業務APIと一体化すべき監査/通知4群、停止/置換/自動保存停止5群、独立して維持候補7群、メンテナンス制御1群。API接続済みもフラグfalseなので旧経路は残る。

重点となる残経路は講習勤務希望、講習期間/非表示/締切、講習配置、講習中カレンダー、生徒削除、旧履歴/全体復元、ログイン/年度境界の自動進級。講師の勤務希望をadmin専用のnormal wrapperへ流すと権限不一致で壊れるため専用APIが必要。

特に、メンテナンス開始は旧backupArchives作成を先に実行する。旧backupの直接writeだけ先に拒否すると、停止設定を保存する前に失敗する。この連鎖を分離せずルールを先行適用しない。旧FunctionsのAdmin SDKはFirestoreルールの影響を受けないので、別途全writer停止を実証する必要がある。

詳細：[全経路・対象コレクション・移行状況](docs/stage3/WRITE_PATHS.md)。動的な復元対象やリポジトリ外のConsole/私有CLI/ジョブ/旧端末は、私有側の追加一覧と合わせる。公開コードだけでリポジトリ外writerの不存在は証明できない。

## 今回実装した安全な準備コード

- ソース一覧とハッシュを固定した書込棚卸しの照合。変更があれば再レビューを要求。
- Git外の新規ディレクトリだけに出力するテストWeb準備ツール。未設定のテンプレート、本番設定の流用、project/number/appId/authDomain/bucket/region/origin混在、フラグtrue、既存ディレクトリの上書きを拒否。
- 生成物の3入口でTEST表示と、SDK初期化前の実行時構成チェック。本番のWeb/config/ルール/サーバーソース自体は変更していない。

ツールはプロジェクト作成・Firebase接続・デプロイ設定生成・課金変更を行わない。別projectが承認・作成された後に値を入れるための準備物で、今あるテンプレートは実行しても停止する。

## 手順・計画

|必要な準備|成果物|状態|
|---|---|---|
|私有予約APIへの安全な統合|[統合手順と追加API一覧](docs/stage3/PRIVATE_FUNCTIONS_INTEGRATION.md)|手順作成済み。統合作業/実配備は未実行|
|分離Firebase/Auth/Functions/App Check|[テストproject構成](docs/stage3/FIREBASE_TEST_PROJECT.md)|提案のみ。作成・課金・配備を別承認に分離|
|ルール/API/Webの順序|[切替・復旧](docs/stage3/CUTOVER_ROLLBACK.md)|全writer停止中に一組で切替。部分normalルールを完成版と扱わない|
|同時予約/振替/勤務/QR/削除/復元|[実結合43ケース](docs/stage3/TEST_PLAN.md)|全件未検証。うち11件は実装待ち|
|不具合時の復旧|[復旧手順](docs/stage3/CUTOVER_ROLLBACK.md#不具合時の復旧)|commit前/後で分岐。旧API/epoch/鍵の無条件巻戻しを禁止|
|iPadの次の作業|[1操作ずつの案内](docs/stage3/IPAD_STEPS.md)|最初はFirebase Consoleのプロジェクト一覧表示だけ|

## ローカル検証

第3段階追加30件（ユニット21＋生成3入口×3条件のChromium9）が成功。外部通信を使わず、設定混在時にSDK初期化がゼロであることを確認した。正しい架空構成のケースも実SDKをstubに置換しており、実Firebaseの動作検証ではない。

既存の通常APIモデル/クライアント89件、予約transport12件、Chromium画面操作98件、通常エディター回帰、構成ガード、勤務設定の回帰を再実行して成功。現行ルール静的照合20項目も成功。証跡はaudit-evidence/20261113-stage3-preparation/。第2段階の私有モデル31件は前段階の結果であり、今回の実Firebase検証として再計上しない。

**未検証**：実Firestore/ルール評価、Auth/App Check、実Functions並列、実iPad/Safari、実データ規模・無料枠・費用、切替/復旧の実リハーサル。実Firebase計画JSONは全件NOT_RUN。未実装機能を停止したまま、準備ツールで無理にフラグを有効化しない。

## 次のiPad作業

Safariで https://console.firebase.google.com/ を開き、プロジェクト一覧を表示する。最初の案内はここまで。次に候補名/IDを確認し、利用者の確認後にだけ作成へ進む。作成・Blaze変更・配備・移行モードを一度に承認したものとは扱わない。
