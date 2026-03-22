import type { z } from 'zod';

/**
 * A guard function that validates a state transition.
 *
 * Receives the previous typed state (null on first update after open)
 * and the proposed next state. Return false to reject the transition.
 */
export type TransitionGuard<T> = (
  prev: T | null,
  next: T,
  context: { version: number; channelId: string },
) => boolean;

/**
 * Input to `defineProtocol()`.
 */
export interface ProtocolDefinition<S extends z.ZodTypeAny> {
  /** Human-readable name. Encoded into state.data. */
  name: string;
  /** Monotonically increasing integer version. */
  version: number;
  /** Zod schema for the typed payload. Validated on every send(). */
  schema: S;
  /**
   * Named transition guards. All defined guards must pass for a send() to succeed.
   * Receives decoded typed states, not raw hex.
   */
  transitions?: Record<string, TransitionGuard<z.infer<S>>>;
  /**
   * Given the full channel history of typed states, return the state that
   * should be submitted on forceClose(). Defaults to the latest state.
   */
  resolveDispute?: (history: Array<z.infer<S>>) => z.infer<S> | undefined;
}

/**
 * The object returned by `defineProtocol()`. Carries the schema output type as T.
 */
export interface Protocol<T> {
  readonly name: string;
  readonly version: number;
  readonly schema: z.ZodType<T>;
  readonly transitions?: Record<string, TransitionGuard<T>>;
  readonly resolveDispute?: (history: T[]) => T | undefined;
  /** Unique identifier string: "${name}@${version}" — embedded in state.data */
  readonly identifier: string;
}
