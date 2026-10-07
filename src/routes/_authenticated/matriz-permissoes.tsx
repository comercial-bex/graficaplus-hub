import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Check, Minus } from "lucide-react";
import { permissions, type Permission } from "@/lib/permissions";
import { motivoParaNaoMudarPermissao } from "@/lib/criar-usuario";
import { toast } from "sonner";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { lerMatrizDosPapeis } from "@/lib/api/permissoes-por-pessoa";

export const Route = createFileRoute("/_authenticated/matriz-permissoes")({
  head: () => ({
    meta: [
      { title: "Matriz de permissões — BEX PRINT OS" },
      {
        name: "description",
        content: "Quais ações cada perfil pode executar em cada módulo do ERP da Bex Print.",
      },
      { property: "og:title", content: "Matriz de permissões — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Visão perfil × permissão por módulo, lida direto da matriz do banco.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MatrizPermissoesPage,
});

const ROLES: AppRole[] = [
  "admin",
  "gestor",
  "financeiro",
  "vendedor",
  "designer",
  "operador",
  "estoque",
  "instalador",
  "cliente",
  "parceiro",
];

const moduloLabels: Record<string, string> = {
  leads: "Leads",
  clientes: "Clientes",
  whatsapp: "WhatsApp",
  automacoes: "Automações",
  templates: "Templates",
  orcamentos: "Orçamentos",
  catalogo: "Catálogos de fornecedores",
  desconto: "Descontos",
  margem: "Margem",
  impressao3d: "Impressão 3D",
  os: "Ordens de Serviço",
  financeiro: "Financeiro",
  pagamentos: "Pagamentos",
  custos: "Custos",
  resultado: "Resultado",
  usuarios: "Usuários",
  permissoes: "Permissões",
  logs: "Logs",
  configuracoes: "Configurações",
  parceiros: "Parceiros (gestão)",
  parceiro: "Painel do parceiro",
};

function MatrizPermissoesPage() {
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);
  const qc = useQueryClient();
  // Só o administrador grava a matriz: é o que as policies de perfil_permissoes
  // exigem desde 06/10/2026 (has_role admin; permissoes.manage deixou de bastar).
  // Quem mais abrir a tela confere, mas não clica.
  const { hasRole } = useAuth();
  const podeEditar = hasRole("admin");

  const {
    data: dbMatrix,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["role-permission-matrix"],
    // Falha é falha: antes caía em silêncio no retrato do código e a grade
    // mostrava (e deixava clicar em cima de) um estado que não é o do banco.
    // A leitura é em páginas: as contagens por perfil não podem passar pelo
    // corte de 1.000 linhas do PostgREST.
    queryFn: async () => {
      const matriz = await lerMatrizDosPapeis();
      return Object.fromEntries(
        Object.entries(matriz).map(([papel, chaves]) => [papel, new Set(chaves)]),
      ) as Record<string, Set<string>>;
    },
  });

  const can = (role: AppRole, permission: Permission) => dbMatrix?.[role]?.has(permission) ?? false;

  const grupos = useMemo(() => {
    const filtro = busca.trim().toLowerCase();
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      const modulo = p.split(".")[0];
      const label = moduloLabels[modulo] ?? modulo;
      if (filtro && !p.toLowerCase().includes(filtro) && !label.toLowerCase().includes(filtro))
        continue;
      const list = map.get(label) ?? [];
      list.push(p);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [busca]);

  const totais = ROLES.map((r) => permissions.filter((p) => can(r, p)).length);

  /**
   * Liga e desliga a permissão direto em perfil_permissoes.
   *
   * A tela era só leitura enquanto a tabela sempre aceitou escrita de admin — e
   * o auth-context já lê a matriz do banco, então a mudança vale para todo mundo
   * no próximo carregamento, sem publicar nada.
   */
  async function alternar(role: AppRole, permission: Permission) {
    if (!podeEditar) return toast.error("Só o administrador muda permissões.");
    const impedimento = motivoParaNaoMudarPermissao(role);
    if (impedimento) return toast.error(impedimento);

    const chave = `${role}:${permission}`;
    setSalvando(chave);
    const tinha = can(role, permission);

    // Escrita barrada por RLS devolve 0 linhas e nenhum erro: sem conferir o
    // retorno, o quadradinho mudaria na tela e nada mudaria no banco.
    const resposta = tinha
      ? await (supabase as any)
          .from("perfil_permissoes")
          .delete()
          .eq("perfil", role)
          .eq("permissao", permission)
          .select("permissao")
      : await (supabase as any)
          .from("perfil_permissoes")
          .insert({ perfil: role, permissao: permission })
          .select("permissao");
    setSalvando(null);

    if (resposta.error) return toast.error(resposta.error.message);
    if (!resposta.data || resposta.data.length === 0) {
      return toast.error("Seu perfil não tem permissão para alterar a matriz.");
    }
    await qc.invalidateQueries({ queryKey: ["role-permission-matrix"] });
    toast.success(
      `${permission} ${tinha ? "removida de" : "concedida a"} ${role}. Quem estiver logado vê a mudança ao recarregar.`,
    );
  }

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/matriz-permissoes")}
        breadcrumb="Administração"
        title="Matriz de permissões por perfil"
        description={
          podeEditar
            ? "Clique para conceder ou remover. Cada linha é uma ação, cada coluna é um perfil; vale para todo mundo daquele perfil. Para uma pessoa só, use Permissões na lista da equipe."
            : "Cada linha é uma ação, cada coluna é um perfil. Só o administrador muda permissões: aqui você só confere."
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por módulo ou ação (ex.: pagamentos, os.close)"
          className="max-w-sm"
        />
        {isLoading && <span className="text-sm text-muted-foreground">Carregando matriz...</span>}
      </div>

      {isError && (
        <FalhaDeConsulta
          titulo="Não deu para ler a matriz de permissões do banco"
          erro={error}
          onTentarDeNovo={() => refetch()}
        />
      )}

      {/* Sem matriz do banco, sem grade: um quadradinho "desligado" ali seria mentira. */}
      <Card className={isError || isLoading ? "hidden" : undefined}>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Ação
                </th>
                {ROLES.map((r, i) => (
                  <th
                    key={r}
                    className="px-2 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {r}
                    <div className="mt-0.5 text-[9px] text-muted-foreground/60">{totais[i]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map(([modulo, perms]) => (
                <Fragment key={modulo}>
                  <tr className="bg-muted/40">
                    <td
                      colSpan={ROLES.length + 1}
                      className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--bex-cyan)]"
                    >
                      {modulo}
                    </td>
                  </tr>
                  {perms.map((p) => (
                    <tr key={p} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p}</td>
                      {ROLES.map((r) => {
                        const marcado = can(r, p);
                        const fixo = r === "admin" || !podeEditar;
                        return (
                          <td key={r} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={fixo || salvando === `${r}:${p}`}
                              onClick={() => alternar(r, p)}
                              title={
                                !podeEditar
                                  ? "Só o administrador muda permissões"
                                  : r === "admin"
                                  ? "O perfil admin mantém todas as permissões"
                                  : marcado
                                    ? `Remover ${p} de ${r}`
                                    : `Conceder ${p} a ${r}`
                              }
                              aria-label={`${marcado ? "Remover" : "Conceder"} ${p} ${marcado ? "de" : "a"} ${r}`}
                              aria-pressed={marcado}
                              className={`mx-auto flex h-6 w-6 items-center justify-center rounded transition-colors ${
                                fixo
                                  ? "cursor-not-allowed opacity-60"
                                  : "hover:bg-[color:var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              }`}
                            >
                              {marcado ? (
                                <Check className="h-4 w-4 text-[color:var(--bex-lime)]" />
                              ) : (
                                <Minus className="h-3.5 w-3.5 text-muted-foreground/30" />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {grupos.length === 0 && (
                <tr>
                  <td
                    colSpan={ROLES.length + 1}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Nenhuma ação encontrada para "{busca}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
