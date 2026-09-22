import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dica } from "@/components/bex/Dica";
import { brl } from "@/domain/parceiros/preco";

/**
 * Comissões de venda — o que a gráfica deve a quem trouxe cada trabalho.
 *
 * Cada linha nasce sozinha quando a OS é paga (gatilho no banco), com a base
 * e o % daquela hora. Aqui o financeiro vê o que está a pagar, paga no
 * fechamento e marca como paga. Nada é criado à mão: comissão que não veio de
 * OS paga não existe.
 */

type Linha = {
  id: string; usuario_id: string; usuario_nome: string; os_numero: number | null; os_titulo: string | null;
  cliente: string | null; base: number; pct: number; valor: number; status: string;
  quando: string; pago_em: string | null;
};

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  a_pagar: { rotulo: "a pagar", classe: "border-[color:var(--bex-amber)]/50 text-[color:var(--bex-amber)]" },
  paga: { rotulo: "paga", classe: "border-[color:var(--bex-lime)]/50 text-[color:var(--bex-lime)]" },
  cancelada: { rotulo: "cancelada", classe: "text-muted-foreground" },
};

export function ComissoesPanel() {
  const { hasRole, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const podeVer = hasRole("admin") || hasRole("gestor") || hasPermission("financeiro.read");
  const podePagar = hasRole("admin") || hasPermission("pagamentos.confirm");

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["comissoes-painel"],
    enabled: podeVer,
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase.rpc as any)("comissoes_painel");
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const aPagar = useMemo(() => linhas.filter((l) => l.status === "a_pagar"), [linhas]);
  const totalAPagar = aPagar.reduce((s, l) => s + Number(l.valor), 0);
  const totalMarcado = aPagar.filter((l) => marcadas.has(l.id)).reduce((s, l) => s + Number(l.valor), 0);

  const pagar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await (supabase.rpc as any)("comissoes_pagar", { p_ids: ids });
      if (error) throw error;
      return data as { pagas: number; total: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.pagas} comissão(ões) marcada(s) como pagas — ${brl(Number(r.total))}.`);
      setMarcadas(new Set());
      qc.invalidateQueries({ queryKey: ["comissoes-painel"] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (!podeVer) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgePercent className="h-4 w-4 text-muted-foreground" />
              Comissões de venda
              {aPagar.length > 0 && (
                <Badge variant="outline" className="border-[color:var(--bex-amber)]/50 text-[color:var(--bex-amber)]">
                  {aPagar.length} a pagar · {brl(totalAPagar)}
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Geradas sozinhas quando a OS é paga, sobre o bruto da OS. O % é o de quem trouxe a venda.
            </p>
          </div>
          {podePagar && marcadas.size > 0 && (
            <Dica texto="Marca como pagas as comissões selecionadas. Faça isso depois de efetivamente pagar — não gera lançamento em contas a pagar.">
              <Button size="sm" disabled={pagar.isPending} onClick={() => pagar.mutate([...marcadas])}>
                <CheckCheck className="mr-1 h-4 w-4" />
                Marcar {marcadas.size} como paga{marcadas.size > 1 ? "s" : ""} · {brl(totalMarcado)}
              </Button>
            </Dica>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
        ) : linhas.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nenhuma comissão ainda. Ela aparece aqui quando uma OS trazida por alguém com comissão configurada for paga.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {podePagar && <TableHead className="w-8" />}
                  <TableHead>Quem trouxe</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => {
                  const st = STATUS[l.status] ?? STATUS.cancelada;
                  return (
                    <TableRow key={l.id}>
                      {podePagar && (
                        <TableCell>
                          {l.status === "a_pagar" && (
                            <input
                              type="checkbox"
                              aria-label="Selecionar comissão"
                              checked={marcadas.has(l.id)}
                              onChange={(e) => {
                                const n = new Set(marcadas);
                                e.target.checked ? n.add(l.id) : n.delete(l.id);
                                setMarcadas(n);
                              }}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{l.usuario_nome}</TableCell>
                      <TableCell>
                        <div className="text-sm">#{l.os_numero ?? "—"} {l.os_titulo ?? ""}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.cliente ?? "—"} · {new Date(l.quando).toLocaleDateString("pt-BR")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{brl(Number(l.base))}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Number(l.pct)}%</TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">{brl(Number(l.valor))}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={st.classe}>{st.rotulo}</Badge>
                        {l.pago_em && (
                          <div className="text-xs text-muted-foreground">{new Date(l.pago_em).toLocaleDateString("pt-BR")}</div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
