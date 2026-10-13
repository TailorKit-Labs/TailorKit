import { createFileRoute } from "@tanstack/react-router";

import { AccountLayout } from "#components/account-layout";

const ProfileLayout = () => <AccountLayout />;

export const Route = createFileRoute("/(app)/account/profile")({
  component: ProfileLayout,
});
