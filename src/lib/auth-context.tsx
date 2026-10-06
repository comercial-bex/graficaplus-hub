import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Permission } from "@/lib/permissions";
import type { NivelDeVisao } from "@/lib/supabase-financial-views";
import { buscarMinhasPermissoes, lerMatrizDosPapeis } from "@/lib/api/permissoes-por-pessoa";
import {
  SEM_PERMISSOES,
  fonteDasPermissoes,
  proximoEstado,
  temPermissao,
  type EstadoDasPermissoes,
  type FonteDasPermissoes,
} from "@/domain/acesso/permissoes-efetivas";

export type AppRole =
  | "admin"
  | "gestor"
  | "financeiro"
  | "vendedor"
  | "designer"
  | "operador"
  | "estoque"
  | "instalador"
  | "cliente"
  // revendedor de fora da equipe: só enxerga o próprio painel em /parceiro
  | "parceiro";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: AppRole[]) => boolean;
  hasPermission: (permission: Permission) => boolean;
  /** De onde vieram as permissões: banco (com exceções), matriz ou reserva do código. */
  fonteDasPermissoes: FonteDasPermissoes;
  canSeeFinancials: boolean;
  /** Vê preço de venda (vendedor, gestão, financeiro). Custo e margem seguem em canSeeFinancials. */
  canSeePrices: boolean;
  /** Qual view usar: operacional (sem dinheiro), comercial (preço), financeiro (tudo). */
  nivelDeVisao: NivelDeVisao;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as AppRole);
}

/**
 * Matriz perfil × permissão vinda do banco — só os papéis, sem as exceções
 * por pessoa. É a reserva quando `minhas_permissoes()` não responde; se ela
 * também falhar, vazia (e a tela cai na reserva escrita no código).
 */
async function fetchPermissionMatrix(): Promise<Record<string, string[]>> {
  return lerMatrizDosPapeis().catch(() => ({}));
}

/**
 * Lê o que vale para a pessoa logada: primeiro do banco (papéis + exceções);
 * se a função falhar, a matriz dos papéis, como era antes.
 */
async function lerPermissoes(): Promise<{
  efetivas: Set<string> | null;
  matriz: Record<string, string[]> | null;
}> {
  const efetivas = await buscarMinhasPermissoes().catch(() => null);
  if (efetivas) return { efetivas, matriz: null };
  return { efetivas: null, matriz: await fetchPermissionMatrix() };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissoes, setPermissoes] = useState<EstadoDasPermissoes>(SEM_PERMISSOES);
  const [loading, setLoading] = useState(true);

  const atualizarPermissoes = async (donoId: string) => {
    const { efetivas, matriz } = await lerPermissoes();
    setPermissoes((anterior) => proximoEstado(anterior, donoId, efetivas, matriz));
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => {
          fetchRoles(s.user.id).then(setRoles);
          atualizarPermissoes(s.user.id);
        }, 0);
      } else {
        setRoles([]);
        setPermissoes(SEM_PERMISSOES);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        atualizarPermissoes(s.user.id);
        fetchRoles(s.user.id)
          .then(setRoles)
          .finally(() => setLoading(false));
      } else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Exceção dada, tirada ou vencida vale no banco na hora; na tela, quando a
  // pessoa volta para a aba (ou recarrega). Uma leitura por volta, ≤ 117 chaves.
  useEffect(() => {
    const donoId = user?.id;
    if (!donoId || typeof document === "undefined") return;
    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizarPermissoes(donoId);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [user?.id]);

  const hasRole = (r: AppRole) => roles.includes(r);
  const hasAnyRole = (rs: AppRole[]) => rs.some((r) => roles.includes(r));
  const hasPermission = (permission: Permission) => temPermissao(permissoes, roles, permission);
  const canSeeFinancials = hasPermission("financeiro.read");
  const canSeePrices = canSeeFinancials || hasPermission("precos.read");
  const nivelDeVisao: NivelDeVisao = canSeeFinancials
    ? "financeiro"
    : canSeePrices
      ? "comercial"
      : "operacional";

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshRoles = async () => {
    if (user) {
      setRoles(await fetchRoles(user.id));
      await atualizarPermissoes(user.id);
    }
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
        fonteDasPermissoes: fonteDasPermissoes(permissoes),
        canSeeFinancials,
        canSeePrices,
        nivelDeVisao,
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
