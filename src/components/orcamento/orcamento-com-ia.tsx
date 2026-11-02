import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import {
  criarRascunhoDaIa,
  lerPedidoDoCliente,
  type ResultadoDaLeitura,
} from "@/lib/api/orcamento-ia.functions";
import { itemSemMedida, type LeituraDoPedido } from "@/domain/orcamentos/orcamento-com-ia";

const FRASE_DA_FALHA: Record<string, string> = {
  sem_ia: "A IA não está ligada neste projeto: falta a chave no servidor.",
  sem_roteiro: "Nenhum produto está liberado para a IA. Libere o roteiro na pasta do produto.",
  limite: "Muitas chamadas seguidas. Espere um minuto e tente de novo.",
  sem_saldo: "O saldo de IA acabou.",
};

function fraseDaFalha(r: Exclude<ResultadoDaLeitura, { estado: "ok" }>): string {
  return r.estado === "falhou" ? `A IA não conseguiu ler: ${r.detalhe}.` : FRASE_DA_FALHA[r.estado];
}

/**
 * O botão "Orçamento com IA": cola o pedido, a IA lê com o roteiro de cada
 * produto e a pessoa confere antes de virar rascunho. Nada vai para o cliente.
 */
export function OrcamentoComIa() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [pedido, setPedido] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [leitura, setLeitura] = useState<LeituraDoPedido | null>(null);
  const [lendo, setLendo] = useState(false);
  const [criando, setCriando] = useState(false);

  if (!hasPermission("orcamentos.create")) return null;

  async function ler() {
    setLendo(true);
    setLeitura(null);
    try {
      const r = await lerPedidoDoCliente({ data: { pedido } });
      if (r.estado === "ok") setLeitura(r.leitura);
      else toast.error(fraseDaFalha(r));
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setLendo(false);
    }
  }

  async function criar() {
    if (!leitura) return;
    setCriando(true);
    try {
      const r = await criarRascunhoDaIa({
        data: { contato_nome: nome, contato_telefone: telefone, pedido, leitura },
      });
      if (r.falharam.length > 0)
        toast.warning(`O rascunho foi criado, mas ficaram de fora: ${r.falharam.join(", ")}.`);
      else toast.success("Rascunho criado. Confira antes de enviar ao cliente.");
      void qc.invalidateQueries({ queryKey: ["orcamentos"] });
      setAberto(false);
      setPedido("");
      setNome("");
      setTelefone("");
      setLeitura(null);
      void navigate({ to: "/orcamentos/$id", params: { id: r.orcamento_id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Sparkles className="mr-2 h-4 w-4" /> Orçamento com IA
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Orçamento com IA</DialogTitle>
            <DialogDescription>
              Cole o que o cliente pediu. A IA escolhe os produtos e diz o que falta perguntar. O
              preço vem da tabela, e nada vai para o cliente sem você conferir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ia-pedido">Pedido do cliente</Label>
              <Textarea
                id="ia-pedido"
                rows={5}
                value={pedido}
                placeholder="Ex.: preciso de 2 banners de 1,20 por 0,80 com bastão e 200 chaveiros de acrílico"
                onChange={(e) => setPedido(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={lendo || pedido.trim().length < 5}
              onClick={() => void ler()}
            >
              <Sparkles className="mr-2 h-4 w-4" /> {lendo ? "Lendo o pedido..." : "Ler o pedido"}
            </Button>

            {leitura && (
              <div className="space-y-3 rounded border p-3">
                <div className="text-sm font-medium">{leitura.titulo}</div>
                {leitura.itens.length === 0 && (
                  <p className="text-sm text-destructive">
                    A IA não achou nenhum produto do catálogo neste pedido.
                  </p>
                )}
                {leitura.itens.map((i, n) => (
                  <div key={n} className="rounded border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {i.nome}
                      {itemSemMedida(i) && (
                        <Badge variant="outline">Falta a medida: sai sem preço</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i.quantidade.toLocaleString("pt-BR")}{" "}
                      {i.unidade === "m2" ? "peça(s)" : i.unidade}
                      {i.largura_m && i.altura_m
                        ? ` · ${i.largura_m.toLocaleString("pt-BR")} × ${i.altura_m.toLocaleString("pt-BR")} m`
                        : ""}
                      {i.acabamentos.length > 0 ? ` · ${i.acabamentos.join(", ")}` : ""}
                      {i.observacao ? ` · ${i.observacao}` : ""}
                    </div>
                  </div>
                ))}
                {leitura.perguntas_que_faltam.length > 0 && (
                  <div className="text-sm">
                    <div className="font-medium">Falta perguntar ao cliente</div>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {leitura.perguntas_que_faltam.map((p, n) => (
                        <li key={n}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {leitura.sem_produto.length > 0 && (
                  <div className="text-sm">
                    <div className="font-medium">Não está no catálogo</div>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {leitura.sem_produto.map((p, n) => (
                        <li key={n}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ia-nome">Nome do cliente</Label>
                    <Input id="ia-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ia-telefone">Telefone (opcional)</Label>
                    <Input
                      id="ia-telefone"
                      value={telefone}
                      onChange={(e) => setTelefone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!leitura || leitura.itens.length === 0 || !nome.trim() || criando}
              onClick={() => void criar()}
            >
              {criando ? "Criando..." : "Criar rascunho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
