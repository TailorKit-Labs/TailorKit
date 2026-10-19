# Choose where data belongs

Start from the requested behavior. Host tools access data and operations the product exposes. App functions save new app-owned data; component state holds unsaved UI values.

| Request | Starting point |
| --- | --- |
| Existing product records, navigation, or integrations | Generated host tools and components |
| App-owned notes, todos, or saved settings | One table, a query, and the mutations the feature needs |
| Form drafts, filters, or open/closed state | Component state; pass it through props when shared |
| Dashboard or report | A host tool for product data, or a query for app data |
| Details for the selected record | Read its ID/data from the view's host context |
| One tile/page per record | A repeated slot's instance resolver |
| Public external data | An action that fetches and validates the response |
| Change an existing app | Extend its current flow and preserve data/configuration |

For example, a contact panel can use host context and a host update tool without a database. Private notes need a table, a query filtered by user ID, and a mutation to save. A draft input needs only `useState` until saved.

Choose shared or private storage from the feature's requirements and enforce that choice in functions. Limit growing lists; add pagination when needed. When the host exposes no required control or operation, explain the missing capability and use a supported alternative.
