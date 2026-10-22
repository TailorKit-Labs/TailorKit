const phases = new Set([
  "runtime_gateway",
  "runtime_gateway_auth",
  "runtime_installation",
  "runtime_auth",
  "runtime_queue",
  "runtime_metadata",
  "runtime_metadata_kv",
  "runtime_metadata_platform",
  "runtime_bundle",
  "runtime_prepare",
  "runtime_execute",
]);

const durationEntry =
  /^(?<phase>runtime_[a-z_]+);dur=(?<duration>\d+(?:\.\d+)?)$/u;

/** Maxima across concurrent installations; these overlapping durations are not additive. */
export class ViewResolutionTimings {
  readonly #maxima = new Map<string, number>();
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(fetcher: typeof fetch = fetch, now = () => performance.now()) {
    this.#fetch = fetcher;
    this.#now = now;
  }

  #record(name: string, duration: number) {
    this.#maxima.set(name, Math.max(this.#maxima.get(name) ?? 0, duration));
  }

  async session<T>(create: () => Promise<T>): Promise<T> {
    const started = this.#now();

    try {
      return await create();
    } finally {
      this.#record("views_session", this.#now() - started);
    }
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const started = this.#now();
    const response = await this.#fetch(input, init);
    this.#record("runtime_roundtrip", this.#now() - started);
    const header = response.headers.get("server-timing") ?? "";

    if (header.length <= 8192) {
      for (const entry of header.split(",")) {
        const match = durationEntry.exec(entry.trim());
        const name = match?.groups?.phase ?? "";
        const duration = Number(match?.groups?.duration);

        if (
          name !== "" &&
          phases.has(name) &&
          Number.isFinite(duration) &&
          duration <= 60_000
        ) {
          this.#record(name, duration);
        }
      }
    }

    return response;
  };

  header() {
    return [...this.#maxima]
      .map(([name, duration]) => `${name}_max;dur=${duration.toFixed(1)}`)
      .join(", ");
  }
}
