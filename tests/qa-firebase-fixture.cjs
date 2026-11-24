const projectId = 'shiftly-t-test';
const databaseId = 'shiftly-qa-v1';
const region = 'asia-northeast1';
const siteKey = 'synthetic-recaptcha-site-key';
const senderId = '123456789012';
const config = {
  projectId,
  authDomain: `${projectId}.firebaseapp.com`,
  apiKey: 'AIza' + 'a'.repeat(35),
  appId: `1:${senderId}:web:1234abcd`,
  messagingSenderId: senderId,
};

const configModule = `export const firebaseConfig = ${JSON.stringify(config)};
export const qaFirestoreDatabaseId = ${JSON.stringify(databaseId)};
export const teacherWorkFeatureEnabled = true, normalAuthorityApiEnabled = true;`;
const bookingConfigModule = `export const bookingAppCheckSiteKey = ${JSON.stringify(siteKey)};`;

module.exports = {projectId,databaseId,region,siteKey,config,configModule,bookingConfigModule};
