# Firestore直接書き込み経路（第4段階の再棚卸し）

変更の比較元は `9baa0c69aaf4197f2967db9afcb9fc62bd74c297`。現在の正確なソースは `write-inventory.json` のsourceHashesで固定する。36操作群・122箇所の旧write/constructor/commit経路を保持し、機能フラグ無効時の既存動作を維持。APIモードの対応先を以下に更新した。

新APIの接続は実Firebaseへの移行完了を意味しない。両フラグfalse、実配備なし。サーバーが対応を返さない場合は書込を停止し、旧Firestoreへフォールバックしない。

|操作群|コード|対象|状態|APIモードの対応/制限|
|---|---|---|---|---|
|監査履歴の共通ヘルパー|[app.js:404](../../app.js#L404)〜411|`auditLogs`|旧経路は業務API移行時に一体化|各業務操作のトランザクションに監査を含める|
|旧形式バックアップ作成|[app.js:455](../../app.js#L455)〜476|`backupArchives/*/parts`、`backupArchives`|制限付きAPI接続済み|APIモードはowner+maintenanceの小規模format2。旧形式の生成へフォールバックしない。|
|変更履歴から単一文書復元|[app.js:542](../../app.js#L542)〜577|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|APIモードでは停止|参照・台帳を含む復元計画へ。任意パスset/deleteは移行しない|
|全体復元|[app.js:577](../../app.js#L577)〜632|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|制限付きAPI接続済み|format2だけ計画と適用。旧形式/部分復元/上限超過を停止。|
|メンテナンス変更・イベント記録|[app.js:684](../../app.js#L684)〜718|`systemConfig/maintenance`、`maintenanceEvents`|制限付きAPI接続済み|APIモードの停止前バックアップ依存を除去。再開は全writer移行・独立直接writeロックの検証を要求。|
|ログイン/年度境界の学年自動保存|[app.js:825](../../app.js#L825)〜858|`schoolStudents`、`auditLogs`|APIモードでは自動保存停止|通常APIモードでは停止。表示計算は維持。保存するなら予約表示情報も同じトランザクションへ|
|特別開校日解除|[app.js:1154](../../app.js#L1154)〜1175|`schoolOpenDays`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|特別開校日登録|[app.js:1176](../../app.js#L1176)〜1196|`schoolOpenDays`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校登録・編集|[app.js:1297](../../app.js#L1297)〜1327|`schoolClosures`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校解除|[app.js:1328](../../app.js#L1328)〜1341|`schoolClosures`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試登録・編集|[app.js:1342](../../app.js#L1342)〜1363|`schoolEvents`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試削除|[app.js:1364](../../app.js#L1364)〜1371|`schoolEvents`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|講習非表示・復元|[app.js:1377](../../app.js#L1377)〜1394|`specialCourses`、`auditLogs`|制限付きAPI接続済み|対応済みの状態変更をpatchCourseで保存。進行中の非表示は拒否。|
|講習勤務希望締切変更|[app.js:1475](../../app.js#L1475)〜1492|`specialCourses`、`auditLogs`|制限付きAPI接続済み|管理者権限でpatchCourse。期限と講師情報を同じ境界で検証。|
|講習登録・期間/コマ変更|[app.js:1493](../../app.js#L1493)〜1523|`specialCourses`、`auditLogs`|制限付きAPI接続済み|空の講習の新規作成と整合性検証。依存データのある構造変更は停止。|
|講習削除と子文書削除|[app.js:1524](../../app.js#L1524)〜1545|`specialCourses`、`specialCourses/*/teacherAvailability`、`specialCourses/*/scheduleMeta`、`auditLogs`|制限付きAPI接続済み|空の講習と子文書だけを原子的削除。予約/QR/履歴があれば拒否。|
|公式お知らせ取消|[app.js:1607](../../app.js#L1607)〜1622|`officialAnnouncements`|独立書込として維持候補|owner限定の独立機能。業務復元の巻戻し対象にしない|
|公式お知らせ既読|[app.js:1623](../../app.js#L1623)〜1638|`announcementReadStates`|独立書込として維持候補|本人のみ・単調追加。権限テストは必要|
|通知件数整理|[app.js:1644](../../app.js#L1644)〜1666|`notifications/*/items`|独立書込として維持候補|本人宛の古い通知削除。業務カウンターに影響しない|
|通知個別削除|[app.js:1681](../../app.js#L1681)〜1699|`notifications/*/items`|独立書込として維持候補|本人のみ|
|通知既読一括|[app.js:1700](../../app.js#L1700)〜1713|`notifications/*/items`|独立書込として維持候補|本人のみread=true|
|通知全削除|[app.js:1714](../../app.js#L1714)〜1729|`notifications/*/items`|独立書込として維持候補|本人のみ|
|公式お知らせ掲載|[app.js:1730](../../app.js#L1730)〜1744|`officialAnnouncements`|独立書込として維持候補|ownerのみ・期間と文字数検証|
|生徒表示情報の授業伝播|[app.js:1799](../../app.js#L1799)〜1821|`timetableEntries`、`auditLogs`|API接続済み・フラグ無効|旧経路は分割batch。新経路は生徒保存と一体。私有連携候補の実結合未検証|
|生徒登録・編集・毎週設定|[app.js:1822](../../app.js#L1822)〜1863|`schoolStudents`、`auditLogs`|API接続済み・フラグ無効|新経路はstudent API。予約連携は私有候補のみ|
|生徒削除と関連文書削除|[app.js:1891](../../app.js#L1891)〜1935|`schoolStudents`、`timetableEntries`、`monthlyTargets`、`auditLogs`|制限付きAPI接続済み|ownerがrevisionに結び付いた計画確認後に小規模一括削除。QR失効・予約取消・枠解放を一体化。|
|授業通知生成|[app.js:2009](../../app.js#L2009)〜2015|`notifications/*/items`|旧経路は業務API移行時に一体化|授業変更/欠席/振替と同じcommitに含める|
|生徒変更通知生成|[app.js:2047](../../app.js#L2047)〜2055|`notifications/*/items`|旧経路は業務API移行時に一体化|生徒変更と同じcommitに含める|
|旧定型通知生成|[app.js:2056](../../app.js#L2056)〜2062|`notifications/*/items`|旧経路は業務API移行時に一体化|独立再送で重複しないよう業務APIのreceiptに従う|
|個別授業登録・編集・担当/別日移動|[app.js:2064](../../app.js#L2064)〜2139|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、講習はseasonal API。予約所有IDの自由編集は拒否。|
|個別授業削除|[app.js:2140](../../app.js#L2140)〜2160|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、manual講習はseasonal API。done/予約所有の自由削除は拒否。|
|伝達事項保存|[app.js:2196](../../app.js#L2196)〜2233|`timetableEntries`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、講習/予約授業は専用memo API。配置・台帳を変更させない。|
|講習勤務希望提出・管理者代理保存|[app.js:2495](../../app.js#L2495)〜2538|`specialCourses/*/teacherAvailability`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|employee本人と管理者代理を分け、締切/版/確保済み枠を原子的検証。|
|講習配置エディター公開|[app.js:2913](../../app.js#L2913)〜3010|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|手動講習配置は共通lock・版・最新勤務希望・上限2を検証。予約所有IDの任意配置は拒否。|
|通常エディター担当振替・コマ別欠席公開|[normal-editor.js:400](../../normal-editor.js#L400)〜480|`timetableEntries`、`teacherDayAbsences`、`auditLogs`、`notifications/*/items`|API接続済み・フラグ無効|day API接続済み。両フラグfalseでは旧batchが残る|
|通常勤務曜日・臨時出勤登録解除|[teacher-work.js:155](../../teacher-work.js#L155)〜203|`teacherWeeklyWork`、`teacherDateWork`、`auditLogs`|API接続済み・フラグ無効|work API接続済み。講習勤務希望から独立|

## 残る停止・検証境界

任意の履歴からの単一文書復元、旧format1の復元適用、依存データがある講習の期間/コマ変換、実施済み履歴の削除/移動、大規模復元は未対応として停止する。公開normal候補の生徒/予約連携は引き続き保守的拒否で、実連携は私有候補にのみ存在する。

旧書込の122箇所を削除したという意味ではない。独立機能（お知らせ掲載、本人通知既読/削除等）を除き、APIモードで業務APIへ接続/停止する。全writer移行と最終ルール・旧Functions排出の実証が済むまで有効化しない。

棚卸しは全ルートWeb JSのハッシュ固定＋既知sink形式の検査と手動レビュー。汎用taint解析ではない。HTMLの3入口、Map/Set、仮想通常授業表示、Authenticationを別確認した。Console、私有CLI、古いデプロイ/ジョブなどリポジトリ外writerの不存在は公開コードだけでは証明できない。
