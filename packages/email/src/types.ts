import type { BetterAuthEmailType } from "#templates/better-auth";

export interface SendEmailInput {
  from?: string;
  html: string;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string;
}

export interface SendBetterAuthOtpInput {
  email: string;
  otp: string;
  type: BetterAuthEmailType;
}

export interface SendOrganizationInvitationEmailInput {
  email: string;
  invitationId: string;
  inviterName?: string;
  organizationName: string;
  role?: string | null;
}
