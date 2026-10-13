import { useMemo, createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

interface HeaderActionsContextValue {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  actions: null,
  setActions: () => {
    /* Intentionally no action is needed. */
  },
});

export const HeaderActionsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [actions, setActions] = useState<ReactNode>(null);
  const contextValue1 = useMemo(
    () => ({ actions, setActions }),
    [actions, setActions]
  );
  return (
    <HeaderActionsContext value={contextValue1}>
      {children}
    </HeaderActionsContext>
  );
};

export const useHeaderActions = () => useContext(HeaderActionsContext);

export const SetHeaderActions = ({ children }: { children: ReactNode }) => {
  const { setActions } = useHeaderActions();
  useEffect(() => {
    setActions(children);
    return () => setActions(null);
  });
  return null;
};
