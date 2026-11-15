# 旧実装待ち11ケースへの第4段階対応

実Firebase43ケースは全件NOT_RUN。以下はコード対応の分類で、PASSの記録ではない。6件は制限付き/候補対応、5件は旧版排出や実運用の条件が残る。

|ID|コード状態|残る条件|
|---|---|---|
|AUTH-02|partial|提供された候補の全APIはmaintenanceへ従いowner業務も停止。旧版のin-flight/外部writer停止の実証は未完了。|
|RULE-01|candidate_ready_unverified|独立した直接write拒否フラグで旧allowを狭める生成候補とlocalhost限定12テストを追加。compile/実評価は未検証。|
|RULE-02|partial|旧Webの直接write拒否候補あり。ルールを迂回する旧Admin SDK/旧版の排出確認が残る。|
|COURSE-01|implemented_unverified|本人/代理/締切/非表示/正規コマ/source token/確保済み容量を同じ境界で検証。私有モデルとUI接続を検査。|
|COURSE-03|implemented_unverified|手動講習を共通lockへ接続。親予約との最後の1枠競合、講師2人、版競合、予約所有ID保護を隔離検査。|
|COURSE-04|implemented_with_limits|空の講習登録・締切・状態・空削除を接続。依存データのある期間/コマ変換は未実装として無書込拒否。|
|COURSE-05|implemented_unverified|通常/講習カレンダーと枠を原子的更新。既存確保を保持し、閉校で新規予約を拒否。|
|RESTORE-04|partial|提供候補の停止と小規模完全復元/計画投影は実装。旧版/外部writerの全停止を実環境で確認できていない。|
|OPS-02|partial|停止・読取整合性API・復旧手順あり。配備版の互換性/旧版排出と実切替のリハーサルが残る。|
|OPS-03|partial|新形式小規模復元とQR失効維持を実装。大規模世代復旧・外部writer停止・実復旧は未完了。|
|UI-01|ui_implemented_device_unverified|新APIフォーム/配置/メモ/削除/復元/停止/整合性を隔離UIで検査。実iPad Safariは未検証。|

依存データのある期間変換や旧形式/大規模復元を許可して6件に数えたものではない。未対応操作の明示的な全体拒否を含む。実SDK・最終ルール・実端末・運用リハーサルで確認してから判定する。
