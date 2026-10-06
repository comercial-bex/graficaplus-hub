import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  Coins,
  Plus,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { DataPanel } from "@/components/bex/DataPanel";
import { NeonButton } from "@/components/bex/NeonButton";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";
import { ConferenciaDeDuplicidade } from "@/components/materiais/conferencia-de-duplicidade";
import { conferirMaterialComIa } from "@/lib/api/materiais-ia.functions";
import {
  UNIDADES_DE_MATERIAL,
  contarPorUnidade,
  materiaisParecidos,
  normalizarTexto,
  normalizarUnidade,
  type ConferenciaIa,
} from "@/domain/materiais/parecidos";

export const Route = createFileRoute("/_authenticated/materiais")({
  head: () => ({
    meta: [
      { title: "Materiais e peças — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Estoque de materiais e peças com custo unitário, entradas, saídas, consumo por OS e desperdício valorizado.",
      },
      { property: "og:title", content: "Materiais e peças — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Quanto tem, quanto custa, quanto saiu para produção e quanto virou perda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MateriaisPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

type Material = {
  id: string;
  nome: string;
  unidade: string;
  estoque: number;
  custo_unitario: number | null;
  custo_medio: number | null;
  estoque_minimo: number | null;
  fornecedor: string | null;
  localizacao: string | null;
  caracteristicas: string | null;
};

const formVazio = {
  nome: "",
  caracteristicas: "",
  unidade: "m²",
  estoque: "0",
  custo_unitario: "",
  estoque_minimo: "0",
  fornecedor: "",
};

/** O que foi conferido pela IA: o resultado só vale para este texto. */
const chaveDaConferencia = (f: { nome: string; unidade: string; caracteristicas: string }) =>
  `${normalizarTexto(f.nome)}|${normalizarUnidade(f.unidade)}|${normalizarTexto(f.caracteristicas)}`;

type MovForm = {
  material_id: string;
  tipo: "entrada" | "saida";
  quantidade: string;
  custo_unitario: string;
  motivo: string;
  observacao: string;
};

const movVazio: MovForm = {
  material_id: "",
  tipo: "entrada",
  quantidade: "0",
  custo_unitario: "",
  motivo: "compra",
  observacao: "",
};

function MateriaisPage() {
  const qc = useQueryClient();
  const { canSeeFinancials, hasAnyRole } = useAuth();
  // Cadastrar material é de admin, gestor e estoque — a mesma regra da policy
  // de escrita da tabela. Para os outros, o botão não aparece (antes aparecia
  // e o salvar estourava permissão).
  const podeCadastrar = hasAnyRole(["admin", "gestor", "estoque"]);
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroUnidade, setFiltroUnidade] = useState<string | null>(null);
  const [form, setForm] = useState({ ...formVazio });
  const [ia, setIa] = useState<{ chave: string; resultado: ConferenciaIa } | null>(null);
  const [confirmarDuplicado, setConfirmarDuplicado] = useState<string[] | null>(null);
  const [movOpen, setMovOpen] = useState(false);
  const [mov, setMov] = useState<MovForm>(movVazio);

  const { data: materiais = [], isLoading } = useQuery({
    queryKey: ["materiais", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("materiais", canSeeFinancials)
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Material[];
    },
  });

  const { data: movimentos = [] } = useQuery({
    queryKey: ["movimentos-materiais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimentacoes_estoque")
        .select("id, material_id, tipo, quantidade, custo_unitario_snapshot, origem, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: perdas = [] } = useQuery({
    queryKey: ["perdas-por-material"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_perdas")
        .select("material_id, quantidade_perdida, custo_unitario, custo_total")
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  /**
   * Em quantos produtos cada material entra como receita.
   *
   * Material sem custo que ninguém usa em ficha é só um cadastro pela metade.
   * Material sem custo que ESTÁ numa receita é outra coisa: o custo do produto
   * inteiro depende dele, e a soma da ficha o trataria como zero. O banco se
   * recusa a gravar essa conta (`recalcular_custo_produto` volta sem mexer),
   * então o produto fica com o custo digitado à mão — congelado até alguém
   * preencher o custo aqui. É essa diferença que o aviso abaixo mostra.
   */
  const { data: usoEmReceita = new Map<string, number>() } = useQuery({
    queryKey: ["materiais-em-receita"],
    queryFn: async () => {
      const { data, error } = await supabase.from("produto_materiais").select("material_id");
      if (error) throw error;
      const mapa = new Map<string, number>();
      for (const r of (data ?? []) as { material_id: string }[]) {
        mapa.set(r.material_id, (mapa.get(r.material_id) ?? 0) + 1);
      }
      return mapa;
    },
  });

  const semCustoEmReceita = useMemo(
    () =>
      materiais.filter(
        (m) =>
          Number(m.custo_medio ?? m.custo_unitario ?? 0) <= 0 && (usoEmReceita.get(m.id) ?? 0) > 0,
      ),
    [materiais, usoEmReceita],
  );

  const resumoPorMaterial = useMemo(() => {
    const mapa = new Map<
      string,
      { saidas: number; consumoOS: number; perdaQtd: number; perdaCusto: number }
    >();
    const pega = (id: string) =>
      mapa.get(id) ?? { saidas: 0, consumoOS: 0, perdaQtd: 0, perdaCusto: 0 };
    for (const m of movimentos as any[]) {
      if (!m.material_id || m.tipo !== "saida") continue;
      const r = pega(m.material_id);
      r.saidas += Number(m.quantidade ?? 0);
      if (m.origem === "baixa_os") r.consumoOS += Number(m.quantidade ?? 0);
      mapa.set(m.material_id, r);
    }
    for (const p of perdas as any[]) {
      if (!p.material_id) continue;
      const r = pega(p.material_id);
      r.perdaQtd += Number(p.quantidade_perdida ?? 0);
      r.perdaCusto += Number(
        p.custo_total ?? Number(p.custo_unitario ?? 0) * Number(p.quantidade_perdida ?? 0),
      );
      mapa.set(p.material_id, r);
    }
    return mapa;
  }, [movimentos, perdas]);

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("materiais").insert({
        nome: form.nome.trim(),
        caracteristicas: form.caracteristicas.trim() || null,
        unidade: form.unidade || "un",
        estoque: Number(form.estoque) || 0,
        estoque_minimo: Number(form.estoque_minimo) || 0,
        fornecedor: form.fornecedor || null,
        custo_unitario:
          canSeeFinancials && form.custo_unitario ? Number(form.custo_unitario) : null,
        custo_medio: canSeeFinancials && form.custo_unitario ? Number(form.custo_unitario) : null,
        // `as never`: `caracteristicas` (05/10/2026) ainda não está nos tipos gerados.
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Material cadastrado");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      setOpen(false);
      setForm({ ...formVazio });
      setIa(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  // Parecidos pelo texto: de graça, enquanto digita, contra a lista inteira.
  const parecidos = useMemo(
    () =>
      materiaisParecidos(
        { nome: form.nome, unidade: form.unidade, caracteristicas: form.caracteristicas },
        materiais,
      ),
    [form.nome, form.unidade, form.caracteristicas, materiais],
  );
  // A resposta da IA só vale para o texto que foi conferido.
  const iaAtual = ia && ia.chave === chaveDaConferencia(form) ? ia.resultado : null;

  const conferirComIa = useMutation({
    mutationFn: async () => {
      const chave = chaveDaConferencia(form);
      const resultado = await conferirMaterialComIa({
        data: { nome: form.nome, unidade: form.unidade, caracteristicas: form.caracteristicas },
      });
      return { chave, resultado };
    },
    onSuccess: (r) => setIa(r),
    onError: (e: unknown) => toast.error(mensagemErro(e, "A conferência com IA falhou")),
  });

  /** Salvar: se já existe algo forte, pergunta antes — duplicar é dividir o estoque. */
  function salvarMaterial() {
    const fortes = [
      ...parecidos.filter((p) => p.nivel !== "parecido").map((p) => p.material.nome),
      ...(iaAtual?.estado === "ok"
        ? iaAtual.duplicados.filter((d) => d.certeza === "alta").map((d) => d.nome)
        : []),
    ];
    const unicos = [...new Set(fortes)];
    if (unicos.length > 0) {
      setConfirmarDuplicado(unicos);
      return;
    }
    criar.mutate();
  }

  function usarExistente(material: { nome: string }) {
    setOpen(false);
    setForm({ ...formVazio });
    setIa(null);
    setFiltroUnidade(null);
    setBusca(material.nome);
    toast.success(`Use o material já cadastrado: ${material.nome}`);
  }

  /**
   * Entrada e saída de material.
   *
   * A versão anterior fazia tudo à mão no navegador: inseria a movimentação,
   * calculava o custo médio ponderado em JavaScript e gravava
   * `estoque = estoque ± qtd` direto na tabela. Três problemas, todos calados:
   *
   *  1. `materiais.estoque` é a SOMA DOS LOTES — `recalcular_estoque_material`
   *     refaz essa conta a cada mexida em lote. O número gravado aqui era
   *     apagado na entrada seguinte, e com ele a movimentação sumia do saldo;
   *  2. ler, somar e gravar sem trava é perder lançamento: duas pessoas
   *     registrando ao mesmo tempo e uma sobrescreve a outra;
   *  3. a entrada não criava lote, então não havia de onde a saída tirar, nem
   *     custo por data de compra.
   *
   * Agora são duas RPC que fazem lote, movimentação e custo num lugar só. O
   * banco passou a recusar escrita direta no saldo (`aa_estoque_tem_um_dono`).
   */
  const lancarMov = useMutation({
    mutationFn: async () => {
      const material = materiais.find((m) => m.id === mov.material_id);
      if (!material) throw new Error("Escolha o material.");
      const qtd = Number(mov.quantidade) || 0;
      if (qtd <= 0) throw new Error("Informe uma quantidade maior que zero.");

      if (mov.tipo === "entrada") {
        const custo = mov.custo_unitario ? Number(mov.custo_unitario) : null;
        const { error } = await (supabase as any).rpc("registrar_entrada_material", {
          p_material_id: material.id,
          p_quantidade: qtd,
          // Sem custo informado, o da última compra: entrada a custo zero
          // derrubaria o custo médio e, com ele, a margem de toda peça que usa
          // este material.
          p_custo_unitario: custo ?? Number(material.custo_medio ?? material.custo_unitario ?? 0),
          p_fornecedor: material.fornecedor ?? null,
          p_nota: null,
          p_validade: null,
          p_localizacao: material.localizacao ?? null,
          p_observacao: mov.observacao || mov.motivo || null,
        });
        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any).rpc("registrar_saida_material", {
        p_material_id: material.id,
        p_quantidade: qtd,
        p_motivo: mov.motivo || "saída manual",
        p_observacao: mov.observacao || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimentação registrada");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      qc.invalidateQueries({ queryKey: ["movimentos-materiais"] });
      setMovOpen(false);
      setMov(movVazio);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const contagemPorUnidade = useMemo(() => contarPorUnidade(materiais), [materiais]);

  const filtrados = useMemo(() => {
    const q = normalizarTexto(busca);
    return materiais.filter((m) => {
      if (filtroUnidade && normalizarUnidade(m.unidade) !== filtroUnidade) return false;
      if (!q) return true;
      return (
        normalizarTexto(m.nome).includes(q) ||
        normalizarTexto(m.fornecedor).includes(q) ||
        normalizarTexto(m.caracteristicas).includes(q)
      );
    });
  }, [materiais, busca, filtroUnidade]);

  const kpis = useMemo(() => {
    const valor = materiais.reduce(
      (a, m) => a + Number(m.estoque ?? 0) * Number(m.custo_medio ?? m.custo_unitario ?? 0),
      0,
    );
    const baixo = materiais.filter(
      (m) => Number(m.estoque ?? 0) <= Number(m.estoque_minimo ?? 0),
    ).length;
    let perdaCusto = 0;
    resumoPorMaterial.forEach((r) => (perdaCusto += r.perdaCusto));
    return { valor, baixo, perdaCusto, itens: materiais.length };
  }, [materiais, resumoPorMaterial]);

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/materiais")}
        breadcrumb="Catálogo & Estoque"
        title="Materiais e peças"
        description="Cada entrada atualiza o custo médio; cada saída sai do estoque. O que é consumido em OS entra no custo da ordem e o que vira perda aparece aqui valorizado."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setMov({ ...movVazio, material_id: filtrados[0]?.id ?? "" });
                setMovOpen(true);
              }}
              disabled={materiais.length === 0}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Entrada / saída
            </Button>
            {podeCadastrar && (
              <NeonButton onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" />
                Novo material
              </NeonButton>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Itens cadastrados" value={kpis.itens} icon={Boxes} tone="cyan" />
        <KpiCard
          label="Abaixo do mínimo"
          value={kpis.baixo}
          icon={AlertTriangle}
          tone={kpis.baixo > 0 ? "magenta" : "muted"}
          hint="Repor para não parar a produção"
        />
        {canSeeFinancials && (
          <KpiCard label="Valor em estoque" value={brl(kpis.valor)} icon={Coins} tone="lime" />
        )}
        {canSeeFinancials && (
          <KpiCard
            label="Desperdício acumulado"
            value={brl(kpis.perdaCusto)}
            icon={TrendingDown}
            tone={kpis.perdaCusto > 0 ? "magenta" : "muted"}
            hint="Já lançado no custo das OS"
          />
        )}
      </div>

      {canSeeFinancials && semCustoEmReceita.length > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 px-3 py-2 text-xs text-[color:var(--bex-amber)]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{semCustoEmReceita.length}</strong>{" "}
            {semCustoEmReceita.length === 1 ? "material está" : "materiais estão"} em receita de
            produto sem custo de compra preenchido:{" "}
            <strong>{semCustoEmReceita.map((m) => m.nome).join(", ")}</strong>. O custo dos produtos
            que usam {semCustoEmReceita.length === 1 ? "esse material" : "esses materiais"} fica{" "}
            <strong>congelado no valor digitado à mão</strong> — o sistema se recusa a recalcular
            com material a zero, para não derrubar o preço e a margem. Preencha o custo unitário
            (botão Entrada / saída ou edição do material) para a ficha voltar a mandar.
          </span>
        </div>
      )}

      {/* Filtro por unidade. "m2" e "m²" são a mesma unidade: a contagem já
          junta as grafias. m², un e kg aparecem sempre (pedido do dono). */}
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por unidade">
        <span className="text-xs text-muted-foreground">Unidade:</span>
        <Button
          type="button"
          size="sm"
          variant={filtroUnidade === null ? "default" : "outline"}
          className="h-7 rounded-full px-3 text-xs"
          aria-pressed={filtroUnidade === null}
          onClick={() => setFiltroUnidade(null)}
        >
          Todas · {materiais.length}
        </Button>
        {contagemPorUnidade.map((c) => (
          <Button
            key={c.unidade}
            type="button"
            size="sm"
            variant={filtroUnidade === c.unidade ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            aria-pressed={filtroUnidade === c.unidade}
            disabled={c.total === 0}
            title={c.total === 0 ? `Nenhum material em ${c.unidade}` : undefined}
            onClick={() => setFiltroUnidade(filtroUnidade === c.unidade ? null : c.unidade)}
          >
            {c.unidade} · {c.total}
          </Button>
        ))}
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar material, característica ou fornecedor..."
        rodape={
          <span>
            {filtrados.length === materiais.length
              ? `${materiais.length} material(is)`
              : `${filtrados.length} de ${materiais.length} material(is)`}
          </span>
        }
      >
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {materiais.length === 0
              ? "Nenhum material cadastrado"
              : "Nenhum material com esse filtro."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                {canSeeFinancials && <TableHead className="text-right">Custo unit.</TableHead>}
                {canSeeFinancials && <TableHead className="text-right">Valor parado</TableHead>}
                <TableHead className="text-right">Consumo em OS</TableHead>
                <TableHead className="text-right">Desperdício</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((m) => {
                const r = resumoPorMaterial.get(m.id);
                const estoque = Number(m.estoque ?? 0);
                const minimo = Number(m.estoque_minimo ?? 0);
                const custo = Number(m.custo_medio ?? m.custo_unitario ?? 0);
                const baixo = estoque <= minimo;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.nome}</div>
                      {m.caracteristicas && (
                        <div className="text-xs text-muted-foreground">{m.caracteristicas}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {normalizarUnidade(m.unidade)}
                        {m.fornecedor ? ` · ${m.fornecedor}` : ""}
                        {m.localizacao ? ` · ${m.localizacao}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{num(estoque)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {num(minimo)}
                    </TableCell>
                    {canSeeFinancials && (
                      <TableCell className="text-right font-mono">
                        {custo ? (
                          brl(custo)
                        ) : (usoEmReceita.get(m.id) ?? 0) > 0 ? (
                          <span
                            className="cursor-help text-[color:var(--bex-amber)]"
                            title={`Sem custo de compra, e este material está na receita de ${usoEmReceita.get(m.id)} produto(s). Enquanto ficar assim, o custo desses produtos não é recalculado — vale o valor digitado à mão.`}
                          >
                            sem custo
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    {canSeeFinancials && (
                      <TableCell className="text-right font-mono">{brl(estoque * custo)}</TableCell>
                    )}
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {num(r?.consumoOS ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r?.perdaQtd ? (
                        <span className="text-[color:var(--bex-magenta)]">
                          {num(r.perdaQtd)}
                          {canSeeFinancials && r.perdaCusto > 0 ? ` · ${brl(r.perdaCusto)}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        label={baixo ? "Repor" : "OK"}
                        tone={baixo ? "magenta" : "lime"}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataPanel>

      {/* Novo material */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar material</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="material-nome" className="flex items-center gap-1.5">
                Nome *
                <DicaIcone texto={dicaCampo("/materiais", "Nome *")} rotulo="Nome *" />
              </Label>
              <Input
                id="material-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Lona 440g"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="material-caracteristicas">Características</Label>
              <Textarea
                id="material-caracteristicas"
                rows={2}
                value={form.caracteristicas}
                onChange={(e) => setForm({ ...form, caracteristicas: e.target.value })}
                placeholder="Cor, espessura, gramatura, acabamento, largura da bobina…"
              />
            </div>
            <div className="sm:col-span-2">
              <ConferenciaDeDuplicidade
                nome={form.nome}
                parecidos={parecidos}
                ia={iaAtual}
                conferindo={conferirComIa.isPending}
                podeUsarIa={podeCadastrar}
                onConferirComIa={() => conferirComIa.mutate()}
                onUsarExistente={usarExistente}
                onUsarNome={(nome) => setForm({ ...form, nome })}
              />
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select
                value={form.unidade}
                onValueChange={(v) => setForm({ ...form, unidade: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES_DE_MATERIAL.map((u) => (
                    <SelectItem key={u.valor} value={u.valor}>
                      {u.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estoque inicial</Label>
              <Input
                type="number"
                step="0.01"
                value={form.estoque}
                onChange={(e) => setForm({ ...form, estoque: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Estoque mínimo
                <DicaIcone
                  texto="Abaixo desse número o material aparece como 'Repor'."
                  rotulo="Estoque mínimo"
                />
              </Label>
              <Input
                type="number"
                step="0.01"
                value={form.estoque_minimo}
                onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Input
                value={form.fornecedor}
                onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
              />
            </div>
            {canSeeFinancials && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="flex items-center gap-1.5">
                  Custo unitário (R$)
                  <DicaIcone
                    texto="Custo de compra por unidade. É esse valor que entra no custo da OS e na conta do desperdício."
                    rotulo="Custo unitário"
                  />
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.custo_unitario}
                  onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={salvarMaterial} disabled={!form.nome.trim() || criar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicar material divide o estoque em dois saldos: pergunta antes. */}
      <AlertDialog
        open={confirmarDuplicado !== null}
        onOpenChange={(aberto) => !aberto && setConfirmarDuplicado(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe material parecido</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarDuplicado?.length === 1
                ? `"${confirmarDuplicado[0]}" parece ser o mesmo material.`
                : `${confirmarDuplicado?.map((n) => `"${n}"`).join(", ")} parecem ser o mesmo material.`}{" "}
              Cadastrar outro divide o estoque e o custo em dois. Se for mesmo um material diferente,
              diga a diferença nas características.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e conferir</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmarDuplicado(null);
                criar.mutate();
              }}
            >
              Cadastrar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Entrada / saída */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entrada ou saída de material</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Material *</Label>
              <Select
                value={mov.material_id}
                onValueChange={(v) => setMov({ ...mov, material_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o material" />
                </SelectTrigger>
                <SelectContent>
                  {materiais.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · {num(Number(m.estoque ?? 0))} {m.unidade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={mov.tipo}
                onValueChange={(v) => setMov({ ...mov, tipo: v as MovForm["tipo"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada (compra / devolução)</SelectItem>
                  <SelectItem value="saida">Saída (uso / descarte)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantidade *</Label>
              <Input
                type="number"
                step="0.01"
                value={mov.quantidade}
                onChange={(e) => setMov({ ...mov, quantidade: e.target.value })}
              />
            </div>
            {canSeeFinancials && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Custo unitário (R$)
                  <DicaIcone
                    texto="Na entrada, esse valor recalcula o custo médio do material."
                    rotulo="Custo unitário"
                  />
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={mov.custo_unitario}
                  onChange={(e) => setMov({ ...mov, custo_unitario: e.target.value })}
                  placeholder="deixe vazio para manter o custo atual"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input
                value={mov.motivo}
                onChange={(e) => setMov({ ...mov, motivo: e.target.value })}
                placeholder="compra, ajuste, devolução..."
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observação</Label>
              <Textarea
                rows={2}
                value={mov.observacao}
                onChange={(e) => setMov({ ...mov, observacao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => lancarMov.mutate()}
              disabled={!mov.material_id || lancarMov.isPending}
            >
              {mov.tipo === "entrada" ? (
                <ArrowUpCircle className="mr-2 h-4 w-4" />
              ) : (
                <ArrowDownCircle className="mr-2 h-4 w-4" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
