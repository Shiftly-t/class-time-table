import assert from 'node:assert/strict';
import test from 'node:test';
import qa from './qa-firebase-fixture.cjs';
import {qaFunctionNames,resolveFirebaseTarget} from '../production-hosting/firebase-target.js';

const valid = {firebaseConfig:qa.config,qaFirestoreDatabaseId:qa.databaseId};
const production = {firebaseConfig:{projectId:'shiftly-d02f6'}};

test('QA selects the named Firestore database and the expected Functions region', () => {
  const {databaseId,functionsRegion}=resolveFirebaseTarget('qa',valid,qa.siteKey);
  assert.deepEqual({databaseId,functionsRegion},{databaseId:qa.databaseId,functionsRegion:qa.region});
});

test('QA rejects a foreign Firebase project, wrong database, and a mismatched Firebase App ID', () => {
  for (const config of [
    {...valid,firebaseConfig:{...qa.config,projectId:'shiftly-d02f6'}},
    {...valid,qaFirestoreDatabaseId:'(default)'},
    {...valid,qaFirestoreDatabaseId:undefined},
    {...valid,firebaseConfig:{...qa.config,authDomain:'unexpected.firebaseapp.com'}},
    {...valid,firebaseConfig:{...qa.config,appId:'1:987654321000:web:1234abcd'}},
  ]) {
    assert.throws(() => resolveFirebaseTarget('qa',config,qa.siteKey),/接続を停止/);
  }
});

test('QA requires an App Check site key', () => {
  for (const siteKey of [undefined,'','REPLACE_SITE_KEY']) {
    assert.throws(() => resolveFirebaseTarget('qa',valid,siteKey),/接続を停止/);
  }
});

test('a QA configuration cannot accidentally use the default database via another environment', () => {
  for (const environment of ['production','test',undefined]) {
    assert.throws(() => resolveFirebaseTarget(environment,valid,qa.siteKey),/QA用として生成/);
  }
});

test('unconfigured source fails closed and valid production configuration retains its default database', () => {
  assert.throws(() => resolveFirebaseTarget('production',{firebaseConfig:{projectId:'REPLACE_FIREBASE_PROJECT_ID'}},''),/接続設定が必要/);
  assert.throws(() => resolveFirebaseTarget('test',production,''),/本番には接続しません/);
  const {databaseId,functionsRegion}=resolveFirebaseTarget('production',production,'');
  assert.deepEqual({databaseId,functionsRegion},{databaseId:undefined,functionsRegion:qa.region});
});

test('QA and production resolve their own exact callable names', () => {
  const qaTarget=resolveFirebaseTarget('qa',valid,qa.siteKey);
  const productionTarget=resolveFirebaseTarget('production',production,'');
  assert.deepEqual(qaTarget.callableNames,{
    bookingAdmin:'qaBookingAdminApi',bookingPublic:'qaBookingPublicApi',
    normalAuthority:'qaNormalAuthorityApi',seasonalAuthority:'qaSeasonalAuthorityApi',
  });
  assert.deepEqual(productionTarget.callableNames,{
    bookingAdmin:'bookingAdminApi',bookingPublic:'bookingPublicApi',
    normalAuthority:'normalAuthorityApi',seasonalAuthority:'seasonalAuthorityApi',
  });
});

test('QA preflight inventory includes the deletion trigger outside the callable names', () => {
  const {callableNames}=resolveFirebaseTarget('qa',valid,qa.siteKey);
  assert.deepEqual(qaFunctionNames,[...Object.values(callableNames),'qaBookingStudentDeleted']);
  assert.ok(!Object.values(callableNames).includes('qaBookingStudentDeleted'));
});
