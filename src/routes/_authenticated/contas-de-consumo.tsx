import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, FileText, Pencil, Plus } from "lucide-react";
import { hojeBr } from "@/lib/hoje-br";
import { mensagemErro } from "@/lib/erros";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SituacaoDaFatura } from "@/components/financeiro/contas-de-consumo/situacao-da-fatura";
import { Button } from "@/components/ui/button";
import {
  dataBr,
  faturaEmFalta,
  faturasDaUnidade,
  nomeDaUnidade,
  rotuloDaCompetencia,
  type FaturaDeConsumo,
  type UnidadeDeConsumo,
} from "@/domain/financeiro/contas-de-consumo";
import {
  useFaturasDeConsumo,
  usePodeNasContasDeConsumo,
  useUnidadesDeConsumo,
} from "@/components/financeiro/contas-de-consumo/use-contas-de-consumo";
import {
  DialogosDeConsumo,
  useAnexosDasFaturas,
  type DialogoDeConsumo,
} from "@/components/financeiro/contas-de-consumo/dialogos-de-consumo";

export const Route = createFileRoute("/_authenticated/contas-de-consumo")({
  head: () => ({ meta: [{ title: "Contas de consumo — BEX PRINT OS" }] }),
  component: ContasDeConsumoPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Energia, água, internet, telefone e gás (16/11/2026): uma linha por unidade consumidora, com a
 * última fatura lançada e o aviso de quando falta a do mês. A fatura é uma conta a pagar comum.
 */
function ContasDeConsumoPage() {
  const hoje = hojeBr();
  const { podeCadastrarUnidade, podeLancarFatura } = usePodeNasContasDeConsumo();
  const unidades = useUnidadesDeConsumo();
  const faturas = useFaturasDeConsumo();
  const anexos = useAnexosDasFaturas(faturas.data ?? []);
  const [dialogo, setDialogo] = useState<DialogoDeConsumo | null>(null);

  if (unidades.isLoading || faturas.isLoading) return <Carregando />;
  const erro = unidades.error ?? faturas.error;
  if (erro)
    return <p className="text-sm text-destructive">Não deu para carregar: {mensagemErro(erro)}</p>;

  const todas = unidades.data ?? [];
  const lista = faturas.data ?? [];
  const ativas = todas.filter((u) => u.ativo);
  const inativas = todas.filter((u) => !u.ativo);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Contas de consumo"
        description="Energia, água, internet, telefone e gás: cada unidade com a última fatura e o aviso quando falta a do mês. A fatura lançada é uma conta a pagar como as outras."
        actions={
          podeCadastrarUnidade && (
            <Button onClick={() => setDialogo({ tipo: "unidade", unidade: null })}>
              <Plus className="mr-1 h-4 w-4" /> Nova unidade
            </Button>
          )
        }
      />

      {todas.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhuma unidade consumidora cadastrada.{" "}
            {podeCadastrarUnidade
              ? 'Comece por "Nova unidade".'
              : "Quem cadastra é o administrador ou o gestor."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...ativas, ...inativas].map((u) => (
            <LinhaDaUnidade
              key={u.id}
              unidade={u}
              faturas={lista}
              hoje={hoje}
              podeLancar={podeLancarFatura}
              podeEditar={podeCadastrarUnidade}
              onLancar={() => setDialogo({ tipo: "lancar", unidade: u })}
              onEditar={() => setDialogo({ tipo: "unidade", unidade: u })}
            />
          ))}
        </div>
      )}

      <DialogosDeConsumo
        dialogo={dialogo}
        setDialogo={setDialogo}
        faturas={lista}
        anexos={anexos.data ?? new Map()}
        hoje={hoje}
      />
    </div>
  );
}

function LinhaDaUnidade({
  unidade,
  faturas,
  hoje,
  podeLancar,
  podeEditar,
  onLancar,
  onEditar,
}: {
  unidade: UnidadeDeConsumo;
  faturas: readonly FaturaDeConsumo[];
  hoje: string;
  podeLancar: boolean;
  podeEditar: boolean;
  onLancar: () => void;
  onEditar: () => void;
}) {
  const ultima = faturasDaUnidade(faturas, unidade.id)[0];
  const falta = faturaEmFalta(unidade, faturas, hoje);
  return (
    <Card className={unidade.ativo ? undefined : "opacity-70"} data-testid="unidade-de-consumo">
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/contas-de-consumo/$id"
              params={{ id: unidade.id }}
              className="break-words font-semibold hover:underline"
            >
              {nomeDaUnidade(unidade)}
            </Link>
            {!unidade.ativo && <Badge variant="secondary">desativada</Badge>}
          </div>
          {/* div e não p: o selo da situação é um div. */}
          <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {ultima?.contas_pagar ? (
              <>
                Última fatura: {rotuloDaCompetencia(ultima.competencia)} ·{" "}
                <span className="tabular-nums">{brl(Number(ultima.contas_pagar.valor))}</span> ·{" "}
                <SituacaoDaFatura fatura={ultima} hoje={hoje} />
              </>
            ) : (
              "Nenhuma fatura lançada."
            )}
          </div>
          {falta && (
            <p role="status" className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              Falta a fatura que vence em {dataBr(falta.vencimentoEsperado)} (competência provável{" "}
              {rotuloDaCompetencia(falta.competenciaProvavel)}).
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {podeLancar && unidade.ativo && (
            <Button className="h-11" onClick={onLancar}>
              <FileText className="mr-1 h-4 w-4" /> Lançar fatura
            </Button>
          )}
          <Button asChild variant="outline" className="h-11">
            <Link to="/contas-de-consumo/$id" params={{ id: unidade.id }}>
              Ver histórico
            </Link>
          </Button>
          {podeEditar && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label={`Editar ${nomeDaUnidade(unidade)}`}
              onClick={onEditar}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
