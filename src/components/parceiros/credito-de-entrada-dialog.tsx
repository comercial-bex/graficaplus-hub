/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";
import { brl } from "@/domain/parceiros/preco";
import { darCreditoDeEntrada, type ResultadoDaEntrada } from "@/lib/parceiro-api";

type Candidato = { id: string; nome: string };

/**
 * Dar o crédito de entrada a quem já está ativo e ainda não comprou (os que
 * entraram antes do recurso existir). A lista vem toda marcada; o admin
 * desmarca cadastros de teste. O banco confere tudo de novo e devolve quem
 * ficou de fora e por quê.
 */
export function CreditoDeEntradaDialog({ valor, disabled }: { valor: number; disabled?: boolean }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaEntrada | null>(null);

  const candidatos = useQuery({
    queryKey: ["parceiros-candidatos-entrada"],
    enabled: aberto,
    queryFn: async (): Promise<Candidato[]> => {
      const { data: ps, error } = await (supabase as any)
        .from("parceiros")
        .select("id, marca_nome, cliente_id")
        .eq("status", "ativo")
        .not("usuario_id", "is", null);
      if (error) throw error;
      const lista = (ps ?? []) as {
        id: string;
        marca_nome: string | null;
        cliente_id: string | null;
      }[];
      if (lista.length === 0) return [];
      const ids = lista.map((p) => p.id);
      const [pedidos, creditos, clientes] = await Promise.all([
        (supabase as any)
          .from("parceiro_orcamentos")
          .select("parceiro_id")
          .in("parceiro_id", ids)
          .not("pedido_orcamento_id", "is", null),
        (supabase as any)
          .from("parceiro_creditos")
          .select("parceiro_id")
          .in("parceiro_id", ids)
          .eq("tipo", "entrada"),
        (supabase as any)
          .from("clientes")
          .select("id, nome")
          .in("id", lista.map((p) => p.cliente_id).filter(Boolean)),
      ]);
      for (const r of [pedidos, creditos, clientes]) if (r.error) throw r.error;
      const fora = new Set<string>(
        [...(pedidos.data ?? []), ...(creditos.data ?? [])].map((r: any) => r.parceiro_id),
      );
      const nomes = new Map<string, string>((clientes.data ?? []).map((c: any) => [c.id, c.nome]));
      return lista
        .filter((p) => !fora.has(p.id))
        .map((p) => ({
          id: p.id,
          nome: p.marca_nome?.trim() || nomes.get(p.cliente_id ?? "") || "Parceiro sem nome",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
  });

  useEffect(() => {
    if (candidatos.data) setMarcados(new Set(candidatos.data.map((c) => c.id)));
  }, [candidatos.data]);

  const lista = useMemo(() => candidatos.data ?? [], [candidatos.data]);

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await darCreditoDeEntrada([...marcados]);
      setResultado(r);
      toast.success(
        r.concedidos === 1
          ? "1 parceiro recebeu o crédito."
          : `${r.concedidos} parceiros receberam o crédito.`,
      );
      qc.invalidateQueries({ queryKey: ["parceiros-candidatos-entrada"] });
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setResultado(null);
          setAberto(true);
        }}
      >
        <Gift className="mr-1 h-4 w-4" />
        Dar o crédito aos parceiros ativos que ainda não compraram
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dar o crédito de entrada</DialogTitle>
            <DialogDescription>
              Parceiros ativos, com acesso, que ainda não fizeram pedido nem receberam o crédito.
              Desmarque cadastros de teste.
            </DialogDescription>
          </DialogHeader>

          {resultado ? (
            <div className="space-y-3 text-sm">
              <p>
                <strong>{resultado.concedidos}</strong>{" "}
                {resultado.concedidos === 1 ? "parceiro recebeu" : "parceiros receberam"} o crédito,
                total de <strong>{brl(resultado.total)}</strong>.
              </p>
              {resultado.negados.length > 0 && (
                <div>
                  <p className="font-medium">Ficaram de fora:</p>
                  <ul className="mt-1 space-y-1">
                    {resultado.negados.map((n) => (
                      <li key={n.parceiro_id} className="text-muted-foreground">
                        <span className="text-foreground">{n.nome ?? "Parceiro"}</span>: {n.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : candidatos.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando os parceiros...</p>
          ) : candidatos.error ? (
            <p className="text-sm text-destructive">{mensagemErro(candidatos.error)}</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum parceiro ativo sem compra e sem o crédito.
            </p>
          ) : (
            <div className="space-y-3">
              <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {lista.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={marcados.has(c.id)}
                        onCheckedChange={(v) => {
                          const s = new Set(marcados);
                          if (v === true) s.add(c.id);
                          else s.delete(c.id);
                          setMarcados(s);
                        }}
                      />
                      {c.nome}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                <strong>{marcados.size}</strong> {marcados.size === 1 ? "parceiro" : "parceiros"} ·{" "}
                <strong>{brl(marcados.size * valor)}</strong> no total
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              {resultado ? "Fechar" : "Cancelar"}
            </Button>
            {!resultado && (
              <Button onClick={confirmar} disabled={enviando || marcados.size === 0}>
                {enviando ? "Dando o crédito..." : "Confirmar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
