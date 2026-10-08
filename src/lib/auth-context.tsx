import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
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
import {
  CHAVE_DO_ACESSO_GUARDADO,
  lerAcessoGuardado,
  relerPermissoesAoVoltar,
  sessaoSalvaNoAparelho,
  textoDoAcessoGuardado,
} from "@/domain/acesso/sessao";

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

/**
 * Papéis da pessoa. `null` quando a leitura FALHOU — diferente de "não tem
 * papel": antes a falha virava lista vazia e quem tinha papel caía na tela de
 * "Aguardando liberação" por uma queda de rede.
 */
async function fetchRoles(userId: string): Promise<AppRole[] | null> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return null;
  return (data ?? []).map((r) => r.role as AppRole);
}

/** Até 3 tentativas (0, 1 s, 2 s): rede de celular cai e volta. */
async function fetchRolesComInsistencia(userId: string): Promise<AppRole[] | null> {
  for (const espera of [0, 1000, 2000]) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    const papeis = await fetchRoles(userId);
    if (papeis) return papeis;
  }
  return null;
}

function lerDoAparelho(donoId: string) {
  try {
    return lerAcessoGuardado(localStorage.getItem(CHAVE_DO_ACESSO_GUARDADO), donoId, Date.now());
  } catch {
    return null; // aba anônima, armazenamento bloqueado: segue sem a cópia
  }
}

function guardarNoAparelho(donoId: string, papeis: AppRole[], efetivas: ReadonlySet<string> | null) {
  try {
    if (papeis.length === 0) {
      localStorage.removeItem(CHAVE_DO_ACESSO_GUARDADO);
      return;
    }
    localStorage.setItem(
      CHAVE_DO_ACESSO_GUARDADO,
      textoDoAcessoGuardado({
        donoId,
        papeis,
        efetivas: efetivas ? [...efetivas] : null,
        guardadoEmMs: Date.now(),
      }),
    );
  } catch {
    /* sem armazenamento: a próxima abertura só espera a rede */
  }
}

