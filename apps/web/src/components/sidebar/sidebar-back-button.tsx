import { SidebarMenuButton } from "@tailorkit/ui/sidebar";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

type SidebarBackButtonProps = LinkProps & { label: string };

export const SidebarBackButton = ({
  label,
  ...props
}: SidebarBackButtonProps) => (
  <SidebarMenuButton
    className="mb-1 h-10 text-center sm:h-9"
    render={<Link {...props} />}
  >
    <ChevronLeftIcon className="size-4" />
    <span className="grow truncate">{label}</span>
    <span className="size-4" aria-hidden="true" />
  </SidebarMenuButton>
);
