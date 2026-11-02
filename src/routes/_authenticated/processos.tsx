/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import {
  ROTULO_DA_BASE,
  ROTULO_DA_ORIGEM,
  type BaseDeProdutividade,
  type OrigemDaProdutividade,
} from "@/domain/catalogo/pasta-do-produto";

export const Route = createFileRoute("/_authenticated/processos")({
  head: () => ({ meta: [{ title: "Processos — BEX PRINT OS" }] }),
  component: ProcessosPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
});

const ETAPAS: Record<string, string> = {
  pre_impressao: "Criação",
  producao: "Produção",
  acabamento: "Acabamento",
  saida: "Entrega",
};

type LinhaFamilia = { familias: string; produtividade: string };

type Form = {
  id?: string;
  nome: string;
  etapa: string;
  setup_min: string;
  pessoas: string;
  base_produtividade: BaseDeProdutividade;
  produtividade: string;
  produtividade_original?: string;
  familias: LinhaFamilia[];
  sobra: { superior: string; inferior: string; esquerda: string; direita: string };
};

const VAZIO: Form = {
  nome: "",
  etapa: "producao",
  setup_min: "0",
  pessoas: "1",
  base_produtividade: "m2_h",
  produtividade: "",
  familias: [],
  sobra: { superior: "", inferior: "", esquerda: "", direita: "" },
};

const numero = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * O catálogo de processos (01/11/2026): o passo a passo de que os produtos são
 * feitos. A produtividade nasce vazia de propósito: é o número da oficina, e o
 * tempo do produto só aparece quando ela existir.
 */
