import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { hasPermission as checkPermission, type Permission } from "@/lib/permissions";

export type AppRole =
  | "admin"
  | "gestor"
  | "financeiro"
  | "vendedor"
  | "designer"
  | "operador"
  | "estoque"
  | "instalador"
  | "cliente";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: AppRole[]) => boolean;
  hasPermission: (permission: Permission) => boolean;
  canSeeFinancials: boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as AppRole);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => {
          fetchRoles(s.user.id).then(setRoles);
        }, 0);
      } else {
        setRoles([]);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user)
        fetchRoles(s.user.id)
          .then(setRoles)
          .finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const hasRole = (r: AppRole) => roles.includes(r);
  const hasAnyRole = (rs: AppRole[]) => rs.some((r) => roles.includes(r));
  const hasPermission = (permission: Permission) => checkPermission(roles, permission);
  const canSeeFinancials = hasPermission("financeiro.read");

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshRoles = async () => {
    if (user) setRoles(await fetchRoles(user.id));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        roles,
        loading,
        hasRole,
        hasAnyRole,
        hasPermission,
        canSeeFinancials,
        signOut,
        refreshRoles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
