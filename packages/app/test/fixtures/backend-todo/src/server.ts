import { defineServer } from "tailorkit/server";

import { importTodo } from "./functions/import-todo";
import * as todos from "./functions/todos";

const app = defineServer({ ...todos, importTodo });

export default app;
