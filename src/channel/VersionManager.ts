/**
 * Manages the monotonically-increasing version counter for off-chain state.
 *
 * Every `send()` call reserves a version via `next()`. The version is
 * confirmed (on co-sig received) or rolled back (on timeout) to prevent
 * version gaps and desync with ClearNode.
 *
 * Concurrency model: `send()` calls are queued by Channel — only one
 * in-flight version exists at a time for the happy path. The in-flight
 * set exists to support future concurrent-send modes.
 */
export class VersionManager {
  private _version: number;
  private readonly _inFlight = new Set<number>();

  constructor(initialVersion = 0) {
    this._version = initialVersion;
  }

  /**
   * Reserve the next version. Marks it as in-flight until confirmed or
   * rolled back.
   */
  next(): number {
    const v = ++this._version;
    this._inFlight.add(v);
    return v;
  }

  /**
   * Confirm that version `v` was co-signed by ClearNode. Removes it from
   * the in-flight set.
   */
  confirm(v: number): void {
    this._inFlight.delete(v);
  }

  /**
   * Roll back version `v` — the send failed (timeout, rejection, network
   * error). Decrements the version counter so the next `next()` call
   * reuses this version number.
   *
   * No-op if `v` is not in the in-flight set (idempotent).
   */
  rollback(v: number): void {
    if (!this._inFlight.has(v)) return;
    this._version = v - 1;
    this._inFlight.delete(v);
  }

  /** The highest confirmed or in-flight version number */
  get current(): number {
    return this._version;
  }

  /** True if any send() calls are awaiting co-signature */
  get hasPending(): boolean {
    return this._inFlight.size > 0;
  }

  /** Number of in-flight versions (for diagnostics) */
  get pendingCount(): number {
    return this._inFlight.size;
  }

  /** All currently in-flight version numbers (for diagnostics) */
  get pendingVersions(): number[] {
    return [...this._inFlight].sort((a, b) => a - b);
  }
}
