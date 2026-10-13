import { AuthEmailLayout, AuthOtpContent, COMPANY_NAME } from "./shared";
import type { BetterAuthTemplateProps } from "./shared";

export const ForgetPasswordTemplate = ({
  logoBaseUrl,
  otp,
}: BetterAuthTemplateProps) => (
  <AuthEmailLayout
    logoBaseUrl={logoBaseUrl}
    preview={`Reset your ${COMPANY_NAME} password.`}
  >
    <AuthOtpContent
      description={
        <>
          We received a request to reset your {COMPANY_NAME} password.
          <br />
          Enter this code to choose a new password for your account.
        </>
      }
      heading="Reset your password"
      otp={otp}
    />
  </AuthEmailLayout>
);

ForgetPasswordTemplate.PreviewProps = {
  otp: "123456",
} satisfies BetterAuthTemplateProps;

export default ForgetPasswordTemplate;
