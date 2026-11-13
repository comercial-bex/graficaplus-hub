import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mensagemErro } from "@/lib/erros";
import {
  CHAVE_PAINEL,
  CHAVE_PROGRAMA_PUBLICO,
  carregarProgramaPublico,
  enviarPedido,
  type PedidoEnviado,
} from "@/lib/parceiro-api";
import { ehPrimeiraCompra, lerEntrada, pctMaximoDoPedido, tetoDeCreditoDoPedido } from "@/domain/parceiros/credito-de-entrada";
import { brl, type ResumoDoOrcamento } from "@/domain/parceiros/preco";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * Transforma o orçamento aprovado pelo cliente em pedido para a gráfica.
 *
 * O total aqui é estimativa: o banco recalcula cada preço no envio pela tabela
 * vigente. Se uma oferta acabou entre abrir a tela e confirmar, vale o preço do
 * banco — e o diálogo de sucesso mostra o número que ficou de verdade.
 */
export function PedidoDialog({
  aberto,
  onOpenChange,
  orcamentoId,
  resumo,
  painel,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  orcamentoId: string;
  resumo: ResumoDoOrcamento;
  painel: PainelDoParceiro;
}) {
  const qc = useQueryClient();
  const saldo = Math.max(Number(painel.saldo_credito) || 0, 0);
  // O teto espelha o servidor (parceiro_enviar_pedido), que é quem decide: % dos
  // produtos (sem a taxa de prazo), maior na 1ª compra quando há crédito de entrada.
  const programa = useQuery({ queryKey: CHAVE_PROGRAMA_PUBLICO, queryFn: carregarProgramaPublico, staleTime: 5 * 60_000 });
  const entrada = lerEntrada(programa.data);
  const primeiraCompra = ehPrimeiraCompra(painel.pedidos ?? []);
  const regraDoTeto = {
    base: resumo.custo,
    primeiraCompra,
    maxPctGeral: programa.data ? (programa.data.credito_max_pct_pedido as number | null) : 100,
    entrada,
  };
  const pctTeto = pctMaximoDoPedido(regraDoTeto);
  const teto = tetoDeCreditoDoPedido(regraDoTeto);
  const tetoDeEntrada = !!entrada?.ativa && primeiraCompra && resumo.custo >= entrada.pedido_minimo && entrada.max_pct > Number(regraDoTeto.maxPctGeral ?? 100);
  const maximo = Math.round(Math.min(saldo, teto) * 100) / 100;
  const [usarCredito, setUsarCredito] = useState(false);
  const [valorCredito, setValorCredito] = useState(maximo);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<PedidoEnviado | null>(null);

  useEffect(() => {
    if (aberto) {
      setEnviado(null);
      setUsarCredito(false);
      setValorCredito(maximo);
    }
  }, [aberto, maximo]);

  const bloqueado = resumo.pendencias.length > 0 || resumo.itensDaGrafica === 0 || !painel.parceiro.tem_atendente;

  async function enviar() {
    setEnviando(true);
    try {
      const credito = usarCredito ? Math.max(0, Math.min(Number(valorCredito) || 0, maximo)) : 0;
      const r = await enviarPedido(orcamentoId, credito);
      setEnviado(r);
      qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
      qc.invalidateQueries({ queryKey: ["parceiro-orcamento", orcamentoId] });
      qc.invalidateQueries({ queryKey: ["parceiro-orcamentos"] });
    } catch (e) {
      toast.error(mensagemErro(e, "O pedido não foi enviado. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  const { contato } = painel;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {enviado ? (
          <>
            <DialogHeader>
              <CheckCircle2 className="mb-2 h-10 w-10 text-status-cyan" aria-hidden="true" />
              <DialogTitle className="text-xl">Pedido nº {enviado.numero} enviado</DialogTitle>
              <DialogDescription>
                A gráfica recebeu {enviado.itens} {enviado.itens === 1 ? "item" : "itens"} no valor de{" "}
                {brl(enviado.total)}
                {enviado.credito_usado > 0
                  ? `, menos ${brl(enviado.credito_usado)} de crédito: ficam ${brl(Math.max(enviado.total - enviado.credito_usado, 0))} a pagar`
                  : ""}
                .
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-xl border border-border bg-foreground/5 p-4 text-sm">
              <p className="font-medium">Próximo passo: mande as artes</p>
              <p className="text-muted-foreground">
                {contato.telefones
                  ? `Envie para ${contato.atendente ?? "a gráfica"} pelo ${contato.telefones}${contato.email ? ` ou ${contato.email}` : ""}, citando o pedido nº ${enviado.numero}.`
                  : `Envie para a gráfica citando o pedido nº ${enviado.numero}.`}
              </p>
              {enviado.itens_livres_fora_do_pedido > 0 && (
                <p className="text-muted-foreground">
                  {enviado.itens_livres_fora_do_pedido} item(ns) livre(s) ficaram só no seu orçamento — são serviço seu.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Fazer pedido à gráfica</DialogTitle>
              <DialogDescription>
                Vão para produção os itens da tabela. Os preços são conferidos pela gráfica no envio.
              </DialogDescription>
            </DialogHeader>

            {resumo.pendencias.length > 0 && (
              <div className="rounded-xl border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-[color:var(--bex-amber)]" /> Resolva antes de enviar
                </p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {resumo.pendencias.map((p) => (
                    <li key={p.indice}>
                      Item {p.indice + 1} ({p.descricao}): {p.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!painel.parceiro.tem_atendente && (
              <p className="rounded-xl border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-sm">
                Seu cadastro ainda não tem atendente na gráfica. Peça para a equipe indicar quem vai te atender.
              </p>
            )}

            <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-border p-4 text-sm">
              <dt className="text-muted-foreground">Itens para produzir</dt>
              <dd className="text-right tabular-nums">{resumo.itensDaGrafica}</dd>
              <dt className="text-muted-foreground">Total estimado</dt>
              <dd className="text-right font-semibold tabular-nums">{brl(resumo.custo)}</dd>
              {usarCredito && valorCredito > 0 && (
                <>
                  <dt className="text-muted-foreground">Crédito usado</dt>
                  <dd className="text-right tabular-nums">− {brl(Math.min(Number(valorCredito) || 0, maximo))}</dd>
                  <dt className="font-medium">A pagar à gráfica</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {brl(Math.max(resumo.custo - Math.min(Number(valorCredito) || 0, maximo), 0))}
                  </dd>
                </>
              )}
              {resumo.itensLivres > 0 && (
                <>
                  <dt className="text-muted-foreground">Itens livres (só no seu PDF)</dt>
                  <dd className="text-right tabular-nums">{resumo.itensLivres}</dd>
                </>
              )}
            </dl>

            {saldo > 0 && (
              <div className="space-y-2 rounded-xl border border-border p-4">
                <div className="flex items-center gap-2">
                  <Checkbox id="usar-credito" checked={usarCredito} onCheckedChange={(v) => setUsarCredito(v === true)} />
                  <Label htmlFor="usar-credito">
                    Usar crédito (você tem {brl(saldo)})
                  </Label>
                </div>
                {usarCredito && (
                  <div className="space-y-1.5">
                    <Label htmlFor="valor-credito">Quanto usar (até {brl(maximo)})</Label>
                    <Input
                      id="valor-credito"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maximo}
                      step="0.01"
                      value={valorCredito}
                      onChange={(e) => setValorCredito(Number(e.target.value))}
                      className="w-40"
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {tetoDeEntrada
                    ? `É a sua 1ª compra: o crédito pode cobrir até ${pctTeto.toLocaleString("pt-BR")}% dos produtos. `
                    : programa.data
                      ? `O crédito cobre até ${pctTeto.toLocaleString("pt-BR")}% dos produtos do pedido. `
                      : ""}
                  {!tetoDeEntrada && entrada?.ativa && primeiraCompra && resumo.custo < entrada.pedido_minimo
                    ? `Com produtos a partir de ${brl(entrada.pedido_minimo)}, o crédito de entrada pode cobrir até ${entrada.max_pct.toLocaleString("pt-BR")}%. `
                    : ""}
                  O crédito entra como desconto no próprio pedido. Se a gráfica recusar, ele volta para o seu saldo.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
                Voltar
              </Button>
              <Button onClick={enviar} disabled={bloqueado || enviando}>
                <Send className="mr-1 h-4 w-4" />
                {enviando ? "Enviando…" : "Enviar pedido"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
