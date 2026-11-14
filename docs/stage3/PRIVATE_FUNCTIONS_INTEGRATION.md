# 私有Cloud Functionsを統合するための手順（未配備）

公開してよい契約・作業順序だけを記載する。添付ソースや私有差分は公開Gitに置かない。元の5ファイルは提供時点のスナップショットであり、現在配備中のコードと一致することは未検証。

## 1. 原本・依存・配備先を固定する

私有リポジトリで現行予約APIのソース、lockfile、Node runtime、exports、region、App Check設定、Secret名、トリガー一覧を保存し、添付5ファイルのhashと比較する。配備後の別変更があれば差分を再レビューする。Git外の第2段階候補を**現行ソースへ機械的に上書きせず**、一時ブランチへ適用する。現行のpackage/lockfileを保持し、依存更新は別レビューにする。

公開normal候補のbaselineも固定する。公開のbookingFenceテストstubを使わず、私有の実連携adapterを注入する。公開normal候補自体は保守的な拒否を維持しており、私有コピーだけに存在する機能を公開版へ配備済みと判断しない。

## 2. 共有境界を全writerへ広げる

最初に両API・トリガー・バッチ・CLI/Console運用を一覧化する。全APIは同じAdmin DB、共通revision/生徒epoch、同じtransaction境界を使う。予約側でトランザクション前に取得した生徒・設定・定員を後で使わない。SDKの再試行callback内に外部送信や非冪等副作用を置かない。

第2段階の私有候補に加え、以下は追加実装が必要：

|操作|必要な契約|完了まで|
|---|---|---|
|講習勤務希望|employee本人/管理者代理、締切、非表示、正規コマ、版照合、既存予約への影響を一括検証|旧直接保存を共存させて有効化しない|
|講習期間/非表示/締切|通常生成、希望、公開授業、予約枠を再検査。既存データを勝手に消さない|未対応変更を拒否|
|手動講習配置・担当振替|予約停止中も共通lock参加。予約所有授業は台帳と同時更新。既存備考/状態/nextDates保持|旧scheduleMetaだけの排他に頼らない|
|講習中の営業カレンダー|最新の開閉・模試・講師希望から定員判定。既存確保の調整方針を明示|後追い手動syncだけで代用しない|
|予約授業の伝達事項|メモ専用の権限/expected token/通知。配置と台帳数を変えない|未実装として停止|
|生徒削除・新形式復元Web|私有の計画・適用契約へ接続し、owner/maintenance/件数を確認|現行の公開Webは適用停止|
|メンテナンス制御|旧backup作成が失敗してもwriterを停止できる独立した制御面|旧UIだけを停止手段にしない|

通常勤務曜日/臨時出勤/欠席と講習勤務希望を同じコレクションや判定へ統合しない。通常は欠席＞明示的な臨時出勤コマ＞毎週勤務＞未設定時の互換既定。講習は講習配下の勤務希望が基準。

## 3. 既存APIの外部契約を守る

現行Webが呼ぶbooking公開/管理のaction、引数、応答の互換性を確認。新規requestId、読取専用requestStatus、capabilities、serverOwnsTimetable、maxTeacherCapacityの組合せ表を作る。新版Web＋旧APIは不明な送信を再送せず停止するが、これだけで旧APIを安全にしたとはみなさない。旧Web＋新版APIはrequestId/expected不足を無書込で拒否することを実測する。

normalとbookingは管理者ロールを同じtransaction内で再確認。講師勤務希望にadmin専用wrapperをそのまま使わない。親QRはテストprojectの鍵/epoch/最新氏名を確認し、職員APIを利用できないことも検査する。

## 4. 初期化・秘密情報・schema

テストproject ID/number、Admin credentialの権限、Functions service account、Secret Manager resourceが全てテスト側であることを配備直前に照合。本番QR鍵を流用しない。鍵は変更前に新旧QRの失効方針を決める。token/Authorization/App Check header、個人情報全JSONを実行ログへ出さない。

共通revision、lifecycle、receipt、新形式backupをクライアントread/writeに開放しない。初期configは信頼する私有初期化手順で設定する。Webから設定を書けないことを機能不具合としてルールを緩めない。追加indexは実SDKの失敗から必要なものだけ私有manifestへ保存し、無条件の全index追加は避ける。

## 5. 小規模データで私有候補を実SDKへ置き換えて検証

第2段階の31モデルテストを維持し、DB mockを実Admin SDKにした受入試験を私有管理下で作る。公開リポジトリに添付ハンドラーを埋め込まない。実SDK query/transaction、read-before-write、FieldValue transform、timestamp、transaction再試行、サイズ上限を検査。事前に正常/不正データの完全fingerprintを取り、拒否時に変更がないことを確認する。

Functions実行を経た複数インスタンス競合は、同一Node process内のPromise.allだけで代用しない。実callableへ独立端末/sessionから並列要求を送り、サーバー側の観測記録と台帳集計を突合する。完了・拒否・結果不明を分け、不明を再送しない。

## 6. トリガーと復元の互換性

遅延/重複削除イベントで復元済み文書を消す旧トリガーは切り離す。停止しただけで未配送イベントがないと判断しない。第2段階の書込なし診断候補で、旧イベント再送が無害なことを実検証する。rollback時にも破壊的な旧トリガーを戻さない。

小規模削除は関連80件、snapshotは150レコード/600KB、restoreは現行＋対象240など、私有候補の保守的な上限を確認。全体queryの上限で小さな対象でも拒否する場合がある。上限を増やした分割batchで代用しない。完了履歴の削除・大規模世代復元・通知/監査保持は未実装のまま明記する。

## 7. リリース判定

`CUTOVER_ROLLBACK.md`のゲートを満たし、`TEST_PLAN.md`の全必須ケースが実環境でPASSになるまで有効化しない。実行していない項目をモデル成功から転記しない。私有側の細かなファイル適用順序・原本hash・成果物の保管場所はGit外の手順書を使用する。本番への統合作業は別途確認後の別工程であり、今回実行しない。