function ProcessosPage() {
  const { hasRole } = useAuth();
  const podeEditar = hasRole("admin") || hasRole("gestor") || hasRole("operador");
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const lista = useQuery({
    queryKey: ["processos-catalogo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("processos").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const registro = {
        nome: f.nome.trim(),
        etapa: f.etapa,
        setup_min: numero(f.setup_min) ?? 0,
        pessoas: numero(f.pessoas) ?? 1,
        base_produtividade: f.base_produtividade,
        produtividade_m2_h: f.base_produtividade === "m2_h" ? numero(f.produtividade) : null,
        produtividade_m_h: f.base_produtividade === "m_h" ? numero(f.produtividade) : null,
        // Só mudar o nome não transforma referência em medição: quem digita um número novo é que mede.
        ...(f.base_produtividade === "tempo_do_produto"
          ? { produtividade_origem: "nao_se_aplica", medido_em: null }
          : f.produtividade !== f.produtividade_original
            ? { produtividade_origem: "medido", medido_em: new Date().toISOString() }
            : {}),
        produtividade_por_familia: f.familias
          .map((l) => ({
            familias: l.familias
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            produtividade_m2_h: numero(l.produtividade) ?? 0,
          }))
          .filter((l) => l.familias.length > 0 && l.produtividade_m2_h > 0),
        sobra_cm: {
          superior: numero(f.sobra.superior),
          inferior: numero(f.sobra.inferior),
          esquerda: numero(f.sobra.esquerda),
          direita: numero(f.sobra.direita),
        },
      };
      const consulta = f.id
        ? (supabase as any).from("processos").update(registro).eq("id", f.id)
        : (supabase as any).from("processos").insert(registro);
      const { data, error } = await consulta.select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("Nada foi gravado: seu perfil não pode alterar processos.");
    },
    onSuccess: () => {
      toast.success("Processo salvo.");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["processos-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["processos-ativos"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const abrir = (p: any) =>
    setForm({
      id: p.id,
      nome: p.nome,
      etapa: p.etapa,
      setup_min: txt(p.setup_min),
      pessoas: txt(p.pessoas),
      base_produtividade: p.base_produtividade,
      produtividade: txt(
        p.base_produtividade === "m_h" ? p.produtividade_m_h : p.produtividade_m2_h,
      ),
      produtividade_original: txt(
        p.base_produtividade === "m_h" ? p.produtividade_m_h : p.produtividade_m2_h,
      ),
      familias: ((p.produtividade_por_familia ?? []) as any[]).map((l) => ({
        familias: (l.familias ?? []).join(", "),
        produtividade: txt(l.produtividade_m2_h),
      })),
      sobra: {
        superior: txt(p.sobra_cm?.superior),
        inferior: txt(p.sobra_cm?.inferior),
        esquerda: txt(p.sobra_cm?.esquerda),
        direita: txt(p.sobra_cm?.direita),
      },
    });

  const semNumero = (lista.data ?? []).filter(
    (p) => p.base_produtividade !== "tempo_do_produto" && p.produtividade_origem !== "medido",
  ).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/processos")}
        breadcrumb="Preço e custo · Processos"
        title="Processos"
        description="O passo a passo de que os produtos são feitos: etapa, preparação, pessoas e produtividade."
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {semNumero > 0
            ? `${semNumero} processo(s) ainda com número de referência: meça na oficina e confirme.`
            : "Todos os processos foram medidos na oficina."}
        </p>
        {podeEditar && (
          <Button onClick={() => setForm({ ...VAZIO })}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo processo
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="space-y-2 pt-6">
          {lista.isLoading && <Carregando />}
          {(lista.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!podeEditar}
              onClick={() => abrir(p)}
              className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded border p-3 text-left hover:bg-muted/30 disabled:hover:bg-transparent"
            >
              <span className="font-medium">{p.nome}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{ETAPAS[p.etapa] ?? p.etapa}</Badge>
                {p.base_produtividade === "tempo_do_produto"
                  ? "tempo do produto"
                  : `${Number(p.base_produtividade === "m_h" ? p.produtividade_m_h : p.produtividade_m2_h).toLocaleString("pt-BR")} ${ROTULO_DA_BASE[p.base_produtividade as BaseDeProdutividade]}`}
                {" · "}
                {ROTULO_DA_ORIGEM[p.produtividade_origem as OrigemDaProdutividade]}
                {Number(p.setup_min) > 0 && ` · preparação ${Number(p.setup_min)} min`}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar processo" : "Novo processo"}</DialogTitle>
            <DialogDescription>
              Os números são os da oficina. Deixe em branco o que ainda não foi medido.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="proc-nome">Nome</Label>
                  <Input
                    id="proc-nome"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Etapa da produção</Label>
                  <Select value={form.etapa} onValueChange={(v) => setForm({ ...form, etapa: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ETAPAS).map(([v, r]) => (
                        <SelectItem key={v} value={v}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="proc-setup">Preparação (min)</Label>
                  <Input
                    id="proc-setup"
                    value={form.setup_min}
                    onChange={(e) => setForm({ ...form, setup_min: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proc-pessoas">Pessoas</Label>
                  <Input
                    id="proc-pessoas"
                    value={form.pessoas}
                    onChange={(e) => setForm({ ...form, pessoas: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proc-prod">
                    Produtividade ({ROTULO_DA_BASE[form.base_produtividade]})
                  </Label>
                  <Input
                    id="proc-prod"
                    disabled={form.base_produtividade === "tempo_do_produto"}
                    value={form.produtividade}
                    onChange={(e) => setForm({ ...form, produtividade: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Como o tempo é medido</Label>
                <Select
                  value={form.base_produtividade}
                  onValueChange={(v) =>
                    setForm({ ...form, base_produtividade: v as BaseDeProdutividade })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="m2_h">Pela área: m²/h</SelectItem>
                    <SelectItem value="m_h">Pelo contorno: metros/h</SelectItem>
                    <SelectItem value="tempo_do_produto">
                      Pelo tempo do produto ou do fatiador
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 rounded border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Produtividade por família de material</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setForm({
                        ...form,
                        familias: [...form.familias, { familias: "", produtividade: "" }],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Linha
                  </Button>
                </div>
                {form.familias.map((l, i) => (
                  <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_140px_auto]">
                    <Input
                      aria-label="Famílias, separadas por vírgula"
                      placeholder="Lonas, Adesivos"
                      value={l.familias}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          familias: form.familias.map((x, j) =>
                            j === i ? { ...x, familias: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label="Produtividade em m² por hora"
                      placeholder="m²/h"
                      value={l.produtividade}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          familias: form.familias.map((x, j) =>
                            j === i ? { ...x, produtividade: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Tirar a linha"
                      onClick={() =>
                        setForm({ ...form, familias: form.familias.filter((_, j) => j !== i) })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">Sobra de material por cópia (cm)</span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["superior", "inferior", "esquerda", "direita"] as const).map((lado) => (
                    <div key={lado} className="space-y-1.5">
                      <Label className="capitalize" htmlFor={`proc-${lado}`}>
                        {lado}
                      </Label>
                      <Input
                        id={`proc-${lado}`}
                        value={form.sobra[lado]}
                        onChange={(e) =>
                          setForm({ ...form, sobra: { ...form.sobra, [lado]: e.target.value } })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!form?.nome.trim() || salvar.isPending}
              onClick={() => form && salvar.mutate(form)}
            >
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
