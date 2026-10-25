import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Scissors } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { categoriaLabel } from "@/lib/produtos-catalogo";
import { Carregando } from "@/components/bex/Carregando";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  avisoDeProcesso,
  BASES,
  lerCusto,
  margemDoAcabamento,
  precoPelaMargem,
  PROCESSOS,
  rotuloDaBase,
  rotuloDoProcesso,
  unidadeDaBase,
  type CustoDoAcabamento,
} from "@/domain/acabamentos/acabamentos";

type Acabamento = {
  id: string;
  nome: string;
  processo: string;
  maquina_id: string | null;
  base: string;
  minutos_maquina: number;
  minutos_mao_de_obra: number;
  material_id: string | null;
  material_qtd: number;
  preco_venda: number | null;
  preco_parceiro: number | null;
  observacao: string | null;
  ativo: boolean;
};
type Form = {
  id?: string;
  nome: string;
  processo: string;
  maquina_id: string;
  base: string;
  minutos_maquina: string;
  minutos_mao_de_obra: string;
  material_id: string;
  material_qtd: string;
  preco_venda: string;
  preco_parceiro: string;
  observacao: string;
  ativo: boolean;
  produtos: string[];
};
const VAZIO: Form = {
  nome: "",
  processo: "manual",
  maquina_id: "",
  base: "m2",
  minutos_maquina: "0",
  minutos_mao_de_obra: "0",
  material_id: "",
  material_qtd: "0",
  preco_venda: "",
  preco_parceiro: "",
  observacao: "",
  ativo: true,
  produtos: [],
};

const brl = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const MARGEM_PADRAO = 40;

/** Os acabamentos que o produto aceita, com custo e preço — usado na ficha da tabela de preços. */
export function useAcabamentos() {
  const { canSeeFinancials } = useAuth();
  return useQuery({
    queryKey: ["acabamentos", "tudo", canSeeFinancials],
    queryFn: async () => {
      const db = supabase as any;
      const [ac, links] = await Promise.all([
        db.from("acabamentos").select("*").order("nome"),
        db.from("produto_acabamentos").select("produto_id, acabamento_id, obrigatorio, padrao"),
      ]);
      if (ac.error) throw ac.error;
      if (links.error) throw links.error;
      const lista = ((ac.data ?? []) as any[]).map((a) => ({
        ...a,
        minutos_maquina: Number(a.minutos_maquina),
        minutos_mao_de_obra: Number(a.minutos_mao_de_obra),
        material_qtd: Number(a.material_qtd),
        preco_venda: a.preco_venda != null ? Number(a.preco_venda) : null,
        preco_parceiro: a.preco_parceiro != null ? Number(a.preco_parceiro) : null,
      })) as Acabamento[];
      const custos = new Map<string, CustoDoAcabamento>();
      if (canSeeFinancials) {
        await Promise.all(
          lista.map(async (a) => {
            const { data, error } = await db.rpc("custo_do_acabamento", { p_acabamento: a.id });
            const c = error ? null : lerCusto(data);
            if (c) custos.set(a.id, c);
          }),
        );
      }
      return { lista, custos, links: (links.data ?? []) as Array<{ produto_id: string; acabamento_id: string; obrigatorio: boolean; padrao: boolean }> };
    },
  });
}

