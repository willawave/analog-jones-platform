import { initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  documentId,
  getCount,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore/lite';
import { type FirestoreOps, withDeadline } from '@aj/core';
import { environment } from '../environments/environment';

const app = initializeApp(environment.firebaseConfig);

// public-app only does one-shot reads, so it uses the REST-only "lite" build:
// every read is an ordinary HTTPS request. The full SDK reads over one
// long-lived streaming connection that it keeps open between reads; when a
// phone dropped that connection while asleep, the next in-app read waited
// (skeleton cards for 30s+) until the browser gave up on it. With no stream
// there is nothing to go stale. Used for SSR too, so both sides share one
// Timestamp class. Keep `firebase/firestore` (full build) value imports out of
// files public-app loads; `pnpm check:public-bundle` enforces it.
export const firestore = getFirestore(app);

if (environment.useEmulators) {
  connectFirestoreEmulator(firestore, 'localhost', 8080);
}

function readOnly(): never {
  throw new Error('public-app is read-only: Firestore writes are not available.');
}

// A REST read has no time limit of its own. One sent into a connection that
// died silently would sit there until the browser noticed, which measured at
// over two minutes; the streaming SDK it replaces gave up after 45s. A read
// with no answer in this long is failed so `TransferCacheService` retries it.
// It is a limit on the whole response, so it is generous: the archive list is
// about 780 kB and must still finish on a slow connection.
const READ_DEADLINE_MS = 30_000;

const bounded =
  <A extends unknown[], R>(read: (...args: A) => Promise<R>) =>
  (...args: A): Promise<R> =>
    withDeadline(read(...args), READ_DEADLINE_MS);

// The lite functions take and return the lite build's own classes, which are
// the same shapes as the full build's under different declarations, hence the
// cast. `satisfies` keeps the key list checked against `FirestoreOps`.
export const firestoreOps = {
  collection,
  doc,
  documentId,
  query,
  orderBy,
  where,
  limit,
  getDoc: bounded(getDoc),
  getDocs: bounded(getDocs),
  getCountFromServer: bounded(getCount),
  addDoc: readOnly,
  updateDoc: readOnly,
  writeBatch: readOnly,
  Timestamp,
} satisfies Record<keyof FirestoreOps, unknown> as unknown as FirestoreOps;
