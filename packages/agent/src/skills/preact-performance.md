# Preact performance

Start with the direct implementation. Optimize a visible or measured problem.

- Render query data directly. A stable `ClientProvider` shares subscriptions by function and serialized input.
- For slow lists, filter/limit on the backend and return the fields needed. Add pagination when appropriate.
- Keep frequently changing state near its controls. Keep components at module scope and list keys stable.
- Run independent external calls together when it helps the requested flow. Database handlers remain synchronous.
- Use memoization, debounce, caching, or request coordination only when it addresses the problem being fixed.

Verify the interaction that was slow. A smaller bundle or extra memoization alone does not prove it improved.
