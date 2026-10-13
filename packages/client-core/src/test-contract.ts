import { defineContract } from "@tailorkit/core/schema";
import { z } from "zod";

export function testContract(multiple = false) {
  return defineContract({
    slots: { page: { multiple, views: ["/"] } },
    views: { "/": z.looseObject({}).optional() },
  });
}
