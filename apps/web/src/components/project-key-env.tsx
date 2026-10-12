import { useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@tailorkit/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@tailorkit/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Get started</CardTitle>
        <CardDescription>
          Follow the{" "}
          <a
            className="text-foreground underline underline-offset-4 hover:text-primary"
            href="https://tailorkit.dev/docs/installation"
            rel="noopener noreferrer"
            target="_blank"
          >
            installation guide
          </a>{" "}
          to get started.
        </CardDescription>
      </CardHeader>
      <CardPanel className="pt-0">
        <InputGroup className="bg-muted">
          <InputGroupInput
            aria-label="Project API key"
            className="min-w-0 font-mono text-xs sm:text-sm [&_input]:ps-0!"
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
      </CardPanel>
    </Card>
  );
}
