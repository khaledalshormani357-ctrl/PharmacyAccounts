/** Run a synchronous local-store mutation with rollback on any thrown failure. */
export function withAtomicMutation<T, S>(
  snapshot: () => S,
  restore: (state: S) => void,
  mutation: () => T,
  afterRollback?: () => void,
): T {
  const before = snapshot();
  try {
    return mutation();
  } catch (error) {
    restore(before);
    afterRollback?.();
    throw error;
  }
}
