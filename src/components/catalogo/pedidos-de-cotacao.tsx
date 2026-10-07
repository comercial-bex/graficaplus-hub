import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Inbox, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { mensagemErro } from "@/lib/erros";
import {
  atenderCotacao,
  lerCotacoes,
  type PedidoDeCotacaoRecebido,
} from "@/components/catalogo/consultas";

const PECAS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function quando(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Os pedidos de cotação que os clientes fizeram pelos links da vitrine: quem,
 * quando, o quê, por qual link. Quem atende marca como atendido. O botão de
 * WhatsApp só ABRE a conversa com o cliente — a mensagem é da pessoa da
 * equipe, nada sai sozinho.
 */
export function PedidosDeCotacao() {
  const qc = useQueryClient();
  const [soAbertos, setSoAbertos] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const pedidos = useQuery({ queryKey: ["catalogo-cotacoes"], queryFn: lerCotacoes });

  async function marcar(p: PedidoDeCotacaoRecebido, atendida: boolean) {
    setOcupado(p.id);
    try {
      await atenderCotacao(p.id, atendida);
      qc.invalidateQueries({ queryKey: ["catalogo-cotacoes"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  if (pedidos.isPending)
    return <p className="text-sm text-muted-foreground">Carregando os pedidos…</p>;
  if (pedidos.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não deu para carregar os pedidos de cotação"
        erro={pedidos.error}
        onTentarDeNovo={() => void pedidos.refetch()}
      />
    );
  }

  const lista = pedidos.data.pedidos.filter((p) => !soAbertos || !p.atendido_em);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={soAbertos ? "default" : "outline"}
          className="h-11 md:h-8"
          aria-pressed={soAbertos}
          onClick={() => setSoAbertos(true)}
        >
          Abertos ({pedidos.data.abertos})
        </Button>
        <Button
          size="sm"
          variant={!soAbertos ? "default" : "outline"}
          className="h-11 md:h-8"
          aria-pressed={!soAbertos}
          onClick={() => setSoAbertos(false)}
        >
          Todos ({pedidos.data.pedidos.length})
        </Button>
      </div>

      {lista.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" />
            {soAbertos
              ? "Nenhum pedido de cotação em aberto."
              : "Nenhum pedido de cotação chegou pelos links ainda."}
          </CardContent>
        </Card>
      ) : (
        lista.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {p.nome}
                    {p.atendido_em ? (
                      <Badge variant="outline">
                        Atendido{p.atendido_por ? ` por ${p.atendido_por}` : ""}
                      </Badge>
                    ) : (
                      <Badge>Aberto</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {quando(p.criado_em)} · pelo link "{p.link_titulo}"
                    {p.cliente ? ` (${p.cliente})` : ""} · {p.catalogo_titulo}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" className="h-11 md:h-9">
                    <a
                      href={`https://wa.me/${p.telefone.length <= 11 ? `55${p.telefone}` : p.telefone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="mr-1 h-4 w-4" /> {p.telefone}
                    </a>
                  </Button>
                  <Button
                    variant={p.atendido_em ? "ghost" : "default"}
                    className="h-11 md:h-9"
                    disabled={ocupado === p.id}
                    onClick={() => void marcar(p, !p.atendido_em)}
                  >
                    {ocupado === p.id ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : p.atendido_em ? (
                      <RotateCcw className="mr-1 h-4 w-4" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    {p.atendido_em ? "Reabrir" : "Marcar atendido"}
                  </Button>
                </div>
              </div>
              <ul className="space-y-1 text-sm">
                {p.itens.map((i, n) => (
                  <li key={`${i.codigo}-${n}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs">{i.codigo}</span>
                    <span className="min-w-0 flex-1">
                      {i.nome}
                      {i.rotulo && i.modalidade !== "valor_unico" ? (
                        <span className="text-muted-foreground"> · {i.rotulo}</span>
                      ) : null}
                    </span>
                    <span className="font-semibold">{PECAS.format(i.quantidade)} peças</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
