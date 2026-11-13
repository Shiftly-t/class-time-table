# ルール・API・Webの切替と安全な復旧（手順案・未実行）

対象は承認後の**分離テストprojectのみ**。本番適用の手順実行を許可する文書ではない。全writer移行が未完了のため、現時点では最終切替不可。

## 必要なルールの単位

|パス|最終移行時の直接write|直接read|
|---|---|---|
|schoolStudents、timetableEntries、monthlyTargets、teacherDayAbsences、teacherWeeklyWork、teacherDateWork|クライアント拒否。APIで検証|業務上必要な現行ロール範囲を維持/別途審査|
|schoolClosures、schoolOpenDays、schoolEvents|拒否。APIへ統一|現行の必要範囲|
|specialCourses本体、teacherAvailability、scheduleMeta|全writer移行後に拒否|勤務希望は管理者/本人など現行の狭い範囲|
|bookingの7コレクション、共有revision/receipt/lifecycle、新形式backup、API用config|拒否|原則拒否。必要な表示は認可済みAPIから返す|
|auditLogsのcreate、旧backupArchives/partsのcreate|業務API/新形式へ置換後に拒否|既存owner限定を維持。旧backupは参考資料で完全復元には使わない|
|notifications/itemsのcreate|業務APIのtransactionへ移行後に拒否|本人のみ。本人の既読/削除は狭い現行ルールを維持候補|
|officialAnnouncements、announcementReadStates|owner掲載/取消、本人の既読など狭い現行許可を維持候補|既存の必要範囲|
|systemConfig/maintenance、maintenanceEvents|検証済みowner制御面のみ。業務API用configと区別|現行の必要範囲|
|users|引き続きWebから拒否|現行ロール範囲|

これは適用用rules全文ではない。現行全文・公開normal候補・最終writer表を照合して最終版を作成し、実許可/拒否試験を行う。既存の`server-candidates/normal-authority/firestore.candidate.rules`は**通常系だけの部分移行候補**で、講習metadataや勤務希望等の直接writeを残す。これを第3段階の完成ルールとして適用しない。ルールのallowはOR結合なので、追加matchでdenyを書いても既存allowを打ち消せない。対応する旧allowそのものを狭める必要がある。

## 停止中に切り替える順序

|段階|作業|次へ進む条件|
|---|---|---|
|S0 固定|project番号、原本/候補hash、Web/API/rules/index/secret-version対応表、架空seedと復旧物を保存|作成・課金・配備の承認と対象一致|
|S1 非稼働配備|テストprojectでAPIを無効状態で準備。初期DBはdeny。旧APIが存在する試験では別版を排他して管理|勝手に実行するトリガー/ジョブなし。secretとAdmin接続先はテストのみ|
|S2 全writer停止|旧Webをメンテナンスにし、旧/新の公開予約、管理、normal、ジョブ/トリガー/CLIを停止・隔離。ownerも業務書込しない|旧APIを直に呼んでも無書込。in-flight要求と遅延イベントを確認し排出/無害化|
|S3 整合性基準|停止下で予約/授業/枠/講師負荷の読取突合せと完全な復旧物を保存|不明なcommitなし。全writer一覧と停止証跡、基準hashが揃う|
|S4 API/ルール|排他を保って新API実装と最終直接write拒否ルールを揃える。API gateは閉じたまま|新旧双方の無認可・直接write拒否テスト成功。旧allowの残存なし|
|S5 Web固定|新Web配備、キャッシュ/旧タブの再読込、API契約版を固定。私有runnerで最小の候補試験|全移行済みwriterが共通境界に参加。未対応操作は明示停止|
|S6 限定試験|承認済みテスト環境だけAPI gateを開き、架空データの実結合試験。移行Webフラグは全経路完成後に別途レビュー|全必須試験と実端末確認。整合性再集計が一致|
|S7 判定|未検証/不具合/費用/復旧結果を記録|自動的に本番へ進まない。両公開フラグはfalse維持|

「API→Web→最後にルールを後追い」では旧クライアントの書込みが混在する。「ルールだけ先に変更」では既存操作を壊す。したがって、**全writerを停止した区間で一組として切替え、旧writerが拒否されることを確認してから再開**する。新旧APIが同じDBへ自由に同時writeするblue/green方式は使わない。並行比較するなら別の架空データ環境を用意し、その作成も別途確認する。

maintenance画面は補助で、旧FunctionsのAdmin SDKを止める証拠にはならない。新coordination gateを閉じてもそれを読まない旧APIは止まらない。全入口のfreeze手段・権限・観測を私有実装に追加することが未完了のリリース阻害項目。単に数秒待つだけで排出完了とはしない。応答不明requestId、稼働revision、終了ログ、再試行・イベントを確認し、証明できなければ再開しない。

## 不具合時の復旧

1. **受付と全writerを再停止**。新しい操作を繰り返さず、結果不明は読取専用receiptと台帳で確認する。Webを旧版へ戻して直接writeを再許可する操作はしない。
2. **状態を保全**。対象テストproject、発生時刻JST/UTC、release hash、requestId（QR tokenは除外）、失敗前後の業務fingerprint、監査・receiptを私有保管。故障DBをそのまま保全し、自動の全削除・上書きを行わない。
3. **書込前か後かで分岐**。
   - 新版による業務commitが一度もなく、基準fingerprintと一致する場合だけ、停止下で既知の旧API/Web/rulesの組を復元して試験する。破壊的な削除トリガーは復活させない。
   - 新版commitがある/不明なら、schema/epoch/receiptの互換性を確認するまで旧APIや旧ルールへ戻さない。原則は停止継続＋互換修正版への前進復旧。旧鍵・旧epochを戻してQRを復活させない。
4. **必要なデータ復元を選ぶ**。停止時点の検証済み新形式スナップショットがあり、全制約内ならownerの原子的復元を隔離試験後に使用する。小規模候補が拒否したら手動分割batchへ切り替えない。旧format1からの一括復元、任意文書の履歴復元、本番データのコピーで埋め合わせない。
5. **QRと単調な状態を守る**。復元でもlifecycle epoch、tombstone、失効履歴、receipt、immutable監査、Auth/IAMを過去へ戻さない。全QRの失効を検査し、必要な新QRを再発行する。過去の通知が残るため、通知整理/再通知の未実装方針は解決まで再開を保留する。
6. **突合せしてから再開判断**。予約希望数＝枠used、確定数＝講師load、公開台帳↔時間割、人数上限、学生参照、表示情報、旧QR拒否を再検証。旧端末と遅延イベントの再試験も行う。1つでも不一致/結果不明なら閉じたまま。

DB初期化によるテストやり直しも、この復旧手順の代わりではない。環境削除/データ初期化は別途確認後に行い、結果と証拠は残す。すでに入った正当な業務更新を無条件に失う「コードだけ戻せば安全」という復旧保証はしない。
