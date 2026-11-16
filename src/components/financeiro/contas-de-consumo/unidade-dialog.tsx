import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  TIPOS_DE_CONSUMO,
  dadosDoTipo,
  type TipoDeConsumo,
  type UnidadeDeConsumo,
} from "@/domain/financeiro/contas-de-consumo";
import {
  criarFornecedor,
  useSalvarUnidade,
  type BancoDaLista,
  type FornecedorDaLista,
} from "./use-contas-de-consumo";

const NENHUMA = "nenhuma";
const NOVO_FORNECEDOR = "novo";

/**
 * Cadastrar ou editar a unidade consumidora. Só admin e gestor chegam aqui; o banco confere de novo.
 * O fornecedor vem do cadastro que já existe; se faltar, dá para cadastrar ali mesmo, só com o nome.
 */
export function UnidadeDialog({
  unidade,
  fornecedores,
  bancos,
  onFechar,
  onSalva,
}: {
  /** null = nova unidade. */
  unidade: UnidadeDeConsumo | null;
  fornecedores: readonly FornecedorDaLista[];
  bancos: readonly BancoDaLista[];
  onFechar: () => void;
  onSalva: (id: string) => void;
}) {
  const salvar = useSalvarUnidade();
  const [tipo, setTipo] = useState<TipoDeConsumo>((unidade?.tipo as TipoDeConsumo) ?? "energia");
  const [fornecedor, setFornecedor] = useState(unidade?.fornecedor_id ?? "");
  const [nomeNovo, setNomeNovo] = useState("");
  const [identificador, setIdentificador] = useState(unidade?.identificador ?? "");
  const [endereco, setEndereco] = useState(unidade?.endereco ?? "");
  const [dia, setDia] = useState(unidade?.dia_vencimento ? String(unidade.dia_vencimento) : "");
  const [banco, setBanco] = useState(unidade?.conta_bancaria_id ?? NENHUMA);
  const [observacoes, setObservacoes] = useState(unidade?.observacoes ?? "");
  const [ativo, setAtivo] = useState(unidade?.ativo ?? true);

  const diaNumero = dia.trim() === "" ? null : Number(dia);
  const problema = !fornecedor
    ? "Escolha o fornecedor."
    : fornecedor === NOVO_FORNECEDOR && nomeNovo.trim().length < 2
      ? "Escreva o nome do fornecedor novo."
      : !identificador.trim()
        ? `Informe o número (${dadosDoTipo(tipo).numero}).`
        : diaNumero !== null && (!Number.isInteger(diaNumero) || diaNumero < 1 || diaNumero > 31)
          ? "O dia do vencimento vai de 1 a 31."
          : null;

  const gravar = useMutation({
    mutationFn: async () => {
      if (problema) throw new Error(problema);
      const fornecedorId =
        fornecedor === NOVO_FORNECEDOR ? await criarFornecedor(nomeNovo) : fornecedor;
      return salvar(
        {
          tipo,
          fornecedor_id: fornecedorId,
          identificador: identificador.trim(),
          endereco: endereco.trim() || null,
          dia_vencimento: diaNumero,
          conta_bancaria_id: banco === NENHUMA ? null : banco,
          observacoes: observacoes.trim() || null,
          ativo,
        },
        unidade?.id ?? null,
      );
    },
    onSuccess: (id) => {
      toast.success(unidade ? "Unidade atualizada" : "Unidade cadastrada");
      onSalva(id);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !gravar.isPending && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {unidade ? "Editar unidade consumidora" : "Nova unidade consumidora"}
          </DialogTitle>
          <DialogDescription>
            De quem é a conta, qual o número e quando costuma vencer. Cada fatura do mês é lançada
            depois, em "Lançar fatura".
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="unidade-tipo">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDeConsumo)}>
              <SelectTrigger id="unidade-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_CONSUMO.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unidade-fornecedor">Fornecedor</Label>
            <Select value={fornecedor} onValueChange={setFornecedor}>
              <SelectTrigger id="unidade-fornecedor">
                <SelectValue placeholder="Escolha o fornecedor" />
              </SelectTrigger>
              <SelectContent>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nome}
                  </SelectItem>
                ))}
                <SelectItem value={NOVO_FORNECEDOR}>+ Cadastrar fornecedor novo</SelectItem>
              </SelectContent>
            </Select>
            {fornecedor === NOVO_FORNECEDOR && (
              <Input
                aria-label="Nome do fornecedor novo"
                placeholder="Ex.: CAESA"
                value={nomeNovo}
                onChange={(e) => setNomeNovo(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unidade-numero">
              Número da {dadosDoTipo(tipo).numero === "UC" ? "unidade (UC)" : "conta ou contrato"}
            </Label>
            <Input
              id="unidade-numero"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder={
                dadosDoTipo(tipo).numero === "UC" ? "Ex.: 228.739.007-85" : "Ex.: 123456"
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unidade-dia">Dia habitual do vencimento</Label>
            <Input
              id="unidade-dia"
              inputMode="numeric"
              value={dia}
              onChange={(e) => setDia(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="Ex.: 7"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="unidade-endereco">Endereço</Label>
            <Input
              id="unidade-endereco"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="unidade-banco">Conta bancária de onde costuma sair</Label>
            <Select value={banco} onValueChange={setBanco}>
              <SelectTrigger id="unidade-banco">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUMA}>Não definida</SelectItem>
                {bancos.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.banco ? `${b.nome} · ${b.banco}` : b.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Aparece como sugestão no pagamento; a origem continua sendo escolhida a cada
              pagamento.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="unidade-obs">Observações</Label>
            <Textarea
              id="unidade-obs"
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {unidade && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              Unidade ativa (desmarque quando a conta deixar de existir; o histórico fica)
            </label>
          )}
        </div>

        {problema && fornecedor !== "" && <p className="text-sm text-destructive">{problema}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => gravar.mutate()} disabled={!!problema || gravar.isPending}>
            {gravar.isPending ? "Salvando…" : "Salvar unidade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
