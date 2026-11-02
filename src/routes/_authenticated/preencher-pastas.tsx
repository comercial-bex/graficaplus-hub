/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import {
  faltaNaArea,
  ROTULO_DA_BASE,
  ROTULO_DA_ORIGEM,
  type BaseDeProdutividade,
  type OrigemDaProdutividade,
} from "@/domain/catalogo/pasta-do-produto";

export const Route = createFileRoute("/_authenticated/preencher-pastas")({
  head: () => ({ meta: [{ title: "Preencher as pastas — BEX PRINT OS" }] }),
  component: PreencherPastas,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
});

const numero = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** A política de escrita barra em silêncio (0 linhas, sem erro): a gravação pede as linhas de volta. */
function confereGravou(data: unknown[] | null) {
  if (!data || data.length === 0)
    throw new Error("Nada foi gravado: seu perfil não pode alterar esta parte.");
}

/**
 * O painel de cobrança da pasta do produto (01/11/2026). Cada área vê a sua parte
 * e preenche aqui mesmo; a gerência vê todas e quem está atrás. A pendência no
 * painel de cada papel (`pendencias_do_sistema`) traz cada um para cá.
 */
function PreencherPastas() {
  const { hasRole } = useAuth();
  const gerencia = hasRole("admin") || hasRole("gestor");
  const verProducao = gerencia || hasRole("operador");
  const verAtendimento = gerencia || hasRole("vendedor");
  const verFinanceiro = gerencia || hasRole("financeiro");

  const processos = useQuery({
    queryKey: ["cobranca-processos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("processos")
        .select(
          "id, nome, base_produtividade, produtividade_m2_h, produtividade_m_h, setup_min, produtividade_origem, produtividade_fonte",
        )
        .eq("ativo", true)
        .neq("base_produtividade", "tempo_do_produto")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const fichas = useQuery({
    queryKey: ["cobranca-fichas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_ficha")
        .select(
          "produto_id, ncm, cst_ipi, ipi_percentual, ia_personalidade, ia_como_medir, ia_perguntas, ia_revisado_em, produtos!inner(nome, tipo, ativo)",
        )
        .eq("produtos.ativo", true);
      if (error) throw error;
      return ((data ?? []) as any[]).sort((a, b) => a.produtos.nome.localeCompare(b.produtos.nome));
    },
  });

  if (processos.isLoading || fichas.isLoading) return <Carregando />;
  if (processos.isError || fichas.isError) {
    return (
      <p className="p-6 text-sm text-destructive">
        Não foi possível ler o que falta preencher. Recarregue a página.
      </p>
    );
  }

  const listaProc = processos.data ?? [];
  const listaFicha = fichas.data ?? [];
  const fisicos = listaFicha.filter((f) => f.produtos.tipo !== "servico");
  const areaProducao = faltaNaArea(
    listaProc.map((p) => ({ pronto: p.produtividade_origem === "medido" })),
  );
  const areaAtendimento = faltaNaArea(listaFicha.map((f) => ({ pronto: !!f.ia_revisado_em })));
  const areaFinanceiro = faltaNaArea(fisicos.map((f) => ({ pronto: !!f.ncm?.trim() })));

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/preencher-pastas")}
        breadcrumb="Preço e custo · Produtos e serviços"
        title="Preencher as pastas"
        description="Cada área tem a sua parte para o orçamento e o tempo de produção saírem certos."
      />

      <div className="grid gap-3 md:grid-cols-3">
        <CartaoDaArea
          titulo="Produção"
          detalhe="processos medidos na oficina"
          area={areaProducao}
        />
        <CartaoDaArea
          titulo="Atendimento e vendas"
          detalhe="roteiros da IA revisados"
          area={areaAtendimento}
        />
        <CartaoDaArea titulo="Financeiro" detalhe="produtos com NCM" area={areaFinanceiro} />
      </div>

      {verProducao && <ParteDaProducao processos={listaProc} />}
      {verAtendimento && <ParteDoAtendimento fichas={listaFicha} />}
      {verFinanceiro && <ParteDoFinanceiro fichas={fisicos} />}
    </div>
  );
}

function CartaoDaArea({
  titulo,
  detalhe,
  area,
}: {
  titulo: string;
  detalhe: string;
  area: ReturnType<typeof faltaNaArea>;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{titulo}</span>
          <span className="font-mono text-sm">{area.pct}%</span>
        </div>
        <Progress value={area.pct} aria-label={`${titulo}: ${area.pct}% preenchido`} />
        <p className="text-xs text-muted-foreground">
          {area.prontos} de {area.total} {detalhe}
        </p>
      </CardContent>
    </Card>
  );
}

function ParteDaProducao({ processos }: { processos: any[] }) {
  const pendentes = processos.filter((p) => p.produtividade_origem !== "medido");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Produção: meça e confirme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Os números abaixo são de referência. Cronometre o processo e digite o que a sua oficina
          faz de verdade. O tempo de cada produto já sai deles.
        </p>
        {pendentes.length === 0 && <p className="text-sm">Todos os processos foram medidos.</p>}
        {pendentes.map((p) => (
          <LinhaDeProcesso key={p.id} p={p} />
        ))}
      </CardContent>
    </Card>
  );
}

