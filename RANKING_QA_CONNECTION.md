# Ranking QA接続ゲート（未デプロイ）

- 実装候補 ranking-qa-store.mjs は QA project shiftly-t-test / named DB shiftly-qa-v1 のみ許可。Admin SDKの実際の projectId/databaseId getter が利用できるか現行SDKで検証する。失敗時に既定DBへフォールバックしない。
- 既存のQA Functionsの現行ソースが確認できるまでは追加export・firebase deployをしない。過去の 2026-11-19頃の作業ZIPに normal-authority/policy.cjs の effectiveDay / canAssign と calendar.cjs の automaticClosure が存在したが、現行デプロイ内容・勤務コマ対応・enrollment依存・講習の公開条件は未照合。
- server resolver は同一Firestore transactionの読み出しのみを使って、日付・現在の時間割・休校・特別開校・模試・講師勤務・講習・生徒状態を解決する。講習の最終コマ終了後に取得し、日付終了前の編集に対して保存ロックまたは差分連携を用意する。取得済みの日付を無条件に上書きしない。
- captureは終了済み日の前日中のスナップショットを保存、finalizeは日付終了後に確定、欠落時は停止。correctは既存権限APIで確認した変更元・変更前後・役割のみ受理する。ブラウザ向けに公開しない。
- rankingInternalConfig, rankingInternalSnapshots, rankingInternalDays, rankingInternalOperations, rankingInternalAudit, rankingInternalRefresh は全クライアント read/write 禁止。既存のワイルドカード許可も検査。外部APIは集計済みの公開用データのみ。認証・App Check・アクセス制御とバックアップ対象を確認。
- 同一トランザクションで台帳・冪等レシート・監査・再計算要求を保存する。サイズ上限は暫定の400KB JSON、実際のFirestoreサイズ・取引制限と規模試験で検証。監査保持期間・再集計ワーカー・通知・バッジ・公開結果・障害復旧は未実装。
- 本テストは依存を模したFirestoreトランザクションの試験で、実Firebase・SDK・権限・スケジューラ試験ではない。
- 次に必要: 現行QA functions のコード・package.json・firebase.json（対象コードベースとDBの確認用）・Firestoreルール（秘密値なし）。サービスアカウント鍵、環境変数の値、QR暗号鍵、個人データは不要。
