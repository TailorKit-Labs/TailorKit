import { Avatar, AvatarFallback } from "@tailorkit/ui/avatar";
import { Button } from "@tailorkit/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  ComboboxValue,
} from "@tailorkit/ui/combobox";
import { SidebarMenuButton } from "@tailorkit/ui/sidebar";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, PlusIcon, SearchIcon } from "lucide-react";

import { CreateOrgDialog } from "#components/create-org-dialog";
import { isOrgCreationManaged } from "#lib/org-creation";
import { orpc } from "#lib/orpc";

interface SwitchableOrganization {
  name: string;
  slug: string;
}

interface OrgSwitcherProps {
  orgSlug: string;
}

const orgInitials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const OrgSwitcher = ({ orgSlug }: OrgSwitcherProps) => {
  const navigate = useNavigate();
  const { data: orgs } = useSuspenseQuery(orpc.user.getOrgs.queryOptions());

  const currentOrg = orgs?.find((o) => o.slug === orgSlug) ?? {
    name: orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1),
    slug: orgSlug,
  };

  return (
    <Combobox<SwitchableOrganization>
      isItemEqualToValue={(a, b) => a?.slug === b?.slug}
      itemToStringLabel={(org: SwitchableOrganization) => org.name}
      items={orgs ?? []}
      onValueChange={(org: SwitchableOrganization | null) => {
        if (org) {
          void navigate({
            params: { orgSlug: org.slug },
            to: "/$orgSlug/~/projects",
          });
        }
      }}
      value={currentOrg}
    >
      <ComboboxTrigger
        render={<SidebarMenuButton className="h-12 w-full justify-between" />}
      >
        <ComboboxValue>
          {(org: SwitchableOrganization | null) =>
            org ? (
              <div className="flex items-center gap-2 truncate">
                <Avatar className="size-6">
                  <AvatarFallback>{orgInitials(org.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm font-medium">{org.name}</span>
              </div>
            ) : (
              <span className="truncate text-sm font-medium">
                Select organisation
              </span>
            )
          }
        </ComboboxValue>
        <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Select organisation">
        <div className="border-b p-2">
          <ComboboxInput
            placeholder="Search organisations..."
            showTrigger={false}
            startAddon={<SearchIcon />}
          />
        </div>
        <ComboboxEmpty>No organisations found.</ComboboxEmpty>
        <ComboboxList>
          {(org: SwitchableOrganization) => (
            <ComboboxItem key={org.slug} value={org}>
              <Avatar className="mr-2 size-5">
                <AvatarFallback>{orgInitials(org.name)}</AvatarFallback>
              </Avatar>
              <span>{org.name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <div className="border-t p-2">
          {isOrgCreationManaged ? (
            <Button
              className="w-full justify-start"
              render={<Link to="/account/request-organization" />}
              variant="ghost"
            >
              <PlusIcon className="mr-2 size-4" />
              Create org
            </Button>
          ) : (
            <CreateOrgDialog>
              <Button
                className="w-full justify-start"
                type="button"
                variant="ghost"
              >
                <PlusIcon className="mr-2 size-4" />
                Create org
              </Button>
            </CreateOrgDialog>
          )}
        </div>
      </ComboboxPopup>
    </Combobox>
  );
};
