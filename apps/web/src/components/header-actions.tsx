import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

interface HeaderActionsContextValue {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  actions: null,
  setActions: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <HeaderActionsContext value={{ actions, setActions }}>
      {children}
    </HeaderActionsContext>
  );
}

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}

export function SetHeaderActions({ children }: { children: ReactNode }) {
  const { setActions } = useHeaderActions();
  useEffect(() => {
    setActions(children);
    return () => setActions(null);
  });
  return null;
}
