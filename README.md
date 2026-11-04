# Shift Manager
GitHub Pages + Firebase Authentication + Cloud Firestore によるシフト管理サイト。

## セットアップ
1. Firebase Consoleでプロジェクト作成。Authentication > Sign-in method でメール/パスワードを有効化。
2. Firestore Databaseを作成し、`firestore.rules` の内容をルールとして公開。
3. FirebaseのWebアプリを登録し、`config.example.js` を `config.js` にコピーして設定値を入力。
4. Authentication > Users で管理者ユーザーを追加し、Firestore の `users/{管理者UID}` に `{ "role": "admin", "name": "管理者" }` を設定。
5. 管理者がFirebase Authenticationで従業員アカウントを作成し、Firestore の `users/{UID}` に `{ "role": "employee", "name": "従業員名" }` を設定。従業員本人がログインして利用。
6. GitHubに `index.html`, `app.js`, `style.css`, `config.js`, `firestore.rules` をアップロード。Settings > Pages > Deploy from a branch > main / (root) を選択。
7. Firebase Authentication > Settings > Authorized domains に `<ユーザー名>.github.io` を追加。

**注意**: `config.js` のFirebase Web APIキーは公開される前提です。アクセス制御はFirestoreルールが担います。管理者権限を持つ `users` ドキュメントはFirebase Consoleからのみ作成してください。

## データモデル
- `users/{uid}`: `name`, `role` (`admin` / `employee`)
- `requests/{uid_YYYY-MM-DD}`: `uid`, `date`, `start`, `end`, `note`
- `shifts/{uid_YYYY-MM-DD}`: `uid`, `date`, `start`, `end`

同じ人の同じ日の希望・確定シフトはそれぞれ1件です。日付はブラウザのローカル日付を使用します。勤務時間は同日内に限定しています。
