# Preact performance

Focus on work and data crossing the app/host boundary.

- Use `useQuery` for backend reads. Within a `ClientProvider`, subscriptions deduplicate by function name and serialized input. Equivalent JSON input objects need no memoization for subscription stability. Render the query result directly instead of copying it into local state.
- Keep the provider/client stable. Subscribe near consumers and return bounded results from the backend; fetch only the columns and relations the UI needs.
- Run interactions in event callbacks. Use effects for lifecycle synchronization, with complete dependencies and cleanup. Cancel or ignore stale async results after context changes or unmounts.
- Parallelize independent external calls in actions with `Promise.all`, bounding large fan-outs. Await dependent work in order. Database handlers remain synchronous.
- Derive simple render values directly. Reserve `useMemo` for expensive calculations and `useCallback` for useful identity stability. Use functional state updates when reading previous state.
- Split frequently changing UI into focused components. Refs may hold local bookkeeping, while host components own visible state and DOM behavior.
- Prefer focused imports and defer heavy optional modules when the app build supports it. Keep server/schema imports out of the client bundle.
- Use explicit numeric conditions: `count > 0 ? <Component /> : null` avoids accidentally rendering `0`.

Verify the changed interaction and run the app's available checks. Bundle size alone does not establish runtime performance.
