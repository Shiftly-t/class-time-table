# Shiftly-T 2026-11-12 — Firestoreルール反映とテスト手順

## 重要：mainへマージする前に

このブランチには管理者用通常授業エディター、講師のコマ別欠席、講習の非表示管理が含まれます。**FirestoreのセキュリティルールはGitHub Pagesのデプロイでは自動更新されません。** Firebase Consoleで既存ルールに安全に統合しない限り、コマ別欠席の読み取り・保存が拒否され、エディターの確定ボタンが使用できません。

- 変更するFirestoreデータ
  - `teacherDayAbsences/{YYYY-MM-DD}_{teacherUid}`（新規）
  - `timetableEntries/{lessonId}`：その日の担当振替のみ。既存の `regularId` を保持
  - `specialCourses/{courseId}`：`archived: boolean` を追加（旧データは未設定＝表示）
  - 既存の `auditLogs`、`notifications` に変更履歴・通知を記録
- **変更しないデータ：`schoolStudents/{studentId}.regularSlots`（毎週の通常授業）**
- 講習非表示は期間判定を変更しない（過去の授業・勤務希望・予約データを削除しない）。

## 新しいコレクションへのルール（既存の `service cloud.firestore` → `match /databases/{database}/documents` の内側）

以下は追加ルールです。既存のルール全文を置き換えないでください。

```javascript
function shiftlyIsRegistered() {
  return request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid));
}

function shiftlyIsManager() {
  return shiftlyIsRegistered()
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role
       in ['owner', 'admin'];
}

match /teacherDayAbsences/{absenceId} {
  allow read: if shiftlyIsRegistered();

  allow create, update: if shiftlyIsManager()
    && request.resource.data.keys().hasOnly([
      'date', 'teacherUid', 'absentPeriods', 'updatedBy', 'updatedAt'
    ])
    && request.resource.data.keys().hasAll([
      'date', 'teacherUid', 'absentPeriods', 'updatedBy', 'updatedAt'
    ])
    && request.resource.data.date is string
    && request.resource.data.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    && request.resource.data.teacherUid is string
    && request.resource.data.teacherUid.size() > 0
    && absenceId == request.resource.data.date + '_' + request.resource.data.teacherUid
    && request.resource.data.absentPeriods is list
    && request.resource.data.absentPeriods.size() <= 4
    && request.resource.data.absentPeriods.hasOnly([1, 2, 3, 4])
    && request.resource.data.updatedBy == request.auth.uid
    && request.resource.data.updatedAt == request.time;

  allow delete: if shiftlyIsManager();
}
```

**重複する関数名が既存ルールにある場合**は関数名を変更するか既存の `isAdmin()` / `signedIn()` を再利用してください。管理者認証が曖昧な `request.auth != null` だけの書き込みルールにはしないでください。

## 既存 `specialCourses` ルールの確認

保存データの検証で許可フィールドを列挙している場合、`archived`（boolean）を追加してください。既存の `startDate` / `endDate` / `periods` / `type` / `name` / `availabilityDeadline` を維持してください。講習の表示／非表示は管理者（`admin` または `owner`）だけが書き換え可能としてください。

可能なら講師の `teacherAvailability` 書き込みルールにも、親講習 `archived != true` のときだけ登録可能な条件を入れてください（既存の管理者例外を維持）。

## 動作確認（テストデータで実施）

1. 管理者で「講習期間管理」→終了済み講習を非表示にし、「非表示一覧」に移ったか確認する。
2. 同講習が講師の勤務希望の選択欄と管理者の講習配置エディターの選択欄から消えることを確認する。非表示解除後は再表示、元の勤務希望と授業が残ることを確認する。
3. 各講習に `2026年度 冬期講習` のような年度が表示されることを確認する。
4. 勤務希望画面の上部に重複した「提出状況・締切」カードがなく、選択した講習のカード内に締切／受付状態／提出状態が強調されていることを確認する。
5. 管理者の「授業管理」から通常授業エディターを開き、講師Aの3・4限だけ欠席にする。
6. 3・4限が黒くなり、他の講師から黒い枠にドラッグできないことを確認する。黒い枠の既存授業は他の講師へ移動できることを確認する。
7. iPad Safariでドラッグ、タップして移動、取り消し、確定が使えることを確認する。
8. 担当上限（講師1人につき同時刻2人）の超過が防止されることを確認する。
9. 未振替が残る場合は確認警告が出ることを確認し、確定後の講師時間割で該当授業が「⚠ 担当調整中・要振替」と表示されることを確認する。
10. 変更確定後、元の講師の時間割から移動した授業が消え、新しい講師に表示されることを確認する。
11. 翌週の授業が**元の毎週設定どおり**に自動表示されること、生徒管理の通常授業設定が変わらないことを確認する。
12. Firestoreの `auditLogs` と通知が作成されることを確認する。

## 注意事項

- 既存の `timetableEntries` の保存許可条件に `regularId` が必要です（アプリは既存の形式で日別上書きを作成します）。以前の通常授業保存機能が動作しているなら同じ形式です。
- 監査ログと通知を同一バッチで保存します。いずれかに書き込み権限がない場合は**一括で保存に失敗**します。
- 現時点ではFirebase実環境の画面操作・Firestoreルールのデプロイは行っていません。
- 通常授業エディターの移動は**同じ日付・同じ時間帯の他講師への担当振替**です。授業時間・教科・生徒欠席の変更は従来の詳細編集で行います。
- この実装は本番導入前の開発版です。利用者によるiPad動作確認とFirestoreルールの統合後にのみmainへマージしてください。
