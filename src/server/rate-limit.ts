/** Fixed one-minute windows per key, in memory: there is a single server process. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  /** Counts a request; returns 0 if allowed, otherwise seconds until the window resets. */
  hit(key: string, limit: number, nowMs: number): number {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= nowMs) {
      if (this.windows.size > 100_000) this.dropExpired(nowMs);
      window = { count: 0, resetAt: nowMs + this.windowMs };
      this.windows.set(key, window);
    }
    window.count++;
    return window.count <= limit ? 0 : Math.ceil((window.resetAt - nowMs) / 1000);
  }

  private dropExpired(nowMs: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= nowMs) this.windows.delete(key);
  }
}
