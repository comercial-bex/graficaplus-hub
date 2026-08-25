import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ListChecks, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Tarefa = {
  id: string;
  titulo: string;
  setor: string | null;
  status: string;
  prioridade: string;
  obrigatoria: boolean;
  prazo: string | null;
  responsavel_id: string | null;
  minutos_previstos: number | null;
  minutos_realizados: number | null;
  responsavel?: { nome: string | null } | null;
};

/** Os setores por onde uma OS passa na gráfica. */
const SETORES = ["Arte", "Impressão", "Acabamento", "Instalação", "Entrega", "Financeiro"];

const PRIORIDADES = [
  { valor: "baixa", rotulo: "Baixa" },
  { valor: "normal", rotulo: "Normal" },
  { valor: "alta", rotulo: "Alta" },
];

const tomDoStatus: Record<string, "secondary" | "outline" | "destructive"> = {
  concluida: "secondary",
  cancelada: "outline",
  pendente: "destructive",
};

/**
 * Tarefas da OS — o elo que estava morto.
 *
 * `fechar_os` já recusava fechar com tarefa obrigatória pendente, e nada no
 * sistema criava tarefa: a trava nunca disparava. Esta é a porta que faltava.
 *
 * `obrigatoria` nasce true no banco, então toda tarefa criada aqui passa a
 * segurar o fechamento — por isso a caixa aparece marcada e visível no formulário,
 * em vez de escondida num padrão que ninguém vê.
 */
