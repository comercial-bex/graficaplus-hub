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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { problemaDaDataDoPagamento } from "@/domain/financeiro/contas-a-pagar-anexos";
import { CampoDeAnexos } from "./campo-de-anexos";
import {
  useEnviarAnexos,
  usePagarConta,
  usePodeNaContaAPagar,
  type ArquivoParaEnviar,
} from "./use-conta-a-pagar";

export interface ContaParaPagar {
  id: string;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  vencimento: string;
}

export interface ContaBancariaDaLista {
  conta_id: string;
  nome: string;
  banco?: string | null;
}

const SEM_CONTA = "nao-informada";
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/**
 * "Pagar" não grava no clique: este diálogo mostra o que vai sair, de onde e quando, e só a
 * confirmação aqui chama o banco. A data começa em hoje, aceita data passada e recusa futura.
 * O comprovante é opcional; sem ele a linha da conta fica com o aviso "sem comprovante".
 */
export function PagarContaDialog({
  conta,
  contasBancarias,
  hoje,
  pacoteAtivo,
  onFechar,
  onPago,
}: {
  conta: ContaParaPagar | null;
  contasBancarias: readonly ContaBancariaDaLista[];
  hoje: string;
  pacoteAtivo: boolean;
  onFechar: () => void;
  onPago: () => void;
}) {
  const { podeAnexar } = usePodeNaContaAPagar();
  const pagar = usePagarConta();
  const enviar = useEnviarAnexos();
  // A tela monta o diálogo com `key` = id da conta: cada conta recomeça do zero, com hoje, a
  // única conta bancária (quando só há uma) e nenhum arquivo.
  const [data, setData] = useState(hoje);
  const [contaBancaria, setContaBancaria] = useState(() =>
    contasBancarias.length === 1 ? contasBancarias[0].conta_id : SEM_CONTA,
  );
  const [comprovantes, setComprovantes] = useState<ArquivoParaEnviar[]>([]);

  const problemaDaData = problemaDaDataDoPagamento(data, hoje);

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!conta) throw new Error("Nenhuma conta escolhida.");
      if (problemaDaData) throw new Error(problemaDaData);
      await pagar({
        contaId: conta.id,
        dataPagamento: data,
        contaBancariaId: contaBancaria === SEM_CONTA ? null : contaBancaria,
        pacoteAtivo,
      });
      // O pagamento já está gravado. Arquivo que não subir não desfaz o pagamento: vira aviso.
      return comprovantes.length > 0 ? enviar(conta.id, comprovantes) : { enviados: 0, falhas: [] };
    },
    onSuccess: (envio) => {
      if (envio.falhas.length > 0) {
        toast.warning(
          `Pagamento registrado, mas o comprovante não foi anexado: ${envio.falhas.join(" ")} Anexe pelo clipe da conta.`,
        );
      } else if (envio.enviados > 0) {
        toast.success("Pagamento registrado com comprovante");
      } else {
        toast.success("Pagamento registrado — sem comprovante anexado");
      }
      onPago();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const bancoEscolhido = contasBancarias.find((b) => b.conta_id === contaBancaria);

  return (
    <Dialog open={!!conta} onOpenChange={(aberto) => !aberto && !confirmar.isPending && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Confirmar pagamento</DialogTitle>
          <DialogDescription>
            Confira antes de gravar. A saída entra no caixa na data do pagamento escolhida aqui.
          </DialogDescription>
        </DialogHeader>

        {conta && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm">
              <dt className="text-muted-foreground">Descrição</dt>
              <dd className="min-w-0 break-words font-medium">{conta.descricao}</dd>
              <dt className="text-muted-foreground">Fornecedor</dt>
              <dd className="min-w-0 break-words">{conta.fornecedor || "sem fornecedor"}</dd>
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="font-bold tabular-nums">{brl(conta.valor)}</dd>
              <dt className="text-muted-foreground">Vencimento</dt>
              <dd className="tabular-nums">{dia(conta.vencimento)}</dd>
            </dl>

            <div className="space-y-1.5">
              <Label htmlFor="pagar-conta-bancaria">Conta de onde sai o dinheiro</Label>
              <Select
                value={contaBancaria}
                onValueChange={setContaBancaria}
                disabled={confirmar.isPending}
              >
                <SelectTrigger id="pagar-conta-bancaria">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contasBancarias.map((b) => (
                    <SelectItem key={b.conta_id} value={b.conta_id}>
                      {b.banco ? `${b.nome} · ${b.banco}` : b.nome}
                    </SelectItem>
                  ))}
                  <SelectItem value={SEM_CONTA}>Não informar (dinheiro ou outra conta)</SelectItem>
                </SelectContent>
              </Select>
              {contasBancarias.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma conta bancária cadastrada. Cadastre em Contas bancárias para registrar a
                  origem.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pagar-data">Data do pagamento</Label>
              <Input
                id="pagar-data"
                type="date"
                value={data}
                max={hoje}
                disabled={confirmar.isPending}
                aria-invalid={!!problemaDaData}
                aria-describedby="pagar-data-ajuda"
                onChange={(e) => setData(e.target.value)}
              />
              <p
                id="pagar-data-ajuda"
                className={
                  problemaDaData ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {problemaDaData ?? "A data real em que o dinheiro saiu. Pode ser anterior a hoje."}
              </p>
            </div>

            {pacoteAtivo && podeAnexar && (
              <div className="space-y-1.5">
                <Label htmlFor="pagar-comprovante">Comprovante de pagamento (opcional)</Label>
                <CampoDeAnexos
                  id="pagar-comprovante"
                  itens={comprovantes}
                  onChange={setComprovantes}
                  tipoFixo="comprovante"
                  disabled={confirmar.isPending}
                />
              </div>
            )}

            <p className="rounded-md bg-muted p-3 text-sm">
              Vai sair <strong className="tabular-nums">{brl(conta.valor)}</strong>
              {bancoEscolhido ? ` de ${bancoEscolhido.nome}` : ""}
              {!problemaDaData ? ` em ${dia(data)}` : ""}.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={confirmar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => confirmar.mutate()}
            disabled={!conta || !!problemaDaData || confirmar.isPending}
          >
            {confirmar.isPending
              ? "Gravando…"
              : conta
                ? `Confirmar pagamento de ${brl(conta.valor)}`
                : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
