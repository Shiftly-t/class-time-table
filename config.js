
export const firebaseConfig = {
  apiKey: "AIzaSyC-k8hw1MXgU9CiXQgtYn7RBf8Db6QDN-Y",
  authDomain: "shiftly-d02f6.firebaseapp.com",
  projectId: "shiftly-d02f6",
  storageBucket: "shiftly-d02f6.firebasestorage.app",
  messagingSenderId: "85446950632",
  appId: "1:85446950632:web:2d0394a4052c8ac53f935d"
};

// Draft feature: keep disabled until ALL write/restore paths use the server authority.
// See server-candidates/normal-authority/README.md; CRUD rules alone are insufficient.
export const teacherWorkFeatureEnabled = false;

// Staging-only migration switch. Keep false until deployment/integration validation.
export const normalAuthorityApiEnabled = false;
