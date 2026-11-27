// Deterministic Firebase substitute for browser tests. It performs no I/O.
const records = new Map();
const listeners = new Set();
const authListeners = new Set();
const connectionLog = [];
const callLog = [];
const directWrites = [];
const callableHandlers = new Map();
let currentUser = null;
let sequence = 0;

const auth = {
  get currentUser() {
    return currentUser;
  },
};
const pathOf = (parts) =>
  parts
    .map((part) => (typeof part === 'string' ? part : part.path))
    .filter(Boolean)
    .join('/');
const recordId = (path) => path.split('/').at(-1);
function snapshotValue(value) {
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (value === null || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'testTimestamp')) return { toDate: () => new Date(value.testTimestamp) };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotValue(entry)]));
}

const documentSnapshot = (path, value = records.get(path)) => ({
  id: recordId(path),
  exists: () => value !== undefined,
  data: () => snapshotValue(value),
  metadata: { fromCache: false, hasPendingWrites: false },
});

function snapshot(ref) {
  if (ref.type === 'document') return documentSnapshot(ref.path);
  let rows = [...records].filter(
    ([path]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/'),
  );
  for (const constraint of ref.constraints || []) {
    if (constraint.type === 'where') {
      if (constraint.operator !== '==') throw new Error(`Unsupported test operator ${constraint.operator}`);
      rows = rows.filter(([, value]) => value[constraint.field] === constraint.value);
    } else if (constraint.type === 'limit') {
      rows = rows.slice(0, constraint.count);
    }
  }
  return {
    docs: rows.map(([path, value]) => documentSnapshot(path, value)),
    metadata: { hasPendingWrites: false },
  };
}

function publish(listener) {
  queueMicrotask(() => {
    if (listeners.has(listener)) listener.next(snapshot(listener.ref));
  });
}

function failSnapshot(path) {
  const failed = [...listeners].filter((listener) => listener.ref.path === path);
  if (!failed.length) throw new Error(`Missing subscription: ${path}`);
  for (const listener of failed) {
    listeners.delete(listener);
    queueMicrotask(() =>
      listener.error(Object.assign(new Error('Fixture read failed'), { code: 'permission-denied' })),
    );
  }
}

function setRecords(changes) {
  for (const [path, value] of Object.entries(changes)) {
    if (value === null) records.delete(path);
    else records.set(path, structuredClone(value));
  }
  for (const listener of listeners) {
    if (
      Object.keys(changes).some((path) =>
        listener.ref.type === 'document'
          ? listener.ref.path === path
          : path.slice(0, path.lastIndexOf('/')) === listener.ref.path,
      )
    )
      publish(listener);
  }
}

function setUser(uid) {
  currentUser = uid ? { uid, email: `${uid}@example.invalid` } : null;
  const user = currentUser;
  for (const next of authListeners) queueMicrotask(() => next(user));
}

const read = async (ref) => snapshot(ref);

function rejectWrite(...args) {
  directWrites.push(args);
  throw new Error('Unexpected direct Firebase write in the read-only fixture');
}

export function initializeApp({ projectId, authDomain } = {}) {
  connectionLog.push({ method: 'initializeApp', projectId, authDomain });
  return { projectId };
}

export function initializeAppCheck(app) {
  connectionLog.push({ method: 'initializeAppCheck', projectId: app.projectId });
  return {};
}

export class ReCaptchaEnterpriseProvider {}

export function getAuth(app) {
  connectionLog.push({ method: 'getAuth', projectId: app.projectId });
  return auth;
}

export function getFirestore(app, databaseId) {
  connectionLog.push({ method: 'getFirestore', projectId: app.projectId, databaseId });
  return { path: '' };
}

export function getFunctions(app, region) {
  return { projectId: app.projectId, region };
}

export const collection = (...parts) => ({ path: pathOf(parts), type: 'collection' });
export const doc = (first, ...parts) => ({
  path: pathOf([first, ...(parts.length ? parts : [`auto-${++sequence}`])]),
  type: 'document',
});
export const query = (ref, ...constraints) => ({ ...ref, constraints });
export const where = (field, operator, value) => ({ type: 'where', field, operator, value });
export const limit = (count) => ({ type: 'limit', count });
export const orderBy = () => ({ type: 'orderBy' });
export const getDoc = read;
export const getDocs = read;
export const getDocsFromServer = read;
export const setDoc = rejectWrite;
export const updateDoc = rejectWrite;
export const deleteDoc = rejectWrite;
export const writeBatch = rejectWrite;
export const runTransaction = rejectWrite;
export const serverTimestamp = () => new Date();
export const increment = (amount) => ({ amount });
export const arrayUnion = (...values) => ({ values });
export class Timestamp {
  static fromDate(date) {
    return date;
  }
}

export function onAuthStateChanged(_auth, next) {
  authListeners.add(next);
  const user = currentUser;
  queueMicrotask(() => next(user));
  return () => authListeners.delete(next);
}

export async function signInWithEmailAndPassword(_auth, email) {
  setUser(email.split('@')[0]);
  return { user: currentUser };
}

export async function signOut() {
  setUser(null);
}

export function onSnapshot(ref, options, onNext, onError) {
  const listener =
    typeof options === 'function'
      ? { ref, next: options, error: onNext }
      : { ref, next: onNext, error: onError };
  listeners.add(listener);
  publish(listener);
  return () => listeners.delete(listener);
}

export function httpsCallable(functions, name) {
  connectionLog.push({
    method: 'httpsCallable',
    projectId: functions?.projectId,
    region: functions?.region,
    name,
  });
  return async (request) => {
    callLog.push({ name, request });
    const handler = callableHandlers.get(name);
    if (!handler) throw new Error(`Unexpected callable in browser fixture: ${name}`);
    return { data: await handler(request) };
  };
}

export const fixture = {
  setRecords,
  setUser,
  failSnapshot,
  getRecord: (path) => structuredClone(records.get(path)),
  listenCount: () => listeners.size,
  listensTo: (path) => [...listeners].some((listener) => listener.ref.path === path),
  connectionLog,
  callLog,
  directWrites,
  handleCallable: (name, handler) => callableHandlers.set(name, handler),
};
