import { TestBed } from '@angular/core/testing';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from './firebase.token';

describe('FIRESTORE token (no factory)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('FIRESTORE throws when injected without a provider', () => {
    expect(() => TestBed.inject(FIRESTORE)).toThrow();
  });
});

describe('FIRESTORE_OPS token (no factory)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  // No default factory: a default would bundle one Firestore SDK build into
  // every app. Each app provides its own (full SDK in admin-app, lite in
  // public-app), so a missing provider must fail loudly.
  it('throws when injected without a provider', () => {
    expect(() => TestBed.inject(FIRESTORE_OPS)).toThrow();
  });

  it('returns the provided ops', () => {
    const stub = { getDocs: () => Promise.resolve() } as unknown as FirestoreOps;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FIRESTORE_OPS, useValue: stub }] });
    expect(TestBed.inject(FIRESTORE_OPS)).toBe(stub);
  });
});
