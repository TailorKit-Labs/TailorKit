import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";

/** Dependencies for disposable build and deployment test projects. */
export async function linkTestDependencies(root: string): Promise<void> {
  const modules = path.join(root, "node_modules");
  await mkdir(modules, { recursive: true });
  for (const dependency of ["preact", "typescript", "vite", "zod"]) {
    await symlink(
      path.resolve(import.meta.dirname, "../node_modules", dependency),
      path.join(modules, dependency),
      "dir",
    );
  }
  await symlink(
    path.resolve(import.meta.dirname, "../../tailorkit"),
    path.join(modules, "tailorkit"),
    "dir",
  );
}
