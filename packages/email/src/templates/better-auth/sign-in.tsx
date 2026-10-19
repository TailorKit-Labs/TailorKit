import { AuthEmailLayout, AuthOtpContent, COMPANY_NAME } from "./shared";
import type { BetterAuthTemplateProps } from "./shared";

export const SignInTemplate = ({
  logoBaseUrl,
  otp,
}: BetterAuthTemplateProps) => (
  <AuthEmailLayout
    logoBaseUrl={logoBaseUrl}
    preview={`Your ${COMPANY_NAME} sign-in code.`}
  >
    <AuthOtpContent
      description={
        <>
          Use this code to sign in to {COMPANY_NAME}.
          <br />
          Only enter it on a page you opened yourself.
        </>
      }
      heading="Sign in to PatchSmith"
      otp={otp}
    />
  </AuthEmailLayout>
);

SignInTemplate.PreviewProps = {
  logoBaseUrl: "http://localhost:3000",
  otp: "123456",
} satisfies BetterAuthTemplateProps;

export default SignInTemplate;
