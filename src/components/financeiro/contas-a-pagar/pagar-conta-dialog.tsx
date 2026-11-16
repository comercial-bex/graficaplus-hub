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
import {
  ORIGEM_DINHEIRO,
  problemaDaDataDoPagamento,
  problemaDaOrigem,
} from "@/domain/financeiro/contas-a-pagar-anexos";
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

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/**
 * "Pagar" não grava no clique: este diálogo mostra o que vai sair, de onde e quando, e só a
 * confirmação aqui chama o banco. A data começa em hoje, aceita data passada e recusa futura.
 *
 * De onde saiu o dinheiro é obrigatório (Fase 2A, 16/11/2026): não há mais "Não informar" nem
 * escolha feita pela tela. Ou uma conta bancária, ou "Dinheiro / caixa físico", que exige o
 * comprovante: nesse caso o arquivo sobe ANTES do pagamento, porque o banco só aceita dinheiro com
 * comprovante já anexado. Com conta bancária o comprovante segue opcional (aviso "sem comprovante").
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
  // A tela monta o diálogo com `key` = id da conta: cada conta recomeça do zero, com hoje, sem
  // origem escolhida e nenhum arquivo.
  const [data, setData] = useState(hoje);
  const [origem, setOrigem] = useState("");
  const [comprovantes, setComprovantes] = useState<ArquivoParaEnviar[]>([]);

  const emDinheiro = origem === ORIGEM_DINHEIRO;
  const problemaDaData = problemaDaDataDoPagamento(data, hoje);
  const problemaDeOrigem = problemaDaOrigem(origem, comprovantes.length);

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!conta) throw new Error("Nenhuma conta escolhida.");
      if (problemaDaData) throw new Error(problemaDaData);
      if (problemaDeOrigem) throw new Error(problemaDeOrigem);
      if (emDinheiro) {
        // Dinheiro: o comprovante primeiro. Sem ele anexado o banco recusa o pagamento.
        const envio = await enviar(conta.id, comprovantes);
        if (envio.enviados === 0)
          throw new Error(
            `O comprovante não foi anexado, e sem ele o pagamento em dinheiro não é registrado. ${envio.falhas.join(" ")}`,
          );
        try {
          await pagar({
            contaId: conta.id,
            dataPagamento: data,
            contaBancariaId: null,
            emDinheiro: true,
          });
        } catch (e) {
          throw new Error(
            `${mensagemErro(e)} O comprovante ficou anexado à conta, que segue em aberto.`,
          );
        }
        return envio;
      }
      await pagar({
        contaId: conta.id,
        dataPagamento: data,
        contaBancariaId: origem,
        emDinheiro: false,
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

  const bancoEscolhido = contasBancarias.find((b) => b.conta_id === origem);

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
              <Label htmlFor="pagar-conta-bancaria">De onde saiu o dinheiro (obrigatório)</Label>
              <Select value={origem} onValueChange={setOrigem} disabled={confirmar.isPending}>
                <SelectTrigger
                  id="pagar-conta-bancaria"
                  aria-invalid={!origem}
                  aria-describedby="pagar-origem-ajuda"
                >
                  <SelectValue placeholder="Escolha a conta bancária ou dinheiro" />
                </SelectTrigger>
                <SelectContent>
                  {contasBancarias.map((b) => (
                    <SelectItem key={b.conta_id} value={b.conta_id}>
                      {b.banco ? `${b.nome} · ${b.banco}` : b.nome}
                    </SelectItem>
                  ))}
                  <SelectItem value={ORIGEM_DINHEIRO}>Dinheiro / caixa físico</SelectItem>
                </SelectContent>
              </Select>
              <p
                id="pagar-origem-ajuda"
                className={
                  origem && problemaDeOrigem
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {emDinheiro
                  ? (problemaDeOrigem ??
                    "Dinheiro: o comprovante sobe antes de gravar o pagamento.")
                  : contasBancarias.length === 0
                    ? "Nenhuma conta bancária cadastrada. Cadastre em Contas bancárias, ou pague em dinheiro com comprovante."
                    : "A conta bancária de onde o dinheiro saiu, ou dinheiro com comprovante."}
              </p>
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
                <Label htmlFor="pagar-comprovante">
                  Comprovante de pagamento {emDinheiro ? "(obrigatório no dinheiro)" : "(opcional)"}
                </Label>
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
              {bancoEscolhido ? ` de ${bancoEscolhido.nome}` : emDinheiro ? " em dinheiro" : ""}
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
            disabled={!conta || !!problemaDaData || !!problemaDeOrigem || confirmar.isPending}
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
