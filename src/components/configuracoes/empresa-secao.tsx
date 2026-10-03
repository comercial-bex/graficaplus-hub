import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Pencil, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { formatarDocumento, formatarTelefone } from "@/domain/documentos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ParametrosDaCasa } from "@/components/custos/parametros-da-casa";

type ResumoDaEmpresa = {
  nome: string | null;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  telefones: string | null;
  email: string | null;
  logo_path: string | null;
};

/**
 * A parte da EMPRESA dentro de "Meu perfil" — só para quem tem
 * configuracoes.manage (quem chama esta seção confere; o banco confere de
 * novo: `empresa_config` só aceita escrita com essa permissão, e
 * `custos_tabela` só de admin ou custos.update).
 *
 * Não abre uma segunda porta de edição para o que já tem tela:
 *   - dados da empresa: o resumo do que está em `empresa_config` e do que
 *     falta, e o atalho para "Dados da empresa", que é quem grava (com a
 *     consulta de CNPJ e a logo);
 *   - parâmetros da casa: o próprio componente da tela de custos, que lê e
 *     grava `custos_tabela` pelo caminho que já existe (com histórico).
 */
export function EmpresaSecao() {
  const empresa = useQuery({
    queryKey: ["empresa-config-resumo"],
    queryFn: async (): Promise<ResumoDaEmpresa | null> => {
      const { data, error } = await (supabase as any)
        .from("empresa_config")
        .select("nome, razao_social, cnpj, endereco, cidade, estado, telefones, email, logo_path")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ResumoDaEmpresa | null;
    },
  });

  // O componente de parâmetros esconde a seção quando a consulta cai (lista
  // vazia vira "nada a mostrar"). Esta conferência própria diz o motivo no
  // lugar dele.
  const parametros = useQuery({
    queryKey: ["configuracoes-parametros-conferencia"],
    queryFn: async () => {
      const { data, error } = await supabase.from("custos_tabela").select("id").eq("ativo", true);
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const e = empresa.data;
  const faltando = e
    ? ([
        !e.razao_social?.trim() && "razão social",
        !e.cnpj?.trim() && "CNPJ ou CPF",
        !e.endereco?.trim() && "endereço",
        !e.telefones?.trim() && "telefone",
      ].filter(Boolean) as string[])
    : [];

  return (
    <section className="space-y-4 pt-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Empresa</h2>
        <p className="text-sm text-muted-foreground">
          Esta parte só aparece para quem administra. Muda o que sai nos documentos e o preço de tudo.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Dados da empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {empresa.isLoading ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : empresa.isError ? (
            <div role="alert" className="space-y-2">
              <p>Não deu para carregar os dados da empresa: {mensagemErro(empresa.error)}</p>
              <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => empresa.refetch()}>
                <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
              </Button>
            </div>
          ) : !e ? (
            <p className="text-muted-foreground">
              Nenhum dado da empresa cadastrado ainda: o orçamento sai com o cabeçalho padrão.
            </p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Nome</dt>
                <dd>{e.nome || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Razão social</dt>
                <dd>{e.razao_social || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">CNPJ ou CPF</dt>
                <dd className="font-mono">{e.cnpj ? formatarDocumento(e.cnpj) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cidade</dt>
                <dd>{[e.cidade, e.estado].filter(Boolean).join(" / ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Telefones</dt>
                <dd>{e.telefones ? formatarTelefone(e.telefones) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Logo</dt>
                <dd>{e.logo_path ? "cadastrada" : "sem logo"}</dd>
              </div>
            </dl>
          )}

          {faltando.length > 0 && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
              O documento sai incompleto: falta {faltando.join(", ")}.
            </p>
          )}

          <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
            <Link to="/configuracoes-empresa">
              <Pencil className="mr-1 h-4 w-4" /> Editar dados da empresa
            </Link>
          </Button>
        </CardContent>
      </Card>

      {parametros.isError ? (
        <Card>
          <CardContent role="alert" className="space-y-2 p-4 text-sm">
            <p className="font-medium">Não deu para carregar os parâmetros da casa.</p>
            <p className="text-muted-foreground">{mensagemErro(parametros.error)}</p>
            <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => parametros.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : parametros.isSuccess && parametros.data === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Nenhum parâmetro da casa cadastrado: markup, impostos, mão de obra e perdas estão sem valor, e todo
            cálculo de preço sai sem eles.
          </CardContent>
        </Card>
      ) : (
        <ParametrosDaCasa />
      )}
    </section>
  );
}
