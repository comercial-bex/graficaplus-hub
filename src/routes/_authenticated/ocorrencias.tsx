/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
import { currency, db } from "@/lib/module-data";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SETORES, TIPOS_OCORRENCIA } from "@/domain/producao/setores";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ocorrencias")({
  head: () => ({ meta: [{ title: "Ocorrências — BEX PRINT OS" }] }),
  component: OcorrPage,
});

const vazio = {
  osId: "",
  tipo: "",
  setor: "",
  descricao: "",
  causa: "",
  custo: "",
  quantidade: "",
  minutos: "",
  retrabalho: false,
};

/**
 * Ocorrências e retrabalho.
 *
 * Três coisas estavam erradas na versão anterior, e as três produziam número
 * bonito e falso:
 *
 *  1. `os_id` era a PRIMEIRA OS que a consulta devolvesse — toda ocorrência
 *     ficava pendurada na mesma ordem, de um cliente que talvez nem soubesse
 *     do problema;
 *  2. `retrabalho: true` era fixo no código, então 100% das ocorrências
 *     contavam como retrabalho e o indicador nunca dizia nada;
 *  3. o card "Custo gerado" soma `custo`, e nada nunca gravava `custo` — a
 *     conta mostrava R$ 0,00 para sempre.
 *
 * Ocorrência é o registro que explica por que a margem da OS não fechou. Sem
 * custo, quantidade e tempo perdido, ela é só um bilhete.
 */
function OcorrPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [f, setF] = useState({ ...vazio });
  const campo = (k: keyof typeof vazio, v: any) => setF((s) => ({ ...s, [k]: v }));

  const { data: ocorrencias = [] } = useQuery({
    queryKey: ["ocorrencias"],
    queryFn: async () => {
      const { data, error } = await db
        .from("ocorrencias")
        .select("*, ordens_servico(numero, clientes(nome))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: ordens = [] } = useQuery({
    queryKey: ["os-para-ocorrencia"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, cliente_nome")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const totalCusto = ocorrencias.reduce((s: number, o: any) => s + Number(o.custo ?? 0), 0);
  const retrabalhos = ocorrencias.filter((o: any) => o.retrabalho).length;
  const minutosPerdidos = ocorrencias.reduce(
    (s: number, o: any) => s + Number(o.tempo_perdido_minutos ?? 0),
    0,
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!f.osId) throw new Error("Escolha a OS — ocorrência sem OS não explica nada.");
      if (!f.tipo) throw new Error("Escolha o tipo.");
      if (!f.descricao.trim()) throw new Error("Descreva o que aconteceu.");

      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await (db as any)
        .from("ocorrencias")
        .insert({
          os_id: f.osId,
          tipo: f.tipo,
          setor: f.setor || null,
          descricao: f.descricao.trim(),
          causa: f.causa.trim() || null,
          // Retrabalho é escolha de quem registra: nem toda ocorrência gera
          // refazer a peça, e marcar tudo como retrabalho apaga a diferença.
          retrabalho: f.retrabalho,
          custo: f.custo ? Number(f.custo) : 0,
          quantidade_afetada: f.quantidade ? Number(f.quantidade) : 0,
          tempo_perdido_minutos: f.minutos ? Number(f.minutos) : 0,
          registrado_por: auth.user?.id ?? null,
        })
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não pode registrar ocorrência.");
      }
    },
    onSuccess: () => {
      toast.success("Ocorrência registrada");
      setF({ ...vazio });
      qc.invalidateQueries({ queryKey: ["ocorrencias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("ocorrencias").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocorrencias"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ocorrências &amp; Retrabalho</h1>
        <p className="text-muted-foreground">
          O que deu errado, em qual OS, e quanto custou.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Abertas</div>
            <div className="text-2xl font-bold">
              {ocorrencias.filter((o: any) => !o.resolvida).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Retrabalhos</div>
            <div className="text-2xl font-bold">{retrabalhos}</div>
            <div className="text-xs text-muted-foreground">
              de {ocorrencias.length} ocorrências
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Tempo perdido</div>
            <div className="text-2xl font-bold">
              {minutosPerdidos >= 60
                ? `${(minutosPerdidos / 60).toFixed(1)} h`
                : `${minutosPerdidos} min`}
            </div>
          </CardContent>
        </Card>
        {canSeeFinancials && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Custo gerado</div>
              <div className="text-2xl font-bold text-rose-600">{currency(totalCusto)}</div>
              {totalCusto === 0 && ocorrencias.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  nenhuma ocorrência com custo informado
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registrar ocorrência</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Label htmlFor="os" className="text-xs">Ordem de serviço *</Label>
            <Select value={f.osId} onValueChange={(v) => campo("osId", v)}>
              <SelectTrigger id="os">
                <SelectValue placeholder="Escolha a OS" />
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
            <Label htmlFor="tipo" className="text-xs">Tipo *</Label>
            <Select value={f.tipo} onValueChange={(v) => campo("tipo", v)}>
              <SelectTrigger id="tipo">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_OCORRENCIA.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="setor" className="text-xs">Setor</Label>
            <Select value={f.setor} onValueChange={(v) => campo("setor", v)}>
              <SelectTrigger id="setor">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {SETORES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2 lg:col-span-2">
            <Label htmlFor="desc" className="text-xs">O que aconteceu *</Label>
            <Textarea
              id="desc"
              rows={2}
              value={f.descricao}
              onChange={(e) => campo("descricao", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <Label htmlFor="causa" className="text-xs">
              Causa <span className="text-muted-foreground">(o que originou)</span>
            </Label>
            <Textarea
              id="causa"
              rows={2}
              value={f.causa}
              onChange={(e) => campo("causa", e.target.value)}
              placeholder="Arquivo do cliente em RGB · lona fora de esquadro · cabeça entupida"
            />
          </div>

          <div>
            <Label htmlFor="qtd" className="text-xs">Peças afetadas</Label>
            <Input
              id="qtd"
              type="number"
              min="0"
              step="0.01"
              value={f.quantidade}
              onChange={(e) => campo("quantidade", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="min" className="text-xs">Tempo perdido (min)</Label>
            <Input
              id="min"
              type="number"
              min="0"
              value={f.minutos}
              onChange={(e) => campo("minutos", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="custo" className="text-xs">Custo (R$)</Label>
            <Input
              id="custo"
              type="number"
              min="0"
              step="0.01"
              value={f.custo}
              onChange={(e) => campo("custo", e.target.value)}
              placeholder="material perdido + hora"
            />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox
                checked={f.retrabalho}
                onCheckedChange={(c) => campo("retrabalho", c === true)}
              />
              Gerou retrabalho
            </label>
          </div>

          <div className="lg:col-span-4">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Registrando…" : "Registrar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista de ocorrências</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {ocorrencias.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhuma ocorrência registrada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OS</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead className="text-right">Peças</TableHead>
                    <TableHead className="text-right">Tempo</TableHead>
                    {canSeeFinancials && <TableHead className="text-right">Custo</TableHead>}
                    <TableHead>Retrabalho</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ocorrencias.map((o: any) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">
                        {o.ordens_servico?.numero ? `OS-${o.ordens_servico.numero}` : "—"}
                        {o.ordens_servico?.clientes?.nome && (
                          <div className="text-xs text-muted-foreground">
                            {o.ordens_servico.clientes.nome}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.tipo}
                        {o.causa && (
                          <div className="max-w-[16rem] text-xs text-muted-foreground">
                            {o.causa}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{o.setor || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number(o.quantidade_afetada) > 0 ? Number(o.quantidade_afetada) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number(o.tempo_perdido_minutos) > 0
                          ? `${o.tempo_perdido_minutos} min`
                          : "—"}
                      </TableCell>
                      {canSeeFinancials && (
                        <TableCell className="text-right font-mono text-sm">
                          {Number(o.custo) > 0 ? currency(o.custo) : "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        {o.retrabalho ? (
                          <Badge variant="destructive" className="font-normal">
                            Sim
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Não</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={!o.resolvida ? "destructive" : "outline"}>
                          {o.resolvida ? "resolvida" : "aberta"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {o.resolvida ? (
                          <span className="text-xs text-muted-foreground">encerrada</span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              update.mutate({
                                id: o.id,
                                changes: {
                                  resolvida: true,
                                  resolvida_em: new Date().toISOString(),
                                  status: "resolvida",
                                },
                              })
                            }
                          >
                            Resolver
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
