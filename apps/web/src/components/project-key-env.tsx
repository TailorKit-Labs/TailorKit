import { useState } from "react";
import { ArrowUpRightIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@tailorkit/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@tailorkit/ui/tooltip";
import { toastManager } from "@tailorkit/ui/toast";

export function ProjectKeyEnv({
  apiKey,
  keyPrefix = apiKey.slice(0, 12),
}: {
  apiKey: string;
  keyPrefix?: string;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const revealLabel = showApiKey ? "Hide API key" : "Show API key";

  async function copyEnv() {
    try {
      await navigator.clipboard.writeText(`TAILORKIT_PROJECT_KEY=${apiKey}`);
      toastManager.add({ title: ".env copied", type: "success" });
    } catch {
      toastManager.add({
        title: "Couldn't copy .env",
        description: "Try again, or reveal the key and copy the line manually.",
        type: "error",
      });
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <span className="font-mono text-muted-foreground text-xs">.env</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={revealLabel}
                  aria-pressed={showApiKey}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => setShowApiKey((value) => !value)}
                />
              }
            >
              {showApiKey ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </TooltipTrigger>
            <TooltipPopup>{revealLabel}</TooltipPopup>
          </Tooltip>
          <Button aria-label="Copy .env" size="xs" type="button" variant="ghost" onClick={copyEnv}>
            <CopyIcon aria-hidden="true" />
            Copy
          </Button>
        </div>
      </div>
      <pre
        aria-label="Project .env configuration"
        className="overflow-x-auto p-4 font-mono text-sm"
      >
        <code>
          <span className="text-muted-foreground">TAILORKIT_PROJECT_KEY</span>=
          {showApiKey ? apiKey : `${keyPrefix}*********`}
        </code>
      </pre>
      <div className="border-t px-3 py-2">
        <Button
          className="px-0"
          render={
            <a
              href="https://tailorkit.dev/docs/installation"
              rel="noopener noreferrer"
              target="_blank"
            />
          }
          size="xs"
          variant="link"
        >
          Installation guide
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
