/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db, formatDateTime } from "@/lib/module-data";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maquinas-agenda")({
  head: () => ({ meta: [{ title: "Agenda de máquinas — BEX PRINT OS" }] }),
  component: AgendaPage,
});

const STATUS: Record<string, { rotulo: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  agendado: { rotulo: "Agendado", variant: "secondary" },
  em_producao: { rotulo: "Em produção", variant: "default" },
  concluido: { rotulo: "Concluído", variant: "outline" },
  cancelado: { rotulo: "Cancelado", variant: "destructive" },
};

// datetime-local usa hora LOCAL; toISOString() devolve UTC e deslocaria a
// reserva em três horas no Amapá.
function paraCampo(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const proximaHora = (horas = 1) => {
  const d = new Date(Date.now() + horas * 3600_000);
  d.setMinutes(0, 0, 0);
  return paraCampo(d);
};

/**
 * Agenda de máquinas: quem ocupa qual equipamento, quando.
 *
 * A versão anterior reservava sempre `maquinas[0]` — a primeira máquina da
 * lista, qualquer que fosse — das `new Date()` até duas horas depois. Com duas
 * máquinas de tecnologias diferentes (uma Wizer de grande formato e uma Bambu
 * de 3D), toda reserva caía na mesma, e o horário nunca era o combinado.
 *
 * O par previsto × realizado agora se preenche sozinho: o apontamento de
 * produção alimenta `inicio_real`, `fim_real` e `minutos_reais` da reserva, por
 * gatilho. Sem isso a agenda só guardava intenção, e atraso de máquina — a
 * única coisa que ela existe para mostrar — era invisível.
 */
function AgendaPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeAgendar = hasPermission("agenda.schedule") || hasPermission("maquinas.manage");
  const podeOperar = podeAgendar || hasPermission("agenda.operate");

  const [maquinaId, setMaquinaId] = useState("");
  const [osId, setOsId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [operador, setOperador] = useState("");
  const [inicio, setInicio] = useState(() => proximaHora(1));
  const [fim, setFim] = useState(() => proximaHora(3));

  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data, error } = await db.from("maquinas").select("*").eq("ativa", true).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: agenda = [] } = useQuery({
    queryKey: ["maquinas-agenda"],
    queryFn: async () => {
      const { data, error } = await db
        .from("maquinas_agenda")
        .select("*, maquinas(nome), ordens_servico(numero, titulo)")
        .order("inicio");
      if (error) throw error;
      return data;
    },
  });

  const { data: ordens = [] } = useQuery({
    queryKey: ["os-para-agenda"],
    enabled: podeAgendar,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, cliente_nome, status")
        .not("status", "in", "(concluido,cancelado,faturado)")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const { data: equipe = [] } = useQuery({
    queryKey: ["equipe-agenda"],
    enabled: podeAgendar,
    queryFn: async () => {
      const { data } = await supabase
        .from("usuarios")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!maquinaId) throw new Error("Escolha a máquina.");
      const dInicio = new Date(inicio);
      const dFim = new Date(fim);
      if (dFim <= dInicio) throw new Error("O fim tem que ser depois do início.");

      const minutos = Math.round((dFim.getTime() - dInicio.getTime()) / 60000);
      const escolhida = ordens.find((o: any) => o.id === osId);
      const { data, error } = await (db as any)
        .from("maquinas_agenda")
        .insert({
          maquina_id: maquinaId,
          os_id: osId || null,
          titulo:
            titulo.trim() ||
            (escolhida ? `OS-${escolhida.numero} · ${escolhida.titulo}` : "Bloqueio de máquina"),
          operador_id: operador || null,
          inicio: dInicio.toISOString(),
          fim: dFim.toISOString(),
          // `inicio` e `fim` são o que aparece no quadro; os `_previsto` são a
          // referência que fica congelada para comparar com o realizado.
          inicio_previsto: dInicio.toISOString(),
          fim_previsto: dFim.toISOString(),
          minutos_previstos: minutos,
          status: "agendado",
          origem: "manual",
        })
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não pode reservar máquina.");
      }
    },
    onSuccess: () => {
      toast.success("Máquina reservada");
      setTitulo("");
      setOsId("");
      setOperador("");
      qc.invalidateQueries({ queryKey: ["maquinas-agenda"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("maquinas_agenda").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maquinas-agenda"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const nomePorId = new Map(equipe.map((p: any) => [p.id, p.nome]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda de máquinas</h1>
        <p className="text-muted-foreground">
          Quem ocupa qual equipamento, quando — e quanto tempo levou de verdade.
        </p>
      </div>

      {podeAgendar && (
        <Card>
          <CardHeader>
            <CardTitle>Reservar máquina</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="maq" className="text-xs">Máquina *</Label>
              <Select value={maquinaId} onValueChange={setMaquinaId}>
                <SelectTrigger id="maq">
                  <SelectValue placeholder="Escolha a máquina" />
                </SelectTrigger>
                <SelectContent>
                  {maquinas.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="lg:col-span-2">
              <Label htmlFor="os" className="text-xs">
                Ordem de serviço <span className="text-muted-foreground">(vazio = manutenção ou bloqueio)</span>
              </Label>
              <Select value={osId} onValueChange={setOsId}>
                <SelectTrigger id="os">
                  <SelectValue placeholder="Sem OS" />
                </SelectTrigger>
                <SelectContent>
                  {ordens.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>
                      OS-{o.numero} · {o.cliente_nome ?? "sem cliente"} · {o.titulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ini" className="text-xs">Início *</Label>
              <Input id="ini" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fim" className="text-xs">Fim *</Label>
              <Input id="fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="op" className="text-xs">Operador</Label>
              <Select value={operador} onValueChange={setOperador}>
                <SelectTrigger id="op">
                  <SelectValue placeholder="A definir" />
                </SelectTrigger>
                <SelectContent>
                  {equipe.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="tit" className="text-xs">
                Título <span className="text-muted-foreground">(em branco usa a OS)</span>
              </Label>
              <Input
                id="tit"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Manutenção preventiva, limpeza de cabeça…"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => create.mutate()}
                disabled={!maquinaId || create.isPending}
              >
                {create.isPending ? "Reservando…" : "Reservar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agenda atual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {maquinas.map((m: any) => {
            const daMaquina = agenda.filter((a: any) => a.maquina_id === m.id);
            return (
              <div key={m.id} className="rounded-lg border p-3">
                <div className="mb-2 font-medium">{m.nome}</div>
                {daMaquina.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Sem reservas</div>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {daMaquina.map((a: any) => {
                      const atrasou =
                        a.minutos_reais != null &&
                        a.minutos_previstos != null &&
                        a.minutos_reais > a.minutos_previstos;
                      return (
                        <div key={a.id} className="rounded border bg-muted/50 p-2 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{a.titulo}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatDateTime(a.inicio)} → {formatDateTime(a.fim)}
                              </div>
                              {a.ordens_servico?.numero && (
                                <div className="text-xs text-muted-foreground">
                                  OS-{a.ordens_servico.numero}
                                </div>
                              )}
                              {a.operador_id && (
                                <div className="text-xs text-muted-foreground">
                                  {nomePorId.get(a.operador_id) ?? "operador definido"}
                                </div>
                              )}
                            </div>
                            <Badge variant={STATUS[a.status]?.variant ?? "secondary"}>
                              {STATUS[a.status]?.rotulo ?? a.status}
                            </Badge>
                          </div>

                          {/* Previsto × realizado: preenchido pelo apontamento. */}
                          {a.minutos_previstos != null && (
                            <div className="mt-2 font-mono text-xs">
                              previsto {a.minutos_previstos} min
                              {a.minutos_reais != null && a.minutos_reais > 0 && (
                                <span className={atrasou ? "text-destructive font-medium" : "text-emerald-600"}>
                                  {" "}· real {a.minutos_reais} min
                                  {atrasou ? ` (+${a.minutos_reais - a.minutos_previstos})` : ""}
                                </span>
                              )}
                            </div>
                          )}

                          {podeOperar && !["concluido", "cancelado"].includes(a.status) && (
                            <div className="mt-2">
                              <Select
                                value={a.status}
                                onValueChange={(v) => update.mutate({ id: a.id, changes: { status: v } })}
                              >
                                <SelectTrigger className="h-8 w-[10rem]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(STATUS).map(([valor, s]) => (
                                    <SelectItem key={valor} value={valor}>
                                      {s.rotulo}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
