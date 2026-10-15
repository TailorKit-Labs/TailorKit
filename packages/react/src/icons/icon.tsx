import type { IconData, IconProps } from "@tailorkit/core/icons";
import { createElement, useEffect, useState } from "react";

import { createIconLoader } from "./loader";
import type { IconRendererOptions } from "./loader";

const IconSvg = ({
  props: { name, size = 24, strokeWidth = 2, label },
  loader,
}: {
  props: IconProps;
  loader: ReturnType<typeof createIconLoader>;
}) => {
  const [state, setState] = useState<{
    name: string;
    data: IconData | undefined;
  }>(() => ({ data: loader.peek(name), name }));
  const data = state.name === name ? state.data : loader.peek(name);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await loader.load(name);
        if (active) {
          setState({ data: result, name });
        }
      } catch {
        if (active) {
          setState({ data: undefined, name });
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [loader, name]);

  return (
    <svg
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      fill="none"
      focusable="false"
      height={size}
      role={label === undefined ? undefined : "img"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      style={{
        display: "inline-block",
        flexShrink: 0,
        verticalAlign: "middle",
      }}
      viewBox={`0 0 ${data?.size ?? 24} ${data?.size ?? 24}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {data?.nodes.map(([tag, attributes], index) =>
        createElement(tag, { ...attributes, key: index })
      )}
    </svg>
  );
};

/** Create once alongside the client; its loader is shared by all rendered apps. */
export const Icon = (options: IconRendererOptions) => {
  const loader = createIconLoader(options);
  return function IconRenderer({ props }: { props: IconProps }) {
    return <IconSvg loader={loader} props={props} />;
  };
};
