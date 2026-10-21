/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando } from "@/components/bex/Carregando";
import { Dica } from "@/components/bex/Dica";
import { brl } from "@/domain/parceiros/preco";
import { dicaCampo } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { BarraDeMeta } from "@/components/metas/barra-de-meta";
import { nomeDoMes, NOME_DO_NIVEL, type MetaDoMes } from "@/domain/metas/progresso";

/**
 * Metas de vendas — o placar da equipe e onde a gestão define a meta de cada um.
 *
 * Só a gestão (admin/gestor) e o financeiro enxergam o placar de todos; cada
 * vendedor vê só a própria barra no painel dele. Fechar o mês grava o nível e
 * lança as comissões das OS pagas em "Comissões de venda" logo abaixo, de onde
 * o financeiro paga. O mês só fecha depois de terminar.
 */

type Pessoa = { id: string; nome: string };
type Linha = MetaDoMes & { usuario_nome: string };

/** Primeiro dia do mês, no calendário de São Paulo, deslocado `delta` meses. */
function mesDe(delta: number): string {
  const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [a, m] = hoje.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const ESTILO_NIVEL: Record<string, string> = {
  nenhum: "text-muted-foreground",
  ouro: "border-[color:var(--bex-amber)]/60 text-[color:var(--status-amber)]",
  diamante: "border-[color:var(--bex-cyan)]/60 text-[color:var(--status-cyan)]",
};

export function MetasPanel() {
  const { hasRole, hasPermission } = useAuth();
  const qc = useQueryClient();
  const podeVer = hasRole("admin") || hasRole("gestor") || hasPermission("financeiro.read");
  const podeDefinir = hasRole("admin") || hasRole("gestor");
  const podeFechar = podeDefinir || hasPermission("pagamentos.confirm");

  const mesAtual = mesDe(0);
  const [mes, setMes] = useState(mesAtual);
  const meses = [mesDe(-2), mesDe(-1), mesDe(0), mesDe(1)];
  const [edicao, setEdicao] = useState<null | { pessoa: string; nome: string; linha?: Linha }>(null);

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["meta-painel", mes],
    enabled: podeVer,
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase.rpc as any)("meta_painel", { p_mes: mes });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const { data: equipe = [] } = useQuery({
    queryKey: ["equipe-para-venda"],
    enabled: podeDefinir,
    queryFn: async (): Promise<Pessoa[]> => {
      const { data, error } = await (supabase.rpc as any)("equipe_para_venda");
      if (error) throw error;
      return (data ?? []) as Pessoa[];
    },
  });

  const semMeta = useMemo(() => equipe.filter((p) => !linhas.some((l) => l.usuario_id === p.id)), [equipe, linhas]);
  const fechado = linhas.length > 0 && linhas.every((l) => l.fechada);
  const terminou = mes < mesAtual;

  const fechar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("meta_fechar_mes", { p_mes: mes });
      if (error) throw error;
      return data as { pessoas: Array<{ comissoes_lancadas: number; valor_lancado: number }> };
    },
    onSuccess: (r) => {
      const n = r.pessoas.reduce((s, p) => s + Number(p.comissoes_lancadas), 0);
      const total = r.pessoas.reduce((s, p) => s + Number(p.valor_lancado), 0);
      toast.success(n > 0 ? `Mês fechado: ${n} comissão(ões) lançada(s), ${brl(total)}.` : "Mês fechado: nenhuma comissão nova a lançar.");
      qc.invalidateQueries({ queryKey: ["meta-painel"] });
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
              <Target className="h-4 w-4 text-muted-foreground" />
              Metas de vendas
              {fechado && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> fechado</Badge>}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Ouro ao bater a meta, Diamante em {linhas[0]?.diamante_em_pct ?? 150}% dela. O nível vale para todas as OS pagas do mês.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Mês das metas"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {meses.map((m) => <option key={m} value={m}>{nomeDoMes(m)}</option>)}
            </select>
            {podeFechar && terminou && linhas.length > 0 && (
              <Dica texto="Grava o nível de cada um e lança as comissões das OS pagas do mês. Pode ser repetido: só acrescenta OS pagas depois, no mesmo percentual.">
                <Button size="sm" disabled={fechar.isPending} onClick={() => fechar.mutate()}>
                  <Lock className="mr-1 h-4 w-4" />
                  {fechado ? "Lançar o que faltou" : "Fechar o mês"}
                </Button>
              </Dica>
            )}
            {podeDefinir && semMeta.length > 0 && !terminou && (
              <Button size="sm" variant="outline" onClick={() => setEdicao({ pessoa: semMeta[0].id, nome: semMeta[0].nome })}>
                <Plus className="mr-1 h-4 w-4" /> Nova meta
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <Carregando />
        ) : linhas.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhuma meta definida para {nomeDoMes(mes)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="min-w-48">Progresso</TableHead>
                  <TableHead className="text-right">Meta</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  {podeDefinir && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => {
                  const nivel = l.fechada ? (l.nivel_fechado ?? "nenhum") : l.nivel;
                  const pctNivel = l.fechada ? Number(l.pct_fechado ?? 0) : Number(l.pct_atual);
                  return (
                    <TableRow key={l.meta_id}>
                      <TableCell className="font-medium">{l.usuario_nome}</TableCell>
                      <TableCell><BarraDeMeta meta={l} compacta className="pb-5" /></TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{brl(Number(l.meta))}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{brl(Number(l.vendido))}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{brl(Number(l.pago))}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(ESTILO_NIVEL[nivel])}>{NOME_DO_NIVEL[nivel]}</Badge>
                        {pctNivel > 0 && <div className="text-xs text-muted-foreground">{pctNivel.toLocaleString("pt-BR")}% da OS</div>}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        {brl(Number(l.pago) * pctNivel / 100)}
                      </TableCell>
                      {podeDefinir && (
                        <TableCell>
                          {!l.fechada && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Editar a meta de ${l.usuario_nome}`}
                              onClick={() => setEdicao({ pessoa: l.usuario_id, nome: l.usuario_nome, linha: l })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {edicao && (
        <EditarMeta
          mes={mes}
          edicao={edicao}
          pessoas={edicao.linha ? [{ id: edicao.pessoa, nome: edicao.nome }] : semMeta}
          onClose={() => setEdicao(null)}
          onSaved={() => {
            setEdicao(null);
            qc.invalidateQueries({ queryKey: ["meta-painel"] });
            qc.invalidateQueries({ queryKey: ["minha-meta"] });
          }}
        />
      )}
    </Card>
  );
}

function EditarMeta({
  mes, edicao, pessoas, onClose, onSaved,
}: {
  mes: string;
  edicao: { pessoa: string; nome: string; linha?: Linha };
  pessoas: Pessoa[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const l = edicao.linha;
  const [pessoa, setPessoa] = useState(edicao.pessoa);
  const [meta, setMeta] = useState(String(l?.meta ?? ""));
  const [ouro, setOuro] = useState(String(l?.pct_ouro ?? 1));
  const [diamante, setDiamante] = useState(String(l?.pct_diamante ?? 2.5));
  const [diamanteEm, setDiamanteEm] = useState(String(l?.diamante_em_pct ?? 150));

  const salvar = useMutation({
    mutationFn: async () => {
      const num = (v: string) => Number(v.replace(",", "."));
      const { error } = await (supabase.rpc as any)("meta_definir", {
        p_usuario_id: pessoa,
        p_mes: mes,
        p_meta: num(meta),
        p_pct_ouro: num(ouro),
        p_pct_diamante: num(diamante),
        p_diamante_em_pct: num(diamanteEm),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meta salva.");
      onSaved();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const valido = Number(meta.replace(",", ".")) > 0 && pessoa;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{l ? `Meta de ${edicao.nome}` : "Nova meta"} — {nomeDoMes(mes)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!l && (
            <div className="space-y-1">
              <Label htmlFor="meta-pessoa">Pessoa</Label>
              <select
                id="meta-pessoa"
                value={pessoa}
                onChange={(e) => setPessoa(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="meta-valor">Meta do mês (R$)</Label>
            <Input id="meta-valor" inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="20000" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Dica texto={dicaCampo("/financeiro", "meta_pct_ouro")}><Label htmlFor="meta-ouro">Ouro (% da OS)</Label></Dica>
              <Input id="meta-ouro" inputMode="decimal" value={ouro} onChange={(e) => setOuro(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Dica texto={dicaCampo("/financeiro", "meta_pct_diamante")}><Label htmlFor="meta-diamante">Diamante (% da OS)</Label></Dica>
              <Input id="meta-diamante" inputMode="decimal" value={diamante} onChange={(e) => setDiamante(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Dica texto={dicaCampo("/financeiro", "meta_diamante_em")}><Label htmlFor="meta-diamante-em">Diamante a (% da meta)</Label></Dica>
              <Input id="meta-diamante-em" inputMode="decimal" value={diamanteEm} onChange={(e) => setDiamanteEm(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
