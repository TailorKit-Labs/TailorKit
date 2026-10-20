import { Button } from "@patchsmith/ui/button";
import type { PatchsmithApp } from "patchsmith/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { patchsmith } from "#lib/patchsmith-client";

import "#styles.css";
import "./checks";

const app: PatchsmithApp = {
  clientPath: "/canvas-client.js",
  id: "canvas-demo",
  name: "Canvas demo",
  views: [{ path: "/", slot: "canvas" }],
};

const apps = [app];

const context = {
  team: { id: "demo", name: "Demo team" },
  user: { id: "demo", name: "Demo user" },
};

const Demo = () => {
  const [revision, setRevision] = useState(0);
  const [second, setSecond] = useState(false);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Experimental canvas API</h1>
      <p>
        Real RenderSlot, generated app bindings, and isolated sandbox rendering.
        No platform or database setup required.
      </p>
      <div className="flex gap-3">
        <Button
          onClick={() => {
            setRevision((value) => value + 1);
          }}
          type="button"
        >
          Restart sandbox
        </Button>
        <Button
          onClick={() => {
            setSecond((value) => !value);
          }}
          type="button"
        >
          {second ? "Remove second app" : "Mount second app"}
        </Button>
      </div>
      <patchsmith.Provider apps={apps}>
        <section aria-label="First app" key={`first:${revision}`}>
          <patchsmith.RenderSlot.Controlled
            app={app}
            context={context}
            slot="canvas"
            status="ready"
            view="/"
          />
        </section>
        {second ? (
          <section aria-label="Second app" key="second">
            <patchsmith.RenderSlot.Controlled
              app={app}
              context={context}
              slot="canvas"
              status="ready"
              view="/"
            />
          </section>
        ) : null}
      </patchsmith.Provider>
    </main>
  );
};

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Missing demo root.");
}

const reactRoot = createRoot(root);

import.meta.hot?.dispose(() => {
  reactRoot.unmount();
});

reactRoot.render(
  <StrictMode>
    <Demo />
  </StrictMode>
);
