# PatchSmith email

`@patchsmith/email` contains email templates and delivery code for the PatchSmith platform.

Import `sendEmail`, `sendBetterAuthOtpEmail`, or `sendOrganizationInvitationEmail` normally. Each function loads the rendering and delivery implementation when called, so importing the package does not load email providers or templates.

For direct template use, import `BetterAuthOtpTemplate` or `InvitationTemplate` from `@patchsmith/email/templates`.
