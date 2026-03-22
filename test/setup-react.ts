// Marks this environment as supporting React's act() batching.
// Suppresses the "not configured to support act()" warning in jsdom tests.
// @ts-expect-error — global flag consumed by React internally
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
