import { defineServer } from "tailorkit/fn";
import * as todos from "./functions/todos";
import { importTodo } from "./functions/import-todo";

const app = defineServer({ ...todos, importTodo });

export default app;
