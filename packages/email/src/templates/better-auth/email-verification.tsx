import { AuthEmailLayout, AuthOtpContent, COMPANY_NAME } from "./shared";
import type { BetterAuthTemplateProps } from "./shared";

export const EmailVerificationTemplate = ({
  logoBaseUrl,
  otp,
}: BetterAuthTemplateProps) => (
  <AuthEmailLayout
    logoBaseUrl={logoBaseUrl}
    preview={`Verify your ${COMPANY_NAME} email address.`}
  >
    <AuthOtpContent
      description={
        <>
          Enter this code to verify your email address and finish setting up
          your account.
        </>
      }
      heading="Verify your email address"
      otp={otp}
    />
  </AuthEmailLayout>
);

EmailVerificationTemplate.PreviewProps = {
  otp: "123456",
} satisfies BetterAuthTemplateProps;

export default EmailVerificationTemplate;
