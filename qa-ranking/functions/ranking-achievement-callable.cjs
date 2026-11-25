'use strict';

function createRankingAchievementCallable({ onCall, HttpsError, handle }) {
  if (![onCall, HttpsError, handle].every(value => typeof value === 'function')) {
    throw Error('RANKING_WRAPPER_DEPENDENCIES');
  }
  const messages = {
    RANKING_FORBIDDEN: ['permission-denied', 'この操作を利用できません。'],
    INVALID_ACHIEVEMENT_INPUT: ['invalid-argument', 'バッジ・表彰の入力を確認してください。'],
    RANKING_UNAVAILABLE: ['unavailable', '現在ランキングを利用できません。'],
    RANKING_ACHIEVEMENTS_NOT_ENABLED: ['failed-precondition', 'バッジ・表彰を利用できる状態ではありません。'],
    RANKING_NOT_PUBLISHED: ['failed-precondition', 'ランキングはまだ公開されていません。'],
    RANKING_OPERATION_ID_REUSED: ['already-exists', '操作IDが重複しています。画面を更新して再度操作してください。'],
    RANKING_ALREADY_GRANTED: ['already-exists', '選択したバッジはすでに付与されています。'],
    RANKING_NOT_GRANTED: ['failed-precondition', '選択したバッジは付与されていません。'],
    RANKING_GRANT_TARGET_UNAVAILABLE: ['failed-precondition', 'バッジの公開状態と付与先を確認してください。'],
    RANKING_ACHIEVEMENT_LIMIT: ['resource-exhausted', 'バッジ・表彰の処理件数上限に達しました。']
  };
  return onCall({ region: 'asia-northeast1', enforceAppCheck: true, timeoutSeconds: 60, maxInstances: 3 }, async request => {
    if (!request?.auth?.uid) throw new HttpsError('unauthenticated', 'ログイン情報を確認してください。');
    if (!request.app) throw new HttpsError('permission-denied', 'アプリの確認に失敗しました。');
    try {
      return await handle(request);
    } catch (error) {
      if (Object.hasOwn(messages, error?.message)) throw new HttpsError(...messages[error.message]);
      throw new HttpsError('internal', 'バッジ・表彰を処理できませんでした。');
    }
  });
}

module.exports = { createRankingAchievementCallable };
