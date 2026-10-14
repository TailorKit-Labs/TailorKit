import type { Schema } from "@tailorkit/core/schema";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createViewContextStore } from "./view-context";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const requiredContext = z.object({ customer: z.object({ id: z.string() }) });
const setup = (schema: Schema = requiredContext) =>
  createViewContextStore({ views: { "/": schema } });
afterEach(() => vi.restoreAllMocks());

it("strips nested extra fields using the original schema without mutating the input", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const context = {
    customer: { email: "private@example.com", id: "c1" },
    extra: true,
  };
  store.register({ context, id: Symbol("identity"), view: "/" });
  await Promise.resolve();
  expect(store.state.get()?.layers).toEqual([
    { context: { customer: { id: "c1" } }, path: "/", status: "ready" },
  ]);
  expect(context.customer.email).toBe("private@example.com");
  expect(error).not.toHaveBeenCalled();
});

it("preserves the schema's transforms and refinements", async () => {
  const store = setup(z.object({ name: z.string().trim().min(1) }));
  store.register({
    context: { name: "  Alice  " },
    id: Symbol("identity"),
    view: "/",
  });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.context).toEqual({ name: "Alice" });
});

it("honors explicitly loose and strict schemas", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const loose = setup(z.looseObject({ name: z.string() }));
  const strict = setup(z.strictObject({ name: z.string() }));
  const context = { extra: true, name: "Alice" };
  loose.register({ context, id: Symbol("identity"), view: "/" });
  strict.register({ context, id: Symbol("identity"), view: "/" });
  await Promise.resolve();
  expect(loose.state.get()?.layers[0]?.context).toEqual(context);
  expect(strict.state.get()?.layers[0]).toMatchObject({
    context: undefined,
    status: "error",
  });
  expect(error).toHaveBeenCalledOnce();
});

it("logs missing required context once across synchronous cleanup and remount", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const id = Symbol("identity");
  const entry = { context: undefined, id, view: "/" };
  store.register(entry);
  store.unregister(id);
  store.register(entry);
  store.register({ ...entry, error: null, loading: false });
  await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("required context")
  );
  expect(store.state.get()?.layers[0]?.status).toBe("error");
  store.register({ ...entry, context: { customer: { id: "c1" } } });
  store.register(entry);
  expect(error).toHaveBeenCalledTimes(2);
});

it("allows omitted context through an optional native schema", async () => {
  const store = setup(requiredContext.optional());
  store.register({ context: undefined, id: Symbol("identity"), view: "/" });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]).toEqual({
    context: undefined,
    path: "/",
    status: "ready",
  });
});

it("skips validation while loading and lets request errors take precedence", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const id = Symbol("identity");
  store.register({ context: {}, id, loading: true, view: "/" });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.status).toBe("loading");
  store.register({
    context: {},
    error: new Error("offline"),
    id,
    loading: true,
    view: "/",
  });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.status).toBe("error");
  expect(error).not.toHaveBeenCalled();
});

it("reports native issue paths and withholds invalid context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  store.register({
    context: { customer: { id: 123 } },
    id: Symbol("identity"),
    view: "/",
  });
  await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("does not match"),
    expect.arrayContaining([
      expect.objectContaining({ path: ["customer", "id"] }),
    ])
  );
  expect(store.state.get()?.layers[0]).toMatchObject({
    context: undefined,
    status: "error",
  });
});

it("waits for asynchronous validation and ignores results for replaced or unmounted registrations", async () => {
  const pending: (() => void)[] = [];
  const base = z.object({ name: z.string() });
  const schema: Schema = {
    "~standard": {
      validate: async (input) => {
        const value = base.parse(input);
        await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<ReturnType<() => void>>();
          try {
            pending.push(resolve);
          } catch (error) {
            rejectPending(error);
          }
          await pendingPromise;
        })();
        return { value: { name: value.name.toUpperCase() } };
      },
      vendor: "async-test",
      version: 1,
    },
  };
  const store = setup(schema);
  const id = Symbol("identity");
  store.register({ context: { name: "old" }, id, view: "/" });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]).toMatchObject({
    context: undefined,
    status: "loading",
  });
  store.register({ context: { name: "new" }, id, view: "/" });
  requireValue(pending[1])();
  await vi.waitFor(() => {
    expect(store.state.get()?.layers[0]?.context).toEqual({ name: "NEW" });
  });
  requireValue(pending[0])();
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.context).toEqual({ name: "NEW" });
  store.register({ context: { name: "unmounted" }, id, view: "/" });
  store.unregister(id);
  requireValue(pending[2])();
  await vi.waitFor(() => {
    expect(store.state.get()).toBeNull();
  });
});

it("handles rejected and thrown validators without leaking context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const validate of [
    () => {
      throw new Error("failed");
    },
    vi.fn().mockRejectedValue(new Error("failed")),
  ]) {
    const schema: Schema = {
      "~standard": {
        validate,
        vendor: "test",
        version: 1,
      },
    };
    const store = setup(schema);
    store.register({ context: {}, id: Symbol("identity"), view: "/" });
    // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
    await vi.waitFor(() => {
      expect(store.state.get()?.layers[0]?.status).toBe("error");
    });
  }
  expect(error).toHaveBeenCalledTimes(2);
});
