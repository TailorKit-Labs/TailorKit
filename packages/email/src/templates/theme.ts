import type { TailwindConfig } from "react-email";

// Tailwind neutral palette — synced with @packages/ui/src/styles/globals.css
const neutral = {
  100: "#f5f5f5",
  200: "#e5e5e5",
  300: "#d4d4d4",
  400: "#a3a3a3",
  50: "#fafafa",
  500: "#737373",
  600: "#525252",
  700: "#404040",
  800: "#262626",
  900: "#171717",
  950: "#0a0a0a",
} as const;

const red = {
  400: "#f87171",
  500: "#ef4444",
  700: "#b91c1c",
} as const;

interface EmailColorScheme {
  accent: string;
  accentForeground: string;
  background: string;
  border: string;
  card: string;
  cardForeground: string;
  destructive: string;
  destructiveForeground: string;
  foreground: string;
  input: string;
  muted: string;
  mutedForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  sidebar: string;
}

export const emailTheme = {
  color: {
    accent: "rgba(0, 0, 0, 0.04)",
    accentForeground: neutral[800],
    background: "#ffffff",
    border: "#ebebeb",
    card: "#ffffff",
    cardForeground: neutral[800],
    destructive: red[500],
    destructiveForeground: red[700],
    foreground: neutral[800],
    input: "#ffffff",
    muted: "#f8f8f8",
    mutedForeground: neutral[500],
    popover: "#ffffff",
    popoverForeground: neutral[800],
    primary: neutral[800],
    primaryForeground: neutral[50],
    secondary: "rgba(0, 0, 0, 0.04)",
    secondaryForeground: neutral[800],
    sidebar: "#fafafa",
  } satisfies EmailColorScheme,
  darkColor: {
    accent: "rgba(255, 255, 255, 0.04)",
    accentForeground: neutral[100],
    background: "#0f0f0f",
    border: "#1f1f1f",
    card: "#141414",
    cardForeground: neutral[100],
    destructive: "rgba(255, 255, 255, 0.9)",
    destructiveForeground: red[400],
    foreground: neutral[100],
    input: "#1a1a1a",
    muted: "#1a1a1a",
    mutedForeground: neutral[400],
    popover: "#121214",
    popoverForeground: neutral[100],
    primary: neutral[100],
    primaryForeground: neutral[800],
    secondary: "rgba(255, 255, 255, 0.04)",
    secondaryForeground: neutral[100],
    sidebar: "#111111",
  } satisfies EmailColorScheme,
  fontFamily: {
    mono: "'Geist Mono', 'SFMono-Regular', Consolas, monospace",
    sans: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  radius: {
    lg: "10px",
    md: "8px",
    sm: "6px",
  },
} as const;

export const emailTailwindConfig: TailwindConfig = {
  theme: {
    extend: {
      fontFamily: {
        mono: [emailTheme.fontFamily.mono],
        sans: [emailTheme.fontFamily.sans],
      },
    },
  },
};

const createEmailColorSchemeCss = (scheme: EmailColorScheme) => `
  .body {
    background-color: ${scheme.background} !important;
    color: ${scheme.foreground} !important;
  }

  .bg-background {
    background-color: ${scheme.background} !important;
  }

  .bg-sidebar {
    background-color: ${scheme.sidebar} !important;
  }

  .text-foreground {
    color: ${scheme.foreground} !important;
  }

  .bg-input {
    background-color: ${scheme.input} !important;
  }

  .bg-card {
    background-color: ${scheme.card} !important;
  }

  .text-card-foreground {
    color: ${scheme.cardForeground} !important;
  }

  .bg-popover {
    background-color: ${scheme.popover} !important;
  }

  .text-popover-foreground {
    color: ${scheme.popoverForeground} !important;
  }

  .bg-primary {
    background-color: ${scheme.primary} !important;
  }

  .text-primary {
    color: ${scheme.primary} !important;
  }

  .text-primary-foreground {
    color: ${scheme.primaryForeground} !important;
  }

  .bg-secondary {
    background-color: ${scheme.secondary} !important;
  }

  .text-secondary-foreground {
    color: ${scheme.secondaryForeground} !important;
  }

  .bg-muted {
    background-color: ${scheme.muted} !important;
  }

  .text-muted-foreground {
    color: ${scheme.mutedForeground} !important;
  }

  .bg-accent {
    background-color: ${scheme.accent} !important;
  }

  .text-accent-foreground {
    color: ${scheme.accentForeground} !important;
  }

  .bg-destructive {
    background-color: ${scheme.destructive} !important;
  }

  .text-destructive {
    color: ${scheme.destructive} !important;
  }

  .text-destructive-foreground {
    color: ${scheme.destructiveForeground} !important;
  }

  .border-border {
    border-color: ${scheme.border} !important;
  }
`;

export const emailColorSchemeCss = `
  :root {
    color-scheme: light dark;
    supported-color-schemes: light dark;
  }

  .rounded-lg {
    border-radius: ${emailTheme.radius.lg} !important;
  }

  .rounded-md {
    border-radius: ${emailTheme.radius.md} !important;
  }

  .rounded-sm {
    border-radius: ${emailTheme.radius.sm} !important;
  }

  .card-frame {
    border-radius: ${emailTheme.radius.lg} !important;
    padding: 1px !important;
  }

  ${createEmailColorSchemeCss(emailTheme.color)}

  @media (prefers-color-scheme: dark) {
    ${createEmailColorSchemeCss(emailTheme.darkColor)}
  }
`;
