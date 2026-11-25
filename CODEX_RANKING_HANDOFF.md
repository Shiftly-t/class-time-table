# Shiftly-T ランキング開発 Codex引き継ぎ（2026-11-25・操作37完了）

## 作業対象と境界
- Repository: Shiftly-t/class-time-table
- Branch: feat/teacher-ranking-20261125 (base before this handoff: 993b57ad207e6074733f053d130507551358cece)
- このブランチ上で開発・テスト。mainへマージしない。mainへのpushは本番Hosting CIを起動する。
- 本番 shiftly-d02f6 / shiftly-t.web.app を変更しない。QA only: shiftly-t-test、named DB shiftly-qa-v1、asia-northeast1。
- QA既存Functionsコードベース shiftly-test-qa-v1。ランキング閲覧専用コードベース shiftly-ranking-qa-v1、qaRankingReadApi はデプロイ済み。既存5関数を削除・無断更新しない。
- 既存Functionsの実ソースはユーザーのCloud Shell ~/shiftly-qa-stage5/functions にある。公開GitHubにはない。必要なソースは安全な作業環境でユーザーから受け取ること。サービスアカウント鍵、暗号鍵、環境変数の秘密値、生徒データを要求・公開リポジトリへ投入しない。取得できない場合は未確認のまま統合せず、必要ファイルを一括列挙する。
- QAへのデプロイは明示対象を確認し、事後訂正・復元連携と権限試験が完了するまで自動保存・公開フラグは有効化しない。本番反映は別承認。

## 現状（旧仕様書の進捗記載よりこちらを優先）
- 操作14: 現行QAルールの内部6コレクションへのget/create/update/delete拒否48件成功。
- 操作16/18: 隔離領域 rankingQaTestRuns で実Firestoreの保存・冪等性・訂正・月間年度集計・模擬ロール/個人情報非公開・後片付け成功。
- 操作21/22: qaRankingReadApi デプロイ成功。既存5関数を含む6関数ACTIVE、未認証拒否確認。
- 操作30～32: QA UIを最新本番UI（main 7820726eff314ed693e0c76d331093ea1f4e049b）に同期。設定モジュールを config-qa-20261125-r3.js 等へ改名、no-cache/no-store対応。owner/admin/employeeでランキング画面と権限別タブをユーザーが確認済み。ランキング未公開。QA構成を本番に流用しない。
- 操作34: QA Cloud Scheduler API有効化済み。ジョブ未作成。
- 操作35: SUCCESS RANKING AUTOMATION GATE TESTS。
- 操作37: SUCCESS RANKING DATE CORRECTION TESTS。次は操作38相当、既存授業編集との実統合。
- 自動保存・実績公開・事後訂正連携・累計/プロフィール詳細・バッジ・表彰履歴は未完了。

## 承認済み仕様
- 生徒1人×1コマを1、同時間2人なら2、連続2コマに2人なら4。通常・講習共通。予定でも授業終了後自動集計。欠席、休校、講師欠勤、未終了は除外。
- 月間・年度(4月～翌3月、JST)・累計。上位3位、同順位含む。4位以下は全員表示で展開。ヘッダーは全権限、横画面はトロフィー＋ランキング、スマホはアイコンのみ。プロフィールは共通人物アイコン。既存最新UIを維持。
- 自動集計試作は23:55当日取得・翌00:10確定。これは実装候補。締め後変更・遅延・欠損時に誤集計しないこと。週間設定変更は過去台帳に影響させない。日付指定の欠席/解除・担当変更・追加削除・時間変更は過去実績、各期間集計、自動バッジ、表彰を再判定する。
- 自動バッジは条件設定可能。手動バッジはownerのみ独自作成・指定者付与/取消。手動バッジは再集計で取り消さない。名称、色、閾値は未確定、勝手に固定しない。
- ブラウザから内部台帳直接アクセス不可。Callable認証・App Check、サーバーのusersロールで判定。生徒ID等を公開レスポンスに含めない。履歴、通知、バックアップ/復元整合を維持。

## 次に実施する作業
1. RANKING_DESIGN.md, RANKING_QA_CONNECTION.md, qa-ranking/SOURCE_INTEGRATION.md と ranking-*.mjs, qa-ranking/functions, tests, qa-ranking/frontend を確認。全既存テスト実行。文書の古い「未デプロイ」表記を最新状態と区別。
2. 実Functionsの coordination.cjs / stage2-bridge.cjs / index.js / normal-authority/* / seasonal-operations.cjs / booking-graph.cjs / booking-lifecycle.cjs / booking-core.cjs / enrollment.cjs 等と現行デプロイの一致を検証。beforeCommitの既存検証を置換しない。過去編集制限の一括解除は禁止。日付指定編集の投影と検証済み元データの変更、台帳、監査、冪等性、再集計要求を同一トランザクションに統合。取得後未確定日の編集、復元、削除済み講師の履歴、勤務設定変更、スケジュール欠損も考慮。
3. Schedulerの実SDKラッパー、実行・再試行・停止・欠損復旧の検証。運用開始前の実績を現在設定から捏造しない。安全ゲートを維持。
4. 累計/プロフィール/月別推移、履歴名簿、自動バッジ、owner限定手動付与、表彰履歴・通知を実装し、最新UIに統合。未確定なバッジ閾値・表彰細則は設定可能にしてユーザー確認。
5. QA統合試験：全権限、欠席/振替/連続コマ、講習の公開予約照合・重複防止、同順位、訂正競合、権限不正、復元、メンテナンス、日付境界、既存機能回帰、スマホ/iPad/PC。未ログイン/未登録/App Check不正/講師の書込み拒否。実データをテストで破壊しない。
6. 作業区切りごとに変更ファイル、コミット、実行した試験、実際の成功表示、未検証事項を報告。Cloud Shellで必要な操作は安全確認付きでまとめ、ユーザー操作を最小化。最後にQA結果と本番反映計画を提示。本番デプロイはしない。
