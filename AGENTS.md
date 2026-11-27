# Shiftly-T 開発ルール

- 作業は最新の `main` を起点にした専用ブランチで行い、Pull Request でレビューする。自動作業で `main` へ直接 push・merge しない。
- 画面・操作・業務仕様、`owner`・`admin`・`employee` の権限、メンテナンス時と復元中の表示・操作条件を保つ。認可は Functions と Firestore Security Rules にも依存する。
- 開発・試験では本番 Hosting や Firebase に接続しない。本番のFirestore、Authentication、Functions、Security Rules、IAM、Schedulerを編集しない。試験にはネットワークを遮断したモックか、別途用意した隔離QA環境を使う。本番用の `config.js` とHTMLの環境指定を保つ。
- サービスアカウント鍵、アクセストークン、QRトークン、バックアップ、実利用者のデータをコード・ログ・テストに含めない。Firebase Web設定とApp Checkのサイトキーは公開クライアント設定として扱う。
- ブラウザの配布対象はGitで追跡しているルート直下の `.html`・`.js`・`.css`。配置や参照を変える場合は `.github/workflows/deploy-hosting.yml` と照合し、`npm test` でエントリと依存を検証する。開発文書・テストは `docs/` と `tests/` に置く。
- JavaScript、HTML、CSSは2スペースで整形し、機能ごとに名前と責務を揃える。コメントには業務上の制約や実装上の理由を残す。整形と動作変更はコミットを分ける。
- CSSを整理する際は宣言順、詳細度、メディア条件、代替値を確認し、動的に生成される要素も検索する。使用状況が確定しないコードは残す。
- 変更後に `npm test` を実行する。画面や操作を変更した場合は `npm run test:browser` を両エンジンで実行し、デスクトップ・iPad相当・スマートフォン相当を確認する。失敗理由や未実施の範囲をPull Requestに明記する。既存アサーションの判定条件を緩和しない。

構成と手順は [開発ガイド](docs/development.md) を参照。
