# 通常授業のサーバー制御候補（未配備）

このディレクトリは新規に作成した公開可能なコードです。添付された非公開Cloud Functionsソース・秘密情報をコピーしていません。Admin SDK初期化、認証情報、プロジェクト指定、既存関数のエクスポート・デプロイ設定は含みません。

**この候補の追加だけで講師管理を有効化しないでください。** フロントの全更新経路と復元経路の移行、実Firestoreテストが未完了です。現行の機能フラグはfalseのままです。

## 最新の画面接続

`NORMAL_API_MIGRATION_REVIEW_20261113.md`が最新の移行状況です。Web側の`normal-authority-client.js`は`normalAuthorityApi` callableを呼び、`inspect`の保存文書トークン/共有revisionと開始時の画面内容を照合します。通常エディター・個別編集・メモ・勤務管理・通常期間のカレンダーは接続済みですが、生徒・複数日移動・復元等が未移行です。新しい`normalAuthorityApiEnabled`も既定falseです。

## ファイル

- `calendar.cjs`：公開Webアプリの祝日計算をUTCで動かす通常授業用カレンダー。
- `policy.cjs`：勤務可否・通常授業生成・人数制約の純粋ロジック。
- `service.cjs`：Admin Firestore互換インターフェースを注入するトランザクション処理。
- `callable.cjs`：認証済みFirebase callable + App Checkを必須とするラッパー例。
- `build-rules.cjs`：ユーザー提示ルール全文の正規化fixtureから、追加制限を組み込んだ完全なルール候補を生成。
- `firestore.candidate.rules`：生成結果。配備ファイルではない。

## 信頼境界と優先順位

Firebase callableの検証済み`request.auth`・`request.app`だけを渡します。ブラウザから送られたuid/role/appIdは使用不可。毎回トランザクション内で`users`の管理者権限、メンテナンス、`systemConfig/normalAuthority {enabled:true,schemaVersion:1}`を確認します。この設定はAdmin管理でありクライアント書き込み不可です。

コマ別欠席 > 日別臨時出勤/休み > 毎週勤務曜日 > 未設定なら従来どおり全曜日。日別設定の空配列は終日休み、削除は毎週へ戻す意味です。標準4コマ外の授業は、日別の4コマ設定だけでは許可しません。週曜日はUTCのdate-only計算を用い、`todayKey`には必ず日本時間の日付関数を注入します。

`normalAuthorityState/global`を、すべての通常授業変更・勤務設定変更でread/writeします。これにより2管理者の処理は同じrevision上で競合し、Firestoreのトランザクション再試行時に授業・勤務設定・生成授業を読み直します。トランザクション外の読取チェックで代用できません。現在は分かりやすい全体ロックを採用しており、スループットと読取量の実測が必要です。

管理者権限をもつ別のAdmin SDKジョブがこの経路を迂回すれば保証は崩れます。既存Functions・復元・生徒の通常設定・カレンダー操作を含め、すべての生成元更新を移行または停止することが前提です。

## コマンドの契約

`execute({auth,app}, command)`はデータ・変更履歴・通知・冪等receipt・revisionを同時に保存します。呼出元はタイムアウト時に同じrequestIdと完全に同じpayloadで再送します。異なるpayloadに同じIDを使うと拒否します。

### 日別の授業変更

```js
{
  kind: 'day', requestId: 'unique-id', date: '2026-11-17',
  changes: [{
    id: 'lesson-id', expected: null,
    value: {
      studentId: 'student-id', studentName: '生徒', grade: '中1', school: '学校',
      teacherUid: 'teacher-id', teacherName: '講師', date: '2026-11-17',
      start: '17:30', end: '18:25', subject: '数学', status: 'scheduled',
      memo: '', memoUpdatedAt: null, nextDates: []
    }
  }]
}
```

`expected`は保存済み文書を同じサービスの`entryToken`で処理した競合検出トークン（未保存の仮想授業はnull）。認証手段ではありません。信頼できる読取アダプターが返す必要があります。`kind:inspect`の読取APIと画面のアダプターを追加しました。読取後の競合は更新トランザクション内で再検証します。取り消しは`{id,expected,remove:true}`。毎週由来の削除は、その日の変更を取り消して毎週の授業に戻す操作です。戻る結果の勤務可否と人数を検証し、現在有効な親の毎週設定がなければ拒否します。その日だけ中止する場合は`status:'cancelled'`。毎週設定は変更しません。

生成される授業を含む同日の全体に対して人数を検証し、1講師2人を超えるコマを拒否します。非標準時間は区間重複も検証します。日別担当変更は`rec_{studentId}_{regularId}_{date}`の文書だけを保存します。既存の勤務曜日外授業の伝達事項更新・中止は許可し、勤務変更後も既存授業を自動削除しません。既存の人数超過がある日は解消操作が必要です。

