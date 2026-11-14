# 完全分離したFirebase結合テスト構成（提案・未作成）

この文書は準備案。プロジェクト作成、課金紐付け、Blaze変更、サービス有効化、デプロイを実行していない。既存の本番プロジェクトを複製したり、そこへテストデータを入れたりしない。

## 承認を分ける

|ゲート|利用者が確認するもの|確認前に行わないこと|
|---|---|---|
|A：作成|新規project ID、表示名、所有アカウント/組織、リージョン、既存本番と異なること|Firebase/GCPプロジェクト、Firestore DB、Auth/Web Appの作成|
|B：課金|Cloud Functions実試験に必要な請求先、Blaze、予算通知、停止方法、費用目安|プラン変更、請求先リンク、課金サービス有効化|
|C：テスト配備|私有差分レビュー、対象project number、Web App、App Check site key、データ範囲、配備物hash|ルール/Functions/Hosting配備、テストデータ投入、負荷試験|
|D：移行モード|全writer移行と実結合結果、旧端末拒否、rollback可否|機能フラグ有効化。準備ツールはtrueを受理しない|

A〜Dは独立。プロジェクト作成の承認をBlaze変更やデプロイの承認とみなさない。本番移行の承認は今回の対象外。

## 提案リソース

- 表示名例：`Shiftly-T 結合テスト（本番利用禁止）`。project IDは`shiftly-t-it-<一意の短い接尾辞>`、30文字以内。これは提案であり、取得可能性は未確認。
- 本番とは別のproject number/Web App/App ID/Authユーザー/Firestore DB/Functions/Hosting/App Checkアプリ/QR鍵/実行サービスアカウントを使う。組織を共有してもプロジェクト権限・データ・秘密値は共有しない。
- Firestoreは新規のdefault DB、原則Tokyo `asia-northeast1`を候補とし、Consoleで対応可否・位置を確認してから作成。DBロケーションは後で簡単に変更できない。本番DBの実ロケーションはコードだけから断定していない。
- 初期ルールはdeny-by-default。「テストモード」の全開放ルールを使わない。試験対象のルール版を保存・hash化してから配備する。現行ルールの本番からの自動取得/変更はしない。
- FunctionsはWebが使用する`asia-northeast1`、添付packageのNode runtimeと整合するruntimeを確認。booking公開/管理/normalの候補を**同じテストproject**で動かす。minInstances=0、maxInstancesは少数（例2）から開始し、timeout/retry/instance数を試験記録に残す。これは費用上限の保証ではない。
- Firebase AuthenticationはEmail/Passwordの架空アカウントだけ。owner1、admin2、employee2、登録外1を作り、対応するテスト`users/{uid}`を信頼する初期化手段で設定。ロールはWebから変更させない。実在の生徒・講師・保護者の氏名/メールをコピーしない。親のQR予約は既存方式どおりQR＋氏名で、職員Authとは分ける。
- Hostingはそのprojectの`https://<id>.web.app`を候補。別projectのpreview channelだけでは分離にならない。本番GitHub Pagesや本番custom domainへ載せない。Firebase Authの許可ドメインもテストだけ。Analytics、電話認証/SMS、実メール送信、外部通知、実決済は有効にしない。
- Web App Checkは**テストHostingドメイン専用**のreCAPTCHA Enterprise登録。FunctionsのenforceAppCheckと必要なFirestore側enforcementを区別して検査する。App Checkは利用者ロール認可や人数制約の代替ではない。
- 必要なら自動試験専用debug providerのトークンをテストprojectだけに登録し、私有の秘密保管先へ置く。ソース/ログ/QR/公開manifestへ書かず、テスト終了後に取り消す。iPadの最終検査はdebugを外した実providerで実施。自動試験が通っても実provider検査済みとはしない。
- QR鍵は新規テスト用に生成し、テストprojectのSecret Managerへ設定。本番鍵、サービスアカウント鍵、Authトークン、QRトークンを公開Git・チャットへ貼らない。Web API key/site keyは公開設定だが、テスト専用値を使う。
- 私有CI/作業者のIAMはテストprojectだけ。実行サービスアカウントに本番project権限を与えない。プロジェクト名の環境変数だけでは分離を証明できないため、credentialsの権限先と実際のFirebase Admin初期化先も確認する。

## 課金と負荷

Cloud Functionsの実配備はBlaze/請求先が必要になるため、まずBの確認で停止する。Firestore/Authの一部をSparkで準備できても、Functionsを含む結合テスト完了とは呼ばない。課金要件・料金・無料枠は変更され得るので、実行前に公式ドキュメントとConsole表示で再確認する。

予算アラートは自動的な利用停止ではない。少人数の架空データ、段階的な並列数、少数maxInstances、試験時間帯、読取回数の観測、受付停止/試験runner停止を組み合わせる。第2段階候補は広域読取＋global lockを使うため、無料枠内や低遅延をまだ保証できない。20並列から開始し、100並列などの追加負荷は結果と費用を確認して別判断する。

公式確認先：
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/functions/get-started
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/firestore/locations

## ローカル準備ツール（実装済み・外部接続なし）

`test-project.template.json`をGit外へコピーし、**承認後に作成されたテストprojectの値だけ**を埋める。サービスアカウント/鍵/トークンを入れる項目はない。現時点のテンプレートは未設定なので必ず失敗する。

```bash
npm run test:stage3:inventory
node tools/prepare-stage3-site.cjs /tmp/approved-stage3-manifest.json /tmp/shiftly-stage3-preview
```

これはローカルの新規ディレクトリへWebファイルを書くだけ。Firebase CLI、SDK接続、プロジェクト作成、配備設定生成、Hosting公開、プラン変更を行わない。Git内・既存出力先を拒否する。projectId/number/appId/authDomain/bucket/region/origin、API key/site keyの本番流用、両フラグfalseを点検する。3入口に実行時ガードとTEST表示を挿入し、SDK初期化前に構成・origin・フラグの差し替えを拒否する。

出力には公開Web設定が含まれるが、私有Functions/QR鍵/サービスアカウントは含まれない。`LOCAL_PREPARATION.json`のhashを配備対象記録に使う。安全ガードは悪意ある配備者や誤ったIAMを防ぐ権限境界ではない。承認manifestそのものとConsoleのWeb App設定の一致も人が確認する。

バックアップはFirestore内で管理するため、この試験のためにCloud Storageを有効にする必要はない。ConsoleのWeb設定にstorageBucketがない場合はmanifestからその項目を省略できる。指定する場合は同じテストproject名だけを受理する。

このツールは準備用で両フラグを有効化しない。フラグfalseのWebには旧writerが残るので、新ルールへ切替済みの環境では対応する操作が停止する。新APIの実結合はまず私有runnerで行い、全writer移行後に別途レビューしたテスト配備物でのみ移行モードを検査する。
