import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";
import { CampoDeAnexos } from "@/components/financeiro/contas-a-pagar/campo-de-anexos";
import {
  useEnviarAnexos,
  type ArquivoParaEnviar,
} from "@/components/financeiro/contas-a-pagar/use-conta-a-pagar";
import {
  avisoDeDuplicidade,
  competenciaDe,
  dadosDoTipo,
  faturaDaCompetencia,
  nomeDaUnidade,
  numeroDoCampo,
  problemaDoLancamento,
  somarMeses,
  vencimentoNoMes,
  type FaturaDeConsumo,
  type UnidadeDeConsumo,
} from "@/domain/financeiro/contas-de-consumo";
import { useLancarFatura } from "./use-contas-de-consumo";

export interface FaturaLancada {
  contaId: string;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  vencimento: string;
  jaPaga: boolean;
}

/**
 * Lançar a fatura do mês: cria a conta a pagar ligada à unidade e à competência e anexa o PDF como
 * "fatura/boleto". Valor e vencimento são digitados (sem leitura do PDF nesta fase). Fatura repetida
 * da mesma competência é avisada aqui e recusada pelo banco. "Já está paga" abre, em seguida, o mesmo
 * "Confirmar pagamento" de sempre, com a origem obrigatória.
 */
export function LancarFaturaDialog({
  unidade,
  faturas,
  hoje,
  onFechar,
  onLancada,
}: {
  unidade: UnidadeDeConsumo;
  faturas: readonly FaturaDeConsumo[];
  hoje: string;
  onFechar: () => void;
  onLancada: (f: FaturaLancada) => void;
}) {
  const lancar = useLancarFatura();
  const enviar = useEnviarAnexos();
  const tipo = dadosDoTipo(String(unidade.tipo));
  const energia = unidade.tipo === "energia";
  // A competência começa no mês passado: a fatura que chega agora costuma ser do mês anterior.
  const [competencia, setCompetencia] = useState(somarMeses(competenciaDe(hoje), -1).slice(0, 7));
  const [vencimento, setVencimento] = useState(
    unidade.dia_vencimento ? vencimentoNoMes(unidade.dia_vencimento, hoje) : "",
  );
  const [valor, setValor] = useState("");
  const [consumo, setConsumo] = useState("");
  const [bandeira, setBandeira] = useState("");
  const [iluminacao, setIluminacao] = useState("");
  const [nf, setNf] = useState("");
  const [pdf, setPdf] = useState<ArquivoParaEnviar[]>([]);
  const [jaPaga, setJaPaga] = useState(false);

  const repetida = /^\d{4}-\d{2}$/.test(competencia)
    ? faturaDaCompetencia(faturas, unidade.id, competencia)
    : undefined;
  const opcionais = [consumo, bandeira, iluminacao].map(numeroDoCampo);
  const problema =
    (repetida ? avisoDeDuplicidade(repetida) : null) ??
    problemaDoLancamento({ competencia, vencimento, valor, temPdf: pdf.length > 0 }, hoje) ??
    (opcionais.some((n) => n !== null && (Number.isNaN(n) || n < 0))
      ? "Consumo, bandeira/taxas e iluminação pública: só número, sem negativo."
      : null);

  const gravar = useMutation({
    mutationFn: async () => {
      if (problema) throw new Error(problema);
      const v = numeroDoCampo(valor) as number;
      const r = await lancar({
        unidadeId: unidade.id,
        competencia: competenciaDe(competencia),
        vencimento,
        valor: v,
        consumo: opcionais[0],
        bandeiraTaxas: opcionais[1],
        iluminacaoPublica: opcionais[2],
        numeroNf: nf.trim() || null,
      });
      // A conta já existe. PDF que não subir não desfaz o lançamento: vira aviso e vai pelo clipe.
      const envio = await enviar(r.contaId, pdf);
      return { ...r, valor: Math.round(v * 100) / 100, envio };
    },
    onSuccess: (r) => {
      if (r.envio.falhas.length > 0) {
        toast.warning(
          `Fatura lançada, mas o PDF não foi anexado: ${r.envio.falhas.join(" ")} Anexe pelo clipe da conta.`,
        );
      } else {
        toast.success("Fatura lançada com o PDF");
      }
      onLancada({
        contaId: r.contaId,
        descricao: r.descricao,
        fornecedor: unidade.fornecedores?.razao_social || unidade.fornecedores?.nome || null,
        valor: r.valor,
        vencimento,
        jaPaga,
      });
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !gravar.isPending && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Lançar fatura</DialogTitle>
          <DialogDescription>{nomeDaUnidade(unidade)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fatura-competencia">Competência (mês da fatura)</Label>
            <Input
              id="fatura-competencia"
              type="month"
              value={competencia}
              max={hoje.slice(0, 7)}
              onChange={(e) => setCompetencia(e.target.value)}
              aria-invalid={!!repetida}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fatura-vencimento">Vencimento</Label>
            <Input
              id="fatura-vencimento"
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fatura-valor">Valor a pagar (total da fatura)</Label>
            <Input
              id="fatura-valor"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          {tipo.medida && (
            <div className="space-y-1.5">
              <Label htmlFor="fatura-consumo">Consumo ({tipo.medida})</Label>
              <Input
                id="fatura-consumo"
                inputMode="decimal"
                value={consumo}
                onChange={(e) => setConsumo(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fatura-bandeira">
              {energia ? "Bandeira e taxas (R$)" : "Taxas (R$)"}
            </Label>
            <Input
              id="fatura-bandeira"
              inputMode="decimal"
              value={bandeira}
              onChange={(e) => setBandeira(e.target.value)}
            />
          </div>
          {energia && (
            <div className="space-y-1.5">
              <Label htmlFor="fatura-cip">Contribuição de iluminação pública (R$)</Label>
              <Input
                id="fatura-cip"
                inputMode="decimal"
                value={iluminacao}
                onChange={(e) => setIluminacao(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fatura-nf">Número da nota fiscal</Label>
            <Input id="fatura-nf" value={nf} onChange={(e) => setNf(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fatura-pdf">PDF da fatura (obrigatório)</Label>
            <CampoDeAnexos
              id="fatura-pdf"
              itens={pdf}
              onChange={setPdf}
              tipoFixo="fatura"
              disabled={gravar.isPending}
            />
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={jaPaga}
              onChange={(e) => setJaPaga(e.target.checked)}
            />
            <span>
              Já está paga
              <span className="block text-xs text-muted-foreground">
                Depois de lançar, abre o "Confirmar pagamento": de onde saiu o dinheiro, a data real
                e o comprovante.
              </span>
            </span>
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          Bandeira, taxas e iluminação pública são informativos: o valor a pagar é o total da
          fatura.
        </p>
        {problema && (competencia || valor) && (
          <p role="alert" className="text-sm text-destructive">
            {problema}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => gravar.mutate()} disabled={!!problema || gravar.isPending}>
            {gravar.isPending ? "Lançando…" : jaPaga ? "Lançar e pagar" : "Lançar fatura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
