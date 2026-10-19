# Data options

Host tools expose operations defined by the host. An app can also store data in its database or keep temporary values in component state.

| Request | Starting point |
| --- | --- |
| Existing product records, navigation, or integrations | Generated host tools and components |
| Persistent data stored by the app | One table, a query, and the mutations the feature needs |
| Form drafts, filters, or open/closed state | Component state; pass it through props when shared |
| Dashboard or report | Host tools for available data, or a query for data stored by the app |
| Details for the selected record | Read its ID/data from the view's host context |
| One tile/page per record | A repeated slot's instance resolver |
| Public external data | An action that fetches and validates the response |
| Change an existing app | Extend its current flow and preserve data/configuration |

For example, a contact panel can use host context and a host update tool without a database. Private notes need a table, a query filtered by user ID, and a mutation to save. A draft input needs only `useState` until saved.

Shared or private storage follows the feature's requirements. Enforce that access rule in backend functions.
