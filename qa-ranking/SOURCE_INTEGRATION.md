# QA Functions source integration check
2026-11-25 Cloud Shellから取得された13ファイルに対して確認。元の非公開Functionsソースはこのブランチに掲載しない。
- normal-authority/policy.cjs: effectiveDay / canAssign / PERIODS
- normal-authority/calendar.cjs: automaticClosure
- enrollment.cjs: allows
- Node 22, firebase-admin ^13.4.0, firebase-functions ^6.4.0.
- qa-ranking/functions/ranking-resolver.cjs を既存Functions配下へコピーする候補。原本のpolicy/calendar/enrollmentを利用し、通常授業の日付別振替、退塾、休校・特別開校、講師勤務可否を再利用する。公開・保存・デプロイは未実施。講習期間は現状停止。
- ローカルでは取得した実際のpolicy/calendar/enrollmentと模擬Firestoreで test-ranking-resolver.cjs が成功。デプロイ中のソースとの同一性、実Firestore、権限、スケジューラ、メンテナンス・復元ロックの完全な統合は未検証。
- 既存seasonal-operations.cjs は過去の講習配置変更と done の担当/状態変更・削除を拒む。事後訂正には既存権限経路と整合した追加実装が必要。ランキングだけを単独訂正しない。
- 次は index.js のQAターゲット・予約公開条件・整合性フック・実際のFirestoreルールを確認する。現時点でデプロイ禁止。

## 講習候補の追加
- QAの講習2件を照合し、3公開予約に対して3時間割、未照合0・エラー0をユーザーのCloud Shellで確認。
- 講習解決器をオプトインで追加。公開予約と b_ 時間割の一対一照合、手動時間割も含める、欠席除外、勤務希望との矛盾・休校日に残る配置・不明な講習設定は確定停止。予約そのものは実績として加算しない。
- テストは独立した架空データによる。現行 booking-core.cjs を使った統合テスト・実データでの新解決器テストは未実施。過去データを現在の設定で集計・保存しない。事後訂正・アーカイブ・復元・スケジューラ・アクセス制御は未完了。

## QA確認 2026-11-25
- ユーザーによるCloud Shellの結果：通常・講習の実読取と照合、現行ルールの48件評価、SDK接続先検証、隔離されたQA実DB保存・訂正・冪等性・後片付け成功。実稼働領域と本番は未変更。
- ranking-read.mjs は内部読取ハンドラ候補。検証済みcallableコンテキスト、usersの役割、公開設定、復元・メンテナンスを確認し、集計値のみ返す。日次台帳欠損時は順位を返さない。現行名簿から消えた過去担当者は誤集計防止のため停止（履歴名簿は別途実装）。
- 閉じた日付のみ、月間・年度をサポート。累計・プロフィール・バッジ・速報・自動実行・事後訂正の既存編集連携・callable wrapperは未実装。未デプロイ。Nodeで tests/ranking-read.test.mjs を実行して確認する。

## Callable候補
ranking-callable.cjs は既存read handler用の認証・App Check必須ラッパー。エラーを安全なメッセージへ変換し、リージョン東京・最大3インスタンスで構成する候補。テストは模擬onCallで実施する。実際のトークン検証、QAサイトのApp Check登録、現行SDKへの接続、稼働環境の認証・デプロイは未実施。既存Functionsの書き換えなし。

## 自動実行候補
ranking-automation.mjs: JST 23:55取得、翌日00:10確定。予定された時刻と対象日を使用し、日付をまたいだ遅延取得は拒否。QA限定。実行トランザクション内でメンテナンス・復元・有効化フラグを確認する。実行には enabled, automationEnabled, correctionIntegrationVerified がすべて true 必須。フラグはまだ設定しない。既存編集との訂正連携、23:55以降の変更の処理、復元後の整合性・障害対応、実際のスケジュール実行検証は未完了。候補の模擬試験は node tests/ranking-automation.test.mjs。自動処理は未デプロイ。

