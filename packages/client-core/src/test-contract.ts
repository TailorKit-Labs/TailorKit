import { defineContract } from "@patchsmith/core/schema";
import type {
  EmptyDefinitionMap,
  PatchSmithContract,
} from "@patchsmith/core/schema";
import { z } from "zod";

const viewSchema = z.looseObject({}).optional();
type TestContract = PatchSmithContract<
  EmptyDefinitionMap,
  { readonly "/": typeof viewSchema },
  {
    readonly page: {
      readonly multiple: boolean;
      readonly views: readonly ["/"];
    };
  },
  EmptyDefinitionMap,
  EmptyDefinitionMap
>;

export const testContract = (multiple = false): TestContract =>
  defineContract({
    slots: { page: { multiple, views: ["/"] } },
    views: { "/": viewSchema },
  });
