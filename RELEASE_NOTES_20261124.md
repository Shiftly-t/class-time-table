# Shiftly-T production Web release candidate — 2026-11-24

> **過去の開発記録です。** 現行の本番構成やデプロイ手順と異なる場合があります。[README](README.md) と [開発ガイド](docs/development.md) を参照し、以下の手順をそのまま本番環境に適用しないでください。


Status: **NOT DEPLOYED**. This branch/PR is a staged release candidate only; no production changes are made by opening the PR.

- Source: QA-verified front-end under `production-hosting/` at `ca7af07a7cf38cd6fb32add2c5ffc94d97296f2f`.
- Destination: GitHub Pages root assets based on main `ae9250b2a90946297399ff755330b2fcdd922d98`.
- Preserve original production Firebase Web App config and production reCAPTCHA Enterprise site key. Do not ship the QA templates as `config.js` / `booking-config.js`.
- Production runtime flags: `teacherWorkFeatureEnabled=true`, `normalAuthorityApiEnabled=true`, `qaFirestoreDatabaseId=''`.
- No automated QA data import, Firestore Rules update, Functions deployment, or database migration is included.

**Release gates (required before merge/deploy):**
1. Confirm current production Cloud Functions `bookingAdminApi`, `bookingPublicApi`, `normalAuthorityApi`, `seasonalAuthorityApi` exist in region `asia-northeast1` and implement the source's expected contracts (including App Check/role gates).
2. Confirm production coordination flags and Firestore rules are compatible; do not copy QA Rules or data.
3. Create and verify a **production** backup of the actual Firestore DB; establish rollback for the website and Cloud Functions.
4. Run the production preflight, publish only approved root assets, then smoke-test owner/admin/employee authentication, normal lessons, seasonal booking, and backup controls.

Manual QA checks reported: login/display, normal lessons, 2 booking wishes consuming capacity 2, third wish refused, no extra booking created. Booking publishing and concurrent-server conflict paths were not fully tested.

Rollback: restore the preceding root asset commit `ae9250b2a90946297399ff755330b2fcdd922d98` only after confirming the Pages deployment source/branch, then smoke-test the restored website. Never restore the QA Firestore database into production.
