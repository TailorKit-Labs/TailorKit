import type {
  SendBetterAuthOtpInput,
  SendEmailInput,
  SendOrganizationInvitationEmailInput,
} from "./types";

export type { BetterAuthEmailType } from "#templates/better-auth";

export type {
  SendBetterAuthOtpInput,
  SendEmailInput,
  SendOrganizationInvitationEmailInput,
} from "./types";

// Keep templates, rendering, and delivery providers out of callers' startup path.
export const sendEmail = async (input: SendEmailInput) => {
  const { sendEmail: send } = await import("./send");
  await send(input);
};

export const sendBetterAuthOtpEmail = async (input: SendBetterAuthOtpInput) => {
  const { sendBetterAuthOtpEmail: send } = await import("./send");
  await send(input);
};

export const sendOrganizationInvitationEmail = async (
  input: SendOrganizationInvitationEmailInput
) => {
  const { sendOrganizationInvitationEmail: send } = await import("./send");
  await send(input);
};
