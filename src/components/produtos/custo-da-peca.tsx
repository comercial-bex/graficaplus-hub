/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { acabamentoFicaForaDoCusto, custoDasEtapasDeAcabamento } from "@/domain/catalogo/pasta-do-produto";
import {
  composicaoMaisRecente,
  custoCheio,
  fichaDoProduto,
  fatiasDoCusto,
  margemSobreVenda,
  PARTES_DO_CUSTO,
  servicoComCustoInteiro,
  type Composicao,
} from "@/domain/precos/tabela-de-precos";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const COR = {
  material: "bg-primary",
  maquina: "bg-chart-2",
  maoDeObra: "bg-chart-4",
  indireto: "bg-muted-foreground",
} as const;

/** Do que a peça é feita, na pasta do produto. Só o nível financeiro lê estas tabelas (RLS). */
export function CustoDaPeca(p: {
  produtoId: string;
  unidade: string | null;
  tipo: string | null;
  categoria: string | null;
  familia: string | null;
  preco: number | null;
  margemMinima: number | null;
  minutos: number | null;
  temMaquina: boolean;
  largura: number;
  altura: number;
}) {
  const dados = useQuery({
    queryKey: ["pasta-custo", p.produtoId],
    queryFn: async () => {
      const [comp, receita, etapas, casa, produto] = await Promise.all([
        (supabase as any)
          .from("produto_precificacao")
          .select("produto_id, custo_material, custo_maquina, custo_mao_obra, custo_indireto, updated_at")
          .eq("produto_id", p.produtoId),
        (supabase as any)
          .from("produto_materiais")
          .select("material_id, quantidade_por_unidade")
          .eq("produto_id", p.produtoId),
        (supabase as any)
          .from("produto_processos")
          .select(
            "ordem, processos(nome, etapa, base_produtividade, setup_min, produtividade_m2_h, produtividade_m_h, produtividade_por_familia)",
          )
          .eq("produto_id", p.produtoId)
          .order("ordem"),
        (supabase as any)
          .from("custos_tabela")
          .select("codigo, valor")
          .eq("ativo", true)
          .in("codigo", ["mo_custo_hora", "mo_encargos_pct", "custo_admin_hora"]),
        (supabase as any)
          .from("produtos")
          .select("maquinas:maquina_padrao_id(base_cobranca, velocidade_m2_h)")
          .eq("id", p.produtoId)
          .maybeSingle(),
      ]);
      for (const r of [comp, receita, etapas, casa, produto]) if (r.error) throw r.error;
      const ids = (receita.data ?? []).map((r: any) => r.material_id);
      const mats = ids.length
        ? await fromFinancialView("materiais", "financeiro")
            .select("id, nome, unidade, custo_medio, custo_unitario")
            .in("id", ids)
        : { data: [], error: null };
      if (mats.error) throw mats.error;
      const porId = new Map<string, any>((mats.data ?? []).map((m: any) => [m.id, m]));
      const l = composicaoMaisRecente((comp.data ?? []) as any[]).get(p.produtoId) as any;
      const composicao: Composicao | null = l
        ? {
            material: Number(l.custo_material ?? 0),
            maquina: Number(l.custo_maquina ?? 0),
            maoDeObra: Number(l.custo_mao_obra ?? 0),
            indireto: Number(l.custo_indireto ?? 0),
          }
        : null;
      const valor = (c: string) =>
        Number((casa.data ?? []).find((x: any) => x.codigo === c)?.valor ?? 0);
      const receitaDoProduto: { nome: string; unidade: string; quantidade: number; custo: number }[] = (
        receita.data ?? []
      ).flatMap((r: any) => {
        const m = porId.get(r.material_id);
        if (!m) return [];
        return [
          {
            nome: m.nome as string,
            unidade: m.unidade as string,
            quantidade: Number(r.quantidade_por_unidade),
            custo: Number(m.custo_medio ?? m.custo_unitario ?? 0),
          },
        ];
      });
      return {
        composicao,
        receita: receitaDoProduto,
        maquina: (produto.data?.maquinas ?? null) as {
          base_cobranca: string | null;
          velocidade_m2_h: number | null;
        } | null,
        etapas: (etapas.data ?? []).flatMap((e: any) => (e.processos ? [e.processos] : [])),
        horaDaPessoa:
          valor("mo_custo_hora") * (1 + valor("mo_encargos_pct") / 100) + valor("custo_admin_hora"),
      };
    },
  });

  if (dados.isLoading) return null;
  if (dados.isError || !dados.data) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
        Não foi possível ler o custo deste produto.
      </p>
    );
  }
  const { composicao, receita, etapas, horaDaPessoa, maquina } = dados.data;
  const cheio = custoCheio(composicao);
  const fatias = fatiasDoCusto(composicao);
  const margem = margemSobreVenda(p.preco, cheio);
  const abaixo = margem != null && p.margemMinima != null && margem < p.margemMinima;
  const ficha = fichaDoProduto({
    tipo: p.tipo,
    categoria: p.categoria,
    temReceita: receita.length > 0,
    minutos: p.minutos,
    temMaquina: p.temMaquina,
    composicao,
  });
  const inteiro = servicoComCustoInteiro({
    tipo: p.tipo,
    temReceita: receita.length > 0,
    custo: composicao?.material ?? null,
  });
  const acabamento = custoDasEtapasDeAcabamento(
    acabamentoFicaForaDoCusto({ tipo: p.tipo, unidade: p.unidade, maquina }) ? etapas : [],
    { largura: p.largura, altura: p.altura },
    horaDaPessoa,
    { familia: p.familia },
  );
  const porM2 = (p.unidade ?? "").toLowerCase().replace("²", "2") === "m2";
  const area = p.largura * p.altura;
  const extraPorUnidade = porM2 && area > 0 ? acabamento.total / area : acabamento.total;
  const margemComEtapas =
    cheio != null && acabamento.linhas.length > 0
      ? margemSobreVenda(p.preco, cheio + extraPorUnidade)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Do que a peça é feita, por {p.unidade ?? "unidade"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {inteiro ? (
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between gap-2 font-semibold">
              <span>Custo do serviço</span>
              <span className="font-mono">{cheio != null ? brl(cheio) : "—"}</span>
            </li>
            <li className="text-xs text-muted-foreground">O valor digitado já inclui o tempo e o rateio.</li>
            {margem != null && (
              <li className="flex items-center justify-between gap-2">
                <span>
                  Margem no preço de venda
                  {p.margemMinima != null ? ` (mínima de ${pct(p.margemMinima)})` : ""}
                </span>
                <span className={`font-mono ${abaixo ? "text-destructive" : ""}`}>{pct(margem)}</span>
              </li>
            )}
          </ul>
        ) : fatias.length > 0 ? (
          <>
            <div
              className="flex h-3 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label="Composição do custo"
            >
              {fatias.map((f) => (
                <div key={f.chave} className={COR[f.chave]} style={{ width: `${f.pct}%` }} />
              ))}
            </div>
            <ul className="space-y-1.5 text-sm">
              {PARTES_DO_CUSTO.map((parte) => (
                <li key={parte.chave} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${COR[parte.chave]}`} /> {parte.rotulo}
                  </span>
                  <span className="font-mono">{brl(composicao?.[parte.chave] ?? 0)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-2 border-t border-border pt-1.5 font-semibold">
                <span>Custo cheio</span>
                <span className="font-mono">{cheio != null ? brl(cheio) : "—"}</span>
              </li>
              {margem != null && (
                <li className="flex items-center justify-between gap-2">
                  <span>
                    Margem no preço de venda
                    {p.margemMinima != null ? ` (mínima de ${pct(p.margemMinima)})` : ""}
                  </span>
                  <span className={`font-mono ${abaixo ? "text-destructive" : ""}`}>{pct(margem)}</span>
                </li>
              )}
            </ul>
          </>
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Este produto ainda não tem o custo calculado.
          </p>
        )}

        {receita.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">Matéria-prima</h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {receita.map((r) => (
                <li key={r.nome} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{r.nome}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {r.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {r.unidade} ×{" "}
                    {brl(r.custo)} = <strong className="text-foreground">{brl(r.quantidade * r.custo)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(acabamento.linhas.length > 0 || acabamento.semNumero.length > 0) && (
          <section className="rounded-md border border-warning/50 bg-warning/10 p-3">
            <h3 className="text-sm font-semibold">Acabamento que o custo cheio ainda não soma</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tempo de gente numa peça de{" "}
              {p.largura.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ×{" "}
              {p.altura.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} m, a {brl(horaDaPessoa)} por hora.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {acabamento.linhas.map((l) => (
                <li key={l.nome} className="flex items-center justify-between gap-2">
                  <span>{l.nome}</span>
                  <span className="font-mono text-xs">
                    {l.minutos.toLocaleString("pt-BR")} min = {brl(l.custo)}
                  </span>
                </li>
              ))}
              {acabamento.semNumero.map((nome) => (
                <li key={nome} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{nome}</span>
                  <span className="text-xs">sem tempo medido</span>
                </li>
              ))}
            </ul>
            {margemComEtapas != null && (
              <p className="mt-2 text-sm">
                Somando, a margem fica em <strong className="font-mono">{pct(margemComEtapas)}</strong>.
              </p>
            )}
          </section>
        )}

        {ficha.faltas.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> O que falta para o custo fechar
            </h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
              {ficha.faltas.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
