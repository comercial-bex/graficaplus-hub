import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import {
  decidirVinculo,
  itensDoOrcamento,
  type DecisaoDeVinculo,
  type ItemParaEscolher,
} from "@/lib/api/flexi-vinculos.functions";
import { MOTIVO_ROTULO, STATUS_DO_ORCAMENTO, type JobParaConferir } from "@/domain/flexi/rotulos";

/**
 * Conferir o orçamento de um job do Flexi. O sistema sugere; aqui a PESSOA
 * decide. Confirmar não baixa estoque: a baixa é a fase 3 e só olhará os
 * vínculos confirmados.
 */

const cm = (n: number | null) =>
  n === null ? "?" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function CartaoDeItem({
  titulo,
  detalhe,
  extra,
  rotuloDoBotao,
  onConfirmar,
  desabilitado,
}: {
  titulo: string;
  detalhe: string;
  extra?: string;
  rotuloDoBotao: string;
  onConfirmar: () => void;
  desabilitado: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{detalhe}</p>
        {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
      </div>
      <Button type="button" size="sm" onClick={onConfirmar} disabled={desabilitado}>
        {rotuloDoBotao}
      </Button>
    </li>
  );
}

export function ConferirJobDialog({
  job,
  onFechar,
}: {
  job: JobParaConferir | null;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const decidir = useServerFn(decidirVinculo);
  const buscarItens = useServerFn(itensDoOrcamento);
  const [numero, setNumero] = useState("");
  const [encontrados, setEncontrados] = useState<ItemParaEscolher[] | null>(null);
  const [motivo, setMotivo] = useState<keyof typeof MOTIVO_ROTULO>("prova");

  const enviar = useMutation({
    mutationFn: async (d: DecisaoDeVinculo) => decidir({ data: d }),
    onSuccess: (_r, d) => {
      toast.success(
        d.acao === "confirmar"
          ? "Orçamento confirmado. Nada foi baixado do estoque."
          : d.acao === "reabrir"
            ? "Job reaberto para conferência."
            : "Anotado.",
      );
      void queryClient.invalidateQueries({ queryKey: ["rip-jobs-recentes"] });
      setEncontrados(null);
      setNumero("");
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a decisão.")),
  });

  const procurar = useMutation({
    mutationFn: async () => buscarItens({ data: { numero: Number(numero) } }),
    onSuccess: (itens) => {
      setEncontrados(itens);
      if (itens.length === 0) toast.error("Não achei esse orçamento.");
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível procurar o orçamento.")),
  });

  if (!job) return null;
  const v = job.vinculo;
  const candidatos = v?.candidatos ?? [];
  const decidido =
    v?.estado === "confirmado" || v?.estado === "recusado" || v?.estado === "sem_orcamento";
  const ocupado = enviar.isPending;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conferir o orçamento do job</DialogTitle>
          <DialogDescription>
            {job.nome_job} · {Number(job.largura_cm).toLocaleString("pt-BR")} ×{" "}
            {Number(job.altura_cm).toLocaleString("pt-BR")} cm · {job.copias} cópia(s)
          </DialogDescription>
        </DialogHeader>

        {v?.estado === "confirmado" && (
          <p className="rounded-md border border-border bg-muted p-3 text-sm">
            Confirmado: orçamento {v.orcamento_numero} — {v.item_descricao || v.orcamento_titulo}.
          </p>
        )}

        {candidatos.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">
              {v?.estado === "sugerido" ? "O sistema sugere" : "Candidatos do sistema"}
            </h3>
            <ul className="space-y-2">
              {candidatos.map((c) => (
                <CartaoDeItem
                  key={c.itemId}
                  titulo={`Orçamento ${c.orcamentoNumero} — ${c.descricao || c.titulo}`}
                  detalhe={`${cm(c.larguraCm)} × ${cm(c.alturaCm)} cm · ${c.quantidade} un · ${STATUS_DO_ORCAMENTO[c.status] ?? c.status} · confiança ${Math.round(c.confianca * 100)}%`}
                  extra={c.motivos.join(" · ")}
                  rotuloDoBotao={
                    v?.estado === "confirmado" && v.orcamento_numero === c.orcamentoNumero
                      ? "Confirmado"
                      : "É este"
                  }
                  desabilitado={ocupado}
                  onConfirmar={() =>
                    enviar.mutate({
                      acao: "confirmar",
                      ripJobId: job.id,
                      orcamentoItemId: c.itemId,
                    })
                  }
                />
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Outro orçamento</h3>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(numero) >= 1) procurar.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="numero-orcamento">Número do orçamento</Label>
              <Input
                id="numero-orcamento"
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-40"
              />
            </div>
            <Button type="submit" variant="outline" disabled={!numero || procurar.isPending}>
              {procurar.isPending ? "Procurando…" : "Procurar"}
            </Button>
          </form>
          {encontrados && encontrados.length > 0 && (
            <ul className="space-y-2">
              {encontrados.map((i) => (
                <CartaoDeItem
                  key={i.itemId}
                  titulo={`Orçamento ${i.orcamentoNumero} — ${i.descricao || i.titulo}`}
                  detalhe={`${cm(i.larguraCm)} × ${cm(i.alturaCm)} cm · ${i.quantidade} un · ${STATUS_DO_ORCAMENTO[i.status] ?? i.status}`}
                  rotuloDoBotao="É este"
                  desabilitado={ocupado}
                  onConfirmar={() =>
                    enviar.mutate({
                      acao: "confirmar",
                      ripJobId: job.id,
                      orcamentoItemId: i.itemId,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Não tem orçamento</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="motivo-sem-orcamento">Motivo</Label>
              <Select
                value={motivo}
                onValueChange={(m) => setMotivo(m as keyof typeof MOTIVO_ROTULO)}
              >
                <SelectTrigger id="motivo-sem-orcamento" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MOTIVO_ROTULO).map(([chave, rotulo]) => (
                    <SelectItem key={chave} value={chave}>
                      {rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => enviar.mutate({ acao: "sem_orcamento", ripJobId: job.id, motivo })}
            >
              Marcar sem orçamento
            </Button>
          </div>
        </section>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(v?.estado === "sugerido" || v?.estado === "revisar") && (
              <Button
                type="button"
                variant="ghost"
                disabled={ocupado}
                onClick={() => enviar.mutate({ acao: "recusar", ripJobId: job.id })}
              >
                Nenhum desses
              </Button>
            )}
            {decidido && (
              <Button
                type="button"
                variant="ghost"
                disabled={ocupado}
                onClick={() => enviar.mutate({ acao: "reabrir", ripJobId: job.id })}
              >
                Reabrir
              </Button>
            )}
          </div>
          <Button type="button" variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
