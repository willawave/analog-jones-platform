import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { FIRESTORE_OPS, FirestoreOps } from './firebase.token';
import { ReadUnavailableError, TransferCacheService, withDeadline } from './transfer-state.helpers';

// A stand-in for the other SDK build's Timestamp: same shape, different class.
class OtherBuildTimestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
}

function configure(
  platform: 'server' | 'browser',
  TimestampClass: unknown = Timestamp,
): TransferCacheService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: FIRESTORE_OPS,
        useValue: { Timestamp: TimestampClass } as unknown as FirestoreOps,
      },
    ],
  });
  return TestBed.inject(TransferCacheService);
}

// What the SDK throws when a request never got an answer.
const networkError = () => Object.assign(new Error('Request failed'), { code: 'unknown' });
const deniedError = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

describe('TransferCacheService (server)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('runs the fetcher and writes the result to TransferState', async () => {
    const svc = configure('server');
    const state = TestBed.inject(TransferState);
    const fetcher = vi.fn().mockResolvedValue({ a: 1 });

    const result = await svc.cached('k1', fetcher);

    expect(result).toEqual({ a: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // serialized payload available for transfer
    const serialized = state.toJson();
    expect(serialized).toContain('aj:k1');
  });

  it('serializes Timestamp instances into a tagged plain object', async () => {
    const svc = configure('server');
    const state = TestBed.inject(TransferState);
    const ts = new Timestamp(1700000000, 500);
    await svc.cached('k-ts', async () => ({ at: ts, nested: [{ at: ts }] }));

    const json = JSON.parse(state.toJson());
    const stored = json['aj:k-ts'];
    expect(stored.at).toEqual({ __ts__: true, seconds: 1700000000, nanoseconds: 500 });
    expect(stored.nested[0].at).toEqual({ __ts__: true, seconds: 1700000000, nanoseconds: 500 });
  });

  it('returns the fetched result even when fetcher returns a primitive or null', async () => {
    const svc = configure('server');
    const a = await svc.cached('p1', async () => 42 as unknown as object);
    const b = await svc.cached('p2', async () => null as unknown as object);
    expect(a).toBe(42);
    expect(b).toBeNull();
  });

  it('propagates fetcher errors on the server', async () => {
    const svc = configure('server');
    const err = new Error('boom');
    await expect(svc.cached('k-err', () => Promise.reject(err))).rejects.toBe(err);
  });

  it("serializes the provided build's Timestamp class, not the full SDK's", async () => {
    const svc = configure('server', OtherBuildTimestamp);
    const state = TestBed.inject(TransferState);
    await svc.cached('k-other', async () => ({
      at: new OtherBuildTimestamp(1700000000, 500),
    }));

    const stored = JSON.parse(state.toJson())['aj:k-other'];
    expect(stored.at).toEqual({ __ts__: true, seconds: 1700000000, nanoseconds: 500 });
  });

  it('retries on the server when the request got no answer', async () => {
    const svc = configure('server');
    const fetcher = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ a: 1 });

    await expect(svc.cached('k-retry', fetcher)).resolves.toEqual({ a: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  describe('read timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('rejects a server read that has not answered after 10 seconds', async () => {
      const svc = configure('server');
      const state = TestBed.inject(TransferState);
      const never = new Promise<object>(() => {});

      const pending = svc.cached('k-hang', () => never);
      const outcome = expect(pending).rejects.toBeInstanceOf(ReadUnavailableError);
      await vi.advanceTimersByTimeAsync(10_000);

      await outcome;
      expect(state.toJson()).not.toContain('aj:k-hang');
    });

    it('stops retrying for a server render that has already given up', async () => {
      const svc = configure('server');
      // Each attempt fails after 6s with no answer: the second is in flight when
      // the 10s limit ends the render, and a third must not be issued after it.
      const fetcher = vi.fn(
        () => new Promise<object>((_, reject) => setTimeout(() => reject(networkError()), 6_000)),
      );

      const outcome = svc.cached('k-abandoned', fetcher).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await outcome).toBeInstanceOf(ReadUnavailableError);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('does not time out a server read that answers in time', async () => {
      const svc = configure('server');
      const fetcher = () =>
        new Promise<object>((resolve) => setTimeout(() => resolve({ ok: true }), 9_000));

      const pending = svc.cached('k-slow', fetcher);
      await vi.advanceTimersByTimeAsync(9_000);

      await expect(pending).resolves.toEqual({ ok: true });
    });
  });
});

describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes through a read that settles before the deadline', async () => {
    const read = new Promise<string>((resolve) => setTimeout(() => resolve('data'), 500));

    const bounded = withDeadline(read, 1_000);
    await vi.advanceTimersByTimeAsync(500);

    await expect(bounded).resolves.toBe('data');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes through the read's own rejection", async () => {
    const denied = deniedError();

    await expect(withDeadline(Promise.reject(denied), 1_000)).rejects.toBe(denied);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a retryable deadline-exceeded error when the read never answers', async () => {
    const bounded = withDeadline(new Promise<string>(() => {}), 1_000);
    const outcome = bounded.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);

    const error = (await outcome) as Error & { code: string };
    expect(error.code).toBe('deadline-exceeded');
    expect(error.message).toContain('1000 ms');
  });

  it('makes a hung read retryable through cached()', async () => {
    const svc = configure('browser');
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => withDeadline(new Promise<object>(() => {}), 30_000))
      .mockResolvedValueOnce({ v: 'after-hang' });

    const pending = svc.cached('k-hung', fetcher);
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ v: 'after-hang' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('TransferCacheService (browser)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('hydrates from TransferState, revives Timestamps, and removes the key', async () => {
    const svc = configure('browser');
    const state = TestBed.inject(TransferState);
    // Simulate SSR-transferred payload
    const key = { toString: () => 'aj:k-hydrate' } as unknown as Parameters<
      TransferState['set']
    >[0];
    state.set(key, {
      at: { __ts__: true, seconds: 10, nanoseconds: 20 },
      list: [{ __ts__: true, seconds: 1, nanoseconds: 2 }],
      name: 'x',
    } as never);

    const fetcher = vi.fn();
    const result = (await svc.cached('k-hydrate', fetcher)) as {
      at: Timestamp;
      list: Timestamp[];
      name: string;
    };

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.at).toBeInstanceOf(Timestamp);
    expect(result.at.seconds).toBe(10);
    expect(result.at.nanoseconds).toBe(20);
    expect(result.list[0]).toBeInstanceOf(Timestamp);
    expect(result.name).toBe('x');
    expect(state.hasKey(key)).toBe(false);
  });

  it('memoizes hydrated values so a second call does not re-read TransferState', async () => {
    const svc = configure('browser');
    const state = TestBed.inject(TransferState);
    const key = { toString: () => 'aj:k-memo' } as unknown as Parameters<TransferState['set']>[0];
    state.set(key, { v: 1 } as never);

    const first = await svc.cached('k-memo', async () => ({ v: 999 }));
    const second = await svc.cached('k-memo', async () => ({ v: 999 }));

    expect(first).toEqual({ v: 1 });
    expect(second).toBe(first);
  });

  it('falls back to the fetcher when no TransferState entry exists and memoizes the result', async () => {
    const svc = configure('browser');
    const fetcher = vi.fn().mockResolvedValue({ v: 'fresh' });

    const a = await svc.cached('k-miss', fetcher);
    const b = await svc.cached('k-miss', fetcher);

    expect(a).toEqual({ v: 'fresh' });
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not confuse plain objects that happen to share Timestamp-shaped keys without the tag', async () => {
    const svc = configure('browser');
    const result = (await svc.cached('k-shape', async () => ({
      seconds: 5,
      nanoseconds: 6,
    }))) as { seconds: number; nanoseconds: number };
    expect(result).toEqual({ seconds: 5, nanoseconds: 6 });
    expect((result as unknown) instanceof Timestamp).toBe(false);
  });

  it('propagates fetcher errors and does not memoize the rejection', async () => {
    const svc = configure('browser');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce({ ok: true });

    await expect(svc.cached('k-err', fetcher)).rejects.toThrow('nope');
    const retry = await svc.cached('k-err', fetcher);
    expect(retry).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries when the request got no answer, and memoizes the retry result', async () => {
    const svc = configure('browser');
    const fetcher = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ v: 1 });

    const a = await svc.cached('k-net', fetcher);
    const b = await svc.cached('k-net', fetcher);

    expect(a).toEqual({ v: 1 });
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry or relabel an uncoded TypeError, which is a bug in the fetcher', async () => {
    const svc = configure('browser');
    const bug = new TypeError("Cannot read properties of undefined (reading 'docs')");
    const fetcher = vi.fn().mockRejectedValue(bug);

    await expect(svc.cached('k-type', fetcher)).rejects.toBe(bug);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the third attempt: hang, then the failure that drops the connection, then a fresh one', async () => {
    const svc = configure('browser');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('no answer'), { code: 'deadline-exceeded' }))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ v: 3 });

    await expect(svc.cached('k-third', fetcher)).resolves.toEqual({ v: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('gives up after three attempts with a message fit to show the visitor', async () => {
    const svc = configure('browser');
    const last = networkError();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(last);

    const error = await svc.cached('k-down', fetcher).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReadUnavailableError);
    expect((error as Error).message).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
    expect((error as Error).cause).toBe(last);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('passes through a real answer that arrives on the retry', async () => {
    const svc = configure('browser');
    const denied = deniedError();
    const fetcher = vi.fn().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(denied);

    await expect(svc.cached('k-then-denied', fetcher)).rejects.toBe(denied);
  });

  it('does not retry an error that is a real answer', async () => {
    const svc = configure('browser');
    const fetcher = vi.fn().mockRejectedValue(deniedError());

    await expect(svc.cached('k-denied', fetcher)).rejects.toThrow('denied');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("revives dates as the provided build's Timestamp class", async () => {
    const svc = configure('browser', OtherBuildTimestamp);
    const state = TestBed.inject(TransferState);
    const key = { toString: () => 'aj:k-other' } as unknown as Parameters<TransferState['set']>[0];
    state.set(key, { at: { __ts__: true, seconds: 3, nanoseconds: 4 } } as never);

    const result = (await svc.cached('k-other', vi.fn())) as { at: OtherBuildTimestamp };

    expect(result.at).toBeInstanceOf(OtherBuildTimestamp);
    expect(result.at.seconds).toBe(3);
    expect(result.at.nanoseconds).toBe(4);
  });

  it('handles null and array payloads through the revive path', async () => {
    const svc = configure('browser');
    const state = TestBed.inject(TransferState);
    const nullKey = { toString: () => 'aj:k-null' } as unknown as Parameters<
      TransferState['set']
    >[0];
    const arrKey = { toString: () => 'aj:k-arr' } as unknown as Parameters<TransferState['set']>[0];
    state.set(nullKey, null as never);
    state.set(arrKey, [{ __ts__: true, seconds: 7, nanoseconds: 8 }, { plain: true }] as never);

    const nullResult = await svc.cached('k-null', async () => ({ shouldNot: 'run' }));
    const arrResult = (await svc.cached('k-arr', async () => [])) as unknown as [
      Timestamp,
      { plain: true },
    ];

    expect(nullResult).toBeNull();
    expect(arrResult[0]).toBeInstanceOf(Timestamp);
    expect(arrResult[0].seconds).toBe(7);
    expect(arrResult[1]).toEqual({ plain: true });
  });
});
