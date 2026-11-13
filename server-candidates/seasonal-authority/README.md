# 講習・ライフサイクルAPIの公開契約と純粋検証部品

このフォルダーだけではFunctionsを配備できない。`policy.cjs`は公開Web/ルールのスキーマを基に独立実装した純粋検証、`build-rules.cjs`は利用者提供ルール全文からローカル候補を生成するコード。非公開予約Functions、配備ラッパー、秘密値は含まない。実配備なし、両Webフラグfalse。

## Web接続

`seasonal-authority-client.js`が`seasonalAuthorityApi`のprotocolVersion=3とoperation能力を毎操作で確認する。準備・読取・保存を同一ログイン世代に結び付け、古い画面/別利用者の操作を送らない。未対応能力/不正応答/権限拒否でFirestoreへのフォールバックをしない。変更はrequestId付き。不明応答は再送せず、読取専用requestStatus（protocolVersion=2）の受付記録を確認する。再読込後のrequestId回復は未実装。

|利用者|許可する候補操作|
|---|---|
|講師employee|本人の講習勤務希望の読取/提出、能力と自分の受付結果確認だけ|
|管理者admin|講習設定、代理勤務希望、手動講習配置、講習/予約の伝達事項、営業カレンダー|
|運営owner|上記＋制限付き生徒削除、新形式backup/restore、読取専用整合性検査、メンテナンス|

講師を既存の管理者用予約APIへ追加する方式は使わない。親QRに職員操作を許可しない。通常勤務曜日・臨時出勤・欠席の判定と、講習配下の勤務希望は独立させる。

主な書込：saveAvailability、saveCourse、patchCourse、deleteCourse、publishManualCourse、saveCalendar、saveCourseMemo、deleteStudent、createSnapshot、restoreSnapshot、setMaintenance。inspectCourse/Availability/Control、planStudentDelete、planSnapshotRestore、listSnapshots、verifyIntegrity、requestStatusは読取専用。能力が返らなければ操作を停止する。

course/entry/metaはサーバーが読んだ値のtokenを照合。削除は生徒token＋global revision、復元は完全スナップショットの検査＋global revisionで結び付ける。現行フォームの一時編集は維持する。予約所有IDの任意配置変更は許可せず、既存の予約管理操作へ分離。専用memoは担当・台帳数・実施状態を変えない。

## 私有実装候補との境界

実予約台帳・QR・負荷・共通排他・データ保護は私有adapterで検証する。公開normal候補の保守的なbookingFence拒否をテストstubで解除して配備してはならない。私有候補の実装と公開clientの契約を一緒にレビューする。提供時点の原本と現在配備中のソースが一致するかは未検証。

一回の手動講習公開は60変更まで。小規模削除は関連80件/実施済み履歴なし、snapshot150レコード/600KB、restore現行＋対象240以下、全書込400/概算5MBまでの保守的候補。通常の広域整合性検査はbackupとは別の1000レコード上限。大規模処理・全データの自動修復は未実装。全件クエリの上限で小さな対象でも停止し得る。実規模の読取量/遅延は未検証。

復元計画は一時的なメモリ内の書込投影で台帳/参照/人数/スキーマを検証し、投影を破棄する。SDKへの実書込やflushは行わない。適用も改めて検証し、旧形式・不完全・不正データは部分適用しない。厳格な復元検査に通らない既存状態（閉校日の確保や勤務不一致等を含む）は、勝手に緩めず停止する。

既存の通常授業に勤務不一致が残る場合、勤務変更・カレンダー変更だけで授業を削除/変更しない。新規配置/振替は最新条件で拒否する。整合性確認は台帳・参照・人数の検査であり、既存の「要振替」の解消を意味しない。

## 直接write拒否のルール候補

```bash
node server-candidates/seasonal-authority/build-rules.cjs /tmp/shiftly-seasonal-candidate.rules
```

ローカル生成だけ。配備しない。`systemConfig/coordination.enforceDirectWriteDeny`をAPIのenabledとは独立させ、API停止で旧writeが再許可されないようにした。旧業務allowを制限し、予約保護・入力条件・本人通知既読/削除・狭いowner制御を維持する。後から追加するdenyで既存allowを打ち消す方式ではない。クライアントにこの設定を変更する権限は与えない。

メンテナンスの新APIは旧backup生成に依存せず停止できる。再開にはallWritersMigratedとenforceDirectWriteDenyの信頼する設定、および整合性検査を要求する。これらの設定値だけで旧Admin SDKや遅延リクエストの停止が証明されたとは扱わない。旧Functionsの排出・最終ルールの実許可拒否・運用確認が別途必要。

ルールEmulator検査コードは`tests/rules/seasonal-workflows.test.cjs`。実行先はlocalhost:8095/demoだけに限定するが、Emulator未入手のため12ケースとも未実行。コンパイル成功や実Firebase許可拒否を静的検査から推定しない。
