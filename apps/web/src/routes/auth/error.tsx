import { Button } from "@patchsmith/ui/button";
import {
  Card,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@patchsmith/ui/card";
import { Logo } from "@patchsmith/ui/logo";
import { useSearch, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const messages = new Map<string, string>([
  ["no_code", "The sign-in request was cancelled or did not complete."],
  ["state_mismatch", "Your sign-in session expired. Please try again."],
  ["state_not_found", "Your sign-in session expired. Please try again."],
]);

const AuthErrorPage = () => {
  const { error } = useSearch({ from: "/auth/error" });
  const message =
    error !== undefined && error !== null && error !== ""
      ? messages.get(error)
      : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <a
          className="flex items-center gap-2"
          href="https://patchsmith.io/home"
        >
          <Logo className="size-6" />
          <span className="text-lg font-semibold">PatchSmith</span>
        </a>

        <CardFrame className="w-full">
          <Card>
            <CardHeader>
              <CardTitle>We couldn&apos;t complete sign in</CardTitle>
            </CardHeader>
            <CardPanel>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {message ??
                    "Something went wrong while signing you in. Please try again."}
                </p>
                <Button
                  className="w-full"
                  render={<a aria-label="Back to sign in" href="/login" />}
                >
                  Back to sign in
                </Button>
              </div>
            </CardPanel>
          </Card>

          <CardFrameFooter className="relative">
            <p className="text-center text-sm text-muted-foreground">
              If this keeps happening, contact support.
            </p>
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/auth/error")({
  component: AuthErrorPage,
  validateSearch: z.object({
    error: z.string().optional(),
  }),
});
