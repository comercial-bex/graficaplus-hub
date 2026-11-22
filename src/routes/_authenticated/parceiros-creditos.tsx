import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { ListaDeCreditos, ResumoDosCreditos, VencimentosDosCreditos } from "@/components/parceiros/creditos-dos-parceiros";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { painelDeCreditos } from "@/lib/parceiro-creditos-api";
import { calcularPainel, filtrarParceiros, OPCOES_DE_MOSTRAR, responsaveisDaLista, type Mostrar, type Ordem } from "@/domain/parceiros/creditos-painel";

export const Route = createFileRoute("/_authenticated/parceiros-creditos")({
  head: () => ({
    meta: [
      { title: "Créditos dos parceiros — BEX PRINT OS" },
      { name: "description", content: "Saldo, lançamentos e o que cada crédito dos parceiros pagou, com o que vence primeiro." },
      { property: "og:title", content: "Créditos dos parceiros — BEX PRINT OS" },
      { property: "og:description", content: "Saldo de crédito dos parceiros, lançamentos e vencimentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditosDosParceiros,
});

const TODOS = "__todos";

function CreditosDosParceiros() {
  const [busca, setBusca] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [mostrar, setMostrar] = useState<Mostrar>("todos");
  const [ordem, setOrdem] = useState<Ordem>("vence");
  const consulta = useQuery({ queryKey: ["parceiros-creditos"], queryFn: painelDeCreditos, refetchInterval: 5 * 60_000 });

  const calculado = useMemo(() => (consulta.data ? calcularPainel(consulta.data) : null), [consulta.data]);
  const lista = useMemo(
    () => (calculado ? filtrarParceiros(calculado.parceiros, { busca, responsavel, mostrar, ordem, dias: consulta.data?.programa?.lembreteDias }) : []),
    [calculado, busca, responsavel, mostrar, ordem, consulta.data],
  );

  return (
    <div className="space-y-6 p-6">
      <SectionHeader
        breadcrumb="Comercial"
        title="Créditos dos parceiros"
        description="Saldo de cada parceiro, os lançamentos e o que cada um pagou, com o que vence primeiro."
        ajuda={dicaTela("/parceiros-creditos")}
      />

      {consulta.isLoading ? (
        <Carregando />
      ) : consulta.error ? (
        <div role="alert" className="space-y-2 rounded-xl border border-destructive p-4" data-testid="creditos-falhou">
          <p className="text-sm text-destructive">{mensagemErro(consulta.error, "Não foi possível carregar os créditos.")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void consulta.refetch()}>
            <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" /> Tentar de novo
          </Button>
        </div>
      ) : consulta.data === null ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm" data-testid="creditos-nao-ativada">
          A tela de créditos ainda não foi ativada no banco. Peça à gerência para aplicar a migração dos créditos.
        </p>
      ) : !calculado || calculado.parceiros.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="sem-creditos">
          Nenhum parceiro tem crédito lançado ainda.
        </p>
      ) : (
        <>
          {calculado.resumo.divergentes.length > 0 && (
            <p role="alert" className="rounded-xl border border-[color:var(--warning)] px-4 py-3 text-sm" data-testid="aviso-divergencia">
              O saldo do banco não bate com a soma do livro em {calculado.resumo.divergentes.length}{" "}
              {calculado.resumo.divergentes.length === 1 ? "parceiro" : "parceiros"}: {calculado.resumo.divergentes.join(", ")}. Vale o saldo do banco.
            </p>
          )}
          <ResumoDosCreditos resumo={calculado.resumo} />
          <VencimentosDosCreditos resumo={calculado.resumo} programa={consulta.data?.programa ?? null} />

          <section className="space-y-3" aria-labelledby="titulo-parceiros">
            <h2 id="titulo-parceiros" className="font-semibold">
              Parceiros e lançamentos
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label htmlFor="busca-credito" className="text-sm font-medium">
                  Buscar
                </label>
                <Input id="busca-credito" className="min-h-11" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Parceiro ou responsável" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="filtro-responsavel" className="text-sm font-medium">
                  Responsável
                </label>
                <Select value={responsavel || TODOS} onValueChange={(v) => setResponsavel(v === TODOS ? "" : v)}>
                  <SelectTrigger id="filtro-responsavel" className="min-h-11" data-testid="filtro-responsavel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    {responsaveisDaLista(calculado.parceiros).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="filtro-mostrar" className="text-sm font-medium">
                  Mostrar
                </label>
                <Select value={mostrar} onValueChange={(v) => setMostrar(v as Mostrar)}>
                  <SelectTrigger id="filtro-mostrar" className="min-h-11" data-testid="filtro-mostrar">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPCOES_DE_MOSTRAR.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="filtro-ordem" className="text-sm font-medium">
                  Ordem
                </label>
                <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
                  <SelectTrigger id="filtro-ordem" className="min-h-11" data-testid="filtro-ordem">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vence">Vence primeiro</SelectItem>
                    <SelectItem value="saldo">Maior saldo</SelectItem>
                    <SelectItem value="nome">Nome</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-muted-foreground" data-testid="contagem-da-lista">
              {lista.length} de {calculado.parceiros.length} {calculado.parceiros.length === 1 ? "parceiro" : "parceiros"}
            </p>
            <ListaDeCreditos parceiros={lista} programa={consulta.data?.programa ?? null} />
          </section>
        </>
      )}
    </div>
  );
}
