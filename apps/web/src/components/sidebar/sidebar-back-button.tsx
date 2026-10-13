import { Button } from "@tailorkit/ui/button";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

type SidebarBackButtonProps = LinkProps & { label: string };

export function SidebarBackButton({ label, ...props }: SidebarBackButtonProps) {
  return (
    <Button
      className="text-sidebar-accent-foreground/75 hover:text-sidebar-accent-foreground mb-1 w-full px-2.5 text-center"
      render={<Link {...props} />}
      size="lg"
      variant="ghost"
    >
      <ChevronLeftIcon className="size-4" />
      <span className="grow truncate">{label}</span>
      <span className="size-4" aria-hidden="true" />
    </Button>
  );
}
