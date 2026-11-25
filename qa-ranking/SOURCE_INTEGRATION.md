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
