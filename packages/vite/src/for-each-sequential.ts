/** Complete each operation before starting the next, and stop on the first failure. */
export const forEachSequential = async <T>(
  values: Iterable<T>,
  operation: (value: T) => Promise<void>
): Promise<void> => {
  for (const value of values) {
    // oxlint-disable-next-line no-await-in-loop -- Ordering and fail-fast behavior are the purpose of this helper.
    await operation(value);
  }
};
