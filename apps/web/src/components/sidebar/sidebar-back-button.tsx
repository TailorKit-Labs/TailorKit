import { Button } from "@tailorkit/ui/button";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

type SidebarBackButtonProps = LinkProps & { label: string };

export const SidebarBackButton = ({
  label,
  ...props
}: SidebarBackButtonProps) => (
  <Button
    className="mb-1 w-full px-2.5 text-center text-sidebar-accent-foreground/75 hover:text-sidebar-accent-foreground"
    render={<Link {...props} />}
    size="lg"
    variant="ghost"
  >
    <ChevronLeftIcon className="size-4" />
    <span className="grow truncate">{label}</span>
    <span className="size-4" aria-hidden="true" />
  </Button>
);
