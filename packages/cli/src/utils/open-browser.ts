import { spawn } from "node:child_process";
import { platform } from "node:os";

const getBrowserCommand = (url: string) => {
  const currentPlatform = platform();

  if (currentPlatform === "darwin") {
    return { args: [url], command: "open" };
  }

  if (currentPlatform === "win32") {
    return { args: ["/c", "start", "", url], command: "cmd" };
  }

  return { args: [url], command: "xdg-open" };
};

export const openUrlInBrowser = async (url: string): Promise<boolean> =>
  await (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<boolean>();

    try {
      const { args, command } = getBrowserCommand(url);

      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      child.once("error", () => {
        resolve(false);
      });

      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch (error) {
      rejectPending(error);
    }

    return await pendingPromise;
  })();
