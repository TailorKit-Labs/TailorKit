import type {
  SendBetterAuthOtpInput,
  SendOrganizationInvitationEmailInput,
} from "@tailorkit/email";

export type { BetterAuthEmailType as EmailType } from "@tailorkit/email";

// API-key verification uses auth too; load email rendering and transports only
// when a sign-in or invitation actually sends a message.
export const sendOtpEmail = async (input: SendBetterAuthOtpInput) => {
  const { sendBetterAuthOtpEmail } = await import("@tailorkit/email");
  await sendBetterAuthOtpEmail(input);
};

export const sendInvitationEmail = async (
  input: SendOrganizationInvitationEmailInput
) => {
  const { sendOrganizationInvitationEmail } = await import("@tailorkit/email");
  await sendOrganizationInvitationEmail(input);
};
