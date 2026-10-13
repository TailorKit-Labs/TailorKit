import { defineContract } from "@tailorkit/core/schema";
import { z } from "zod";

export const testContract = (multiple = false) =>
  defineContract({
    slots: { page: { multiple, views: ["/"] } },
    views: { "/": z.looseObject({}).optional() },
  });
