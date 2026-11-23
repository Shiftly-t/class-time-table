# Shiftly-T 連携機能の監査資料採取

`collect-coordination-evidence.sh` は Cloud Shell で、指定したプロジェクトとリージョンの Hosting、Firestore、Functions、Cloud Run、Cloud Build、Cloud Logging の証跡をまとめて採取します。対象の Firestore は `(default)` です。クラウド操作は設定とログの取得、および指定時の Cloud Storage からのダウンロードです。出力先は実行ディレクトリ内の新規ローカルディレクトリです。

## 実行

対象プロジェクトに対する既存の読み取り権限を持つアカウントで Cloud Shell を開きます。Bash、`gcloud`、`jq`、`curl`、`sha256sum` が必要です。監査で指定されたコミットSHAのスクリプトを一時ディレクトリへ取得し、提供された SHA-256 と照合してから実行します。引数は以下の順です。

```bash
bash ./collect-coordination-evidence.sh \
  PROJECT_ID REGION BOOKING_ADMIN_REVISION SEASONAL_AUTHORITY_REVISION \
  FROM_UTC TO_UTC --download-source
```

`FROM_UTC` と `TO_UTC` は `YYYY-MM-DDTHH:MM:SSZ` 形式です。開始時刻を含み、終了時刻を含まない範囲で検索します。`--download-source` は、障害時のコンテナイメージとビルドのダイジェストが一致し、ソースの Storage オブジェクト世代が確認できた場合に、原本をローカルに保存します。この引数を省くとソースZIPのダウンロードを省略できます。リビジョンが現行と異なる場合は現在のビルドのリージョン、判明しなければ指定リージョンでイメージダイジェストを検索します。

一部の情報を取得できない場合、採取できた結果と `share-review/unavailable.txt` を確認します。トレース付きのアプリログや所定の構造化フィールドが記録されていない場合は、操作名やエラーコードが空になります。Functionsの一覧は指定リージョンの配備情報です。別リージョン・外部ジョブを含む全書き込み経路の停止、データ移行、台帳の整合性は別途確認が必要です。

## 監査への共有

出力された `shiftly-coordination.*` ディレクトリから、必要なファイルだけを Codex の監査スレッドへ渡します。

| 出力 | 共有の扱い |
|---|---|
| `share-review/incident-requests.json`、`incident-app-summary.json` | 応答時刻、リビジョン、操作名・コードなどを絞り込んだ要約です。原因照合に使います。 |
| `share-review/coordination.json`、`maintenance.json`、`restore-job.json`、`firestore-rules-release.json`、`hosting-release.json` | 制御状態と公開版の識別情報です。監査に必要な範囲を確認して共有します。 |
| `share-review/functions.json`、`function-*.json`、`service-*.json`、リビジョン・ビルド・ハッシュのファイル、`unavailable.txt` | 配備情報です。非公開のソース保存先などがある場合は共有前に伏せます。 |
| `private/incident-traces.json` | トレース識別子を含みます。Cloud Shell内での照合に使います。 |
| `private/firestore-rules-source.json` と `private/*.zip` | セキュリティルールの全文と配備ソース原本です。機密性を確認したうえで、原因の特定に必要な箇所だけを個別に共有します。 |

GitHubには採取結果を掲載せず、監査スレッドへ共有する際も認証ヘッダー、トークン、署名付きURL、環境変数の値、ログ本文、個人データ、バックアップ本体は除外します。ログ要約で理由が特定できない場合は、Cloud Loggingの既存ログから操作名と伏字済みの理由だけを抜き出します。
