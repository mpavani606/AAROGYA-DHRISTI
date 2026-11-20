interface CacheQueryOptions {
  ignoreSearch?: boolean;
  ignoreMethod?: boolean;
  ignoreVary?: boolean;
}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
