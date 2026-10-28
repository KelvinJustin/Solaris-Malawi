import { createContext, useContext, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { MerchantProfile } from "./profile";
import { useResource, type Resource } from "./use-resource";

const ProfileContext = createContext<Resource<MerchantProfile> | null>(null);

/**
 * Fetches GET /merchants/profile once for the whole signed-in area, so the sidebar's status
 * and the home page read the same data instead of each making their own request.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { merchant } = useAuth();
  const resource = useResource(() => api<MerchantProfile>("/merchants/profile"), merchant?.userId ?? "");
  return <ProfileContext.Provider value={resource}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
