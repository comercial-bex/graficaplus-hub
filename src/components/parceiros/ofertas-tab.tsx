/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Zap } from "lucide-react";
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
import { mensagemErro } from "@/lib/erros";
import { brl, unidadeLegivel } from "@/domain/parceiros/preco";
import { useNiveis, useProdutosAtivos, type OfertaDaGestao } from "./dados";

type Formulario = {
  id?: string;
  titulo: string;
  mensagem: string;
  produto_id: string | null;
  preco_oferta: string;
  inicio: string;
  fim: string;
  exibir_popup: boolean;
  nivel_minimo_id: string | null;
  ativa: boolean;
};

/** "2026-09-16T08:00" no fuso local, para <input type="datetime-local">. */
function paraCampo(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const nova = (): Formulario => {
  const agora = new Date();
  const fim = new Date(agora);
  fim.setDate(fim.getDate() + 7);
  fim.setHours(23, 59, 0, 0);
  return {
    titulo: "",
    mensagem: "",
    produto_id: null,
    preco_oferta: "",
    inicio: paraCampo(agora),
    fim: paraCampo(fim),
    exibir_popup: true,
    nivel_minimo_id: null,
    ativa: true,
  };
};

/**
 * Ofertas relâmpago: "lona por R$ 55 o m² até sexta".
 *
 * Com produto e preço, a oferta entra direto na tabela do parceiro (quando é menor
 * que o preço dele) e vale no pedido. Sem preço, é só um aviso. Marcada como
 * aviso, abre sozinha uma vez quando o parceiro entra.
 */
export function OfertasTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data: niveis = [] } = useNiveis();
  const { data: produtos = [] } = useProdutosAtivos();
  const [form, setForm] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: ofertas = [], isLoading } = useQuery({
    queryKey: ["parceiros-ofertas"],
    queryFn: async (): Promise<OfertaDaGestao[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_ofertas")
        .select("id, titulo, mensagem, produto_id, preco_oferta, inicio, fim, exibir_popup, nivel_minimo_id, ativa")
        .order("fim", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function salvar() {
    if (!form) return;
    if (!form.titulo.trim() || !form.mensagem.trim()) return toast.error("Preencha título e mensagem.");
    const preco = form.preco_oferta.trim() ? Number(form.preco_oferta.replace(",", ".")) : null;
    if (preco !== null && !(preco > 0)) return toast.error("Preço da oferta inválido.");
    if (preco !== null && !form.produto_id) return toast.error("Preço de oferta precisa de um produto.");
    const inicio = new Date(form.inicio);
    const fim = new Date(form.fim);
    if (!(fim > inicio)) return toast.error("O fim precisa ser depois do início.");
    setSalvando(true);
    const linha = {
      titulo: form.titulo.trim(),
      mensagem: form.mensagem.trim(),
      produto_id: form.produto_id,
      preco_oferta: preco,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      exibir_popup: form.exibir_popup,
      nivel_minimo_id: form.nivel_minimo_id,
      ativa: form.ativa,
    };
    const consulta = form.id
      ? (supabase as any).from("parceiro_ofertas").update(linha).eq("id", form.id).select("id")
      : (supabase as any).from("parceiro_ofertas").insert(linha).select("id");
    const { data, error } = await consulta;
    setSalvando(false);
    if (error || !data?.length) return toast.error(mensagemErro(error, "Seu perfil não pode alterar ofertas."));
    toast.success(form.id ? "Oferta atualizada" : "Oferta publicada para os parceiros");
    setForm(null);
    qc.invalidateQueries({ queryKey: ["parceiros-ofertas"] });
  }

  const produtoDe = (id: string | null) => produtos.find((p) => p.id === id);
  const agora = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Com produto e preço, a oferta vale na tabela e no pedido do parceiro enquanto estiver no prazo — só quando
          for menor que o preço de parceiro dele.
        </p>
        {podeEditar && (
          <Button onClick={() => setForm(nova())}>
            <Plus className="mr-1 h-4 w-4" /> Nova oferta
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : ofertas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma oferta ainda.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {ofertas.map((o) => {
            const valendo = o.ativa && new Date(o.inicio) <= agora && new Date(o.fim) > agora;
            const produto = produtoDe(o.produto_id);
            return (
              <article key={o.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2 font-semibold">
                    <Zap className="h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
                    <span className="truncate">{o.titulo}</span>
                  </p>
                  <StatusChip
                    label={!o.ativa ? "Desligada" : valendo ? "Valendo" : new Date(o.inicio) > agora ? "Agendada" : "Encerrada"}
                    tone={valendo ? "amber" : "muted"}
                  />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{o.mensagem}</p>
                <p className="text-sm">
                  {produto && o.preco_oferta
                    ? `${produto.nome} por ${brl(Number(o.preco_oferta))}/${unidadeLegivel(produto.unidade)}`
                    : "Aviso sem preço"}
                  {" · até "}
                  {new Date(o.fim).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  {o.exibir_popup ? " · abre como aviso" : ""}
                </p>
                {podeEditar && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: o.id,
                        titulo: o.titulo,
                        mensagem: o.mensagem,
                        produto_id: o.produto_id,
                        preco_oferta: o.preco_oferta ? String(o.preco_oferta) : "",
                        inicio: paraCampo(new Date(o.inicio)),
                        fim: paraCampo(new Date(o.fim)),
                        exibir_popup: o.exibir_popup,
                        nivel_minimo_id: o.nivel_minimo_id,
                        ativa: o.ativa,
                      })
                    }
                  >
                    Editar
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>{form.id ? "Editar oferta" : "Nova oferta"}</DialogTitle>
                <DialogDescription>O parceiro vê o título e a mensagem exatamente como estão aqui.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Campo rotulo="Título">
                  <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Lona com preço de fábrica" />
                </Campo>
                <Campo rotulo="Mensagem">
                  <Textarea rows={3} value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} placeholder="Ex.: Só até sexta: lona 440g a R$ 55 o m² para pedidos acima de 10 m²." />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Produto (opcional)">
                    <Select value={form.produto_id ?? "nenhum"} onValueChange={(v) => setForm({ ...form, produto_id: v === "nenhum" ? null : v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">Só aviso, sem produto</SelectItem>
                        {produtos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo rotulo={`Preço da oferta${form.produto_id ? ` (por ${unidadeLegivel(produtoDe(form.produto_id)?.unidade)})` : ""}`}>
                    <Input inputMode="decimal" value={form.preco_oferta} disabled={!form.produto_id} onChange={(e) => setForm({ ...form, preco_oferta: e.target.value })} placeholder="R$" />
                  </Campo>
                  <Campo rotulo="Começa">
                    <Input type="datetime-local" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
                  </Campo>
                  <Campo rotulo="Termina">
                    <Input type="datetime-local" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
                  </Campo>
                </div>
                <Campo rotulo="Para quem">
                  <Select value={form.nivel_minimo_id ?? "todos"} onValueChange={(v) => setForm({ ...form, nivel_minimo_id: v === "todos" ? null : v })}>
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
                  Abrir como aviso quando o parceiro entrar
                  <Switch checked={form.exibir_popup} onCheckedChange={(v) => setForm({ ...form, exibir_popup: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                  Oferta ligada
                  <Switch checked={form.ativa} onCheckedChange={(v) => setForm({ ...form, ativa: v })} />
                </label>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {salvando ? "Salvando…" : "Salvar oferta"}
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
      <Label className="text-xs text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}
