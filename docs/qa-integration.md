# Shiftly-T 最終統合検証

基準は `3fab5207fb6a741958295a5f0225fb39549af8a1`。以降のQA修正を含むビルドでは、実際に検証するコミットを記録します。

| 対象 | QAの値 |
| --- | --- |
| Hosting | `https://shiftly-t-test.web.app/` |
| Firebaseプロジェクト | `shiftly-t-test` |
| Firestore | `shiftly-qa-v1` |
| Functions | `asia-northeast1` |
| 試験アカウント | QA専用の `owner`、`admin`、`employee` |

## 接続と試験アカウント

1. Codex Cloud の **Settings → Codex Cloud → Environments** で、今回のタスクの元になった環境設定を開きます。編集権限を持つ担当者が、既存の接続先を保持して `shiftly-t-test.web.app`、`shiftly-t-test.firebaseapp.com`、`asia-northeast1-shiftly-t-test.cloudfunctions.net` をHTTP許可先に追加し、公開します。変更が実行中のタスクに反映されるか確認します。
2. SDKによるログインとApp Checkには、既存の `identitytoolkit.googleapis.com`、`securetoken.googleapis.com`、`firebaseappcheck.googleapis.com`、`recaptchaenterprise.googleapis.com`、`www.gstatic.com` と reCAPTCHA 配信用の許可を使います。CloudのCLIでScheduler・Functions・ログを読む場合は、`cloudscheduler.googleapis.com`、`cloudfunctions.googleapis.com`、`logging.googleapis.com` も追加します。既存のQA Cloud Shellで読み取る場合は、CLI用の通信許可をCodex側に足す必要はありません。
3. Firebase Console左上で **shiftly-t-test** を確認します。**Authentication → Users** の既存QA専用アカウントを再利用します。FirestoreのDB選択欄で **shiftly-qa-v1** を選び、各UIDの `users/{uid}` で `role` が `owner`・`admin`・`employee` と対応することを確認します。試験生徒・授業・講習は架空データを使用します。
4. ブラウザ試験には、QA専用の認証済みセッションか、Vaultで実行環境へ渡した試験アカウントを使います。パスワード、トークン、サービスアカウント鍵はチャット・Git・ログに含めません。Schedulerとログは権限のあるQA Cloud Shellを優先します。新たに読み取り権限を付ける場合はQAプロジェクト内に限定し、Scheduler Viewer、Logs Viewer、Cloud Functions Viewerを用途に応じて付与します。名前付きDBの内部台帳の確認は、閲覧権限を持つQA担当者がFirestore Consoleで行えます。
5. Firebase Consoleの **プロジェクトの設定 → 全般 → マイアプリ** でQAのWebアプリ設定を取得し、**App Check** で同じWebアプリ用のreCAPTCHA Enterprise登録とQAドメインを確認します。App Checkと認可を有効にした状態で検証します。

## QA成果物と接続先の確認

アプリの追跡ファイルは作業ツリーの外に生成し、QA Web SDK設定とQAの公開App Checkサイトキーをその成果物にだけ適用します。次のコマンドは配備せず、検証するコミットからHosting用のファイルを生成します。

```sh
node tools/stage-qa-hosting.mjs \
  --ref QA検証対象のコミットSHA \
  --config QAのWeb設定JSONへのパス \
  --site-key-file QAの公開サイトキーを含むファイルへのパス \
  --out 新規出力ディレクトリ
```

`qa-build.json` にコミットとファイルハッシュを記録します。QA Hostingに既に置かれているファイルとの一致を確認し、差があれば権限のあるQA担当者が同じQAサイトへ対象成果物を配備します。ランキングは固定のQA Hostingオリジンで起動するため、別オリジンのプレビューでは統合判定をしません。Hosting、Functions、Firestore、認証のプロジェクトが一致してからログインします。

- `qaNormalAuthorityApi`、`qaSeasonalAuthorityApi`、`qaBookingAdminApi`、`qaBookingPublicApi`、`qaRankingReadApi`、`qaRankingAchievementApi` の実配信とリージョンを確認します。書き込みの前に、QA Functionsの配備設定・ソースでAdmin SDKが `shiftly-qa-v1` を使用することを照合します。ブラウザ設定だけではFunctions内部のDB選択は判定できません。
- 記録にはコミット、試験ID、ロール、JST時刻、操作の結果、Callable名とエラーコードを使用します。セッションや個人を識別する値は含めません。

## QAの試験順と合格条件

