import { Button } from "@patchsmith/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@patchsmith/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@patchsmith/ui/input-group";
import { toastManager } from "@patchsmith/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@patchsmith/ui/tooltip";
import { CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";

export const ProjectKeyEnv = ({ apiKey }: { apiKey: string }) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const revealLabel = showApiKey ? "Hide API key" : "Show API key";

  const copyEnv = async () => {
    try {
      await navigator.clipboard.writeText(`PATCHSMITH_PROJECT_KEY=${apiKey}`);
      toastManager.add({ title: ".env copied", type: "success" });
    } catch {
      toastManager.add({
        description: "Try again, or reveal the key and copy the line manually.",
        title: "Couldn't copy .env",
        type: "error",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          Follow the{" "}
          <a
            className="text-foreground underline underline-offset-4 hover:text-primary"
            href="https://patchsmith.io/docs/installation"
            rel="noopener noreferrer"
            target="_blank"
          >
            installation guide
          </a>{" "}
          to get started.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <InputGroup>
          <InputGroupInput
            aria-label="Project API key"
            className="min-w-0"
            readOnly
            type={showApiKey ? "text" : "password"}
            value={apiKey}
          />
          <InputGroupAddon align="inline-start" className="shrink-0">
            <InputGroupText>PATCHSMITH_PROJECT_KEY=</InputGroupText>
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={revealLabel}
                    aria-pressed={showApiKey}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowApiKey((value) => !value);
                    }}
                  />
                }
              >
                {showApiKey ? (
                  <EyeOffIcon aria-hidden="true" />
                ) : (
                  <EyeIcon aria-hidden="true" />
                )}
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
                    onClick={(...args: Parameters<typeof copyEnv>) => {
                      void copyEnv(...args);
                    }}
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
};
