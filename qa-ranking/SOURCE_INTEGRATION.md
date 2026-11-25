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