export function TarefasDaOS({ osId }: { osId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeCriar = hasPermission("tarefas.create");
  const podeConcluir = hasPermission("tarefas.complete");
  const podeReabrir = hasPermission("tarefas.reopen");

  const [titulo, setTitulo] = useState("");
  const [setor, setSetor] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [prioridade, setPrioridade] = useState("normal");
  const [obrigatoria, setObrigatoria] = useState(true);
  const [minutos, setMinutos] = useState("");

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["os-tarefas", osId],
    queryFn: async (): Promise<Tarefa[]> => {
      const { data, error } = await (supabase as any)
        .from("os_tarefas")
        .select(
          "id, titulo, setor, status, prioridade, obrigatoria, prazo, responsavel_id, minutos_previstos, minutos_realizados",
        )
        .eq("os_id", osId)
        .order("created_at");
      if (error) throw error;

      const linhas = (data ?? []) as Tarefa[];
      const ids = [...new Set(linhas.map((t) => t.responsavel_id).filter(Boolean))] as string[];
      if (ids.length === 0) return linhas;
      // `usuarios` só é legível por admin/gestor: sem nome, mostra o id curto em
      // vez de sumir com a informação de que alguém é responsável.
      const { data: pessoas } = await supabase.from("usuarios").select("id, nome").in("id", ids);
      const porId = new Map((pessoas ?? []).map((u: any) => [u.id, u.nome]));
      return linhas.map((t) => ({
        ...t,
        responsavel: t.responsavel_id ? { nome: porId.get(t.responsavel_id) ?? null } : null,
      }));
    },
  });

  const { data: equipe = [] } = useQuery({
    queryKey: ["equipe-para-tarefa"],
    enabled: podeCriar,
    queryFn: async () => {
      const { data } = await supabase
        .from("usuarios")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      return data ?? [];
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error("Descreva a tarefa");
      const { data, error } = await (supabase as any)
        .from("os_tarefas")
        .insert({
          os_id: osId,
          titulo: titulo.trim(),
          setor: setor || null,
          responsavel_id: responsavel || null,
          prioridade,
          obrigatoria,
          minutos_previstos: minutos ? Number(minutos) : null,
        })
        .select("id");
      if (error) throw error;
      // Escrita barrada por RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para criar tarefa nesta OS.");
      }
    },
    onSuccess: () => {
      setTitulo("");
      setSetor("");
      setResponsavel("");
      setMinutos("");
      setObrigatoria(true);
      toast.success("Tarefa criada");
      qc.invalidateQueries({ queryKey: ["os-tarefas", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao criar"),
  });

  const alternar = useMutation({
    mutationFn: async (t: Tarefa) => {
      const concluir = t.status !== "concluida";
      const { error } = await (supabase.rpc as any)("concluir_tarefa_os", {
        p_tarefa_id: t.id,
        p_concluir: concluir,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["os-tarefas", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar"),
  });

  const cancelar = useMutation({
    mutationFn: async (t: Tarefa) => {
      if (!window.confirm(`Cancelar a tarefa "${t.titulo}"?`)) return;
      const { data, error } = await (supabase as any)
        .from("os_tarefas")
        .update({ status: "cancelada" })
        .eq("id", t.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não tem permissão para cancelar tarefa.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["os-tarefas", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao cancelar"),
  });

  const bloqueando = tarefas.filter(
    (t) => t.obrigatoria && t.status !== "concluida" && t.status !== "cancelada",
  ).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Tarefas da OS
          </CardTitle>
          {/* O impedimento aparece aqui, não só no clique de fechar: descobrir o
              bloqueio no último passo é o que faz a equipe fechar OS por fora. */}
          {bloqueando > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" />
              {bloqueando} {bloqueando === 1 ? "tarefa segura" : "tarefas seguram"} o fechamento
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {podeCriar && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_150px_180px]">
              <div>
                <Label htmlFor="tarefa-titulo" className="text-xs">
                  O que precisa ser feito
                </Label>
                <Input
                  id="tarefa-titulo"
                  placeholder="Ex.: conferir cor do vermelho antes de imprimir"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && criar.mutate()}
                />
              </div>
              <div>
                <Label className="text-xs">Setor</Label>
                <Select value={setor} onValueChange={setSetor}>
                  <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
                  <SelectContent>
                    {SETORES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Responsável</Label>
                <Select value={responsavel} onValueChange={setResponsavel}>
                  <SelectTrigger><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                  <SelectContent>
                    {equipe.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">Prioridade</Label>
                <Select value={prioridade} onValueChange={setPrioridade}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORIDADES.map((p) => (
                      <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tarefa-min" className="text-xs">Minutos previstos</Label>
                <Input
                  id="tarefa-min"
                  type="number"
                  min="0"
                  className="w-32"
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox
                  checked={obrigatoria}
                  onCheckedChange={(v) => setObrigatoria(v === true)}
                />
                Segura o fechamento da OS
              </label>
              <Button
                className="ml-auto"
                disabled={criar.isPending || !titulo.trim()}
                onClick={() => criar.mutate()}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : tarefas.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhuma tarefa nesta OS.{" "}
            {podeCriar
              ? "Tarefa marcada como obrigatória impede fechar a OS antes de ser concluída."
              : "Seu perfil não cria tarefas — peça ao gestor."}
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {tarefas.map((t) => {
              const concluida = t.status === "concluida";
              const cancelada = t.status === "cancelada";
              return (
                <div
                  key={t.id}
                  className={`flex items-start gap-3 p-3 ${cancelada ? "opacity-50" : ""}`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={concluida}
                    disabled={cancelada || (concluida ? !podeReabrir : !podeConcluir)}
                    aria-label={concluida ? `Reabrir ${t.titulo}` : `Concluir ${t.titulo}`}
                    onCheckedChange={() => alternar.mutate(t)}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div
                      className={`text-sm font-medium ${concluida || cancelada ? "line-through text-muted-foreground" : ""}`}
                    >
                      {t.titulo}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {t.setor && <Badge variant="outline" className="font-normal">{t.setor}</Badge>}
                      {t.prioridade === "alta" && (
                        <Badge variant="destructive" className="font-normal">alta</Badge>
                      )}
                      {t.obrigatoria && !concluida && !cancelada && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> segura o fechamento
                        </span>
                      )}
                      {t.responsavel?.nome && <span>· {t.responsavel.nome}</span>}
                      {t.minutos_previstos != null && <span>· {t.minutos_previstos} min previstos</span>}
                      {t.minutos_realizados != null && (
                        <span>· {t.minutos_realizados} min reais</span>
                      )}
                      {cancelada && <span>· cancelada</span>}
                    </div>
                  </div>
                  <Badge variant={tomDoStatus[t.status] ?? "outline"} className="font-normal">
                    {t.status}
                  </Badge>
                  {concluida && podeReabrir && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Reabrir"
                      aria-label={`Reabrir ${t.titulo}`}
                      onClick={() => alternar.mutate(t)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  {!concluida && !cancelada && podeCriar && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Cancelar tarefa"
                      aria-label={`Cancelar ${t.titulo}`}
                      onClick={() => cancelar.mutate(t)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
