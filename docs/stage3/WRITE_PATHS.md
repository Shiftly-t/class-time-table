# Firestore直接書き込み経路（簡素化 第1段階）

比較元 `c28dbb9a5493275b98799db92ee204f9ce870def`。36操作群・109箇所（writer生成/commitを含む）。前段階122から13箇所削減。現在の正確なWebソースはsourceHashesで固定。両フラグfalse。

履歴復元・通常画面の完全削除・自動進級の旧writerを廃止。backup/保護付き復旧は代替検証前のため保全する。移行済みの通常/講習保存と通常エディター/講師管理API保存はauthority-commands.jsへ集約。legacy業務writerの全撤去は未完了。

|操作群|コード範囲|箇所数|状態|対応/残作業|
|---|---|---|---|---|
|監査履歴の共通ヘルパー|app.js:374–381|1|migrate-with-business-api|各業務操作のトランザクションに監査を含める|
|旧形式バックアップ作成|app.js:425–446|4|api-connected-with-safety-limits|APIモードはowner+maintenanceの小規模format2。旧形式の生成へフォールバックしない。|
|変更履歴から単一文書復元|app.js:507–520|0|retired-in-app|履歴は閲覧専用。任意履歴の適用writerを廃止。|
|全体復元|app.js:520–575|8|api-connected-with-safety-limits|format2だけ計画と適用。旧形式/部分復元/上限超過を停止。|
|メンテナンス変更・イベント記録|app.js:627–661|4|api-connected-with-safety-limits|APIモードの停止前バックアップ依存を除去。再開は全writer移行・独立直接writeロックの検証を要求。|
|ログイン/年度境界の学年自動保存|app.js:768–769|0|retired-in-app|自動進級のtransactionを廃止。表示計算を共有moduleで維持。|
|特別開校日解除|app.js:1064–1085|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|特別開校日登録|app.js:1086–1106|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校登録・編集|app.js:1207–1237|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|休校解除|app.js:1238–1251|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試登録・編集|app.js:1252–1273|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|模試削除|app.js:1274–1281|3|api-connected-with-safety-limits|通常・講習の営業カレンダーをseasonal APIで一括保存。既存確保は保持し、新規配置を最新状態で検証。|
|講習非表示・復元|app.js:1287–1304|3|api-connected-with-safety-limits|対応済みの状態変更をpatchCourseで保存。進行中の非表示は拒否。|
|講習勤務希望締切変更|app.js:1385–1402|3|api-connected-with-safety-limits|管理者権限でpatchCourse。期限と講師情報を同じ境界で検証。|
|講習登録・期間/コマ変更|app.js:1403–1439|3|api-connected-with-safety-limits|空の講習の新規作成と整合性検証。依存データのある構造変更は停止。|
|講習削除と子文書削除|app.js:1440–1461|5|api-connected-with-safety-limits|空の講習と子文書だけを原子的削除。予約/QR/履歴があれば拒否。|
|公式お知らせ取消|app.js:1523–1538|1|retain-independent-reviewed|owner限定の独立機能。業務復元の巻戻し対象にしない|
|公式お知らせ既読|app.js:1539–1554|1|retain-independent-reviewed|本人のみ・単調追加。権限テストは必要|
|通知件数整理|app.js:1560–1582|3|retain-independent-reviewed|本人宛の古い通知削除。業務カウンターに影響しない|
|通知個別削除|app.js:1597–1615|1|retain-independent-reviewed|本人のみ|
|通知既読一括|app.js:1616–1629|3|retain-independent-reviewed|本人のみread=true|
|通知全削除|app.js:1630–1645|3|retain-independent-reviewed|本人のみ|
|公式お知らせ掲載|app.js:1646–1660|1|retain-independent-reviewed|ownerのみ・期間と文字数検証|
|生徒表示情報の授業伝播|app.js:1716–1738|5|migrated-behind-disabled-flag|旧経路は分割batch。新経路は生徒保存と一体。私有連携候補の実結合未検証|
|生徒登録・編集・毎週設定|app.js:1739–1781|2|migrated-behind-disabled-flag|新経路はstudent API。予約連携は私有候補のみ|
|生徒削除と関連文書削除|app.js:1784–1788|0|retired-in-app|完全削除の画面操作と旧batchを廃止。退塾は能力確認付きAPIのみ、未対応なら停止。|
|授業通知生成|app.js:1863–1869|3|migrate-with-business-api|授業変更/欠席/振替と同じcommitに含める|
|生徒変更通知生成|app.js:1901–1909|3|migrate-with-business-api|生徒変更と同じcommitに含める|
|旧定型通知生成|app.js:1910–1916|3|migrate-with-business-api|独立再送で重複しないよう業務APIのreceiptに従う|
|個別授業登録・編集・担当/別日移動|app.js:1918–1994|3|api-connected-with-safety-limits|通常はnormal API、講習はseasonal API。予約所有IDの自由編集は拒否。|
|個別授業削除|app.js:1995–2015|4|api-connected-with-safety-limits|通常はnormal API、manual講習はseasonal API。done/予約所有の自由削除は拒否。|
|伝達事項保存|app.js:2051–2088|2|api-connected-with-safety-limits|通常はnormal API、講習/予約授業は専用memo API。配置・台帳を変更させない。|
|講習勤務希望提出・管理者代理保存|app.js:2350–2393|4|api-connected-with-safety-limits|employee本人と管理者代理を分け、締切/版/確保済み枠を原子的検証。|
|講習配置エディター公開|app.js:2739–2836|8|api-connected-with-safety-limits|手動講習配置は共通lock・版・最新勤務希望・上限2を検証。予約所有IDの任意配置は拒否。|
|通常エディター担当振替・コマ別欠席公開|normal-editor.js:400–480|7|migrated-behind-disabled-flag|day API接続済み。両フラグfalseでは旧batchが残る|
|通常勤務曜日・臨時出勤登録解除|teacher-work.js:155–203|3|migrated-behind-disabled-flag|work API接続済み。講習勤務希望から独立|

廃止群の0箇所は、対応する旧writerがなくなったことを示す。退塾のサーバー・定員統一/既存データ照合・最終ルール・旧Functions/Console/CLI/ジョブ排出は未完了または未検証。フロント非表示は認可の代替ではない。通知既読等の独立操作と業務writerを区別する。
