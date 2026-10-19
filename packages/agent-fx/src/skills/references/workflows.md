# Choose the simplest data flow

Use what the app and product already provide. Pick only the pieces needed for the request.

| Request | Starting point |
| --- | --- |
| Product records, navigation, or integrations | Generated product tools and components |
| App-owned notes, todos, or saved settings | One table, a query, and the mutations the feature needs |
| Form drafts, filters, or open/closed state | Component state; pass it through props when shared |
| Dashboard or report | A query/tool call and the available display components |
| Record panel | The selected view's context and an authorized query |
| Repeated tiles | An instance resolver only when the slot requires multiple items |
| Public external data | An action that fetches and validates the response |
| Existing app changes | Extend the current flow and preserve its data/configuration |

Decide whether app data is shared or private and apply that access rule in functions. For lists that can grow large, add an appropriate query limit; add pagination when the feature needs it.

Finish when the requested flow works and the relevant checks and authorized publication succeed. Explain any unavailable product capability or behavior that could not be verified.
