import {
  inject,
  Injectable,
  makeStateKey,
  PendingTasks,
  PLATFORM_ID,
  TransferState,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import type { Timestamp } from 'firebase/firestore';
import { FIRESTORE_OPS } from './firebase.token';

const TS_TAG = '__ts__';

// How long a server render waits on one cached read (all attempts together).
// The streaming SDK used to give up on an unreachable backend after 10s; a
// plain REST request has no such limit and could otherwise hold the response
// for minutes.
const SERVER_READ_TIMEOUT_MS = 10_000;

// A read is tried this many times before the visitor sees an error. Three, not
// two: when a connection has died silently, the first attempt hangs until its
// deadline, the second is what makes the browser notice and drop the
// connection, and the third goes out on a fresh one.
const READ_ATTEMPTS = 3;

// Error codes that mean "the request did not get an answer", as opposed to an
// answer we should respect (permission-denied, not-found, ...). `unknown` is
// what the REST build reports when `fetch` itself fails.
const TRANSIENT_CODES = new Set([
  'unknown',
  'unavailable',
  'deadline-exceeded',
  'internal',
  'aborted',
  'cancelled',
]);

/**
 * Bound a read: if it has not settled after `ms`, reject with a
 * `deadline-exceeded` error (which `TransferCacheService` treats as "no answer"
 * and retries). A plain REST request has no time limit of its own, so a read
 * sent into a silently dead connection would otherwise leave skeleton cards up
 * for as long as the browser takes to notice, which can be minutes. The
 * abandoned request is left to fail in the background; the SDK offers no way to
 * abort it.
 */
export function withDeadline<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`Read got no answer in ${ms} ms`), {
            code: 'deadline-exceeded',
          }),
        ),
      ms,
    );
  });
  return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
}

/**
 * A read that got no answer, even after retrying. The stores show an error's
 * message to the visitor as is, and the SDK's own text for this case is not fit
 * for that ("Request failed with error: undefined"). The original is on `cause`.
 */
export class ReadUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the server. Check your connection and try again.', { cause });
    this.name = 'ReadUnavailableError';
  }
}

// Only coded SDK errors count. A bare TypeError is not treated as a network
// failure: both SDK builds wrap those in a coded error, so an uncoded one is a
// bug in the fetcher, and retrying it would hide the bug behind a "could not
// reach the server" message.
function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

function replaceTimestamps(value: unknown, TimestampClass: typeof Timestamp): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof TimestampClass) {
    return { [TS_TAG]: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map((v) => replaceTimestamps(v, TimestampClass));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = replaceTimestamps(v, TimestampClass);
  }
  return out;
}

function reviveTimestamps(value: unknown, TimestampClass: typeof Timestamp): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => reviveTimestamps(v, TimestampClass));
  const obj = value as Record<string, unknown>;
  if (
    obj[TS_TAG] === true &&
    typeof obj['seconds'] === 'number' &&
    typeof obj['nanoseconds'] === 'number'
  ) {
    return new TimestampClass(obj['seconds'] as number, obj['nanoseconds'] as number);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = reviveTimestamps(v, TimestampClass);
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class TransferCacheService {
  private readonly transferState = inject(TransferState);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly ops = inject(FIRESTORE_OPS);
  private readonly isServer = isPlatformServer(inject(PLATFORM_ID));
  private readonly memo = new Map<string, unknown>();

  async cached<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { memoize?: boolean },
  ): Promise<T> {
    const memoize = options?.memoize !== false;
    const stateKey = makeStateKey<unknown>(`aj:${key}`);

    if (this.isServer) {
      // Firebase SDK uses raw fetch (not HttpClient), so its promises don't
      // register with Angular's stability tracking. Without an explicit pending
      // task, SSR can serialize before the fetcher resolves and the
      // transfer-state key is never written — forcing the browser to re-fetch.
      const removeTask = this.pendingTasks.add();
      // Once the render has stopped waiting, stop issuing retries for it.
      let waiting = true;
      try {
        const result = await this.withServerTimeout(this.withRetry(fetcher, () => waiting));
        this.transferState.set(stateKey, replaceTimestamps(result, this.ops.Timestamp));
        return result;
      } finally {
        waiting = false;
        removeTask();
      }
    }

    if (memoize && this.memo.has(key)) {
      return this.memo.get(key) as T;
    }

    if (this.transferState.hasKey(stateKey)) {
      const raw = this.transferState.get(stateKey, null);
      this.transferState.remove(stateKey);
      const revived = reviveTimestamps(raw, this.ops.Timestamp) as T;
      if (memoize) this.memo.set(key, revived);
      return revived;
    }

    const result = await this.withRetry(fetcher);
    if (memoize) this.memo.set(key, result);
    return result;
  }

  /**
   * Run a read, retrying while the request gets no answer (up to
   * `READ_ATTEMPTS` tries). public-app reads are plain REST requests, which the
   * SDK does not retry; a connection the device dropped while asleep fails the
   * first request and works on a later one. Errors that are real answers
   * (permission denied, not found) are not retried.
   */
  private async withRetry<T>(
    fetcher: () => Promise<T>,
    stillWanted: () => boolean = () => true,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      if (attempt > 0 && !stillWanted()) break;
      try {
        return await fetcher();
      } catch (error) {
        if (!isTransient(error)) throw error;
        lastError = error;
      }
    }
    throw new ReadUnavailableError(lastError);
  }

  private async withServerTimeout<T>(read: Promise<T>): Promise<T> {
    try {
      return await withDeadline(read, SERVER_READ_TIMEOUT_MS);
    } catch (error) {
      throw isTransient(error) ? new ReadUnavailableError(error) : error;
    }
  }
}
