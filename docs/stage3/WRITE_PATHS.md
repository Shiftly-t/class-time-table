# Firestore直接書き込み経路の棚卸し

基準コミット：`82ef57e2e5750e0e172dbab5dce675eac3c8461a`。Webルートの全JavaScriptを確認し、**36操作群・122呼出箇所**（writer生成、set/update/delete、commit、監査への委譲を含む）を分類した。122件の独立した業務操作という意味ではない。

機能フラグは両方falseなので、API接続済みと記載した操作も現在は旧直接経路が使われる。APIへ完全移行済みという意味ではない。クライアントでの読取・仮想通常授業の生成表示・Map/Setの変更はFirestore書込みから除外。予約専用WebはFirestoreへの直接writeを持たず、callableを使用する。Authenticationのログイン/ログアウトは別途実Auth検証対象。

|操作群|コード範囲（基準コミット）|対象|移行状態|必要な対応|
|---|---|---|---|---|
|監査履歴の共通ヘルパー|[app.js:398](../../app.js#L398)〜405|`auditLogs`|業務APIと一体化が必要|各業務操作のトランザクションに監査を含める|
|旧形式バックアップ作成|[app.js:449](../../app.js#L449)〜469|`backupArchives/*/parts`、`backupArchives`|置換または停止が必要|新形式の一貫したサーバースナップショットへ置換。現形式は復元可能な完全コピーではない|
|変更履歴から単一文書復元|[app.js:529](../../app.js#L529)〜560|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|APIモードでは停止|参照・台帳を含む復元計画へ。任意パスset/deleteは移行しない|
|全体復元|[app.js:560](../../app.js#L560)〜615|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|APIモードでは停止|予約を含む新形式の原子的復元へ。既存の分割batchは再開手順に使わない|
|メンテナンス変更・イベント記録|[app.js:666](../../app.js#L666)〜699|`systemConfig/maintenance`、`maintenanceEvents`|制御面として別途審査|owner限定制御面。開始前の旧バックアップ呼出しは切替前に置換/分離が必要|
|ログイン/年度境界の学年自動保存|[app.js:806](../../app.js#L806)〜839|`schoolStudents`、`auditLogs`|APIモードで自動保存停止|通常APIモードでは停止。表示計算は維持。保存するなら予約表示情報も同じトランザクションへ|
|特別開校日解除|[app.js:1135](../../app.js#L1135)〜1156|`schoolOpenDays`、`auditLogs`|一部接続・講習等が未移行|通常期間はAPI接続済み。講習中の開閉変更は停止中|
|特別開校日登録|[app.js:1157](../../app.js#L1157)〜1177|`schoolOpenDays`、`auditLogs`|一部接続・講習等が未移行|同上。予約APIとの最新開校状態・枠同期が必要|
|休校登録・編集|[app.js:1278](../../app.js#L1278)〜1308|`schoolClosures`、`auditLogs`|一部接続・講習等が未移行|通常API接続済み。講習中は開校状態を変えない備考だけ対応|
|休校解除|[app.js:1309](../../app.js#L1309)〜1322|`schoolClosures`、`auditLogs`|一部接続・講習等が未移行|講習中の開閉変更は停止|
|模試登録・編集|[app.js:1323](../../app.js#L1323)〜1344|`schoolEvents`、`auditLogs`|一部接続・講習等が未移行|通常API接続済み。講習中は時間・開閉を変えない編集だけ対応|
|模試削除|[app.js:1345](../../app.js#L1345)〜1352|`schoolEvents`、`auditLogs`|一部接続・講習等が未移行|講習中の開閉変更は停止|
|講習非表示・復元|[app.js:1358](../../app.js#L1358)〜1374|`specialCourses`、`auditLogs`|API未移行|通常生成への影響・予約受付停止/再開と同じ境界で検証。既存予約を勝手に削除しない|
|講習勤務希望締切変更|[app.js:1455](../../app.js#L1455)〜1472|`specialCourses`、`auditLogs`|API未移行|講習勤務希望提出・予約/配置と同じtransactionの時刻と版を使う|
|講習登録・期間/コマ変更|[app.js:1473](../../app.js#L1473)〜1505|`specialCourses`、`auditLogs`|API未移行|予約設定有無だけでなく保存授業/希望/通常生成も検証|
|講習削除と子文書削除|[app.js:1506](../../app.js#L1506)〜1526|`specialCourses`、`specialCourses/*/teacherAvailability`、`specialCourses/*/scheduleMeta`、`auditLogs`|API未移行|孤児台帳と通常生成の再出現を防止。未対応時は停止|
|公式お知らせ取消|[app.js:1588](../../app.js#L1588)〜1603|`officialAnnouncements`|独立書込として維持候補|owner限定の独立機能。業務復元の巻戻し対象にしない|
|公式お知らせ既読|[app.js:1604](../../app.js#L1604)〜1619|`announcementReadStates`|独立書込として維持候補|本人のみ・単調追加。権限テストは必要|
|通知件数整理|[app.js:1625](../../app.js#L1625)〜1647|`notifications/*/items`|独立書込として維持候補|本人宛の古い通知削除。業務カウンターに影響しない|
|通知個別削除|[app.js:1662](../../app.js#L1662)〜1680|`notifications/*/items`|独立書込として維持候補|本人のみ|
|通知既読一括|[app.js:1681](../../app.js#L1681)〜1694|`notifications/*/items`|独立書込として維持候補|本人のみread=true|
|通知全削除|[app.js:1695](../../app.js#L1695)〜1710|`notifications/*/items`|独立書込として維持候補|本人のみ|
|公式お知らせ掲載|[app.js:1711](../../app.js#L1711)〜1725|`officialAnnouncements`|独立書込として維持候補|ownerのみ・期間と文字数検証|
|生徒表示情報の授業伝播|[app.js:1780](../../app.js#L1780)〜1802|`timetableEntries`、`auditLogs`|API接続済み・フラグ無効|旧経路は分割batch。新経路は生徒保存と一体。私有連携候補の実結合未検証|
|生徒登録・編集・毎週設定|[app.js:1803](../../app.js#L1803)〜1844|`schoolStudents`、`auditLogs`|API接続済み・フラグ無効|新経路はstudent API。予約連携は私有候補のみ|
|生徒削除と関連文書削除|[app.js:1870](../../app.js#L1870)〜1911|`schoolStudents`、`timetableEntries`、`monthlyTargets`、`auditLogs`|APIモードでは停止|公開候補はplanのみ。私有の小規模一括削除はWeb未接続|
|授業通知生成|[app.js:1985](../../app.js#L1985)〜1991|`notifications/*/items`|業務APIと一体化が必要|授業変更/欠席/振替と同じcommitに含める|
|生徒変更通知生成|[app.js:2023](../../app.js#L2023)〜2031|`notifications/*/items`|業務APIと一体化が必要|生徒変更と同じcommitに含める|
|旧定型通知生成|[app.js:2032](../../app.js#L2032)〜2038|`notifications/*/items`|業務APIと一体化が必要|独立再送で重複しないよう業務APIのreceiptに従う|
|個別授業登録・編集・担当/別日移動|[app.js:2040](../../app.js#L2040)〜2114|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|一部接続・講習等が未移行|通常はAPI接続済み。講習は直接経路が残りAPI管理対象は停止|
|個別授業削除|[app.js:2115](../../app.js#L2115)〜2134|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|一部接続・講習等が未移行|通常はday API。講習は専用の台帳整合APIが必要|
|伝達事項保存|[app.js:2170](../../app.js#L2170)〜2206|`timetableEntries`、`auditLogs`、`notifications/*/items`|一部接続・講習等が未移行|通常はmemo API。予約授業は停止。予約側専用memo APIは未実装|
|講習勤務希望提出・管理者代理保存|[app.js:2465](../../app.js#L2465)〜2506|`specialCourses/*/teacherAvailability`、`auditLogs`、`notifications/*/items`|API未移行|本人/管理者/締切/非表示を検証する専用APIが必要。現在の私有normal wrapperは管理者専用で流用不可|
|講習配置エディター公開|[app.js:2881](../../app.js#L2881)〜2977|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|API未移行|予約停止中も共通lockが必要。配置metaだけでは予約APIと排他しない|
|通常エディター担当振替・コマ別欠席公開|[normal-editor.js:400](../../normal-editor.js#L400)〜480|`timetableEntries`、`teacherDayAbsences`、`auditLogs`、`notifications/*/items`|API接続済み・フラグ無効|day API接続済み。両フラグfalseでは旧batchが残る|
|通常勤務曜日・臨時出勤登録解除|[teacher-work.js:155](../../teacher-work.js#L155)〜203|`teacherWeeklyWork`、`teacherDateWork`、`auditLogs`|API接続済み・フラグ無効|work API接続済み。講習勤務希望から独立|

## 特に切替を止める未移行経路

1. **講習勤務希望**：講師本人の書込が残る。第2段階の私有normal wrapperはadmin/owner専用なので、この経路に流用すると講師が提出できなくなる。専用APIで本人・代理権限・締切・講習非表示・勤務コマを検証し、枠の減少と既存確保分の扱いも同時に計画する。通常勤務設定は読まない。
2. **講習配置**：`scheduleMeta/state`の版だけでは予約APIと排他しない。予約受付停止中の手動授業も共通lockへ参加させる。予約所有の授業は専用の台帳整合操作へ送る。
3. **講習期間/非表示/締切と営業カレンダー**：通常生成、希望、確定授業、予約枠に影響する。期間や勤務希望を先に保存し後で手動syncする方式では同時実行を保証できない。未対応の変更は無書込で停止する。
4. **学年自動更新**：ログイン/年度境界でフォーム以外から発生。新APIモードでは停止するが、旧Webを残すとサーバーの生徒連動更新を迂回する。
5. **生徒削除、履歴復元、全体復元**：公開Webは私有の小規模ライフサイクル操作に未接続。旧形式バックアップは予約台帳を含まない。APIモードでの停止を維持し、旧Webの操作も最終ルールで拒否する。
6. **メンテナンス開始の連鎖**：`changeMaintenance(start)`は旧バックアップの作成成功後に停止設定を書き込む。backupArchivesの直接writeだけ先に拒否すると、UIからメンテナンスを開始できない。制御面を別の検証済み手段へ分離するまで先行適用しない。

## 独立して残せる書込の条件

公式お知らせのowner限定掲載/取消、本人の既読・通知削除は予約枠・通常生成を変更しないため、現行の狭いルールで残す候補。業務変更に伴う**通知生成・監査生成は残さず**サーバーcommitに含める。メンテナンスは全writerが読む制御面として別扱いで、従来のowner UIだけでは旧Functionsを停止できない。

## 検索範囲・再検査

`write-inventory.json`は全ルートJSのSHA-256、全検出箇所の行番号・sink・分類・行ハッシュを持つ。`npm run test:stage3:inventory`で一致を確認。ソースやファイル一覧が変わると準備を停止する。既知receiver名の呼出し検査と手動レビューであり、任意の別名・動的import・REST書込みを証明する汎用taint解析ではない。新しい依存や書込形式を追加したら分類と検索式もレビューする。

HTMLは3入口のmodule scriptで、別のインラインFirestore writerはない。`monthlyTargets`に独立した現行CRUD画面はなく、旧削除・復元からwriteされる。`users`はWebからwriteされない。旧ブラウザ、Console/Admin SDK、Cloud Functions、トリガー、私有ジョブ/CLIなどリポジトリ外writerは別途全一覧を私有側で確定する。これらの不存在は公開コードからは証明できない。
