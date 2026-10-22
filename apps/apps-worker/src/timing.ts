import { Effect } from "effect";

type RuntimePhase =
  | "runtime_gateway"
  | "runtime_gateway_auth"
  | "runtime_installation"
  | "runtime_auth"
  | "runtime_queue"
  | "runtime_metadata"
  | "runtime_metadata_kv"
  | "runtime_metadata_platform"
  | "runtime_bundle"
  | "runtime_prepare"
  | "runtime_execute";

/** Request-local wall-clock durations. Names never contain app or caller data. */
export class RuntimeTimings {
  readonly #durations = new Map<RuntimePhase, number>();
  readonly #now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  start(name: RuntimePhase) {
    const started = this.#now();

    return () => {
      this.#durations.set(
        name,
        (this.#durations.get(name) ?? 0) + this.#now() - started
      );
    };
  }

  measure<A, E, R>(name: RuntimePhase, operation: Effect.Effect<A, E, R>) {
    return Effect.suspend(() => {
      const finish = this.start(name);

      return operation.pipe(Effect.ensuring(Effect.sync(finish)));
    });
  }

  async time<T>(name: RuntimePhase, operation: () => Promise<T>): Promise<T> {
    const finish = this.start(name);

    try {
      return await operation();
    } finally {
      finish();
    }
  }

  response(response: Response): Response {
    if (response.status === 101) {
      return response;
    }

    const headers = new Headers(response.headers);

    const timing = [...this.#durations]
      .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
      .join(", ");

    if (timing) {
      headers.append("server-timing", timing);
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}
