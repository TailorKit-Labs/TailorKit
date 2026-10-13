import { createElement } from "react";

import { ChangeEmailTemplate } from "./better-auth/change-email";
import { EmailVerificationTemplate } from "./better-auth/email-verification";
import { ForgetPasswordTemplate } from "./better-auth/forget-password";
import type { BetterAuthTemplateProps } from "./better-auth/shared";
import { SignInTemplate } from "./better-auth/sign-in";

export type BetterAuthEmailType =
  | "change-email"
  | "email-verification"
  | "forget-password"
  | "sign-in";

interface BetterAuthOtpTemplateProps extends BetterAuthTemplateProps {
  type: BetterAuthEmailType;
}

const emailConfig = {
  "change-email": {
    component: ChangeEmailTemplate,
    subject: "Confirm your new email",
  },
  "email-verification": {
    component: EmailVerificationTemplate,
    subject: "Verify your email",
  },
  "forget-password": {
    component: ForgetPasswordTemplate,
    subject: "Reset your password",
  },
  "sign-in": {
    component: SignInTemplate,
    subject: "Your sign-in code",
  },
} satisfies Record<
  BetterAuthEmailType,
  {
    component: (props: BetterAuthTemplateProps) => React.ReactNode;
    subject: string;
  }
>;

export const betterAuthEmailSubjects = Object.fromEntries(
  Object.entries(emailConfig).map(([type, value]) => [type, value.subject])
) as Record<BetterAuthEmailType, string>;

export const BetterAuthOtpTemplate = ({
  logoBaseUrl,
  otp,
  type,
}: BetterAuthOtpTemplateProps) => {
  const Template = emailConfig[type].component;

  return createElement(Template, { logoBaseUrl, otp });
};

export { ChangeEmailTemplate } from "./better-auth/change-email";
export { EmailVerificationTemplate } from "./better-auth/email-verification";
export { ForgetPasswordTemplate } from "./better-auth/forget-password";
export { SignInTemplate } from "./better-auth/sign-in";
