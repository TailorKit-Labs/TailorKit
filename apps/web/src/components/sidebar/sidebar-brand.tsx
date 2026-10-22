import { Logo } from "@patchsmith/ui/logo";
import { Link } from "@tanstack/react-router";

export const SidebarBrand = () => (
  <Link className="flex items-center gap-2 text-foreground" to="/">
    <Logo className="size-6" />
    <span className="text-base font-semibold">Patchsmith</span>
  </Link>
);
