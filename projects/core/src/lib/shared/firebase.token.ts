import { InjectionToken } from '@angular/core';
// Type-only: this file must not pull a Firestore SDK build into an app's
// bundle. Each app picks its own build (admin-app the full SDK, public-app the
// REST-only `firebase/firestore/lite`) and provides it through the tokens below.
import type {
  addDoc,
  collection,
  doc,
  documentId,
  Firestore,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

export const FIRESTORE = new InjectionToken<Firestore>('Firestore');

export interface FirestoreOps {
  collection: typeof collection;
  doc: typeof doc;
  documentId: typeof documentId;
  query: typeof query;
  orderBy: typeof orderBy;
  where: typeof where;
  limit: typeof limit;
  getDoc: typeof getDoc;
  getDocs: typeof getDocs;
  getCountFromServer: typeof getCountFromServer;
  addDoc: typeof addDoc;
  updateDoc: typeof updateDoc;
  writeBatch: typeof writeBatch;
  // The Timestamp class of the app's own SDK build. The full and lite builds
  // each ship their own class, so `instanceof` only works against this one.
  Timestamp: typeof Timestamp;
}

// No default factory: a factory here would statically import one SDK build
// into every app. Each app provides the ops in its `app.config.ts`.
export const FIRESTORE_OPS = new InjectionToken<FirestoreOps>('FirestoreOps');
