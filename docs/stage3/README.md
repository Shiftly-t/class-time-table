# 第3段階：実Firebase結合テストの準備

基準：Draft PR #4、82ef57e。準備段階であり、Firebaseプロジェクト作成/課金/サービス設定/配備/実データ操作は行っていない。本番とmainは変更せず、両公開フラグはfalse。

読む順序：

1. [直接書込36操作群の一覧](WRITE_PATHS.md)（機械可読：[write-inventory.json](write-inventory.json)）
2. [分離テストproject・承認・ローカル準備](FIREBASE_TEST_PROJECT.md)
3. [私有Functions統合手順と追加実装](PRIVATE_FUNCTIONS_INTEGRATION.md)
4. [ルール/API/Web切替と復旧](CUTOVER_ROLLBACK.md)
5. [実結合43ケース](TEST_PLAN.md)（全件未検証：[real-test-plan.json](real-test-plan.json)）
6. [iPadの1操作ずつの案内](IPAD_STEPS.md)

## 実装済み

- 現行の全ルートWeb JavaScriptを棚卸しし、36操作群・122呼出箇所を分類。ソース一覧/行/ハッシュと分類を照合する`tools/check-write-inventory.cjs`を追加。
- Firebaseに接続せず、承認済みの別project Web設定からローカルテストサイトを用意する`tools/prepare-stage3-site.cjs`を追加。未設定/混在構成、本番API key/site key流用、フラグ有効化、Git内出力、既存出力上書きを拒否。
- 生成した3入口にTEST表示とSDK初期化前のorigin/config/flags照合を挿入。通常の本番Webソースは変更していない。
- 21ユニット＋9ローカルChromiumガード検査が成功。ブラウザの全通信はローカルでinterceptし、Firebase SDKもstub。実Firebase成功件数ではない。

## 設計のみ・未実装

講習勤務希望API、講習期間/非表示/締切、手動講習配置、講習中の開閉変更、予約授業memo、公開Webからの私有削除/新形式復元適用、全旧writerを止める制御面、最終ルール、実SDKの私有突合せrunnerは完成していない。対応する実結合11ケースは実装待ち。第2段階の31モデル成功は維持するが、今回は私有サーバー実装を変更していない。

## 未検証

実Firebase43ケースは全件NOT_RUN。実Firestore/ルールcompile・許可拒否、実Auth/App Check、複数Functionsインスタンス、実iPad Safari、料金・実規模性能・実復旧は未検証。Emulator取得の通信制約は変更していない。作成・Blaze変更の許可を推定して操作しない。
