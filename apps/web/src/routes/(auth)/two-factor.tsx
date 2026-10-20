"use client";

import { Button } from "@patchsmith/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@patchsmith/ui/card";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@patchsmith/ui/dialog";
import { Field, FieldError, FieldLabel } from "@patchsmith/ui/field";
import { Logo } from "@patchsmith/ui/logo";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "@patchsmith/ui/otp-field";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Fragment, useRef, useState } from "react";

import { authClient } from "#lib/auth-client";
import { orpc } from "#lib/orpc";
import { getSameOriginPath } from "#lib/safe-return-url";

const OTP_LENGTH = 6;

const BACKUP_CODE_LENGTH = 10;

const OTP_SLOT_KEYS = Array.from(
  { length: OTP_LENGTH },
  (_, index) => `otp-slot-${index}`
);

const BACKUP_CODE_SLOT_KEYS = Array.from(
  { length: BACKUP_CODE_LENGTH },
  (_, index) => `backup-code-slot-${index}`
);

const formatBackupCode = (code: string) =>
  `${code.slice(0, 5)}-${code.slice(5)}`;

const TwoFactorPage = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [backupCodeOpen, setBackupCodeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodeError, setBackupCodeError] = useState<string | null>(null);
  const [isTotpPending, setIsTotpPending] = useState(false);
  const [isBackupCodePending, setIsBackupCodePending] = useState(false);
  const totpVerificationInProgressRef = useRef(false);
  const backupCodeVerificationInProgressRef = useRef(false);
  const backupCodeDialogSessionRef = useRef(0);

  const navigateAfterVerification = async (destination: string) => {
    const currentLocation = window.location.href;
    try {
      await queryClient.invalidateQueries(orpc.user.getSession.queryOptions());
      await router.navigate({ href: destination });
    } catch {
      window.location.assign(destination);
      return;
    }

    if (window.location.href === currentLocation) {
      window.location.assign(destination);
    }
  };

  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  const verify = async (verificationCode: string, useBackupCode = false) => {
    const expectedLength = useBackupCode ? BACKUP_CODE_LENGTH : OTP_LENGTH;
    const verificationInProgressRef = useBackupCode
      ? backupCodeVerificationInProgressRef
      : totpVerificationInProgressRef;
    if (
      verificationCode.length !== expectedLength ||
      verificationInProgressRef.current
    ) {
      return;
    }

    verificationInProgressRef.current = true;
    const backupCodeDialogSession = backupCodeDialogSessionRef.current;
    let redirecting = false;
    if (useBackupCode) {
      setBackupCodeError(null);
      setIsBackupCodePending(true);
    } else {
      setError(null);
      setIsTotpPending(true);
    }
    try {
      const result = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({
            code: formatBackupCode(verificationCode),
          })
        : await authClient.twoFactor.verifyTotp({ code: verificationCode });

      if (result.error) {
        const message =
          result.error.message ??
          (useBackupCode
            ? "That backup code is not valid."
            : "That verification code is not valid.");
        if (
          useBackupCode &&
          backupCodeDialogSessionRef.current === backupCodeDialogSession
        ) {
          setBackupCodeError(message);
        } else if (!useBackupCode) {
          setError(message);
        }
        return;
      }

      const returnPath = getSameOriginPath(
        window.sessionStorage.getItem("patchsmith.two-factor-return-to") ??
          undefined,
        window.location.origin
      );
      window.sessionStorage.removeItem("patchsmith.two-factor-return-to");
      const destination = returnPath ?? "/";
      await navigateAfterVerification(destination);
      redirecting = true;
    } catch {
      if (
        useBackupCode &&
        backupCodeDialogSessionRef.current === backupCodeDialogSession
      ) {
        setBackupCodeError(
          "Unable to verify that backup code. Please try again."
        );
      } else if (!useBackupCode) {
        setError(
          "Unable to verify that authentication code. Please try again."
        );
      }
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler does not support try/finally; cleanup must also run after failures.
    } finally {
      verificationInProgressRef.current = false;
      if (!redirecting) {
        if (useBackupCode) {
          setIsBackupCodePending(false);
        } else {
          setIsTotpPending(false);
        }
      }
    }
  };

  const handleBackupCodeOpenChange = (open: boolean) => {
    if (open === backupCodeOpen) {
      return;
    }

    backupCodeDialogSessionRef.current += 1;
    setBackupCodeOpen(open);
    if (!open) {
      setBackupCode("");
      setBackupCodeError(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <a
          className="flex items-center gap-2"
          href="https://patchsmith.io/home"
        >
          <Logo className="size-6" />
          <span className="text-lg font-semibold">Patchsmith</span>
        </a>
        <CardFrame className="w-full">
          <Card>
            <CardHeader>
              <CardTitle>Verify it’s you</CardTitle>
              <CardDescription>
                Enter the current code from your authenticator app.
              </CardDescription>
            </CardHeader>
            <CardPanel>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col items-center gap-6">
                  <Field className="items-center">
                    <FieldLabel className="sr-only">
                      Authentication code
                    </FieldLabel>
                    <OTPField
                      autoComplete="one-time-code"
                      className="justify-center"
                      length={OTP_LENGTH}
                      onValueChange={(value) => {
                        setCode(value);
                        setError(null);
                        if (value.length === OTP_LENGTH) {
                          void verify(value);
                        }
                      }}
                      disabled={isTotpPending}
                      size="lg"
                      value={code}
                    >
                      {OTP_SLOT_KEYS.map((key, index) => (
                        <Fragment key={key}>
                          <OTPFieldInput
                            aria-invalid={
                              error !== undefined &&
                              error !== null &&
                              error !== ""
                                ? true
                                : undefined
                            }
                            aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                            autoFocus={index === 0}
                          />
                          {index === 2 ? <OTPFieldSeparator /> : null}
                        </Fragment>
                      ))}
                    </OTPField>
                    {error !== undefined && error !== null && error !== "" ? (
                      <FieldError>{error}</FieldError>
                    ) : null}
                  </Field>
                </div>
                <Button
                  disabled={code.length !== OTP_LENGTH || isTotpPending}
                  loading={isTotpPending}
                  onClick={() => {
                    void (async () => {
                      await verify(code);
                    })();
                  }}
                  type="button"
                >
                  Verify
                </Button>
                <Button
                  className="self-center"
                  onClick={() => {
                    handleBackupCodeOpenChange(true);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Use a backup code
                </Button>
              </div>
            </CardPanel>
          </Card>
          <CardFrameFooter className="relative">
            <Link
              className="text-sm text-muted-foreground hover:underline"
              search={{
                email: undefined,
                error: undefined,
                error_description: undefined,
                return_to: undefined,
              }}
              to="/login"
            >
              Back to sign in
            </Link>
          </CardFrameFooter>
        </CardFrame>
      </div>
      <Dialog open={backupCodeOpen} onOpenChange={handleBackupCodeOpenChange}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Use a backup code</DialogTitle>
            <DialogDescription>
              Enter one of the recovery codes you saved when enabling two-factor
              authentication.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col items-center">
            <Field className="items-center">
              <FieldLabel className="sr-only">Backup code</FieldLabel>
              <OTPField
                autoComplete="off"
                className="justify-center"
                length={BACKUP_CODE_LENGTH}
                onValueChange={(value) => {
                  setBackupCode(value);
                  setBackupCodeError(null);
                  if (value.length === BACKUP_CODE_LENGTH) {
                    void verify(value, true);
                  }
                }}
                disabled={isBackupCodePending}
                size="compact"
                validationType="alphanumeric"
                value={backupCode}
              >
                {BACKUP_CODE_SLOT_KEYS.map((key, index) => (
                  <Fragment key={key}>
                    <OTPFieldInput
                      aria-invalid={
                        backupCodeError !== undefined &&
                        backupCodeError !== null &&
                        backupCodeError !== ""
                          ? true
                          : undefined
                      }
                      aria-label={`Character ${index + 1} of ${BACKUP_CODE_LENGTH}`}
                      autoFocus={index === 0}
                    />
                    {index === 4 ? (
                      <OTPFieldSeparator className="mx-1" />
                    ) : null}
                  </Fragment>
                ))}
              </OTPField>
              {backupCodeError !== undefined &&
              backupCodeError !== null &&
              backupCodeError !== "" ? (
                <FieldError>{backupCodeError}</FieldError>
              ) : null}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose
              render={<Button size="sm" type="button" variant="ghost" />}
            >
              Cancel
            </DialogClose>
            <Button
              disabled={
                backupCode.length !== BACKUP_CODE_LENGTH || isBackupCodePending
              }
              loading={isBackupCodePending}
              onClick={() => {
                void (async () => {
                  await verify(backupCode, true);
                })();
              }}
              size="sm"
              type="button"
            >
              Verify
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/two-factor")({
  component: TwoFactorPage,
});
