# A focused local provider

Use this for state shared by sibling controls, such as a filter and its results. It stores temporary UI state; persistence still belongs to a query/mutation. Place it under the relevant view when consumers also need that view's context.

<!-- example: src/components/filter-provider.tsx -->

```tsx
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useState } from "preact/hooks";

type FilterState = { search: string; setSearch: (value: string) => void };
const FilterContext = createContext<FilterState | null>(null);

export const FilterProvider = ({
  children,
}: {
  children: ComponentChildren;
}) => {
  const [search, setSearch] = useState("");
  return (
    <FilterContext.Provider value={{ search, setSearch }}>
      {children}
    </FilterContext.Provider>
  );
};

export const useFilter = (): FilterState => {
  const value = useContext(FilterContext);
  if (!value) throw new Error("useFilter requires FilterProvider.");
  return value;
};
```

Add memoization only if measured consumer work benefits from stable context identity. Keep the provider component at module scope and preserve its position in the view tree.
