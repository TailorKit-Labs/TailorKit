import { useStore } from "@nanostores/react";
import type { ToolBridge, Session } from "@patchsmith/app/client";
import {
  createRemoteViewStore,
  createRemoteElementProps,
} from "@patchsmith/client-core";
import type { RemoteViewStore } from "@patchsmith/client-core";
import type {
  RemoteProps,
  RemoteElementNode,
} from "@patchsmith/sandbox/protocol";
import {
  Component,
  Fragment,
  createElement,
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ComponentType, ReactNode } from "react";

const RemoteUIContext = createContext<RemoteViewStore | null>(null);

const formatError = (error: Error): string => error.message;

interface RemoteErrorBoundaryProps {
  children?: ReactNode;
}

interface RemoteErrorBoundaryState {
  error: Error | null;
}

class RemoteErrorBoundary extends Component<
  RemoteErrorBoundaryProps,
  RemoteErrorBoundaryState
> {
  constructor(props: RemoteErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): RemoteErrorBoundaryState {
    return { error };
  }

  static componentDidCatch(error: Error): void {
    console.error("Patchsmith remote app failed", error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return createElement("div", null, formatError(this.state.error));
    }

    return this.props.children;
  }
}

interface RemoteViewHostProps {
  appUrl: string | URL;
  toolBridge?: ToolBridge;
  getBackendSession?: (options: { refresh: boolean }) => Promise<Session>;
  components: RemoteProps;
  createIframe?: () => HTMLIFrameElement;
  props?: RemoteProps;
}

interface RemoteElementViewProps {
  children: ReactNode[];
  ctx: RemoteViewStore;
  node: RemoteElementNode;
}

const RemoteElementViewComponent = ({
  children,
  ctx,
  node,
}: RemoteElementViewProps): ReactNode => {
  const componentStore = useMemo(
    () => ctx.selectComponent(node.type),
    [ctx, node.type]
  );
  const component = useStore(componentStore);

  if (component === undefined) {
    throw new Error(`Patchsmith component "${node.type}" is not registered.`);
  }
  const props = createRemoteElementProps(node, ctx.dispatch.bind(ctx));

  // SAFETY: The renderer was supplied through the typed component registry; React's createElement overload erases its heterogeneous props.
  return createElement(
    /* oxlint-disable typescript/no-unsafe-type-assertion -- The renderer was supplied through the typed component registry; React's createElement overload erases its heterogeneous props. */
    component as string | ComponentType<RemoteProps>,
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    props,
    ...children
  );
};
const RemoteElementView = memo(RemoteElementViewComponent);

interface RemoteViewProps {
  nodeId: string;
}

const RemoteNode = {
  View: ({
    ctx,
    nodeId,
  }: RemoteViewProps & { ctx: RemoteViewStore }): ReactNode => {
    const nodeStore = useMemo(
      () => ctx.nodes.selectNode(nodeId),
      [ctx, nodeId]
    );
    const node = useStore(nodeStore);
    if (node === null) {
      return null;
    }

    if (node.kind === "text") {
      return node.text;
    }

    const childElements = node.children.map((child) => (
      <RemoteNode.View key={child.id} ctx={ctx} nodeId={child.id} />
    ));

    if (node.kind === "fragment") {
      return createElement(Fragment, { key: node.id }, ...childElements);
    }

    return (
      <RemoteElementView node={node} ctx={ctx}>
        {childElements}
      </RemoteElementView>
    );
  },
};
RemoteNode.View = memo(RemoteNode.View);

const RemoteViewComponent = ({ nodeId }: RemoteViewProps): ReactNode => {
  const ctx = useContext(RemoteUIContext);
  return ctx === null ? null : <RemoteNode.View ctx={ctx} nodeId={nodeId} />;
};

export const RemoteView = memo(RemoteViewComponent);

const RemoteRoot = ({ store }: { store: RemoteViewStore }): ReactNode => {
  const rootId = useStore(store.nodes.root);

  return rootId === null ? null : <RemoteView nodeId={rootId} />;
};

export const RemoteViewHost = ({
  appUrl,
  toolBridge,
  getBackendSession,
  components,
  createIframe,
  props,
}: RemoteViewHostProps): ReactNode => {
  const appKey = appUrl.toString();
  const [state, setState] = useState(() => ({
    appKey,
    store: createRemoteViewStore({ components, props }),
  }));
  if (state.appKey !== appKey) {
    setState({ appKey, store: createRemoteViewStore({ components, props }) });
  }
  const { store } = state;
  const snapshot = useStore(store.state);

  useEffect(() => {
    store.setComponents(components);
  }, [components, store]);

  useEffect(() => {
    store.setProps(props);
  }, [props, store]);

  useEffect(
    () =>
      store.mount({
        appUrl,
        createIframe,
        getBackendSession,
        toolBridge,
      }),
    [appUrl, toolBridge, getBackendSession, createIframe, store]
  );

  if (snapshot.status === "error" && snapshot.error) {
    return createElement("div", null, formatError(snapshot.error));
  }

  return (
    <RemoteUIContext.Provider value={store}>
      <RemoteErrorBoundary key={`${appKey}:${snapshot.generation}`}>
        <RemoteRoot store={store} />
      </RemoteErrorBoundary>
    </RemoteUIContext.Provider>
  );
};
