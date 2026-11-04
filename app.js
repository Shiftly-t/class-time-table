import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
let messageTimeout;
function message(text) {
  $('message').textContent = text;
  clearTimeout(messageTimeout);
  if (text) messageTimeout = setTimeout(() => { $('message').textContent = ''; }, 6000);
}
function showLoggedOut() {
  $('loginPanel').hidden = false;
  $('appPanel').hidden = true;
  $('logout').hidden = true;
  $('password').value = '';
}
function showLoggedIn(profile, user) {
  const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : (user.email || 'ユーザー');
  $('welcomeName').textContent = `ようこそ、${name}さん`;
  $('roleLabel').textContent = profile.role === 'admin' ? '管理者' : '従業員';
  $('loginPanel').hidden = true;
  $('appPanel').hidden = false;
  $('logout').hidden = false;
  $('password').value = '';
}
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('loginForm').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
  } catch {
    message('ログインできません。メールアドレスとパスワードを確認してください。');
  } finally {
    button.disabled = false;
  }
});
$('logout').addEventListener('click', async () => {
  try { await signOut(auth); }
  catch { message('ログアウトに失敗しました。もう一度お試しください。'); }
});
onAuthStateChanged(auth, async user => {
  if (!user) { showLoggedOut(); return; }
  try {
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    if (!profileDoc.exists() || !['admin', 'employee'].includes(profileDoc.data().role)) {
      message('利用者登録がありません。管理者に連絡してください。');
      await signOut(auth);
      return;
    }
    if (auth.currentUser?.uid !== user.uid) return;
    showLoggedIn(profileDoc.data(), user);
  } catch {
    message('利用者情報を読み込めませんでした。通信状態を確認してください。');
    showLoggedOut();
  }
});
