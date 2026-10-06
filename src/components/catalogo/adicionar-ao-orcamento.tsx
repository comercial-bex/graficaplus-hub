import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { useAuth } from "@/lib/auth-context";
import { financialView } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { PRECO_POR, ROTULO_DA_MODALIDADE, fatorDaUnidade, type Modalidade } from "@/domain/catalogo/modalidades";
import { arredondar, precoEmReais } from "@/domain/catalogo/preco-de-venda";
import { conferirQuantidade, quantidadeInicial } from "@/domain/catalogo/quantidade";
import type { ItemDoCatalogo, PrecoDaOpcao } from "@/domain/catalogo/itens";
import { adicionarAoOrcamento, lerClientes, lerRascunhos } from "@/components/catalogo/consultas";

const NOVO = "__novo__";

/**
 * "Adicionar ao orçamento": o item do catálogo entra num orçamento em
 * RASCUNHO pelo mesmo caminho dos outros itens (`orcamento_itens`), com o
 * CUSTO gravado pelo servidor — o vendedor não vê custo, e item de orçamento
 * sem custo era o defeito conhecido desta base.
 *
 * A quantidade é conferida aqui com as MESMAS frases do banco, antes do
 * clique; o banco confere de novo e é ele quem manda.
 */
export function AdicionarAoOrcamentoDialog({
  item,
  precos,
  onOpenChange,
}: {
  item: ItemDoCatalogo | null;
  precos: PrecoDaOpcao[] | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const { nivelDeVisao, hasPermission } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const podeCriar = hasPermission("orcamentos.create");
  const opcoes = useMemo(
    () => (item?.modalidades ?? []).filter((m) => precos?.find((p) => p.modalidade === m.modalidade)?.preco != null),
    [item, precos],
  );
  const [modalidade, setModalidade] = useState<Modalidade | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [destino, setDestino] = useState<string>("");
  const [clienteId, setClienteId] = useState<string>("");
  const [titulo, setTitulo] = useState("Brindes do catálogo");
  const [enviando, setEnviando] = useState(false);

  const opcao = opcoes.find((m) => m.modalidade === modalidade) ?? null;
  const preco = opcao ? (precos?.find((p) => p.modalidade === opcao.modalidade)?.preco ?? null) : null;

  // Recomeça só quando muda o ITEM: os preços podem recarregar com o diálogo
  // aberto, e isso não pode apagar a quantidade que a pessoa digitou.
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId) return;
    const primeira = opcoes[0] ?? null;
    setModalidade(primeira?.modalidade ?? null);
    setQuantidade(
      primeira ? String(quantidadeInicial({ quantidadeMinima: primeira.quantidade_minima, multiplo: primeira.multiplo })) : "",
    );
    setDestino("");
    setClienteId("");
    setTitulo("Brindes do catálogo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const rascunhos = useQuery({
    queryKey: ["catalogo-rascunhos", nivelDeVisao],
    enabled: !!item,
    queryFn: () => lerRascunhos(financialView("orcamentos", nivelDeVisao)),
  });
  const clientes = useQuery({
    queryKey: ["catalogo-clientes"],
    enabled: !!item && destino === NOVO,
    queryFn: lerClientes,
  });

  const qtd = Number(quantidade);
  const conferencia = opcao
    ? conferirQuantidade(
        qtd,
        {
          quantidadeMinima: opcao.quantidade_minima,
          multiplo: opcao.multiplo,
          faixa: opcao.faixa,
          faixaMax: opcao.faixa_max,
        },
        ROTULO_DA_MODALIDADE[opcao.modalidade],
      )
    : null;
  const unitario = item && preco != null ? arredondar(preco / fatorDaUnidade(item.unidade_preco), 4) : null;
  const total = unitario != null && conferencia?.ok ? arredondar(unitario * qtd, 2) : null;
  const destinoOk = destino === NOVO ? !!clienteId && podeCriar : !!destino;

  async function adicionar() {
    if (!item || !opcao || !conferencia?.ok || !destinoOk) return;
    setEnviando(true);
    try {
      const r = await adicionarAoOrcamento({
        itemId: item.id,
        modalidade: opcao.modalidade,
        quantidade: qtd,
        orcamentoId: destino === NOVO ? null : destino,
        clienteId: destino === NOVO ? clienteId : null,
        titulo: destino === NOVO ? titulo : null,
      });
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      qc.invalidateQueries({ queryKey: ["catalogo-rascunhos"] });
      toast.success(
        `${item.codigo_bex} entrou no orçamento${r.orcamento_numero ? ` nº ${r.orcamento_numero}` : ""}${r.orcamento_novo ? " (novo)" : ""}.`,
        {
          description: r.avisos.length > 0 ? r.avisos.join(" ") : undefined,
          action: {
            label: "Abrir orçamento",
            onClick: () => void navigate({ to: "/orcamentos/$id", params: { id: r.orcamento_id } }),
          },
        },
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar ao orçamento</DialogTitle>
          <DialogDescription>
            {item ? `${item.codigo_bex} · ${item.nome}` : ""}. O item entra com o preço de venda do catálogo e o
            custo gravado pelo sistema.
          </DialogDescription>
        </DialogHeader>

        {item && opcoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este item está sob consulta: nenhuma opção tem preço de venda.</p>
        ) : item ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Opção</Label>
              <RadioGroup
                value={modalidade ?? ""}
                onValueChange={(v) => {
                  const m = opcoes.find((o) => o.modalidade === v);
                  setModalidade((m?.modalidade as Modalidade) ?? null);
                  if (m) setQuantidade(String(quantidadeInicial({ quantidadeMinima: m.quantidade_minima, multiplo: m.multiplo })));
                }}
              >
                {opcoes.map((m) => {
                  const p = precos?.find((x) => x.modalidade === m.modalidade)?.preco ?? null;
                  return (
                    <label
                      key={m.modalidade}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <RadioGroupItem value={m.modalidade} />
                      <span className="flex-1">
                        {ROTULO_DA_MODALIDADE[m.modalidade]}
                        {m.faixa ? <span className="text-muted-foreground"> · {m.faixa}</span> : null}
                      </span>
                      <span className="font-semibold">{p != null ? precoEmReais(p) : "—"}</span>
                    </label>
                  );
                })}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">Preço {PRECO_POR[item.unidade_preco]}.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="catalogo-qtd">Quantidade (peças)</Label>
              <Input
                id="catalogo-qtd"
                inputMode="numeric"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))}
                className="h-11"
              />
              {conferencia && !conferencia.ok && (
                <p className="flex items-start gap-1 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {conferencia.mensagem}
                    {conferencia.sugestao != null && (
                      <button
                        type="button"
                        className="ml-1 underline underline-offset-2"
                        onClick={() => setQuantidade(String(conferencia.sugestao))}
                      >
                        Usar {conferencia.sugestao}
                      </button>
                    )}
                  </span>
                </p>
              )}
              {conferencia?.ok && conferencia.aviso && (
                <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {conferencia.aviso}
                </p>
              )}
              {total != null && unitario != null && (
                <p className="text-sm">
                  {qtd} × {precoEmReais(unitario)} ={" "}
                  <span className="font-semibold">{precoEmReais(total)}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Em qual orçamento</Label>
              {rascunhos.isError ? (
                <FalhaDeConsulta
                  titulo="Não deu para carregar os orçamentos em rascunho"
                  erro={rascunhos.error}
                  onTentarDeNovo={() => void rascunhos.refetch()}
                />
              ) : (
                <Select value={destino} onValueChange={setDestino} disabled={rascunhos.isLoading}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={rascunhos.isLoading ? "Carregando…" : "Escolha o orçamento"} />
                  </SelectTrigger>
                  <SelectContent>
                    {podeCriar && <SelectItem value={NOVO}>+ Novo orçamento para um cliente</SelectItem>}
                    {(rascunhos.data ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        nº {o.numero ?? "—"} · {o.titulo ?? "sem título"}
                        {o.cliente_nome ? ` · ${o.cliente_nome}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {rascunhos.isSuccess && rascunhos.data.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum orçamento em rascunho agora.{" "}
                  {podeCriar ? "Crie um novo aqui mesmo." : "Item novo só entra em orçamento em rascunho."}
                </p>
              )}
              {destino && destino !== NOVO && (
                <Link
                  to="/orcamentos/$id"
                  params={{ id: destino }}
                  className="text-xs underline underline-offset-2"
                  target="_blank"
                >
                  Ver este orçamento
                </Link>
              )}
            </div>

            {destino === NOVO && (
              <div className="space-y-3 rounded-md border border-dashed border-border p-3">
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
                        <SelectValue placeholder={clientes.isLoading ? "Carregando…" : "Escolha o cliente"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(clientes.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="catalogo-titulo-orc">Título do orçamento</Label>
                  <Input
                    id="catalogo-titulo-orc"
                    value={titulo}
                    maxLength={200}
                    onChange={(e) => setTitulo(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={enviando || !opcao || !conferencia?.ok || !destinoOk}
            onClick={() => void adicionar()}
          >
            {enviando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
