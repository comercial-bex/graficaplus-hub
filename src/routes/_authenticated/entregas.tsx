/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db, formatDateTime } from "@/lib/module-data";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/entregas")({
  head: () => ({ meta: [{ title: "Entregas — BEX PRINT OS" }] }),
  component: EntregasPage,
});

const TIPOS = [
  { valor: "entrega", rotulo: "Entrega" },
  { valor: "instalacao", rotulo: "Instalação" },
  { valor: "retirada", rotulo: "Retirada pelo cliente" },
];

const STATUS: Record<string, { rotulo: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  agendada: { rotulo: "Agendada", variant: "secondary" },
  em_rota: { rotulo: "Em rota", variant: "default" },
  concluido: { rotulo: "Concluída", variant: "outline" },
  cancelada: { rotulo: "Cancelada", variant: "destructive" },
};

// datetime-local quer 'YYYY-MM-DDTHH:mm' na hora LOCAL. toISOString() devolve
// UTC e jogaria o agendamento para outro horário.
function agoraLocal(horasAdiante = 24) {
  const d = new Date(Date.now() + horasAdiante * 3600_000);
  d.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Entregas e instalações.
 *
 * A versão anterior pendurava toda entrega na PRIMEIRA OS que a consulta
 * devolvesse (`select id ... limit 1`) e agendava sempre para `new Date()`.
 * Não era elo faltando: era elo errado, gravado em silêncio — entrega do
 * cliente A aparecendo na OS do cliente B parece dado bom e vai para o
 * relatório como se fosse.
 */
function EntregasPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeGerenciar = hasPermission("entregas.manage");

  const [osId, setOsId] = useState("");
  const [tipo, setTipo] = useState("entrega");
  const [endereco, setEndereco] = useState("");
  const [quando, setQuando] = useState(() => agoraLocal());
  const [responsavel, setResponsavel] = useState("");

  const { data: entregas = [] } = useQuery({
    queryKey: ["entregas-instalacoes"],
    queryFn: async () => {
      const { data, error } = await db
        .from("entregas_instalacoes")
        .select("*, ordens_servico(numero, titulo, clientes(nome))")
        .order("data_agendada", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Só OS que ainda não foram entregues: agendar entrega de OS concluída é
  // retrabalho de digitação.
  const { data: ordens = [] } = useQuery({
    queryKey: ["os-para-entrega"],
    enabled: podeGerenciar,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, cliente_nome, status, prazo_entrega")
        .not("status", "in", "(concluido,cancelado,faturado)")
        .order("prazo_entrega", { ascending: true, nullsFirst: false })
        .limit(200);
      return data ?? [];
    },
  });

  const { data: equipe = [] } = useQuery({
    queryKey: ["equipe-entrega"],
    enabled: podeGerenciar,
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
      if (!osId) throw new Error("Escolha a OS — entrega sem OS não tem dono.");
      const { data, error } = await (db as any)
        .from("entregas_instalacoes")
        .insert({
          os_id: osId,
          tipo,
          endereco: endereco.trim() || null,
          data_agendada: new Date(quando).toISOString(),
          responsavel_id: responsavel || null,
          status: "agendada",
        })
        .select("id");
      if (error) throw error;
      // Escrita barrada por RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não pode agendar entrega.");
      }
    },
    onSuccess: () => {
      toast.success("Entrega agendada");
      setEndereco("");
      setResponsavel("");
      qc.invalidateQueries({ queryKey: ["entregas-instalacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("entregas_instalacoes").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entregas-instalacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const nomePorId = new Map(equipe.map((p: any) => [p.id, p.nome]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Entregas &amp; Instalações</h1>
        <p className="text-muted-foreground">
          O que sai da gráfica: para qual OS, quando e com quem.
        </p>
      </div>

      {podeGerenciar && (
        <Card>
          <CardHeader>
            <CardTitle>Agendar entrega ou instalação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Label htmlFor="os" className="text-xs">Ordem de serviço *</Label>
              <Select value={osId} onValueChange={setOsId}>
                <SelectTrigger id="os">
                  <SelectValue placeholder="Escolha a OS" />
                </SelectTrigger>
                <SelectContent>
                  {ordens.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      Nenhuma OS em aberto.
                    </div>
                  ) : (
                    ordens.map((o: any) => (
                      <SelectItem key={o.id} value={o.id}>
                        OS-{o.numero} · {o.cliente_nome ?? "sem cliente"} · {o.titulo}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tipo" className="text-xs">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="quando" className="text-xs">Data e hora *</Label>
              <Input
                id="quando"
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="resp" className="text-xs">Quem leva</Label>
              <Select value={responsavel} onValueChange={setResponsavel}>
                <SelectTrigger id="resp">
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
            <div className="sm:col-span-2 lg:col-span-2">
              <Label htmlFor="end" className="text-xs">
                Endereço {tipo === "retirada" && "(retirada no balcão dispensa)"}
              </Label>
              <Input
                id="end"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                placeholder="Rua, número, bairro, ponto de referência"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => create.mutate()}
                disabled={!osId || !quando || create.isPending}
              >
                {create.isPending ? "Agendando…" : "Agendar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agenda</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {entregas.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhuma entrega agendada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OS</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead>Quando</TableHead>
                    <TableHead>Quem leva</TableHead>
                    <TableHead>Status</TableHead>
                    {podeGerenciar && <TableHead>Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entregas.map((e: any) => {
                    const fechada = ["concluido", "cancelada"].includes(e.status);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {e.ordens_servico?.numero ? `OS-${e.ordens_servico.numero}` : "—"}
                        </TableCell>
                        <TableCell>{e.ordens_servico?.clientes?.nome || "—"}</TableCell>
                        <TableCell>
                          {TIPOS.find((t) => t.valor === e.tipo)?.rotulo ?? e.tipo}
                        </TableCell>
                        <TableCell className="max-w-[18rem] text-sm">
                          {e.endereco || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateTime(e.data_agendada)}
                          {e.data_realizada && (
                            <div className="text-xs text-muted-foreground">
                              feita em {formatDateTime(e.data_realizada)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.responsavel_id ? (
                            nomePorId.get(e.responsavel_id) ?? "—"
                          ) : (
                            <span className="text-xs text-amber-600">sem responsável</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS[e.status]?.variant ?? "secondary"}>
                            {STATUS[e.status]?.rotulo ?? e.status}
                          </Badge>
                        </TableCell>
                        {podeGerenciar && (
                          <TableCell>
                            {fechada ? (
                              <span className="text-xs text-muted-foreground">encerrada</span>
                            ) : (
                              <Select
                                value={e.status}
                                onValueChange={(v) =>
                                  update.mutate({
                                    id: e.id,
                                    changes:
                                      v === "concluido"
                                        ? { status: v, data_realizada: new Date().toISOString() }
                                        : { status: v },
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[9.5rem]">
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
      </Card>
    </div>
  );
}
