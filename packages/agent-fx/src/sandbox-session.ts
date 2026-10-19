import type { Sandbox } from "@vercel/sandbox";

type NativeSession = ReturnType<Sandbox["currentSession"]>;

/** The sandbox operations used by setup and verification, injectable in tests. */
export interface AppSandboxSession {
  readFileToBuffer: NativeSession["readFileToBuffer"];
  writeFiles: NativeSession["writeFiles"];
  runCommand: (
    ...args: Parameters<NativeSession["runCommand"]>
  ) => Promise<
    Pick<
      Awaited<ReturnType<NativeSession["runCommand"]>>,
      "exitCode" | "stdout" | "stderr"
    >
  >;
}
