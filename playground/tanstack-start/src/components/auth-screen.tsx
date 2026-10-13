import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import { useState } from "react";

import { signInDemoUser } from "#lib/auth-client";
import type { SignInChoice } from "#lib/auth-client";
import { tailor } from "#lib/tailorkit-client";

export const AuthScreen = ({ choices }: { choices: SignInChoice[] }) => {
  const [pending, setPending] = useState<string>();
  const [operationError, setOperationError] = useState<string>();

  const signIn = async (choice: SignInChoice) => {
    const key = `${choice.userId}-${choice.teamId}`;
    setPending(key);
    setOperationError(undefined);
    try {
      await signInDemoUser(choice.userId, choice.teamId);
      tailor.clearCache();
      window.location.assign("/");
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Could not sign in"
      );
      setPending(undefined);
    }
  };

  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a demo workspace</CardTitle>
          <CardDescription>
            Pick a profile and team to explore the local issue tracker.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {choices.map((choice) => {
            const key = `${choice.userId}-${choice.teamId}`;
            return (
              <Button
                key={key}
                loading={pending === key}
                onClick={() => signIn(choice)}
                variant="outline"
                className="h-auto min-h-16 w-full justify-start py-2 text-left whitespace-normal"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {choice.avatar}
                </span>
                <span className="flex flex-1 flex-col items-start">
                  <span>{choice.userName}</span>
                  <span className="text-xs text-muted-foreground">
                    {choice.teamName}
                  </span>
                </span>
              </Button>
            );
          })}
          {operationError ? (
            <p className="text-sm text-destructive" role="alert">
              {operationError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
};
