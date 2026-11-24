const productionProjectId = 'shiftly-d02f6';
const qaProjectId = 'shiftly-t-test';
const qaDatabaseId = 'shiftly-qa-v1';
const functionsRegion = 'asia-northeast1';
const productionCallableNames = Object.freeze({
  bookingAdmin: 'bookingAdminApi',
  bookingPublic: 'bookingPublicApi',
  normalAuthority: 'normalAuthorityApi',
  seasonalAuthority: 'seasonalAuthorityApi',
});
const qaCallableNames = Object.freeze({
  bookingAdmin: 'qaBookingAdminApi',
  bookingPublic: 'qaBookingPublicApi',
  normalAuthority: 'qaNormalAuthorityApi',
  seasonalAuthority: 'qaSeasonalAuthorityApi',
});
export const qaFunctionNames = Object.freeze([...Object.values(qaCallableNames), 'qaBookingStudentDeleted']);

function configured(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && !value.startsWith('REPLACE_');
}

export function resolveFirebaseTarget(environment, { firebaseConfig, qaFirestoreDatabaseId }, appCheckSiteKey) {
  const projectId = firebaseConfig?.projectId;
  if (environment === 'qa') {
    const senderId = firebaseConfig?.messagingSenderId;
    const appSenderId = /^1:(\d+):web:[a-f0-9]+$/i.exec(firebaseConfig?.appId || '')?.[1];
    if (projectId !== qaProjectId || qaFirestoreDatabaseId !== qaDatabaseId ||
        firebaseConfig.authDomain !== `${qaProjectId}.firebaseapp.com` || !senderId || appSenderId !== senderId ||
        !configured(firebaseConfig.apiKey) || !configured(appCheckSiteKey) ||
        JSON.stringify(firebaseConfig).includes(productionProjectId)) {
      throw new Error('Shiftly-T QA：指定のFirebase設定またはQAデータベースを確認できないため、接続を停止しました。');
    }
    return { databaseId: qaDatabaseId, functionsRegion, callableNames: qaCallableNames };
  }

  if (environment === 'test' && (!configured(projectId) || JSON.stringify(firebaseConfig).includes(productionProjectId))) {
    throw new Error('Shiftly-T TEST：テスト専用Firebase設定が必要です。本番には接続しません。');
  }
  if (projectId === qaProjectId || qaFirestoreDatabaseId) {
    throw new Error('Shiftly-T QA：QA用として生成した画面から開いてください。');
  }
  if (!configured(projectId)) {
    throw new Error('Shiftly-T：Firebaseの接続設定が必要です。');
  }
  return { databaseId: undefined, functionsRegion, callableNames: productionCallableNames };
}

export function firebaseTargetForPage(config, appCheckSiteKey) {
  try {
    return resolveFirebaseTarget(document.documentElement.dataset.shiftlyEnvironment, config, appCheckSiteKey);
  } catch (error) {
    document.body.textContent = error.message;
    throw error;
  }
}
