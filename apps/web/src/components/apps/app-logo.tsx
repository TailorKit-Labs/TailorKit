import { cn } from "@tailorkit/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@tailorkit/ui/avatar";
import { AppWindowIcon } from "lucide-react";

import { useTheme } from "#lib/theme";

interface AppLogoProps {
  className?: string;
  logoPaths?: {
    dark?: string;
    light?: string;
  };
  name: string;
}

export function AppLogo({ className, logoPaths, name }: AppLogoProps) {
  const { resolvedTheme } = useTheme();
  const logoPath =
    resolvedTheme === "dark"
      ? (logoPaths?.dark ?? logoPaths?.light)
      : (logoPaths?.light ?? logoPaths?.dark);

  return (
    <Avatar className={cn("bg-card rounded-lg border", className)}>
      {logoPath ? (
        <AvatarImage
          alt={`${name} logo`}
          className="object-contain p-1"
          src={logoPath}
        />
      ) : null}
      <AvatarFallback className="text-muted-foreground rounded-lg">
        <AppWindowIcon aria-hidden="true" className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  );
}