| 試験 | 操作と合格条件 |
| --- | --- |
| 認証・認可 | 3ロールでログインとログアウト。運営だけに「システム管理」「変更履歴」、管理者にも「生徒管理」「講習期間管理」「講習予約管理」。講師は時間割・生徒一覧を閲覧でき、管理側の操作は拒否される。QA試験データに対する認可も確認し、権限外の読み書きが拒否されることを別に記録する。 |
| 通常授業 | 管理者で「時間割」→「時間割を編集」。連続2コマの振替、欠席コマへの移動拒否、取り消し、確定を確認する。講師で当日の変更を確認し、翌週の通常設定が維持されることを確認する。 |
| 季節講習 | 講師が「勤務希望登録」で試験講習のコマを選び提出。管理者が「勤務希望登録・提出状況」で確認し、「講習配置エディター」で仮登録・移動・確定。講師側に確定後の配置が反映される。 |
| 公開QR予約 | 「講習予約管理」で架空の試験生徒のQRを準備。公開予約で試験氏名を入力し、希望提出を1回行う。管理者が確定・公開し、公開予約の再読み込みで反映される。試験用でない予約を操作しない。 |
| ランキング・バッジ | 講師・管理者は期間・部門とプロフィール・表彰履歴を閲覧。運営だけが「バッジ管理」で試験定義の作成・付与・取消を実行できる。管理者・講師への表示と運営のメンテナンス中のアクセスを確認する。 |
| 通知・停止 | 運営の「通知」→「期間を指定して掲載」で短期間の試験告知を登録。別端末の管理者・講師で未読、開封後の既読を確認する。合意済みのQA試験時間に運営がメンテナンスを開始し、管理者・講師の停止と運営機能を確認したら終了する。 |

## 定時集計の調査

過去のQA配備チェックで期待したスケジュールは、JSTの当日23:55に取得、翌00:10に確定、10分ごとに表彰処理です。実際の現在値はQAのSchedulerで確認します。

```sh
gcloud scheduler jobs list --project=shiftly-t-test --location=asia-northeast1 \
  --filter='name~qaRanking' \
  --format='table(name.basename(),state,schedule,timeZone,lastAttemptTime)'
```

1. `qaRankingCaptureDaily`、`qaRankingFinalizeDaily`、`qaRankingProcessAchievements` に対応するジョブについて `ENABLED`、`Asia/Tokyo`、最終実行時刻を確認し、ログから対象日の実行結果を照合します。
2. 翌00:10 JSTの確定時間を過ぎても表示に未確定日がある場合、対象日の `rankingInternalSnapshots/{date}` と `rankingInternalDays/{date}` を名前付きDBで照合します。スナップショットの有無・当日取得時刻と確定台帳の有無・リビジョンを記録します。授業0件・休校日にも確定台帳が必要です。
3. スナップショットがなければ取得の状態、台帳だけがなければ確定の状態を調べます。Logs Explorerで `qarankingcapturedaily` と `qarankingfinalizedaily` のサービスに絞り、対象日の起動時刻・状態・理由を確認します。取得の遅延、停止フラグ、メンテナンス・復元、入力不備と、同日スナップショット欠落を区別します。
4. 集計欠落の調査中はScheduler設定・台帳を変更しません。同日に取得したスナップショットがない日の自動復元は現行設計の対象外なので、現在の時間割から過去実績を埋めず、別途業務判断を記録します。

## 実機追加チェック

- **iPad Safari**。管理者で縦・横・分割表示を順に開きます。「時間割を編集」で連続2コマを指で移動し、直後のタップで選択、再タップで解除できることを確認します。「取り消す」で戻し、タップで移動先を指定する操作も確認します。架空生徒の編集または「伝達事項」で、仮想キーボードを表示したまま保存を1回タップし、保存が1回だけ行われることを確認します。
- **PC・プリンター・別のiPhone**。「現在のQRを印刷」→「QRコードの印刷プレビューを開く」。A4の1・2・4名配置で見切れと余白を確認します。別のiPhoneのカメラで紙面を読み、QAホストを確認してから「参加する」→枠選択→「提出内容を確認」→「希望日時を提出する」を実行し、「希望提出済み」と管理者の確定・公開の反映を確認します。試験印刷物は終了後に廃棄します。
- **iPhone Safariと別端末**。「ランキング」で期間・部門の切替時に表示が重ならず、選択が反映されるか確認します。「プロフィール」「表彰履歴」とバッジ管理の表示権限、QA試験告知の未読から既読への反映、メンテナンス終了後の復帰を確認します。
