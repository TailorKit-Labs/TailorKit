import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";

/** Dependencies for disposable build and deployment test projects. */
export const linkTestDependencies = async (root: string): Promise<void> => {
  const modules = path.join(root, "node_modules");
  await mkdir(modules, { recursive: true });
  await Promise.all(
    ["preact", "typescript", "vite", "zod"].map(async (dependency) => {
      await symlink(
        path.resolve(import.meta.dirname, "../node_modules", dependency),
        path.join(modules, dependency),
        "dir"
      );
    })
  );
  await symlink(
    path.resolve(import.meta.dirname, "../../tailorkit"),
    path.join(modules, "tailorkit"),
    "dir"
  );
};
