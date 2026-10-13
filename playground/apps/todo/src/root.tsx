import { ClientProvider, defineRoute, Route } from "tailorkit/client";

const Shell = () => (
  <ClientProvider>
    <Route />
  </ClientProvider>
);

export default defineRoute({ shellComponent: Shell });
