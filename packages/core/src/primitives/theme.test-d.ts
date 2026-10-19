import { expectTypeOf } from "vite-plus/test";

import { primitives as arktypePrimitives } from "./arktype";
import { resolveTheme } from "./theme";
import type { PatchSmithTheme } from "./theme";
import { primitives as valibotPrimitives } from "./valibot";
import { primitives as zodPrimitives } from "./zod";

const theme = { breakpoints: { desktop: "1024px", hover: "640px" } };
expectTypeOf(theme).toExtend<PatchSmithTheme>();
zodPrimitives(theme);
valibotPrimitives(theme);
arktypePrimitives(theme);

const reservedDefault = { breakpoints: { default: "0px" } };
const reservedState = { breakpoints: { ":hover": "640px" } };
const reservedPrefix = { breakpoints: { ":custom": "1024px" } };

// @ts-expect-error -- The fallback key cannot be declared as a breakpoint.
zodPrimitives(reservedDefault);
// @ts-expect-error -- Pseudo-class names cannot be declared as breakpoints.
zodPrimitives(reservedState);
// @ts-expect-error -- Every colon-prefixed name is reserved, including unknown states.
zodPrimitives(reservedPrefix);
// @ts-expect-error -- Valibot enforces the same breakpoint-name constraint.
valibotPrimitives(reservedDefault);
// @ts-expect-error -- Valibot rejects colon-prefixed names.
valibotPrimitives(reservedPrefix);
// @ts-expect-error -- ArkType enforces the same breakpoint-name constraint.
arktypePrimitives(reservedDefault);
// @ts-expect-error -- ArkType rejects colon-prefixed names.
arktypePrimitives(reservedPrefix);
// @ts-expect-error -- Explicit theme annotations enforce the constraint too.
const invalidTheme: PatchSmithTheme = reservedState;
void invalidTheme;
// @ts-expect-error -- Host theme resolution accepts the same constrained configuration.
resolveTheme(reservedDefault);

// @ts-expect-error -- Every breakpoint requires a media-query width; there is no null fallback breakpoint.
zodPrimitives({ breakpoints: { base: null } });
