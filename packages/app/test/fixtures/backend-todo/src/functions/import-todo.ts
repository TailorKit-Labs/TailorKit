import { AppError, fn } from "tailorkit/server";
import { z } from "zod";

import * as todos from "./todos";

export const importTodo = fn.action
  .functions(todos)
  .input(z.object({ url: z.url() }))
  .handler(async ({ input, queries, mutations, tools, signal }) => {
    await queries.list();
    const response = await fetch(input.url, { signal });
    if (!response.ok) {
      throw new AppError("UNAVAILABLE", "External API failed");
    }
    const data = z
      .object({ title: z.string().trim().min(1).max(500) })
      .parse(await response.json());
    const text = await tools.echo(data.title);
    return mutations.add({ text });
  });
