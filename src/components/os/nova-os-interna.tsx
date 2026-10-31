import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { ehUnidadeDeArea } from "@/domain/orcamentos/area";
import { ROTULO_DA_FINALIDADE, type FinalidadeDaOS } from "@/domain/os/finalidade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EXPLICA: Record<Exclude<FinalidadeDaOS, "venda">, string> = {
  mostruario: "Amostra, vitrine ou mostruário para vendas futuras (um banner de amostra, um brinquedo 3D, um copo gravado).",
  uso_interno: "Trabalho para a própria gráfica: uma placa, um uniforme, um teste de máquina.",
  reposicao: "Refazer uma peça que se perdeu ou saiu com defeito. Liga à OS que está sendo refeita.",
};

const VAZIO = {
  finalidade: "mostruario" as Exclude<FinalidadeDaOS, "venda">,
  titulo: "",
  produto_id: "",
  quantidade: "1",
  largura_cm: "",
  altura_cm: "",
  motivo: "",
  local: "",
  os_origem: "",
};

/**
 * "OS interna" (23/10/2026): trabalho que usa máquina, material e hora de gente e
 * não tem cliente nem receita. Antes só entrava como venda para um cliente
 * inventado — com conta a receber, aviso e pesquisa que não deviam existir. Todos
 * da equipe abrem (decisão do dono). A OS nasce para o cliente da casa, com
 * material previsto e reservado e a máquina agendada; não gera cobrança, aviso
 * nem pós-venda.
 */
export function NovaOsInterna() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { nivelDeVisao } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ ...VAZIO });
  const [gravando, setGravando] = useState(false);
  const gravandoRef = useRef(false);

  const produtos = useQuery({
    queryKey: ["os-interna-produtos", nivelDeVisao],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await fromFinancialView("produtos", nivelDeVisao)
        .select("id, nome, unidade, tipo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as { id: string; nome: string; unidade: string; tipo: string }[]).filter((p) => p.tipo !== "servico");
    },
  });

  const origens = useQuery({
    queryKey: ["os-interna-origens"],
    enabled: aberto && form.finalidade === "reposicao",
    queryFn: async () => {
      const { data, error } = await fromFinancialView("ordens_servico", false)
        .select("id, numero, titulo")
        .order("numero", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as { id: string; numero: number; titulo: string }[];
    },
  });

  const produto = (produtos.data ?? []).find((p) => p.id === form.produto_id) ?? null;
  const porArea = !!produto && ehUnidadeDeArea(produto.unidade);

  async function abrir() {
    if (gravandoRef.current) return;
    if (!form.titulo.trim()) return toast.error("Dê um nome ao trabalho.");
    if (!form.produto_id) return toast.error("Escolha o produto.");
    if (!form.motivo.trim()) return toast.error("Diga para que é este trabalho.");
    if (form.finalidade === "reposicao" && !form.os_origem) return toast.error("Escolha a OS que está sendo refeita.");
    const largura = Number(form.largura_cm.replace(",", ".")) / 100;
    const altura = Number(form.altura_cm.replace(",", ".")) / 100;
    if (porArea && !(largura > 0 && altura > 0)) return toast.error("Informe a largura e a altura em cm.");

    gravandoRef.current = true;
    setGravando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("criar_os_interna", {
        p_finalidade: form.finalidade,
        p_titulo: form.titulo.trim(),
        p_produto_id: form.produto_id,
        p_quantidade: Number(form.quantidade.replace(",", ".")) || 1,
        p_motivo: form.motivo.trim(),
        p_largura: porArea ? largura : null,
        p_altura: porArea ? altura : null,
        p_local: form.finalidade === "mostruario" ? form.local.trim() || null : null,
        p_os_origem: form.finalidade === "reposicao" ? form.os_origem : null,
      });
      if (error) throw error;
      const r = data as { os_id: string; numero: number; reserva?: { faltantes?: unknown[] } };
      const faltam = r.reserva?.faltantes?.length ?? 0;
      toast.success(`OS interna #${r.numero} aberta`, {
        description: faltam > 0 ? "Falta material no estoque para parte dela: confira em Materiais." : "Material reservado e máquina agendada.",
      });
      setAberto(false);
      setForm({ ...VAZIO });
      void qc.invalidateQueries({ queryKey: ["os-list"] });
      navigate({ to: "/os/$id", params: { id: r.os_id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      gravandoRef.current = false;
      setGravando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !gravando && setAberto(v)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="px-5 md:px-4">
          <Store className="mr-2 h-4 w-4" /> OS interna
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova OS interna</DialogTitle>
          <DialogDescription>{EXPLICA[form.finalidade]} Não gera cobrança, aviso ao cliente nem pesquisa de pós-venda.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Para que é</Label>
            <Select value={form.finalidade} onValueChange={(v) => setForm({ ...form, finalidade: v as typeof form.finalidade })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPLICA) as (keyof typeof EXPLICA)[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {ROTULO_DA_FINALIDADE[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osi-titulo">Nome do trabalho *</Label>
            <Input id="osi-titulo" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Banner de amostra — vitrine" />
          </div>
          <div className="space-y-1.5">
            <Label>Produto *</Label>
            <Select value={form.produto_id} onValueChange={(v) => setForm({ ...form, produto_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder={produtos.isPending ? "Carregando…" : "Escolha o produto"} />
              </SelectTrigger>
              <SelectContent>
                {(produtos.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {produtos.isError && <p className="text-xs text-destructive">Não foi possível carregar os produtos. Feche e abra de novo.</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="osi-qtd">Quantidade</Label>
              <Input id="osi-qtd" inputMode="decimal" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
            </div>
            {porArea && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="osi-larg">Largura (cm) *</Label>
                  <Input id="osi-larg" inputMode="decimal" value={form.largura_cm} onChange={(e) => setForm({ ...form, largura_cm: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="osi-alt">Altura (cm) *</Label>
                  <Input id="osi-alt" inputMode="decimal" value={form.altura_cm} onChange={(e) => setForm({ ...form, altura_cm: e.target.value })} />
                </div>
              </>
            )}
          </div>
          {form.finalidade === "mostruario" && (
            <div className="space-y-1.5">
              <Label htmlFor="osi-local">Onde vai ficar</Label>
              <Input id="osi-local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Vitrine, balcão, com o vendedor…" />
            </div>
          )}
          {form.finalidade === "reposicao" && (
            <div className="space-y-1.5">
              <Label>OS que está sendo refeita *</Label>
              <Select value={form.os_origem} onValueChange={(v) => setForm({ ...form, os_origem: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={origens.isPending ? "Carregando…" : "Escolha a OS"} />
                </SelectTrigger>
                <SelectContent>
                  {(origens.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      #{o.numero} · {o.titulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="osi-motivo">Motivo *</Label>
            <Textarea id="osi-motivo" rows={3} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Para que é, em uma frase. Fica no registro da OS." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={gravando}>
            Cancelar
          </Button>
          <Button onClick={() => void abrir()} disabled={gravando}>
            {gravando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {gravando ? "Abrindo…" : "Abrir OS interna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
