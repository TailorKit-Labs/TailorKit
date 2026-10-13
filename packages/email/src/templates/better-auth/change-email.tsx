import { AuthEmailLayout, AuthOtpContent, COMPANY_NAME } from "./shared";
import type { BetterAuthTemplateProps } from "./shared";

export function ChangeEmailTemplate({
  logoBaseUrl,
  otp,
}: BetterAuthTemplateProps) {
  return (
    <AuthEmailLayout
      logoBaseUrl={logoBaseUrl}
      preview={`Confirm your new ${COMPANY_NAME} email address.`}
    >
      <AuthOtpContent
        description={
          <>
            We received a request to change the email address on your{" "}
            {COMPANY_NAME} account.
            <br />
            Enter this code to confirm the new address.
          </>
        }
        heading="Confirm your new email"
        otp={otp}
      />
    </AuthEmailLayout>
  );
}

ChangeEmailTemplate.PreviewProps = {
  otp: "123456",
} satisfies BetterAuthTemplateProps;

export default ChangeEmailTemplate;