日別コマンドは追加の`absences:[{teacherUid,periods:[1,2],expected:null}]`も受け取り、担当振替と欠席を同一トランザクションで保存できます。既存欠席の変更時は`expected`にその文書のトークンを指定します。欠席設定の保存だけでは既存授業は消えません。

上限は1回20変更（授業と欠席の合計）、同日保存文書400、生徒1000、講習200。超えた場合は不完全な計数をせず拒否します。全生徒の毎週設定を読むため通信量は未最適化です。上限の増加は負荷検証後に行うか、共通の生成索引へ移行してください。複数日間の移動は単一コマンドで対応しません。取消＋新配置をクライアントが別々に実行するのではなく、複数日の原子的APIを追加する必要があります。

### 勤務設定変更

```js
{kind:'work', requestId:'unique-id', type:'weekly', teacherUid:'teacher-id',
 expectedVersion:0, values:[1,2,4]}
```

`type:'date'`は`date`と`values:[1,2]`、`type:'absence'`は`date`と欠席コマ配列を指定します。`clear:true`は対象文書削除。共有revisionのexpectedVersionが古い場合は再読込を求めます。設定変更だけでは既存授業・生徒の毎週設定を更新しません。先生には一般的な予定変更通知を同時保存します。

## ルール候補の変更点

新2コレクションは既存スタッフにreadだけを許可し、writeは全クライアントに拒否。共有revision・receiptはread/writeとも拒否。現行の予約保護・b_文書禁止・メンテナンス制限は維持します。

authority無効時の既存コレクション権限は維持。有効時は通常時間割への直接作成/更新/削除（伝達事項も含む）、欠席設定、生徒変更、開校日/休校日/模試変更を拒否します。講習の開始/終了/コマ変更・作成/削除も通常授業生成日を変えるため拒否します。講習の同一期間内の非表示・名称・締切変更、勤務希望、予約用サーバー処理は従来の規則を維持します。講習と通常授業の仕組みを共通化したわけではありません。

旧`tests/fixtures/teacher-work.additions.rules.txt`はCRUDだけの旧案です。**この完全候補と同時に適用しないでください。** Firestoreの複数match/allowはORであり、writeを許可する旧案を重ねるとserver-only境界を壊します。

## 有効化前の必須作業

1. 非公開デプロイリポジトリに候補を取り込み、Admin初期化・JST時計・App Check対応のcallableを接続する。既存本番のエクスポートを上書きしない。
2. 通常エディター、個別編集、メモ、削除、勤務管理、欠席のcallable接続を隔離環境で検証。生徒通常設定の作成/更新/削除、講習期間内のカレンダー変更と履歴復元の信頼できるAPIも追加する。現時点では候補ルールがこれらの未移行操作を安全に拒否する。
3. バックアップを読み取る機能はそのまま。復元は旧クライアント一括書き込みでは拒否される。owner・メンテナンス下で、容量/勤務を全体検証する専用復元APIと予約データの一貫した復元方針が必要。単純にルールを緩めない。
4. 別のdemoプロジェクトのEmulatorで完全ルール候補をコンパイルし、実Admin SDKトランザクションとルール許可/拒否を実行する。本環境では未検証。
5. 隔離stagingで既存データの不正スロット・人数超過・予約との混在を事前集計する。生徒/授業数の限界、App Check、トークン読取の実環境動作、JST日付境界、トランザクション再試行、同時操作と障害時の履歴/通知を実測する。
6. 作業計画とロールバックをレビューし、全経路が移行されてからauthority設定とフロント機能フラグを整合して有効化する。このPRでは実行しない。

これはサーバー制御の実装候補と検証可能な契約を提供するもので、現行Webアプリのすべての書込経路の移行が完了したという意味ではありません。

## 読取とカレンダー契約

`{kind:'inspect',requestId,date}`は`protocolVersion:1,version,entries,absences,calendar`を返します。各recordは`{value,token}`で、timestampは既存バックアップと同じ`__shiftlyType:'timestamp'`形式。仮想授業は保存文書ではないのでentriesに含めず、そのexpectedはnullです。`work:{type,teacherUid,date?}`を指定すると対象勤務設定とversionを返します。読取は文書を変更しません。

`{kind:'calendar',requestId,date,collection,expected,value}`は通常授業期間のみ対応。collectionはschoolClosures/schoolOpenDays/schoolEvents、valueはnote（模試はtitle,start,endも）。削除は`remove:true`。actorと時刻はサーバーが設定します。授業を削除せず、再開校時の人数を検証してrevision/監査/講師通知を同時保存します。講習期間内は未対応として拒否します。

`callable.cjs`の生成結果は非公開の配備リポジトリで`normalAuthorityApi`という名前にエクスポートする想定です。この公開リポジトリには配備設定を加えていません。両フラグは本PRで有効化しません。
