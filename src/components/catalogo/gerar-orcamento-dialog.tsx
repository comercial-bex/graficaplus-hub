import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { mensagemErro } from "@/lib/erros";
import {
  conferirCarrinho,
  itensParaOrcar,
  resumoDoCarrinho,
  type Carrinho,
} from "@/domain/catalogo/carrinho";
import { precoEmReais } from "@/domain/catalogo/preco-de-venda";
import { gerarOrcamentoDoCarrinho, lerClientes } from "@/components/catalogo/consultas";

const SEM_CLIENTE = "__sem_cliente__";

/**
 * "Gerar orçamento": o carrinho da equipe vira UM orçamento em rascunho, com
 * todos os itens que têm preço, pelo mesmo caminho de "Adicionar ao
 * orçamento" (`catalogo_gerar_orcamento` chama `catalogo_adicionar_ao_orcamento`
 * item a item: preço de venda, custo gravado pelo servidor e totais iguais).
 *
 * "Sem cliente ainda" é o orçamento PRÉVIO do dono: `orcamentos.cliente_id` é
 * nulo por desenho, e o vendedor vincula o cliente na tela do orçamento.
 *
 * Linha sob consulta não entra (o banco recusaria) e FICA no carrinho, com o
 * motivo dito aqui: a regra de venda é da gestão.
 */
export function GerarOrcamentoDialog({
  aberto,
  carrinho,
  onOpenChange,
  onGerado,
}: {
  aberto: boolean;
  carrinho: Carrinho;
  onOpenChange: (aberto: boolean) => void;
  /** As chaves das linhas que entraram no orçamento, para tirá-las do carrinho. */
  onGerado: (chaves: string[]) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [clienteId, setClienteId] = useState(SEM_CLIENTE);
  const [titulo, setTitulo] = useState("Brindes do catálogo");
  const [enviando, setEnviando] = useState(false);
  const clientes = useQuery({
    queryKey: ["catalogo-clientes"],
    enabled: aberto,
    queryFn: lerClientes,
  });

  useEffect(() => {
    if (aberto) {
      setClienteId(SEM_CLIENTE);
      setTitulo("Brindes do catálogo");
    }
  }, [aberto]);

  const separado = useMemo(() => itensParaOrcar(carrinho), [carrinho]);
  const problemas = useMemo(() => conferirCarrinho(carrinho), [carrinho]);
  const resumo = useMemo(() => resumoDoCarrinho(carrinho), [carrinho]);
  const podeGerar = separado.prontos.length > 0 && problemas.length === 0 && !enviando;

  async function gerar() {
    if (!podeGerar) return;
    setEnviando(true);
    try {
      const r = await gerarOrcamentoDoCarrinho({
        itens: separado.prontos,
        clienteId: clienteId === SEM_CLIENTE ? null : clienteId,
        titulo: titulo.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      qc.invalidateQueries({ queryKey: ["catalogo-rascunhos"] });
      const chaves = carrinho
        .filter((l) => l.preco != null && l.ref?.origem === "catalogo")
        .map((l) => l.chave);
      onGerado(chaves);
      toast.success(
        `Orçamento${r.orcamento_numero ? ` nº ${r.orcamento_numero}` : ""} criado com ${r.itens} ${r.itens === 1 ? "item" : "itens"}${r.sem_cliente ? " (sem cliente ainda)" : ""}.`,
        { description: r.avisos.length > 0 ? r.avisos.join(" ") : undefined },
      );
      onOpenChange(false);
      void navigate({ to: "/orcamentos/$id", params: { id: r.orcamento_id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Gerar orçamento
          </DialogTitle>
          <DialogDescription>
            Um orçamento em rascunho com{" "}
            {separado.prontos.length === 1 ? "o item" : `os ${separado.prontos.length} itens`} do
            carrinho, com o preço de venda e o custo gravados pelo sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {resumo.subtotal != null && (
            <p className="text-sm">
              Subtotal dos itens com preço:{" "}
              <span className="font-semibold">{precoEmReais(resumo.subtotal)}</span>
            </p>
          )}
          {separado.semPreco.length > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                {separado.semPreco.length === 1
                  ? "1 item está"
                  : `${separado.semPreco.length} itens estão`}{" "}
                sob consulta e {separado.semPreco.length === 1 ? "fica" : "ficam"} no carrinho, fora
                deste orçamento: {separado.semPreco.map((l) => l.codigo).join(", ")}. Sem regra de
                venda o item não tem preço — quem define a margem é a gestão (Gerenciar → Regra de
                venda).
              </div>
            </div>
          )}
          {problemas.length > 0 && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                Acerte a quantidade no carrinho antes:
                <ul className="mt-1 list-disc pl-4">
                  {problemas.map((p) => (
                    <li key={p.chave}>{p.mensagem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Cliente</Label>
            {clientes.isError ? (
              <FalhaDeConsulta
                titulo="Não deu para carregar os clientes"
                erro={clientes.error}
                onTentarDeNovo={() => void clientes.refetch()}
              />
            ) : (
              <Select value={clienteId} onValueChange={setClienteId} disabled={clientes.isLoading}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_CLIENTE}>Sem cliente ainda — orçamento prévio</SelectItem>
                  {(clientes.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {clienteId === SEM_CLIENTE && (
              <p className="text-xs text-muted-foreground">
                O orçamento nasce sem cliente; você vincula depois, na tela do orçamento.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="carrinho-titulo">Título do orçamento</Label>
            <Input
              id="carrinho-titulo"
              value={titulo}
              maxLength={200}
              onChange={(e) => setTitulo(e.target.value)}
              className="h-11"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="h-11 md:h-9" disabled={!podeGerar} onClick={() => void gerar()}>
            {enviando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Gerar orçamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
