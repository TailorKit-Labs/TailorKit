import { defineContract } from "@tailorkit/core/schema";
import type {
  EmptyDefinitionMap,
  TailorKitContract,
} from "@tailorkit/core/schema";
import { z } from "zod";

const viewSchema = z.looseObject({}).optional();
type TestContract = TailorKitContract<
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
