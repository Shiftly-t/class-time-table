# Firestore直接書き込み経路（第4段階の再棚卸し）

変更の比較元は `9baa0c69aaf4197f2967db9afcb9fc62bd74c297`。現在の正確なソースは `write-inventory.json` のsourceHashesで固定する。36操作群・122箇所の旧write/constructor/commit経路を保持し、機能フラグ無効時の既存動作を維持。APIモードの対応先を以下に更新した。

新APIの接続は実Firebaseへの移行完了を意味しない。両フラグfalse、実配備なし。サーバーが対応を返さない場合は書込を停止し、旧Firestoreへフォールバックしない。

|操作群|コード|対象|状態|APIモードの対応/制限|
|---|---|---|---|---|
|監査履歴の共通ヘルパー|[app.js:402](../../app.js#L402)〜409|`auditLogs`|旧経路は業務API移行時に一体化|各業務操作のトランザクションに監査を含める|
|旧形式バックアップ作成|[app.js:453](../../app.js#L453)〜474|`backupArchives/*/parts`、`backupArchives`|制限付きAPI接続済み|APIモードはowner+maintenanceの小規模format2。旧形式の生成へフォールバックしない。|
|変更履歴から単一文書復元|[app.js:537](../../app.js#L537)〜572|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|APIモードでは停止|参照・台帳を含む復元計画へ。任意パスset/deleteは移行しない|
|全体復元|[app.js:572](../../app.js#L572)〜627|`dynamic: OWNER_ROOT_COLLECTIONS and course subcollections`、`auditLogs`|制限付きAPI接続済み|format2だけ計画と適用。旧形式/部分復元/上限超過を停止。|
|メンテナンス変更・イベント記録|[app.js:678](../../app.js#L678)〜712|`systemConfig/maintenance`、`maintenanceEvents`|制限付きAPI接続済み|APIモードの停止前バックアップ依存を除去。再開は全writer移行・独立直接writeロックの検証を要求。|
|ログイン/年度境界の学年自動保存|[app.js:819](../../app.js#L819)〜852|`schoolStudents`、`auditLogs`|APIモードでは自動保存停止|通常APIモードでは停止。表示計算は維持。保存するなら予約表示情報も同じトランザクションへ|
|特別開校日解除|[app.js:1148](../../app.js#L1148)〜1169|`schoolOpenDays`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|特別開校日登録|[app.js:1170](../../app.js#L1170)〜1190|`schoolOpenDays`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校登録・編集|[app.js:1291](../../app.js#L1291)〜1321|`schoolClosures`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校解除|[app.js:1322](../../app.js#L1322)〜1335|`schoolClosures`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試登録・編集|[app.js:1336](../../app.js#L1336)〜1357|`schoolEvents`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試削除|[app.js:1358](../../app.js#L1358)〜1365|`schoolEvents`、`auditLogs`|制限付きAPI接続済み|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|講習非表示・復元|[app.js:1371](../../app.js#L1371)〜1388|`specialCourses`、`auditLogs`|制限付きAPI接続済み|対応済みの状態変更をpatchCourseで保存。進行中の非表示は拒否。|
|講習勤務希望締切変更|[app.js:1469](../../app.js#L1469)〜1486|`specialCourses`、`auditLogs`|制限付きAPI接続済み|管理者権限でpatchCourse。期限と講師情報を同じ境界で検証。|
|講習登録・期間/コマ変更|[app.js:1487](../../app.js#L1487)〜1517|`specialCourses`、`auditLogs`|制限付きAPI接続済み|空の講習の新規作成と整合性検証。依存データのある構造変更は停止。|
|講習削除と子文書削除|[app.js:1518](../../app.js#L1518)〜1539|`specialCourses`、`specialCourses/*/teacherAvailability`、`specialCourses/*/scheduleMeta`、`auditLogs`|制限付きAPI接続済み|空の講習と子文書だけを原子的削除。予約/QR/履歴があれば拒否。|
|公式お知らせ取消|[app.js:1601](../../app.js#L1601)〜1616|`officialAnnouncements`|独立書込として維持候補|owner限定の独立機能。業務復元の巻戻し対象にしない|
|公式お知らせ既読|[app.js:1617](../../app.js#L1617)〜1632|`announcementReadStates`|独立書込として維持候補|本人のみ・単調追加。権限テストは必要|
|通知件数整理|[app.js:1638](../../app.js#L1638)〜1660|`notifications/*/items`|独立書込として維持候補|本人宛の古い通知削除。業務カウンターに影響しない|
|通知個別削除|[app.js:1675](../../app.js#L1675)〜1693|`notifications/*/items`|独立書込として維持候補|本人のみ|
|通知既読一括|[app.js:1694](../../app.js#L1694)〜1707|`notifications/*/items`|独立書込として維持候補|本人のみread=true|
|通知全削除|[app.js:1708](../../app.js#L1708)〜1723|`notifications/*/items`|独立書込として維持候補|本人のみ|
|公式お知らせ掲載|[app.js:1724](../../app.js#L1724)〜1738|`officialAnnouncements`|独立書込として維持候補|ownerのみ・期間と文字数検証|
|生徒表示情報の授業伝播|[app.js:1793](../../app.js#L1793)〜1815|`timetableEntries`、`auditLogs`|API接続済み・フラグ無効|旧経路は分割batch。新経路は生徒保存と一体。私有連携候補の実結合未検証|
|生徒登録・編集・毎週設定|[app.js:1816](../../app.js#L1816)〜1857|`schoolStudents`、`auditLogs`|API接続済み・フラグ無効|新経路はstudent API。予約連携は私有候補のみ|
|生徒削除と関連文書削除|[app.js:1885](../../app.js#L1885)〜1929|`schoolStudents`、`timetableEntries`、`monthlyTargets`、`auditLogs`|制限付きAPI接続済み|ownerがrevisionに結び付いた計画確認後に小規模一括削除。QR失効・予約取消・枠解放を一体化。|
|授業通知生成|[app.js:2003](../../app.js#L2003)〜2009|`notifications/*/items`|旧経路は業務API移行時に一体化|授業変更/欠席/振替と同じcommitに含める|
|生徒変更通知生成|[app.js:2041](../../app.js#L2041)〜2049|`notifications/*/items`|旧経路は業務API移行時に一体化|生徒変更と同じcommitに含める|
|旧定型通知生成|[app.js:2050](../../app.js#L2050)〜2056|`notifications/*/items`|旧経路は業務API移行時に一体化|独立再送で重複しないよう業務APIのreceiptに従う|
|個別授業登録・編集・担当/別日移動|[app.js:2058](../../app.js#L2058)〜2133|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、講習はseasonal API。予約所有IDの自由編集は拒否。|
|個別授業削除|[app.js:2134](../../app.js#L2134)〜2154|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、manual講習はseasonal API。done/予約所有の自由削除は拒否。|
|伝達事項保存|[app.js:2190](../../app.js#L2190)〜2227|`timetableEntries`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|通常はnormal API、講習/予約授業は専用memo API。配置・台帳を変更させない。|
|講習勤務希望提出・管理者代理保存|[app.js:2486](../../app.js#L2486)〜2529|`specialCourses/*/teacherAvailability`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|employee本人と管理者代理を分け、締切/版/確保済み枠を原子的検証。|
|講習配置エディター公開|[app.js:2904](../../app.js#L2904)〜3001|`timetableEntries`、`specialCourses/*/scheduleMeta`、`auditLogs`、`notifications/*/items`|制限付きAPI接続済み|手動講習配置は共通lock・版・最新勤務希望・上限2を検証。予約所有IDの任意配置は拒否。|
|通常エディター担当振替・コマ別欠席公開|[normal-editor.js:400](../../normal-editor.js#L400)〜480|`timetableEntries`、`teacherDayAbsences`、`auditLogs`、`notifications/*/items`|API接続済み・フラグ無効|day API接続済み。両フラグfalseでは旧batchが残る|
|通常勤務曜日・臨時出勤登録解除|[teacher-work.js:155](../../teacher-work.js#L155)〜203|`teacherWeeklyWork`、`teacherDateWork`、`auditLogs`|API接続済み・フラグ無効|work API接続済み。講習勤務希望から独立|

## 残る停止・検証境界

任意の履歴からの単一文書復元、旧format1の復元適用、依存データがある講習の期間/コマ変換、実施済み履歴の削除/移動、大規模復元は未対応として停止する。公開normal候補の生徒/予約連携は引き続き保守的拒否で、実連携は私有候補にのみ存在する。

旧書込の122箇所を削除したという意味ではない。独立機能（お知らせ掲載、本人通知既読/削除等）を除き、APIモードで業務APIへ接続/停止する。全writer移行と最終ルール・旧Functions排出の実証が済むまで有効化しない。

棚卸しは全ルートWeb JSのハッシュ固定＋既知sink形式の検査と手動レビュー。汎用taint解析ではない。HTMLの3入口、Map/Set、仮想通常授業表示、Authenticationを別確認した。Console、私有CLI、古いデプロイ/ジョブなどリポジトリ外writerの不存在は公開コードだけでは証明できない。
