import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@tailorkit/ui/breadcrumb";
import { Link, useMatches } from "@tanstack/react-router";
import { Fragment } from "react";
import { z } from "zod";

const breadcrumbMetadata = z.object({ name: z.string().optional() });

interface BreadcrumbSegment {
  href?: string;
  label: string;
}

const accountRouteLabels = new Map<string, string>([
  ["/(app)/account/invites", "Invites"],
  ["/(app)/account/organizations", "Organisations"],
  ["/(app)/account/profile/", "Profile"],
  ["/(app)/account/security/", "Security"],
]);

const settingsRouteLabels = new Map<string, string>([
  ["/(app)/$orgSlug/$projectSlug/settings/", "General"],
  ["/(app)/$orgSlug/$projectSlug/settings/api-keys", "API Keys"],
  ["/(app)/$orgSlug/~/(org)/settings/", "General"],
  ["/(app)/$orgSlug/~/(org)/settings/members", "Members"],
]);

const toLabel = (segment: string) =>
  segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const addOrgSegment = (
  params: Record<string, string>,
  segments: BreadcrumbSegment[]
) => {
  if (
    !("orgSlug" in params) ||
    segments.some((s) => s.label === toLabel(params.orgSlug))
  ) {
    return;
  }

  segments.push({
    href: `/${params.orgSlug}/~/projects`,
    label: toLabel(params.orgSlug),
  });
};

const addProjectSegment = (
  id: string,
  params: Record<string, string>,
  segments: BreadcrumbSegment[]
) => {
  if (
    !("projectSlug" in params) ||
    segments.some((s) => s.label === toLabel(params.projectSlug))
  ) {
    return;
  }

  const isLast = id.endsWith("/$projectSlug") || id.endsWith("/$projectSlug/");
  segments.push({
    href: isLast ? undefined : `/${params.orgSlug}/${params.projectSlug}`,
    label: toLabel(params.projectSlug),
  });
};

const addStaticSegments = (
  id: string,
  params: Record<string, string>,
  segments: BreadcrumbSegment[],
  loaderData: z.output<typeof breadcrumbMetadata> | undefined
) => {
  if (id.includes("/account") && !segments.some((s) => s.label === "Account")) {
    segments.push({ href: "/account/profile", label: "Account" });
  }

  if (id.includes("/projects") && !id.includes("$projectSlug")) {
    segments.push({ label: "Projects" });
  }
  if (id.endsWith("/apps")) {
    segments.push({ label: "Apps" });
  }
  if (id.endsWith("/apps/$appId")) {
    const appsSegment = segments.find((segment) => segment.label === "Apps");
    if (appsSegment) {
      appsSegment.href = `/${params.orgSlug}/${params.projectSlug}/apps`;
    } else {
      segments.push({
        href: `/${params.orgSlug}/${params.projectSlug}/apps`,
        label: "Apps",
      });
    }
    const appName = loaderData?.name ?? params.appId;

    segments.push({ label: appName });
  }
  if (id.includes("/support")) {
    segments.push({ label: "Support" });
  }
  if (
    id.includes("/settings") &&
    !id.includes("/account") &&
    !segments.some((s) => s.label === "Settings")
  ) {
    let href = "/account/profile";
    if ("projectSlug" in params) {
      href = `/${params.orgSlug}/${params.projectSlug}/settings`;
    } else if ("orgSlug" in params) {
      href = `/${params.orgSlug}/~/settings`;
    }

    segments.push({ href, label: "Settings" });
  }

  const accountLabel = accountRouteLabels.get(id);
  if (accountLabel) {
    segments.push({ label: accountLabel });
  }

  const settingsLabel = settingsRouteLabels.get(id);
  if (settingsLabel) {
    segments.push({ label: settingsLabel });
  }
};

export const NavBreadcrumb = () => {
  const matches = useMatches();
  const segments: BreadcrumbSegment[] = [];

  for (const match of matches) {
    const id = match.routeId;
    const params = z.record(z.string(), z.string()).parse(match.params);

    if (id === "__root__" || id === "/(app)" || id === "/(auth)") {
      continue;
    }

    addOrgSegment(params, segments);
    addProjectSegment(id, params, segments);
    const metadata = breadcrumbMetadata.safeParse(match.loaderData);
    addStaticSegments(
      id,
      params,
      segments,
      metadata.success ? metadata.data : undefined
    );
  }

  if (segments.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((seg, i) => (
          <Fragment key={seg.label}>
            <BreadcrumbItem>
              {seg.href ? (
                <BreadcrumbLink render={<Link to={seg.href} />}>
                  {seg.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{seg.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {i < segments.length - 1 && <BreadcrumbSeparator />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
