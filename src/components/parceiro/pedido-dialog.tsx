import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { CHAVE_PAINEL, enviarPedido, type PedidoEnviado } from "@/lib/parceiro-api";
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
  const maximo = Math.round(Math.min(saldo, resumo.custo) * 100) / 100;
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
              <CheckCircle2 className="mb-2 h-10 w-10 text-[color:var(--bex-cyan)]" />
              <DialogTitle className="text-xl">Pedido nº {enviado.numero} enviado</DialogTitle>
              <DialogDescription>
                A gráfica recebeu {enviado.itens} {enviado.itens === 1 ? "item" : "itens"} no valor de{" "}
                {brl(enviado.total)}
                {enviado.credito_usado > 0 ? `, com ${brl(enviado.credito_usado)} de crédito para abater` : ""}.
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
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maximo}
                      step="0.01"
                      value={valorCredito}
                      onChange={(e) => setValorCredito(Number(e.target.value))}
                      className="w-40"
                      aria-label="Valor de crédito a usar"
                    />
                    <span className="text-xs text-muted-foreground">até {brl(maximo)}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  O crédito é abatido no pagamento. Se o pedido for recusado, ele volta para o seu saldo.
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
