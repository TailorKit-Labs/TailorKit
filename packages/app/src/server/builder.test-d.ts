/* oxlint-disable react/rules-of-hooks -- Compile-only API tests exercise hook signatures outside runtime components. */
/* oxlint-disable require-await -- These negative type cases intentionally return promises from database handlers. */
import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

import type { Client } from "#client/connection";
import { createApi } from "#client/reference";
import { useAction, useMutation, useQuery } from "#preact";

import { fn } from "./builder";
import { defineRouter } from "./functions";

const functions = {
  actionWithoutSchemas: fn.action.handler(async ({ input }) => {
    const absent: undefined = input;
    expectTypeOf(absent).toEqualTypeOf<undefined>();

    return { completed: true };
  }),
  list: fn.query.handler(({ input }) => {
    const absent: undefined = input;
    expectTypeOf(absent).toEqualTypeOf<undefined>();
    // @ts-expect-error No input schema means there are no input properties.
    void input.value;

    return [1, 2];
  }),
  read: fn.query
    .input(z.object({ raw: z.string().transform(Number) }))
    .output(z.string().transform(Number))
    .handler(({ input, db }) => {
      const value: number = input.raw;
      // @ts-expect-error Queries cannot write to the database.
      void db.insert;

      return String(value);
    }),
  saveWithoutSchemas: fn.mutation.handler(({ input }) => {
    const absent: undefined = input;
    expectTypeOf(absent).toEqualTypeOf<undefined>();

    return { saved: true };
  }),
  write: fn.mutation
    .input(z.object({ value: z.number() }))
    .handler(({ input }) => input.value),
};

const save = fn.action
  .functions(functions)
  .input(z.object({ value: z.number() }))
  .output(z.number())
  .handler(async (context) => {
    const read: number = await context.queries.read({ raw: "4" });
    // @ts-expect-error Actions have no direct database handle.
    void context.db;
    // @ts-expect-error Action query arguments use schema inputs.
    void context.queries.read({ raw: 4 });
    const rows: number[] | undefined = await context.queries.list();

    const saved: { saved: boolean } =
      await context.mutations.saveWithoutSchemas();

    void rows;
    void saved;
    // @ts-expect-error No-input queries do not accept objects.
    void context.queries.list({});

    return await context.mutations.write({ value: context.input.value + read });
  });

const app = defineRouter({ ...functions, save });

type Api = typeof app;

const refs = createApi<Api>();
declare const client: Client;
const result: Promise<number> = client.query(refs.read, { raw: "3" });

void result;

const inferredRows: Promise<number[]> = client.query(refs.list);

const savedWithoutInput: Promise<{ saved: boolean }> = client.mutate(
  refs.saveWithoutSchemas
);

const completedWithoutInput: Promise<{ completed: boolean }> = client.action(
  refs.actionWithoutSchemas
);

void inferredRows;

void savedWithoutInput;

void completedWithoutInput;

// @ts-expect-error No-input imperative queries do not accept values.
void client.query(refs.list, {});

// @ts-expect-error Required imperative query inputs cannot be omitted.
void client.query(refs.read);

// @ts-expect-error Imperative inputs are inferred from the reference, not widened by arguments.
void client.query(refs.read, { raw: 3 });

// @ts-expect-error Async database handlers cannot escape the synchronous transaction.
fn.mutation.handler(async () => 1);

// @ts-expect-error Async queries are not allowed.
fn.query.handler(async () => 1);

// @ts-expect-error Output schemas constrain handler results before output transformations.
fn.query.output(z.number()).handler(() => "wrong");

// @ts-expect-error Only actions can call other functions.
fn.query.functions(functions);

const query = useQuery(refs.read, { raw: "3" });
const data: number | undefined = query.data;

void data;

useQuery(refs.list);

const rows: number[] | undefined = useQuery(refs.list).data;

void rows;

// @ts-expect-error No-input queries do not accept objects.
useQuery(refs.list, {});

const inferredSave: Promise<{ saved: boolean }> = useMutation(
  refs.saveWithoutSchemas
).mutateAsync();

const inferredAction: Promise<{ completed: boolean }> = useAction(
  refs.actionWithoutSchemas
).executeAsync();

void inferredSave;

void inferredAction;

// @ts-expect-error No-input mutations do not accept objects.
useMutation(refs.saveWithoutSchemas).mutate({});

// @ts-expect-error No-input actions do not accept objects.
useAction(refs.actionWithoutSchemas).execute({});

// @ts-expect-error Output schemas also constrain async action results.
fn.action.output(z.number()).handler(async () => "wrong");

// @ts-expect-error Required query inputs cannot be omitted.
useQuery(refs.read);

// @ts-expect-error Mutation functions cannot be subscribed as queries.
useQuery(refs.write, { value: 1 });

const write = useMutation(refs.write);

write.mutate({ value: 1 });

// @ts-expect-error Mutation arguments retain schema input types.
write.mutate({ value: "1" });

const action = useAction(refs.save);
const saved: Promise<number> = action.executeAsync({ value: 1 });

void saved;

// @ts-expect-error Actions cannot be called with the mutation hook.
useMutation(refs.save);

const internalFunctions = {
  read: fn.query
    .internal()
    .input(z.string().transform(Number))
    .output(z.string().transform(Number))
    .handler(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<number>();

      return String(input);
    }),
  write: fn.mutation
    .input(z.number())
    .internal()
    .output(z.number())
    .handler(({ input }) => input),
};

const internalAction = fn.action
  .internal()
  .functions({ records: internalFunctions })
  .input(z.string())
  .output(z.number())
  .handler(async ({ input, queries, mutations }) => {
    const value = await queries.records.read(input);
    expectTypeOf(value).toEqualTypeOf<number>();

    // @ts-expect-error Internal function input types still precede schema transforms.
    void queries.records.read(1);

    return await mutations.records.write(value);
  });

const privateRefs = createApi<{
  action: typeof internalAction;
  hidden: typeof internalFunctions;
  mixed: { visible: typeof functions.list; hidden: typeof internalFunctions };
}>();

expectTypeOf(internalAction.visibility).toEqualTypeOf<"internal">();

expectTypeOf(functions.list.visibility).toEqualTypeOf<"public">();

expectTypeOf(privateRefs.mixed.visible).toEqualTypeOf<typeof refs.list>();

// @ts-expect-error Internal actions are absent from the public client API.
void privateRefs.action;

// @ts-expect-error Namespaces containing only internal functions are omitted.
void privateRefs.hidden;

// @ts-expect-error Internal nested namespaces are omitted from mixed routers.
void privateRefs.mixed.hidden;

const mixedRefs = createApi<{
  records: typeof internalFunctions & {
    visible: typeof functions.list;
  };
}>();

// @ts-expect-error Internal queries are absent even beside public functions.
void mixedRefs.records.read;

// @ts-expect-error Internal mutations are absent even beside public functions.
void mixedRefs.records.write;