## 事後訂正接続調査
- ユーザー提供 stage2-bridge.cjs / coordination.cjs を照合。beforeCommit は全業務の書込みを遅延バッファに保持したまま呼ばれ、flush 前に既存検証を行う。新しい setHooks 呼び出しで既存のフックを置換しないこと。既存 beforeCommit に追加する必要がある。復元計画・復元バッチは通常の訂正と分離する。
- booking-graph.cjs は done の移動・削除を拒否し、公開予約と時間割の整合を要求する。seasonal-operations.cjs にも過去日配置制約がある。制限の一括解除は禁止。専用の検証済み訂正経路が必要。
- ranking-correction.mjs は日付指定編集の検証済み前後実績から差分を算出し、変更対象のみ台帳へ適用する候補。変更前が台帳と矛盾する場合は停止。無関係な過去実績や週間設定変更からの再生成は行わない。現行日付別編集の前後投影・履歴由来の仮想授業、取得後未確定日の扱い、予約側の過去訂正・復元整合・同一トランザクション接続は未完了。自動化フラグは有効にしない。

## 操作38以降のQA候補

上記の「未デプロイ」は各試作時点の記録。2026-11-25の操作37時点で
`qaRankingReadApi` はQAで稼働済み。操作38以降のこの候補はローカルの
FirestoreエミュレーターとChromiumで検証した。

- 対象は `shiftly-t-test` の `shiftly-qa-v1` と東京リージョン。提供された
  公開ファイル・設定・ルール・関数情報のSHA256照合は41件成功。
- 非公開の既存Functionsソースには検証済み日付変更を取り込むフックを追加。
  通常と講習の編集、台帳、監査、再集計要求は既存コーディネーターで一括保存。
  集計済みの日付を変更する旧バックアップは復元計画で拒否する。
  日付実績を保持したままの業務データ復元は従来の計画を使う。
- 取得済みの当日データに有効な編集が入った場合は日次確定前でも更新する。
  スナップショットが欠けた過去日は、現在の週設定で補完しない。
  通常の非標準時刻の授業は既存時間割と同じく1コマとして扱う。
- 累計、プロフィール、退職者の表示名、同順位、運営によるバッジ設定、
  付与、取消、表彰履歴、同一イベントの通知1件を検証。
  自動表彰は全日分が確定した月または年度だけを扱う。自動ルールは初期状態で空。
- `qaRankingCaptureDaily` はJST 23:55、`qaRankingFinalizeDaily` は翌00:10。
  `qaRankingProcessAchievements` は10分間隔で再集計と通知を処理する。
  Firestoreルールは10個の内部コレクションを全クライアントから保護している。
  通知は既存の `notifications/{uid}/items` を使う。
- 機能フラグ `automationEnabled`、`publicationEnabled`、
  `achievementsEnabled`、`achievementNotificationsEnabled` は、
  QA側の順序に従って個別に検証する。今回の作業では実QAの設定更新なし。

### 実QAへの移行ゲート

1. Cloud Shellで `qa-ranking/check-deployed-source.py` を実行し、
   提供されたソースとデプロイ済み世代を照合する。関数ごとに異なる
   リビジョンとソース世代なので、差分があればその世代を基準に再統合する。
2. QAの復元ジョブが停止中であることとバックアップを確認する。
   運用画面経由のバックアップと、ランキング内部台帳を含むDBバックアップは
   対象が異なる。前者の復元では既存のランキング台帳を保持する。
3. 更新対象は既存コードベース `shiftly-test-qa-v1` の
   `qaNormalAuthorityApi`、`qaSeasonalAuthorityApi`、`qaBookingAdminApi`。
   ランキング用コードベース `shiftly-ranking-qa-v1` では
   `qaRankingReadApi`、`qaRankingAchievementApi` と3個のジョブを照合する。
   実QAでは既存5関数の残存、IAM、App Check、全権限、既存機能を確認する。
4. QAテスト用の合成データで取得・確定・欠損・後処理と通知を検証してから
   公開可否を判断する。実機Safari、実QAの負荷と長期累計の読取上限も確認する。
5. 実QAの結果と対象・復旧手順を提示し、本番反映は別承認とする。

ローカルの確認表示は `SUCCESS RANKING AUTHORITY COORDINATOR EMULATOR TESTS`、
`SUCCESS RANKING SEASONAL COORDINATOR EMULATOR TESTS`、
`SUCCESS RANKING FIREBASE SCHEDULER SDK TESTS`、
`SUCCESS NAMED FIRESTORE EMULATOR RANKING ACHIEVEMENT AND NOTIFICATION TESTS`、
`SUCCESS RANKING UI PATCH AND BROWSER TESTS`、
`SUCCESS RANKING EMULATOR RULES (250 client denials on shiftly-qa-v1)`。
