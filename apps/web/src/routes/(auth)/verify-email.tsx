"use client";

import { Button } from "@patchsmith/ui/button";
import {
  Card,
  CardFooter,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@patchsmith/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@patchsmith/ui/field";
import { Logo } from "@patchsmith/ui/logo";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "@patchsmith/ui/otp-field";
import { toastManager } from "@patchsmith/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useNavigate,
  createFileRoute,
  Link,
  useSearch,
} from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { authClient } from "#lib/auth-client";
import { optionalAuthSearchString } from "#lib/auth-search";
import { getSameOriginPath } from "#lib/safe-return-url";

const OTP_LENGTH = 6;
const SLOT_KEYS = Array.from({ length: OTP_LENGTH }, (_, i) => `slot-${i}`);

const RouteComponent = () => {
  const { email, return_to } = useSearch({ from: "/(auth)/verify-email" });
  const navigate = useNavigate({ from: "/verify-email" });
  const [otp, setOtp] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentRef = useRef(false);

  const startResendTimer = useCallback(() => {
    setResendCountdown(60);
    timerRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const sendOtp = useCallback(async () => {
    setSending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setSending(false);
    if (result.error) {
      toastManager.add({
        description: result.error.message ?? "Failed to send code",
        title: "Error",
        type: "error",
      });
      return;
    }
    startResendTimer();
  }, [email, startResendTimer]);

  useEffect(() => {
    if (!sentRef.current) {
      sentRef.current = true;
      void sendOtp();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [sendOtp]);

  const queryClient = useQueryClient();

  const verifyOtp = async (code: string) => {
    setVerifying(true);
    setInvalid(false);
    const result = await authClient.signIn.emailOtp({ email, otp: code });
    setVerifying(false);
    if (result.error) {
      setInvalid(true);
      toastManager.add({
        description: result.error.message ?? "Invalid or expired code",
        title: "Verification failed",
        type: "error",
      });
      setOtp("");
      return;
    }
    toastManager.add({
      description: "Your email has been verified.",
      title: "Email verified",
      type: "success",
    });

    queryClient.clear();

    const returnPath = getSameOriginPath(return_to, window.location.origin);
    if (returnPath !== undefined && returnPath !== null && returnPath !== "") {
      window.location.href = returnPath;
    } else {
      void navigate({ to: "/" });
    }
  };

  const handleOtpChange = (value: string) => {
    setOtp(value);
    setInvalid(false);

    if (value.length === OTP_LENGTH) {
      void verifyOtp(value);
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
          <span className="text-lg font-semibold">PatchSmith</span>
        </a>
        <CardFrame className="w-full">
          <Card>
            <CardHeader>
              <CardTitle>Verify your email</CardTitle>
            </CardHeader>
            <CardPanel>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col items-center gap-6">
                  <Field className="items-center">
                    <FieldLabel>Verification code</FieldLabel>
                    <OTPField
                      length={OTP_LENGTH}
                      value={otp}
                      onValueChange={handleOtpChange}
                      disabled={verifying}
                      size="lg"
                    >
                      {SLOT_KEYS.map((key, index) => (
                        <Fragment key={key}>
                          <OTPFieldInput
                            aria-invalid={invalid || undefined}
                            aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                          />
                          {index === 2 && <OTPFieldSeparator />}
                        </Fragment>
                      ))}
                    </OTPField>
                    <FieldDescription>
                      {email
                        ? `Sent to ${email}`
                        : "Enter the 6-digit code sent to your email"}
                    </FieldDescription>
                    {invalid && (
                      <FieldError>
                        Invalid or expired code. Please try again.
                      </FieldError>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      onClick={(...args: Parameters<typeof sendOtp>) => {
                        void sendOtp(...args);
                      }}
                      disabled={sending || resendCountdown > 0}
                      loading={sending}
                      className="h-auto"
                    >
                      {resendCountdown > 0
                        ? `Resend in ${resendCountdown}s`
                        : "Resend code"}
                    </Button>
                  </Field>
                </div>
              </div>
            </CardPanel>
            <CardFooter>
              <Button
                className="w-full"
                disabled={otp.length < OTP_LENGTH || verifying}
                loading={verifying}
                onClick={() => {
                  void (async () => {
                    await verifyOtp(otp);
                  })();
                }}
              >
                Continue
              </Button>
            </CardFooter>
          </Card>
          <CardFrameFooter className="relative">
            <Button
              variant="link"
              render={<Link search={{ email, return_to }} to="/login" />}
            >
              <ChevronLeftIcon />
              Back to sign in
            </Button>
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/verify-email")({
  component: RouteComponent,
  validateSearch: z.object({
    email: optionalAuthSearchString.transform((value) => value ?? ""),
    return_to: optionalAuthSearchString,
  }),
});
