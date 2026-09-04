/**
 * A structural type for what `fetch` gives back.
 *
 * The global `Response` resolves differently on this machine and in the deploy
 * target's build. Locally it comes from `@types/node` and carries `.ok`,
 * `.status`, `.text()`, `.json()` and `.body`; in the hosted build it does not,
 * and every one of those accesses failed to compile there while
 * `tsc --noEmit` stayed green here. The host's build tolerated the errors and
 * shipped anyway, which is the worst of the two outcomes: seven lines of red on
 * every single deploy that everybody learns to scroll past, so the eighth line
 * — the one that matters — goes unread.
 *
 * Naming the five members actually used makes the check identical in both
 * places and independent of whichever lib happens to be loaded.
 */
export interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
  };
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: ByteStream | null;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

/** `fetch`, with a return type that means the same thing in both builds. */
export const httpFetch: FetchLike = (input, init) =>
  (fetch as unknown as FetchLike)(input, init);
