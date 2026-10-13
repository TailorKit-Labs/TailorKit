import { mkdir } from "node:fs/promises";

await mkdir(".data", { recursive: true });
