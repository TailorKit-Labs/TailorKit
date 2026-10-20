import { defineView } from "./app";

declare module "@patchsmith/app" {
  interface PatchsmithSlots {
    packageTest: { views: "/package-test"; multiple: false };
  }
  interface PatchsmithViews {
    "/package-test": { context: { customerId: string } };
  }
}

const view = defineView({
  component: () => null,
  slot: "packageTest",
  view: "/package-test",
});
const context = view.useContext();
context.customerId satisfies string;
// @ts-expect-error The umbrella export must preserve the registered context type.
context.customerId satisfies number;
