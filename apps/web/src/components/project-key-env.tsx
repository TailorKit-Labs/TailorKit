import { useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@tailorkit/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@tailorkit/ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@tailorkit/ui/tooltip";
import { toastManager } from "@tailorkit/ui/toast";

export function ProjectKeyEnv({ apiKey }: { apiKey: string }) {
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
    <section aria-label="Project setup" className="w-full max-w-2xl space-y-3">
      <h2 className="font-medium text-lg">Get set up</h2>
      <InputGroup className="bg-muted">
        <InputGroupInput
          aria-label="Project API key"
          className="min-w-0 font-mono text-xs sm:text-sm"
          readOnly
          type={showApiKey ? "text" : "password"}
          value={apiKey}
        />
        <InputGroupAddon align="inline-start" className="shrink-0">
          <InputGroupText className="font-mono text-foreground text-xs sm:text-sm">
            TAILORKIT_PROJECT_KEY=
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupAddon align="inline-end" className="gap-1">
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Copy .env"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={copyEnv}
                />
              }
            >
              <CopyIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup>Copy .env</TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground text-sm">
        Add this to your backend's .env file. Follow the{" "}
        <a
          className="text-foreground underline underline-offset-4 hover:text-primary"
          href="https://tailorkit.dev/docs/installation"
          rel="noopener noreferrer"
          target="_blank"
        >
          installation guide
        </a>{" "}
        to get started.
      </p>
    </section>
  );
}