function esquecerDoAparelho() {
  try {
    localStorage.removeItem(CHAVE_DO_ACESSO_GUARDADO);
  } catch {
    /* nada a fazer */
  }
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
  // De quem é o acesso desenhado agora. `undefined` = ainda não leu a sessão.
  // Toda resposta que chega depois de a pessoa trocar é jogada fora.
  const donoCarregado = useRef<string | null | undefined>(undefined);
  const ultimaLeituraDePermissoes = useRef(0);
  // Abriu com a sessão e o acesso guardados no aparelho: falta conferir com a
  // biblioteca (sessão) e com o banco (acesso) assim que a sessão se confirmar.
  const conferirDepois = useRef(false);

  const atualizarPermissoes = async (donoId: string) => {
    ultimaLeituraDePermissoes.current = Date.now();
    const { efetivas, matriz } = await lerPermissoes();
    if (donoCarregado.current !== donoId) return;
    setPermissoes((anterior) => proximoEstado(anterior, donoId, efetivas, matriz));
    const guardado = lerDoAparelho(donoId);
    if (guardado && efetivas) guardarNoAparelho(donoId, guardado.papeis as AppRole[], efetivas);
  };

  /** Papéis e permissões da pessoa, lidos juntos e uma vez só. */
  const carregarAcesso = async (donoId: string) => {
    ultimaLeituraDePermissoes.current = Date.now();
    const [papeis, { efetivas, matriz }] = await Promise.all([
      fetchRolesComInsistencia(donoId),
      lerPermissoes(),
    ]);
    if (donoCarregado.current !== donoId) return;
    if (papeis) setRoles(papeis);
    setPermissoes((anterior) => proximoEstado(anterior, donoId, efetivas, matriz));
    if (papeis) {
      // Se a função de permissões falhou agora, fica a última resposta boa.
      const antes = lerDoAparelho(donoId);
      guardarNoAparelho(donoId, papeis, efetivas ?? (antes?.efetivas ? new Set(antes.efetivas) : null));
    }
  };

  useEffect(() => {
    let vivo = true;

    /**
     * A pessoa logada mudou? Só então relê o acesso. A biblioteca avisa
     * "SIGNED_IN" a cada volta à aba e "TOKEN_REFRESHED" a cada hora; antes,
     * cada aviso relia papéis e permissões (3 leituras de cada na abertura,
     * medido em 07/10/2026). Ver src/domain/acesso/sessao.ts.
     */
    const aoMudarSessao = (evento: AuthChangeEvent | "LEITURA_INICIAL", s: Session | null) => {
      if (!vivo) return;
      const novo = s?.user?.id ?? null;
      // Token renovado: guarda a sessão nova sem redesenhar a tela inteira.
      setSession((atual) => (atual?.access_token === s?.access_token ? atual : s));
      if (novo === donoCarregado.current) {
        if (evento === "USER_UPDATED") setUser(s?.user ?? null); // cadastro editado
        if (novo && conferirDepois.current) {
          // A sessão do aparelho se confirmou: troca pelo objeto confirmado e
          // relê papéis e permissões do banco.
          conferirDepois.current = false;
          setUser(s?.user ?? null);
          void carregarAcesso(novo);
        }
        return;
      }
      conferirDepois.current = false;
      donoCarregado.current = novo;
      setUser(s?.user ?? null);

      if (!novo) {
        setRoles([]);
        setPermissoes(SEM_PERMISSOES);
        esquecerDoAparelho(); // saiu: o próximo a usar o aparelho não herda nada
        setLoading(false);
        return;
      }

      const guardado = lerDoAparelho(novo);
      if (guardado) {
        // Abre na hora com a cópia do aparelho e confere com o banco logo
        // depois. A cópia só desenha o menu: o banco decide o que cada um vê.
        setRoles(guardado.papeis as AppRole[]);
        setPermissoes(
          proximoEstado(
            SEM_PERMISSOES,
            novo,
            guardado.efetivas ? new Set(guardado.efetivas) : null,
            null,
          ),
        );
        setLoading(false);
        void carregarAcesso(novo);
        return;
      }

      // Primeira vez neste aparelho (ou cópia vencida): espera o banco, sem
      // desenhar "Aguardando liberação" com a lista de papéis ainda vazia.
      setRoles([]);
      setPermissoes(SEM_PERMISSOES);
      setLoading(true);
      void carregarAcesso(novo).finally(() => {
        if (vivo && donoCarregado.current === novo) setLoading(false);
      });
    };

    // Abre na hora com o que está no aparelho, se a sessão salva e a cópia do
    // acesso forem da mesma pessoa. Sem isso o menu esperava a renovação do
    // token (1,1 s) e a leitura dos papéis (até 1,2 s): "Carregando..." por
    // 4 s na abertura do painel, medido em 07/10/2026.
    try {
      const salva = sessaoSalvaNoAparelho(localStorage);
      const guardado = salva ? lerDoAparelho(salva.userId) : null;
      if (salva && guardado) {
        donoCarregado.current = salva.userId;
        conferirDepois.current = true;
        setUser(salva.user as unknown as User);
        setRoles(guardado.papeis as AppRole[]);
        setPermissoes(
          proximoEstado(
            SEM_PERMISSOES,
            salva.userId,
            guardado.efetivas ? new Set(guardado.efetivas) : null,
            null,
          ),
        );
        setLoading(false);
      }
    } catch {
      /* armazenamento bloqueado: espera a biblioteca, como antes */
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, s) => {
      // Nada de chamar o supabase DENTRO do aviso: a biblioteca ainda segura a
      // trava da sessão e a chamada esperaria por ela. Vai para a próxima volta.
      setTimeout(() => aoMudarSessao(evento, s), 0);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => aoMudarSessao("LEITURA_INICIAL", s))
      .catch(() => {
        if (vivo && donoCarregado.current === undefined) setLoading(false);
      });

    return () => {
      vivo = false;
      subscription.unsubscribe();
    };
  }, []);

  // Exceção dada, tirada ou vencida vale no banco na hora; na tela, quando a
  // pessoa volta para a aba (ou recarrega). No máximo uma leitura por minuto.
  useEffect(() => {
    const donoId = user?.id;
    if (!donoId || typeof document === "undefined") return;
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (!relerPermissoesAoVoltar(ultimaLeituraDePermissoes.current, Date.now())) return;
      void atualizarPermissoes(donoId);
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
    if (user) await carregarAcesso(user.id);
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
