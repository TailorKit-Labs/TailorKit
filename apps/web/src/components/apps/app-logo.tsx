import { Avatar, AvatarFallback, AvatarImage } from "@patchsmith/ui/avatar";
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

export const AppLogo = ({ className, logoPaths, name }: AppLogoProps) => {
  const { resolvedTheme } = useTheme();

  const logoPath =
    resolvedTheme === "dark"
      ? (logoPaths?.dark ?? logoPaths?.light)
      : (logoPaths?.light ?? logoPaths?.dark);

  return (
    <Avatar className={className}>
      {logoPath !== undefined && logoPath !== null && logoPath !== "" ? (
        <AvatarImage
          alt={`${name} logo`}
          className="object-contain"
          src={logoPath}
        />
      ) : null}
      <AvatarFallback>
        <AppWindowIcon aria-hidden="true" className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  );
};
