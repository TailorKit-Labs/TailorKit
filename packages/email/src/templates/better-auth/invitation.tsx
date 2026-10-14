import { Button, Heading, Section, Text } from "react-email";

import { AuthEmailLayout, COMPANY_NAME } from "./shared";

export interface InvitationTemplateProps {
  acceptUrl: string;
  inviterName?: string;
  logoBaseUrl?: string;
  organizationName: string;
  role?: string;
}

export const InvitationTemplate = ({
  acceptUrl,
  inviterName,
  logoBaseUrl,
  organizationName,
  role = "member",
}: InvitationTemplateProps) => {
  const preview = `${inviterName ?? "Someone"} invited you to join ${organizationName}`;

  return (
    <AuthEmailLayout logoBaseUrl={logoBaseUrl} preview={preview}>
      <Section className="mb-3">
        <Heading
          as="h1"
          className="m-0 text-center font-sans text-[28px] leading-9 font-semibold"
        >
          Join {organizationName}
        </Heading>
      </Section>

      <Text className="mx-auto mt-0 mb-8 max-w-[420px] text-center font-sans text-[16px] leading-6 text-muted-foreground">
        {inviterName ?? "Someone"} invited you to join {organizationName} as{" "}
        {role} on {COMPANY_NAME}.
      </Text>

      <Button
        className="rounded-md bg-primary px-5 py-3 text-center text-sm font-medium text-primary-foreground"
        href={acceptUrl}
      >
        Review invitation
      </Button>

      <Text className="mx-auto mt-8 mb-0 max-w-[420px] text-center font-sans text-[13px] leading-5 text-muted-foreground">
        If you were not expecting this invitation, you can ignore this email.
      </Text>
    </AuthEmailLayout>
  );
};