export function GerenciadorDeAcabamentos({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const qc = useQueryClient();
  const { hasRole, canSeeFinancials } = useAuth();
  const podeEditar = hasRole("admin") || hasRole("gestor");
  const dados = useAcabamentos();
  const [form, setForm] = useState<Form | null>(null);

  const maquinas = useQuery({
    queryKey: ["acabamentos", "maquinas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("maquinas").select("id, nome, ativa").order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; ativa: boolean }>;
    },
  });
  const materiais = useQuery({
    queryKey: ["acabamentos", "materiais"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("materiais", "operacional").select("id, nome, unidade").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; nome: string; unidade: string }>;
    },
  });
  const produtos = useQuery({
    queryKey: ["acabamentos", "produtos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("produtos").select("id, nome, categoria, ativo").order("nome");
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; nome: string; categoria: string; ativo: boolean }>).filter((p) => p.ativo);
    },
  });

  const vinculosDe = (id: string) => (dados.data?.links ?? []).filter((l) => l.acabamento_id === id).map((l) => l.produto_id);

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.nome.trim()) throw new Error("Dê um nome ao acabamento.");
      const usaMaquina = PROCESSOS.find((p) => p.valor === f.processo)?.usaMaquina;
      if (usaMaquina && !f.maquina_id) throw new Error("Esse processo precisa de uma máquina.");
      const db = supabase as any;
      const payload = {
        nome: f.nome.trim(),
        processo: f.processo,
        maquina_id: f.maquina_id || null,
        base: f.base,
        minutos_maquina: num(f.minutos_maquina),
        minutos_mao_de_obra: num(f.minutos_mao_de_obra),
        material_id: f.material_id || null,
        material_qtd: f.material_id ? num(f.material_qtd) : 0,
        preco_venda: f.preco_venda.trim() === "" ? null : num(f.preco_venda),
        preco_parceiro: f.preco_parceiro.trim() === "" ? null : num(f.preco_parceiro),
        observacao: f.observacao.trim() || null,
        ativo: f.ativo,
        updated_at: new Date().toISOString(),
      };
      let id = f.id;
      if (id) {
        const { error } = await db.from("acabamentos").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("acabamentos").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id as string;
      }
      // Vínculos: tira o que saiu e põe o que entrou (sem apagar tudo e recriar).
      const atuais = new Set(f.id ? vinculosDe(f.id) : []);
      const novos = new Set(f.produtos);
      const sair = [...atuais].filter((p) => !novos.has(p));
      const entrar = [...novos].filter((p) => !atuais.has(p));
      if (sair.length) {
        const { error } = await db.from("produto_acabamentos").delete().eq("acabamento_id", id).in("produto_id", sair);
        if (error) throw error;
      }
      if (entrar.length) {
        const { error } = await db.from("produto_acabamentos").insert(entrar.map((p) => ({ produto_id: p, acabamento_id: id })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acabamentos"] });
      toast.success("Acabamento salvo");
      setForm(null);
    },
    onError: (e) => toast.error(/duplicate|unique/i.test(String((e as Error).message)) ? "Já existe um acabamento com esse nome." : mensagemErro(e)),
  });

  function abrir(a: Acabamento | null) {
    setForm(
      a
        ? {
            id: a.id,
            nome: a.nome,
            processo: a.processo,
            maquina_id: a.maquina_id ?? "",
            base: a.base,
            minutos_maquina: String(a.minutos_maquina),
            minutos_mao_de_obra: String(a.minutos_mao_de_obra),
            material_id: a.material_id ?? "",
            material_qtd: String(a.material_qtd),
            preco_venda: a.preco_venda != null ? String(a.preco_venda) : "",
            preco_parceiro: a.preco_parceiro != null ? String(a.preco_parceiro) : "",
            observacao: a.observacao ?? "",
            ativo: a.ativo,
            produtos: vinculosDe(a.id),
          }
        : VAZIO,
    );
  }

  const produtosPorCategoria = useMemo(() => {
    const m = new Map<string, Array<{ id: string; nome: string }>>();
    for (const p of produtos.data ?? []) m.set(p.categoria, [...(m.get(p.categoria) ?? []), p]);
    return [...m.entries()];
  }, [produtos.data]);

  const avisos = form
    ? (produtos.data ?? []).filter((p) => form.produtos.includes(p.id)).map((p) => avisoDeProcesso(form.processo, p.nome) && `${p.nome}: ${avisoDeProcesso(form.processo, p.nome)}`).filter(Boolean)
    : [];

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2"><Scissors className="h-5 w-5" aria-hidden /> Acabamentos</SheetTitle>
          <SheetDescription>
            O que se faz depois de produzir: corte a laser, CNC, recorte, manual. Cada um puxa a hora da máquina e a mão de obra. Escolhe-se o produto e depois o acabamento.
          </SheetDescription>
        </SheetHeader>

        {!form && (
          <div className="mt-4 space-y-3">
            {podeEditar && (
              <Button size="sm" onClick={() => abrir(null)}><Plus className="mr-1.5 h-4 w-4" /> Novo acabamento</Button>
            )}
            {dados.isLoading && <Carregando linhas={4} />}
            {dados.error && <p className="text-sm text-destructive" role="alert">Não consegui carregar: {mensagemErro(dados.error)}</p>}
            <ul className="space-y-2">
              {(dados.data?.lista ?? []).map((a) => {
                const c = dados.data?.custos.get(a.id) ?? null;
                const sugerido = precoPelaMargem(c?.custo_total ?? null, MARGEM_PADRAO);
                const margem = margemDoAcabamento(a.preco_venda, c?.custo_total ?? null);
                return (
                  <li key={a.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{a.nome}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline">{rotuloDoProcesso(a.processo)}</Badge>
                          <span>{rotuloDaBase(a.base)}</span>
                          <span>· {vinculosDe(a.id).length} produto(s)</span>
                          {!a.ativo && <Badge variant="outline">inativo</Badge>}
                        </div>
                      </div>
                      {podeEditar && (
                        <Button size="icon" variant="ghost" aria-label={`Editar ${a.nome}`} onClick={() => abrir(a)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-muted/50 p-1.5"><dt className="text-muted-foreground">Custo / {unidadeDaBase(a.base)}</dt><dd className="font-mono text-sm">{canSeeFinancials ? brl(c?.custo_total ?? null) : "—"}</dd></div>
                      <div className="rounded-lg bg-primary/10 p-1.5"><dt className="text-muted-foreground">Preço</dt><dd className="font-mono text-sm">{a.preco_venda != null ? brl(a.preco_venda) : <span className="text-muted-foreground">sem preço</span>}</dd></div>
                      <div className="rounded-lg bg-muted/50 p-1.5"><dt className="text-muted-foreground">{a.preco_venda != null ? "Margem" : `Sugerido (${MARGEM_PADRAO}%)`}</dt><dd className="font-mono text-sm">{a.preco_venda != null ? (margem != null ? `${margem}%` : "—") : brl(sugerido)}</dd></div>
                    </dl>
                    {c && c.faltas.length > 0 && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                        <span>{c.faltas.join(" · ")}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {form && (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate(form);
            }}
          >
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Corte a laser (CNC Laser)" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Processo</Label>
                <Select value={form.processo} onValueChange={(v) => setForm({ ...form, processo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROCESSOS.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Máquina</Label>
                <Select value={form.maquina_id || "nenhuma"} onValueChange={(v) => setForm({ ...form, maquina_id: v === "nenhuma" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">Sem máquina (manual)</SelectItem>
                    {(maquinas.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Cobrado</Label>
                <Select value={form.base} onValueChange={(v) => setForm({ ...form, base: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BASES.map((b) => <SelectItem key={b.valor} value={b.valor}>{b.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Min. de máquina / {unidadeDaBase(form.base)}</Label>
                <Input inputMode="decimal" value={form.minutos_maquina} onChange={(e) => setForm({ ...form, minutos_maquina: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Min. de gente / {unidadeDaBase(form.base)}</Label>
                <Input inputMode="decimal" value={form.minutos_mao_de_obra} onChange={(e) => setForm({ ...form, minutos_mao_de_obra: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Material gasto (opcional)</Label>
                <Select value={form.material_id || "nenhum"} onValueChange={(v) => setForm({ ...form, material_id: v === "nenhum" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Nenhum</SelectItem>
                    {(materiais.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome} ({m.unidade})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Qtd / {unidadeDaBase(form.base)}</Label>
                <Input inputMode="decimal" value={form.material_qtd} disabled={!form.material_id} onChange={(e) => setForm({ ...form, material_qtd: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preço de venda / {unidadeDaBase(form.base)} (R$)</Label>
                <Input inputMode="decimal" value={form.preco_venda} onChange={(e) => setForm({ ...form, preco_venda: e.target.value })} placeholder="vazio = sem preço" />
              </div>
              <div className="space-y-1.5">
                <Label>Preço de parceiro (R$)</Label>
                <Input inputMode="decimal" value={form.preco_parceiro} onChange={(e) => setForm({ ...form, preco_parceiro: e.target.value })} placeholder="vazio = sem preço" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea rows={2} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} id="acabamento-ativo" />
              <Label htmlFor="acabamento-ativo">Ativo</Label>
            </div>

            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="text-sm font-semibold">Produtos que aceitam este acabamento</div>
              {avisos.length > 0 && (
                <ul className="space-y-1 rounded-md border border-warning/50 bg-warning/15 p-2 text-xs" role="alert">
                  {avisos.map((a) => <li key={String(a)}>{a}</li>)}
                </ul>
              )}
              {produtosPorCategoria.map(([cat, lista]) => (
                <div key={cat}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{categoriaLabel(cat)}</div>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {lista.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={form.produtos.includes(p.id)}
                          onCheckedChange={(v) => setForm({ ...form, produtos: v === true ? [...form.produtos, p.id] : form.produtos.filter((x) => x !== p.id) })}
                        />
                        <span className="min-w-0 truncate">{p.nome}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={salvar.isPending}>Salvar</Button>
              <Button type="button" variant="outline" onClick={() => setForm(null)}>Voltar</Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
