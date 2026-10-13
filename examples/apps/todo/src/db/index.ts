import { defineDatabase } from "tailorkit/fn";
import { relations } from "./relations";

export const db = defineDatabase({ relations });

export * from "./schema";