function LinhaDeProcesso({ p }: { p: any }) {
  const qc = useQueryClient();
  const base = p.base_produtividade as BaseDeProdutividade;
  const atual = base === "m_h" ? p.produtividade_m_h : p.produtividade_m2_h;
  const [prod, setProd] = useState(atual == null ? "" : String(atual));
  const [setup, setSetup] = useState(String(p.setup_min ?? 0));
  const confirmar = useMutation({
    mutationFn: async () => {
      const n = numero(prod);
      if (!n || n <= 0) throw new Error("Digite a produtividade medida.");
      const { data, error } = await (supabase as any)
        .from("processos")
        .update({
          [base === "m_h" ? "produtividade_m_h" : "produtividade_m2_h"]: n,
          setup_min: numero(setup) ?? 0,
          produtividade_origem: "medido",
          medido_em: new Date().toISOString(),
        })
        .eq("id", p.id)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success(`${p.nome}: número confirmado.`);
      void qc.invalidateQueries({ queryKey: ["cobranca-processos"] });
      void qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <div className="grid items-end gap-3 rounded border p-3 md:grid-cols-[1fr_140px_120px_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {p.nome}
          <Badge variant="outline">
            {ROTULO_DA_ORIGEM[p.produtividade_origem as OrigemDaProdutividade]}
          </Badge>
        </div>
        {p.produtividade_fonte && (
          <div className="text-xs text-muted-foreground">{p.produtividade_fonte}</div>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`prod-${p.id}`} className="text-xs">
          {ROTULO_DA_BASE[base]}
        </Label>
        <Input
          id={`prod-${p.id}`}
          inputMode="decimal"
          value={prod}
          onChange={(e) => setProd(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`setup-${p.id}`} className="text-xs">
          Preparação (min)
        </Label>
        <Input
          id={`setup-${p.id}`}
          inputMode="decimal"
          value={setup}
          onChange={(e) => setSetup(e.target.value)}
        />
      </div>
      <Button disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
        Confirmar medido
      </Button>
    </div>
  );
}

function ParteDoAtendimento({ fichas }: { fichas: any[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const pendentes = fichas.filter((f) => !f.ia_revisado_em);
  const [aberta, setAberta] = useState<any | null>(null);
  const [texto, setTexto] = useState({ personalidade: "", medir: "", perguntas: "" });
  const abrir = (f: any) => {
    setAberta(f);
    setTexto({
      personalidade: f.ia_personalidade ?? "",
      medir: f.ia_como_medir ?? "",
      perguntas: f.ia_perguntas ?? "",
    });
  };
  const revisar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_ficha")
        .update({
          ia_personalidade: texto.personalidade.trim() || null,
          ia_como_medir: texto.medir.trim() || null,
          ia_perguntas: texto.perguntas.trim() || null,
          ia_revisado_em: new Date().toISOString(),
          ia_revisado_por: user?.id ?? null,
        })
        .eq("produto_id", aberta.produto_id)
        .select("produto_id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success("Roteiro revisado.");
      setAberta(null);
      void qc.invalidateQueries({ queryKey: ["cobranca-fichas"] });
      void qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Atendimento e vendas: revise o roteiro da IA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          É o que a IA lê para orçar. Corrija o que não é assim na nossa loja e marque como
          revisado.
        </p>
        {pendentes.length === 0 && <p className="text-sm">Todos os roteiros foram revisados.</p>}
        <div className="grid gap-2 md:grid-cols-2">
          {pendentes.map((f) => (
            <button
              key={f.produto_id}
              type="button"
              onClick={() => abrir(f)}
              className="min-h-11 rounded border p-3 text-left text-sm hover:bg-muted/30"
            >
              {f.produtos.nome}
            </button>
          ))}
        </div>
      </CardContent>
      <Dialog open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{aberta?.produtos.nome}</DialogTitle>
            <DialogDescription>Ajuste o texto e marque como revisado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rot-personalidade">Personalidade e regras</Label>
              <Textarea
                id="rot-personalidade"
                rows={7}
                value={texto.personalidade}
                onChange={(e) => setTexto({ ...texto, personalidade: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rot-medir">Como descobrir as medidas</Label>
              <Textarea
                id="rot-medir"
                rows={5}
                value={texto.medir}
                onChange={(e) => setTexto({ ...texto, medir: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rot-perguntas">Perguntas obrigatórias</Label>
              <Textarea
                id="rot-perguntas"
                rows={5}
                value={texto.perguntas}
                onChange={(e) => setTexto({ ...texto, perguntas: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberta(null)}>
              Cancelar
            </Button>
            <Button disabled={revisar.isPending} onClick={() => revisar.mutate()}>
              Revisado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ParteDoFinanceiro({ fichas }: { fichas: any[] }) {
  const pendentes = fichas.filter((f) => !f.ncm?.trim());
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Financeiro: NCM dos produtos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Use o código que a contabilidade indicar. Produto sem NCM não sai certo na nota.
        </p>
        {pendentes.length === 0 && <p className="text-sm">Todos os produtos têm NCM.</p>}
        {pendentes.map((f) => (
          <LinhaFiscal key={f.produto_id} f={f} />
        ))}
      </CardContent>
    </Card>
  );
}

function LinhaFiscal({ f }: { f: any }) {
  const qc = useQueryClient();
  const [ncm, setNcm] = useState("");
  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_ficha")
        .update({ ncm: ncm.trim() })
        .eq("produto_id", f.produto_id)
        .select("produto_id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success(`${f.produtos.nome}: NCM salvo.`);
      void qc.invalidateQueries({ queryKey: ["cobranca-fichas"] });
      void qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border p-2">
      <span className="min-w-[200px] flex-1 text-sm">{f.produtos.nome}</span>
      <Input
        aria-label={`NCM de ${f.produtos.nome}`}
        className="w-36"
        placeholder="NCM"
        value={ncm}
        onChange={(e) => setNcm(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!ncm.trim() || salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        Salvar
      </Button>
    </div>
  );
}
