import type { ReactNode } from "react";
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { emailColorSchemeCss, emailTailwindConfig } from "../theme";
import { TailorKitFonts } from "../theme-fonts";

export const COMPANY_NAME = "TailorKit";

const DEFAULT_LOGO_BASE_URL = "http://localhost:3000";

const CODE_EXPIRY_MINUTES = 10;

export interface BetterAuthTemplateProps {
  logoBaseUrl?: string;
  otp: string;
}

interface AuthEmailLayoutProps {
  children: ReactNode;
  logoBaseUrl?: string;
  preview: string;
  unsubscribeUrl?: string;
}

interface AuthOtpContentProps {
  description: ReactNode;
  heading: string;
  otp: string;
}

const getLogoUrl = (logoBaseUrl: string = DEFAULT_LOGO_BASE_URL) =>
  new URL("/brand/mark-auto.svg", logoBaseUrl).toString();

const AuthEmailHeader = ({
  logoBaseUrl,
}: Pick<AuthEmailLayoutProps, "logoBaseUrl">) => (
  <Section className="mb-3 px-6">
    <Row>
      <Column align="center" className="py-[7px] align-middle">
        <Row>
          <Column className="w-[40px] align-middle">
            <Img
              alt={`${COMPANY_NAME} logo`}
              className="h-auto"
              height="32"
              src={getLogoUrl(logoBaseUrl)}
              width="32"
            />
          </Column>
          <Column className="align-middle">
            <Text className="text-foreground m-0 text-left font-sans text-[18px] leading-6 font-semibold">
              {COMPANY_NAME}
            </Text>
          </Column>
        </Row>
      </Column>
    </Row>
  </Section>
);

const AuthEmailFooter = ({
  unsubscribeUrl,
}: Pick<AuthEmailLayoutProps, "unsubscribeUrl">) => (
  <Section className="bg-muted border-border rounded-b-md border-t">
    <Row>
      <Column className="px-6 py-10 text-center">
        <Text className="text-muted-foreground mx-auto mt-0 mb-0 max-w-[320px] text-center font-sans text-[13px] leading-5">
          You are receiving this email because a security action was requested
          for your {COMPANY_NAME} account. If you did not request this, you can
          ignore this email.
        </Text>
        {unsubscribeUrl ? (
          <Text className="text-muted-foreground m-0 mt-5 text-center font-sans text-[11px] leading-4">
            <Link
              href={unsubscribeUrl}
              className="text-muted-foreground underline"
            >
              Unsubscribe
            </Link>{" "}
            from {COMPANY_NAME} marketing emails.
          </Text>
        ) : null}
      </Column>
    </Row>
  </Section>
);

export const AuthEmailLayout = ({
  children,
  logoBaseUrl,
  preview,
  unsubscribeUrl,
}: AuthEmailLayoutProps) => (
  <Tailwind config={emailTailwindConfig}>
    <Html lang="en">
      <Head>
        <TailorKitFonts />
        <style>{emailColorSchemeCss}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body className="body bg-sidebar text-foreground m-0 text-center font-sans">
        <Container className="mx-auto mt-8 w-full max-w-[640px]">
          <Section className="px-6 py-4">
            <AuthEmailHeader logoBaseUrl={logoBaseUrl} />
            <Section className="card-frame bg-card border-border text-card-foreground rounded-lg border">
              <Section className="bg-card text-card-foreground rounded-md px-10 py-16 text-center">
                {children}
              </Section>
              <AuthEmailFooter unsubscribeUrl={unsubscribeUrl} />
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  </Tailwind>
);

export const AuthOtpContent = ({
  description,
  heading,
  otp,
}: AuthOtpContentProps) => (
  <>
    <Section className="mb-3">
      <Heading
        as="h1"
        className="m-0 text-center font-sans text-[28px] leading-9 font-semibold"
      >
        {heading}
      </Heading>
    </Section>

    <Text className="text-muted-foreground mx-auto mt-0 mb-8 max-w-[390px] text-center font-sans text-[16px] leading-6">
      {description}
    </Text>

    <Section className="border-border bg-muted text-foreground mb-6 max-w-[320px] rounded-lg border px-4 py-[18px] text-center font-mono text-[32px] leading-10 font-bold tracking-[8px]">
      {otp.slice(0, 3)}-{otp.slice(3)}
    </Section>

    <Text className="text-muted-foreground mx-auto mt-8 mb-0 max-w-[400px] text-center font-sans text-[13px] leading-5">
      This code expires in {CODE_EXPIRY_MINUTES} minutes.
    </Text>
  </>
);
