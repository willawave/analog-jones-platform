/// <reference types="vitest/globals" />
import { TestBed } from '@angular/core/testing';
import { AUTH, AUTH_OPS, AuthOps } from '../shared/firebase-auth.token';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from '../shared/firebase.token';
import { UserService } from './user.service';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

describe('UserService', () => {
  let service: UserService;
  let ops: { [K in keyof FirestoreOps]: ReturnType<typeof vi.fn> };
  let authOps: {
    GoogleAuthProvider: ReturnType<typeof vi.fn>;
    signInWithPopup: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    onAuthStateChanged: ReturnType<typeof vi.fn>;
  };
  let providerInstance: { setCustomParameters: ReturnType<typeof vi.fn> };
  const firestore = { __brand: 'fake-firestore' } as unknown as Firestore;
  const auth = { __brand: 'fake-auth' } as unknown as Auth;

  beforeEach(() => {
    ops = {
      collection: vi.fn((_db, path) => ({ __collection: path })),
      doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
      query: vi.fn((coll, ...constraints) => ({ __query: { coll, constraints } })),
      orderBy: vi.fn((field) => ({ __orderBy: field })),
      documentId: vi.fn(() => '__name__'),
      where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
      limit: vi.fn((n) => ({ __limit: n })),
      getDoc: vi.fn(),
      getDocs: vi.fn(),
      getCountFromServer: vi.fn(),
      addDoc: vi.fn(),
      updateDoc: vi.fn().mockResolvedValue(undefined),
      writeBatch: vi.fn(),
      Timestamp: vi.fn(),
    };

    providerInstance = { setCustomParameters: vi.fn() };
    const ProviderCtor = vi.fn(function (this: typeof providerInstance) {
      Object.assign(this, providerInstance);
    });
    authOps = {
      GoogleAuthProvider: ProviderCtor,
      signInWithPopup: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
      onAuthStateChanged: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        UserService,
        { provide: AUTH, useValue: auth },
        { provide: AUTH_OPS, useValue: authOps as unknown as AuthOps },
        { provide: FIRESTORE, useValue: firestore },
        { provide: FIRESTORE_OPS, useValue: ops as unknown as FirestoreOps },
      ],
    });

    service = TestBed.inject(UserService);
  });

  describe('service injection', () => {
    it('should be created', () => {
      expect(service).toBeInstanceOf(UserService);
    });
  });

  describe('signInWithGoogle', () => {
    it('should construct a GoogleAuthProvider, set the account-prompt param, and return the user', async () => {
      const user = { uid: 'u1', displayName: 'Alice' };
      authOps.signInWithPopup.mockResolvedValueOnce({ user });

      const result = await service.signInWithGoogle();

      expect(authOps.GoogleAuthProvider).toHaveBeenCalledTimes(1);
      expect(providerInstance.setCustomParameters).toHaveBeenCalledWith({
        prompt: 'select_account',
      });
      expect(authOps.signInWithPopup).toHaveBeenCalledWith(auth, expect.any(Object));
      expect(result).toBe(user);
    });

    it('should propagate errors from signInWithPopup', async () => {
      authOps.signInWithPopup.mockRejectedValueOnce(new Error('popup-closed'));

      await expect(service.signInWithGoogle()).rejects.toThrow('popup-closed');
    });
  });

  describe('signOutUser', () => {
    it('should call signOut with the auth handle', async () => {
      await service.signOutUser();
      expect(authOps.signOut).toHaveBeenCalledWith(auth);
    });

    it('should propagate errors from signOut', async () => {
      authOps.signOut.mockRejectedValueOnce(new Error('network'));
      await expect(service.signOutUser()).rejects.toThrow('network');
    });
  });

  describe('listenToAuthState', () => {
    it('should subscribe via onAuthStateChanged and return its unsubscribe function', () => {
      const unsubscribe = vi.fn();
      authOps.onAuthStateChanged.mockReturnValueOnce(unsubscribe);
      const callback = vi.fn();

      const result = service.listenToAuthState(callback);

      expect(authOps.onAuthStateChanged).toHaveBeenCalledWith(auth, callback);
      expect(result).toBe(unsubscribe);
    });
  });

  describe('getUserDoc', () => {
    it('should return the user when the snapshot exists', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'uid1',
        data: () => ({
          avatarUrl: null,
          createdAt: { seconds: 1000, nanoseconds: 0 },
          email: 'alice@example.com',
          name: 'Alice',
          role: 'admin',
        }),
      });

      const result = await service.getUserDoc('uid1');

      expect(ops.doc).toHaveBeenCalledWith(firestore, 'users', 'uid1');
      expect(result).toEqual({
        id: 'uid1',
        avatarUrl: null,
        createdAt: { seconds: 1000, nanoseconds: 0 },
        email: 'alice@example.com',
        name: 'Alice',
        role: 'admin',
      });
    });

    it('should return null when the snapshot does not exist', async () => {
      ops.getDoc.mockResolvedValueOnce({ exists: () => false });

      const result = await service.getUserDoc('missing');

      expect(result).toBeNull();
    });

    it('should propagate getDoc errors', async () => {
      ops.getDoc.mockRejectedValueOnce(new Error('permission-denied'));
      await expect(service.getUserDoc('uid1')).rejects.toThrow('permission-denied');
    });
  });
});
