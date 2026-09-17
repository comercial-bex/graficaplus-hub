/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Info, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/bex/StatusChip";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { formatarData } from "@/domain/os/prazo";
import { quantidadeDaMetrica, textoDaRecompensa } from "@/domain/parceiros/painel";
import { hojeIso, ROTULO_DA_METRICA, useNiveis, type CampanhaDaGestao } from "./dados";

const NOVA: Omit<CampanhaDaGestao, "id"> = {
  titulo: "",
  descricao: "",
  metrica: "valor_compras",
  meta: 0,
  inicio: hojeIso(),
  fim: hojeIso(30),
  recompensa_tipo: "credito",
  recompensa_valor: null,
  recompensa_descricao: "",
  nivel_minimo_id: null,
  ativa: true,
};

/**
 * Metas com prêmio certo.
 *
 * O formulário não tem "quantidade de prêmios" nem "os N primeiros" — e o aviso
 * diz por quê. Meta em que todo mundo que bate ganha é bonificação; limitar os
 * ganhadores ou sortear vira promoção comercial, que precisa de autorização prévia
 * da SPA/MF.
 */
export function MetasTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data: niveis = [] } = useNiveis();
  const [editando, setEditando] = useState<(Omit<CampanhaDaGestao, "id"> & { id?: string }) | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: campanhas = [], isLoading } = useQuery({
    queryKey: ["parceiros-campanhas"],
    queryFn: async (): Promise<CampanhaDaGestao[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_campanhas")
        .select("id, titulo, descricao, metrica, meta, inicio, fim, recompensa_tipo, recompensa_valor, recompensa_descricao, nivel_minimo_id, ativa")
        .order("fim", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function salvar() {
    if (!editando) return;
    const e = editando;
    if (!e.titulo.trim() || !(Number(e.meta) > 0) || !e.recompensa_descricao.trim()) {
      return toast.error("Preencha título, meta e o que o parceiro ganha.");
    }
    if (e.recompensa_tipo === "credito" && !(Number(e.recompensa_valor) > 0)) {
      return toast.error("Informe o valor do crédito.");
    }
    if (e.fim < e.inicio) return toast.error("O fim precisa ser depois do início.");
    setSalvando(true);
    const linha = {
      titulo: e.titulo.trim(),
      descricao: e.descricao?.trim() || null,
      metrica: e.metrica,
      meta: Number(e.meta),
      inicio: e.inicio,
      fim: e.fim,
      recompensa_tipo: e.recompensa_tipo,
      recompensa_valor: e.recompensa_tipo === "credito" ? Number(e.recompensa_valor) : null,
      recompensa_descricao: e.recompensa_descricao.trim(),
      nivel_minimo_id: e.nivel_minimo_id,
      ativa: e.ativa,
    };
    const consulta = e.id
      ? (supabase as any).from("parceiro_campanhas").update(linha).eq("id", e.id).select("id")
      : (supabase as any).from("parceiro_campanhas").insert(linha).select("id");
    const { data, error } = await consulta;
    setSalvando(false);
    if (error || !data?.length) return toast.error(mensagemErro(error, "Seu perfil não pode alterar metas."));
    toast.success(e.id ? "Meta atualizada" : "Meta criada — já aparece para os parceiros do nível");
    setEditando(null);
    qc.invalidateQueries({ queryKey: ["parceiros-campanhas"] });
  }

  const nomeDoNivel = (id: string | null) => niveis.find((n) => n.id === id)?.nome;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-2xl gap-2 rounded-lg border border-border bg-foreground/5 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Todo parceiro que bater a meta ganha — sem limite de ganhadores. Sorteio ou “os primeiros a bater” é
            promoção comercial e exige autorização prévia da Secretaria de Prêmios e Apostas (Ministério da Fazenda).
          </p>
        </div>
        {podeEditar && (
          <Button onClick={() => setEditando({ ...NOVA })}>
            <Plus className="mr-1 h-4 w-4" /> Nova meta
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : campanhas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma meta ainda. Uma boa primeira: “compre R$ 3.000 em 60 dias e ganhe R$ 150 em crédito”.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {campanhas.map((c) => {
            const vigente = c.ativa && c.inicio <= hojeIso() && c.fim >= hojeIso();
            return (
              <article key={c.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <Gift className="h-4 w-4 shrink-0 text-[color:var(--bex-magenta)]" />
                      <span className="truncate">{c.titulo}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {quantidadeDaMetrica(c.metrica, Number(c.meta))} de {formatarData(c.inicio)} a {formatarData(c.fim)}
                      {c.nivel_minimo_id ? ` · a partir de ${nomeDoNivel(c.nivel_minimo_id) ?? "nível"}` : ""}
                    </p>
                  </div>
                  <StatusChip
                    label={!c.ativa ? "Desligada" : vigente ? "Valendo" : c.inicio > hojeIso() ? "Agendada" : "Encerrada"}
                    tone={vigente ? "lime" : "muted"}
                  />
                </div>
                <p className="text-sm">
                  Prêmio: <span className="font-medium">{textoDaRecompensa(c)}</span>
                </p>
                {podeEditar && (
                  <Button size="sm" variant="outline" onClick={() => setEditando({ ...c, descricao: c.descricao ?? "" })}>
                    Editar
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {editando && (
            <>
              <DialogHeader>
                <DialogTitle>{editando.id ? "Editar meta" : "Nova meta"}</DialogTitle>
                <DialogDescription>Conta o que o parceiro comprou entre o início e o fim.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Campo rotulo="Título (o parceiro vê)">
                  <Input value={editando.titulo} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} placeholder="Ex.: Setembro forte" />
                </Campo>
                <Campo rotulo="Descrição (opcional)">
                  <Textarea rows={2} value={editando.descricao ?? ""} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="O que conta">
                    <Select value={editando.metrica} onValueChange={(v) => setEditando({ ...editando, metrica: v as CampanhaDaGestao["metrica"] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROTULO_DA_METRICA).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo rotulo="Meta">
                    <Input type="number" min={0} step="0.01" value={editando.meta || ""} onChange={(e) => setEditando({ ...editando, meta: Number(e.target.value) })} />
                  </Campo>
                  <Campo rotulo="Início">
                    <Input type="date" value={editando.inicio} onChange={(e) => setEditando({ ...editando, inicio: e.target.value })} />
                  </Campo>
                  <Campo rotulo="Fim">
                    <Input type="date" value={editando.fim} onChange={(e) => setEditando({ ...editando, fim: e.target.value })} />
                  </Campo>
                  <Campo rotulo="Prêmio">
                    <Select value={editando.recompensa_tipo} onValueChange={(v) => setEditando({ ...editando, recompensa_tipo: v as CampanhaDaGestao["recompensa_tipo"] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="credito">Crédito (entra na hora)</SelectItem>
                        <SelectItem value="produto">Produto (ex.: metros de lona)</SelectItem>
                        <SelectItem value="brinde">Brinde físico</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                  {editando.recompensa_tipo === "credito" ? (
                    <Campo rotulo="Valor do crédito (R$)">
                      <Input type="number" min={0} step="0.01" value={editando.recompensa_valor ?? ""} onChange={(e) => setEditando({ ...editando, recompensa_valor: Number(e.target.value) })} />
                    </Campo>
                  ) : (
                    <div />
                  )}
                </div>
                <Campo rotulo="Como o prêmio aparece para o parceiro">
                  <Input
                    value={editando.recompensa_descricao}
                    onChange={(e) => setEditando({ ...editando, recompensa_descricao: e.target.value })}
                    placeholder={editando.recompensa_tipo === "credito" ? "Ex.: R$ 150 em crédito" : "Ex.: 4 m² de lona 440g"}
                  />
                </Campo>
                <Campo rotulo="Para quem">
                  <Select value={editando.nivel_minimo_id ?? "todos"} onValueChange={(v) => setEditando({ ...editando, nivel_minimo_id: v === "todos" ? null : v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os parceiros</SelectItem>
                      {niveis.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          Do nível {n.nome} para cima
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                  Meta ligada
                  <Switch checked={editando.ativa} onCheckedChange={(v) => setEditando({ ...editando, ativa: v })} />
                </label>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {salvando ? "Salvando…" : "Salvar meta"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs text-muted-foreground">
        {rotulo}
        <DicaIcone texto={dicaCampo("/parceiros", rotulo)} rotulo={rotulo} />
      </Label>
      {children}
    </div>
  );
}
