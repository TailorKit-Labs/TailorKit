/** Adapt fixture logic to a Promise API, including synchronous failures. */
export const asyncFixture =
  <TArgs extends unknown[], TResult>(
    implementation: (...args: TArgs) => TResult
  ) =>
  async (...args: TArgs): Promise<Awaited<TResult>> =>
    await implementation(...args);
