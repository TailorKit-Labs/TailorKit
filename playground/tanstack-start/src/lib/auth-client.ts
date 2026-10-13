import { useEffect, useState } from "react";
import type { DemoSession } from "@playground/shared/auth";

export interface SignInChoice {
  userId: string;
  userName: string;
  email: string;
  avatar: string;
  teamId: string;
  teamName: string;
  teamKey: string;
}

export interface DemoAuthState {
  session: DemoSession | null;
  choices: SignInChoice[];
}

async function readAuth(): Promise<DemoAuthState> {
  const response = await fetch("/api/auth", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not load the local demo session");
  return (await response.json()) as DemoAuthState;
}

export function useAuthSession() {
  const [data, setData] = useState<DemoAuthState>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let cancelled = false;
    void readAuth().then(
      (next) => {
        if (!cancelled) setData(next);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, isPending: data === undefined && error === undefined };
}

export async function signInDemoUser(userId: string, teamId: string) {
  const response = await fetch("/api/auth", {
    body: JSON.stringify({ action: "sign-in", userId, teamId }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Could not start the local demo session");
  return (await response.json()) as DemoAuthState;
}

export async function signOutDemoUser() {
  const response = await fetch("/api/auth", {
    body: JSON.stringify({ action: "sign-out" }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Could not end the local demo session");
}
