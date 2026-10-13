import type { DemoSession } from "@playground/shared/auth";
import { useEffect, useState } from "react";

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

const readAuth = async (): Promise<DemoAuthState> => {
  const response = await fetch("/api/auth", { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("Could not load the local demo session");
  }
  return (await response.json()) as DemoAuthState;
};

export const useAuthSession = () => {
  const [data, setData] = useState<DemoAuthState>();
  const [err, setErr] = useState<Error>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await readAuth();
        if (!cancelled) {
          setData(next);
        }
      } catch (error) {
        if (!cancelled) {
          setErr(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    data,
    error: err,
    isPending: data === undefined && err === undefined,
  };
};

export const signInDemoUser = async (userId: string, teamId: string) => {
  const response = await fetch("/api/auth", {
    body: JSON.stringify({ action: "sign-in", teamId, userId }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Could not start the local demo session");
  }
  return (await response.json()) as DemoAuthState;
};

export const signOutDemoUser = async () => {
  const response = await fetch("/api/auth", {
    body: JSON.stringify({ action: "sign-out" }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Could not end the local demo session");
  }
};
