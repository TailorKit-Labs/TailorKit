import { Logo } from "@tailorkit/ui/logo";
import { Link } from "@tanstack/react-router";

export function SidebarBrand() {
  return (
    <Link className="flex items-center gap-2" to="/">
      <Logo className="text-foreground size-6" />
      <span className="text-base font-semibold">TailorKit</span>
    </Link>
  );
}
