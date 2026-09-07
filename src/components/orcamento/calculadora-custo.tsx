import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Calculator, Plus, Trash2 } from "lucide-react";
import {
  tempoCorteLaser,
  tempoImpressao,
  tempoMarcacaoFiber,
  tempoRecorte,
  type BaseCobranca,
  type ComplexidadeDecapagem,
  type VelocidadePorMaterial,
} from "@/domain/producao/tempo-de-maquina";
import {
  sincronizarDecapagem,
  type FuncaoMO,
  type LinhaMOSync as LinhaMO,
} from "./decapagem-segue-o-recorte";
import {
  calcularOrcamento,
  type EntradaCalculo,
  type ResultadoCalculo,
} from "@/domain/orcamentos/cost-engine";

type Material = {
  id: string;
  nome: string;
  unidade: string | null;
  custo: number;
};

type LinhaMat = { key: string; material_id: string | null; descricao: string; unidade: string; quantidade: string; custoUnitario: string; perdaPct: string };
/**
 * Linha de processo. Além das horas, guarda o que cada BASE DE COBRANÇA
 * precisa para derivá-las: a impressora quer área; o laser quer material,
 * espessura e traçado; o recorte quer traçado e complexidade da decapagem; a
 * fiber quer peças e área por peça. `memoria` é a conta em português.
 */
type LinhaProc = {
  key: string; maquina_id: string | null; descricao: string; horas: string; custoHora: string; setupMin: string; potenciaKw: string;
  base: BaseCobranca; memoria: string; derivado: boolean;
  /** Material que esta máquina não pode processar: a linha recusa, não pede a hora. */
  vetado: boolean;
  /** Minutos de decapagem e fita quando a base é metro linear; vira linha de mão de obra. */
  maoDeObraMin: string;
  /** Modo de qualidade da impressora — muda a velocidade em 2 a 4 vezes. */
  modoId: string | null;
  material: string; espessuraMm: string; comprimentoM: string; areaGravacaoCm2: string;
  complexidade: ComplexidadeDecapagem; pecas: string; areaPecaCm2: string; rotativo: boolean;
};

const linhaProcVazia = (): Omit<LinhaProc, "key"> => ({
  maquina_id: null, descricao: "", horas: "0", custoHora: "0", setupMin: "0", potenciaKw: "0",
  base: "tempo", memoria: "", derivado: false, vetado: false, maoDeObraMin: "", modoId: null,
  material: "", espessuraMm: "", comprimentoM: "", areaGravacaoCm2: "",
  complexidade: "media", pecas: "1", areaPecaCm2: "", rotativo: false,
});
// LinhaMO vem de decapagem-segue-o-recorte.ts: a linha de mão de obra sabe se
// segue uma linha de recorte e se foi ajustada à mão.

const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

let contador = 0;
const novaKey = () => `l${++contador}`;

export type CalculoAplicado = {
  resultado: ResultadoCalculo;
  parametros: EntradaCalculo & { baseConsumo: number; unidadeBase: string };
};

export function CalculadoraCusto({
  open,
  onOpenChange,
  produtoId,
  quantidade,
  baseConsumo,
  unidadeBase,
  tarifaKwh,
  onAplicar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  produtoId: string | null;
  /** peças do item — divide o custo total para chegar ao custo unitário */
  quantidade: number;
  /** m² cobrados quando o item é vendido por área, senão a própria quantidade */
  baseConsumo: number;
  unidadeBase: string;
  tarifaKwh?: number;
  onAplicar: (calculo: CalculoAplicado) => void;
}) {
  const [materiais, setMateriais] = useState<LinhaMat[]>([]);
  const [processos, setProcessos] = useState<LinhaProc[]>([]);
  const [maoDeObra, setMaoDeObra] = useState<LinhaMO[]>([]);
  const [markupPadrao, setMarkupPadrao] = useState("30");
  const [taxasVenda, setTaxasVenda] = useState("0");
  const [outrosCustos, setOutrosCustos] = useState("0");

  const { data: catalogoMateriais = [] } = useQuery({
    queryKey: ["calc-materiais"],
    enabled: open,
    queryFn: async (): Promise<Material[]> => {
      const { data } = await supabase
        .from("materiais")
        .select("id, nome, unidade, custo_medio, custo_unitario")
        .order("nome");
      return (data ?? []).map((m: any) => ({
        id: m.id,
        nome: m.nome,
        unidade: m.unidade,
        custo: Number(m.custo_medio ?? 0) || Number(m.custo_unitario ?? 0),
      }));
    },
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ["calc-maquinas"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("maquinas")
        .select("id, nome, custo_hora, potencia_kw, setup_min, velocidade_m2_h, base_cobranca, velocidade_mm_s, tempo_minimo_min")
        .eq("ativa", true)
        .order("nome");
      return data ?? [];
    },
  });

  /**
   * Velocidades por material e espessura das máquinas em uso.
   *
   * Um mm/s único por máquina erraria por 8× entre acrílico de 3 mm e de
   * 10 mm — por isso é tabela, e por isso é carregada por máquina.
   */
  const idsMaquinas = processos.map((l) => l.maquina_id).filter(Boolean).join(",");
  const { data: velocidades = [] } = useQuery({
    queryKey: ["calc-velocidades", idsMaquinas],
    enabled: open && idsMaquinas.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_velocidades")
        .select("maquina_id, operacao, material, espessura_mm, velocidade_mm_s, vetado, motivo")
        .in("maquina_id", idsMaquinas.split(","));
      return (data ?? []) as { maquina_id: string; operacao: string; material: string; espessura_mm: number; velocidade_mm_s: number; vetado: boolean; motivo: string | null }[];
    },
  });

  /**
   * Modos de qualidade da impressora.
   *
   * A mesma máquina faz 28 m²/h em rascunho e 7 em alta qualidade. Cobrar
   * sempre pelo modo de produção subestima em 2× o trabalho caprichado — e o
   * caprichado é justamente o que o cliente paga mais caro.
   */
  const { data: modos = [] } = useQuery({
    queryKey: ["calc-modos", idsMaquinas],
    enabled: open && idsMaquinas.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_modos_impressao")
        .select("id, maquina_id, nome, velocidade_m2_h, passadas, padrao, ordem")
        .in("maquina_id", idsMaquinas.split(","))
        .order("ordem");
      return (data ?? []) as { id: string; maquina_id: string; nome: string; velocidade_m2_h: number; passadas: number | null; padrao: boolean; ordem: number }[];
    },
  });

  const modosDe = (maquinaId: string | null) => modos.filter((m) => m.maquina_id === maquinaId);

  const tabelaDe = (maquinaId: string | null, operacao: "corte" | "gravacao"): VelocidadePorMaterial[] =>
    velocidades
      .filter((v) => v.maquina_id === maquinaId && v.operacao === operacao)
      .map((v) => ({
        material: v.material,
        espessuraMm: Number(v.espessura_mm),
        velocidadeMmS: Number(v.velocidade_mm_s),
        vetado: !!v.vetado,
        motivo: v.motivo ?? undefined,
      }));

  /**
   * Deriva as horas da linha pela base de cobrança da máquina.
   *
   * É aqui que "hora cheia num banner de 2 m²" deixa de acontecer: a hora vem
   * da área, do traçado ou das peças, com a conta escrita ao lado. Quando não
   * dá para derivar (sem velocidade, sem material na tabela), a linha diz isso
   * e deixa a hora para digitar — em vez de fingir zero.
   */
  function derivarHoras(l: LinhaProc): Partial<LinhaProc> {
    const maq: any = maquinas.find((m: any) => m.id === l.maquina_id);
    if (!maq) return {};
    const setup = num(l.setupMin);
    if (l.base === "area") {
      // O modo escolhido manda; sem modo cadastrado, a velocidade da máquina.
      const modo = modosDe(l.maquina_id).find((m) => m.id === l.modoId);
      const velocidade = modo ? Number(modo.velocidade_m2_h) : Number(maq.velocidade_m2_h ?? 0);
      const r = tempoImpressao({ areaM2: baseConsumo, velocidadeM2H: velocidade, setupMin: setup });
      const memoria = modo ? `${modo.nome}${modo.passadas ? ` (${modo.passadas} passadas)` : ""}: ${r.memoria}` : r.memoria;
      return r.derivado ? { horas: (r.minutos / 60).toFixed(3), memoria, derivado: true } : { memoria, derivado: false };
    }
    if (l.base === "tempo") {
      const gravacao = tabelaDe(l.maquina_id, "gravacao")[0];
      const r = tempoCorteLaser({
        comprimentoCorteM: num(l.comprimentoM), material: l.material, espessuraMm: num(l.espessuraMm),
        tabela: tabelaDe(l.maquina_id, "corte"),
        areaGravacaoCm2: num(l.areaGravacaoCm2), velocidadeGravacaoMmS: gravacao?.velocidadeMmS,
        setupMin: setup, minimoMin: Number(maq.tempo_minimo_min ?? 0),
      });
      // Material vetado zera a hora: cobrar por um trabalho que não pode ser
      // feito é pior do que não orçar.
      if (r.vetado) return { horas: "0", memoria: r.memoria, derivado: false, vetado: true };
      return r.derivado
        ? { horas: (r.minutos / 60).toFixed(3), memoria: r.memoria, derivado: true, vetado: false }
        : { memoria: r.memoria, derivado: false, vetado: false };
    }
    if (l.base === "metro_linear") {
      const r = tempoRecorte({
        comprimentoCorteM: num(l.comprimentoM), velocidadeMmS: Number(maq.velocidade_mm_s ?? 0),
        areaM2: baseConsumo, complexidade: l.complexidade, setupMin: setup,
      });
      // Só a MÁQUINA entra nesta linha. A decapagem é gente: sai daqui em
      // `maoDeObraMin` e vira uma linha de mão de obra que segue esta (ver
      // decapagem-segue-o-recorte.ts).
      return {
        horas: (r.minutosMaquina / 60).toFixed(3),
        memoria: r.memoria,
        derivado: true,
        maoDeObraMin: String(r.minutosMaoDeObra),
      };
    }
    if (l.base === "peca") {
      const r = tempoMarcacaoFiber({
        pecas: num(l.pecas), areaMarcacaoCm2: num(l.areaPecaCm2), velocidadeMmS: Number(maq.velocidade_mm_s ?? 0),
        setupMin: setup, rotativo: l.rotativo,
      });
      const minutos = Math.max(r.minutos, Number(maq.tempo_minimo_min ?? 0));
      return r.derivado ? { horas: (minutos / 60).toFixed(3), memoria: r.memoria, derivado: true } : { memoria: r.memoria, derivado: false };
    }
    return {};
  }

  // A área do item pode mudar depois da máquina escolhida: recalcula todas.
  //
  // A dependência é uma CHAVE, não o array: `velocidades` vale um `[]` novo a
  // cada render enquanto a query está desligada, e array novo a cada render
  // faria este efeito setar estado a cada render — loop infinito, tela travada.
  const velocidadesKey = velocidades
    .map((v) => `${v.maquina_id}|${v.operacao}|${v.material}|${v.espessura_mm}|${v.velocidade_mm_s}`)
    .join(";");
  const modosKey = modos.map((m) => `${m.maquina_id}|${m.id}|${m.velocidade_m2_h}`).join(";");
  useEffect(() => {
    setProcessos((a) =>
      a.map((l) => {
        if (!l.maquina_id) return l;
        // Modo padrão só entra na linha que ainda não tem modo: se a vendedora
        // escolheu "Alta qualidade", o padrão não pode puxar de volta.
        const modoId = l.modoId ?? modosDe(l.maquina_id).find((m) => m.padrao)?.id ?? null;
        const base = { ...l, modoId, maoDeObraMin: "" };
        return { ...base, ...derivarHoras(base) };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseConsumo, velocidadesKey, modosKey]);

  function atualizarLinha(key: string, patch: Partial<LinhaProc>) {
    setProcessos((a) =>
      a.map((l) => {
        if (l.key !== key) return l;
        const base = { ...l, ...patch };
        // `maoDeObraMin` zera antes de derivar: só o recorte a preenche, e uma
        // linha que troca de máquina não pode carregar a decapagem da anterior.
        return { ...base, maoDeObraMin: "", ...derivarHoras(base) };
      }),
    );
  }

  const { data: funcoes = [] } = useQuery({
    queryKey: ["calc-mao-de-obra"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("custos_mao_de_obra" as any)
        .select("id, funcao, custo_hora, encargos_pct")
        .eq("ativo", true)
        .order("funcao");
      return (data ?? []) as any[];
    },
  });

  // A decapagem segue o recorte: cada linha de máquina cobrada por metro linear
  // tem a sua linha de mão de obra, que nasce, recalcula e some junto com ela.
  // Chave em vez do array pelo mesmo motivo de `velocidadesKey`.
  const funcoesKey = funcoes.map((f: any) => `${f.id}|${f.custo_hora}|${f.encargos_pct}`).join(";");
  useEffect(() => {
    setMaoDeObra((atual) => sincronizarDecapagem(processos, atual, funcoes as FuncaoMO[], novaKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processos, funcoesKey]);

  // Ficha técnica do produto: é o que evita a vendedora ter que lembrar de cor,
  // gramatura e consumo. A quantidade da ficha é POR UNIDADE DE VENDA — para
  // produto vendido em m², a base multiplicadora é a metragem, não a peça.
  const { data: ficha = [] } = useQuery({
    queryKey: ["calc-ficha", produtoId],
    enabled: open && !!produtoId,
    queryFn: async () => {
      const { data } = await supabase
        .from("produto_materiais" as any)
        .select("material_id, quantidade_por_unidade")
        .eq("produto_id", produtoId);
      return (data ?? []) as any[];
    },
  });

  const semCustoHora = maquinas.length > 0 && maquinas.every((m: any) => !Number(m.custo_hora));
  const semMaquina = maquinas.length === 0;
  const semMaoDeObra = funcoes.length === 0;

  // Carrega a ficha uma vez por abertura. Depois disso a lista é do usuário:
  // reaplicar a cada render apagaria o ajuste manual dele.
  useEffect(() => {
    if (!open) return;
    if (ficha.length === 0 || catalogoMateriais.length === 0) return;
    setMateriais((atual) => {
      if (atual.length > 0) return atual;
      return ficha.map((f: any) => {
        const mat = catalogoMateriais.find((m) => m.id === f.material_id);
        return {
          key: novaKey(),
          material_id: f.material_id,
          descricao: mat?.nome ?? "Material",
          unidade: mat?.unidade ?? "un",
          quantidade: String(Number(f.quantidade_por_unidade) * baseConsumo),
          custoUnitario: String(mat?.custo ?? 0),
          perdaPct: "0",
        };
      });
    });
  }, [open, ficha, catalogoMateriais, baseConsumo]);

  useEffect(() => {
    if (!open) {
      setMateriais([]);
      setProcessos([]);
      setMaoDeObra([]);
    }
  }, [open]);

  const entrada: EntradaCalculo = useMemo(
    () => ({
      quantidade: quantidade > 0 ? quantidade : 1,
      materiais: materiais.map((m) => ({
        descricao: m.descricao || "Material",
        quantidade: num(m.quantidade),
        unidade: m.unidade,
        custoUnitario: num(m.custoUnitario),
        perdaPct: Math.min(num(m.perdaPct) / 100, 0.99),
      })),
      // Linha vetada não entra no cálculo: um trabalho que não pode ser feito
      // não tem preço, e deixá-la somar zero esconderia a recusa.
      processos: processos.filter((p) => !p.vetado).map((p) => ({
        descricao: p.descricao || "Processo",
        horas: num(p.horas),
        custoHora: num(p.custoHora),
        setupMin: num(p.setupMin),
        potenciaKw: num(p.potenciaKw),
        tarifaKwh: tarifaKwh ?? 0,
      })),
      maoDeObra: maoDeObra.map((mo) => ({
        descricao: mo.descricao || "Mão de obra",
        horas: num(mo.horas),
        custoHora: num(mo.custoHora),
        encargosPct: num(mo.encargosPct) / 100,
      })),
      outrosCustos: num(outrosCustos),
      taxasVendaPct: num(taxasVenda) / 100,
      markupPadraoPct: num(markupPadrao) / 100,
    }),
    [quantidade, materiais, processos, maoDeObra, outrosCustos, taxasVenda, markupPadrao, tarifaKwh],
  );

  const resultado = useMemo(() => {
    try {
      return calcularOrcamento(entrada);
    } catch {
      return null;
    }
  }, [entrada]);

  const temAlgumaLinha = materiais.length + processos.length + maoDeObra.length > 0;
  const temVetada = processos.some((p) => p.vetado);

  function addMaterial() {
    setMateriais((a) => [
      ...a,
      { key: novaKey(), material_id: null, descricao: "", unidade: "un", quantidade: "0", custoUnitario: "0", perdaPct: "0" },
    ]);
  }
  function addProcesso() {
    setProcessos((a) => [
      ...a,
      { key: novaKey(), ...linhaProcVazia() },
    ]);
  }
  function addMaoDeObra() {
    setMaoDeObra((a) => [
      ...a,
      { key: novaKey(), funcao_id: null, descricao: "", horas: "0", custoHora: "0", encargosPct: "0" },
    ]);
  }

  function escolherMaterial(key: string, materialId: string) {
    const mat = catalogoMateriais.find((m) => m.id === materialId);
    setMateriais((a) =>
      a.map((l) =>
        l.key === key
          ? {
              ...l,
              material_id: materialId,
              descricao: mat?.nome ?? l.descricao,
              unidade: mat?.unidade ?? l.unidade,
              custoUnitario: String(mat?.custo ?? 0),
            }
          : l,
      ),
    );
  }

  function escolherMaquina(key: string, maquinaId: string) {
    const maq: any = maquinas.find((m: any) => m.id === maquinaId);
    atualizarLinha(key, {
      maquina_id: maquinaId,
      descricao: maq?.nome ?? "",
      custoHora: String(maq?.custo_hora ?? 0),
      setupMin: String(maq?.setup_min ?? 0),
      potenciaKw: String(maq?.potencia_kw ?? 0),
      base: (maq?.base_cobranca ?? "tempo") as BaseCobranca,
      // Trocar de máquina troca o modo: o "Alta qualidade" de uma não é o da
      // outra, e um id órfão faria a linha cair na velocidade da máquina.
      modoId: modosDe(maquinaId).find((m) => m.padrao)?.id ?? null,
    });
  }

  function escolherFuncao(key: string, funcaoId: string) {
    const f: any = funcoes.find((x: any) => x.id === funcaoId);
    setMaoDeObra((a) =>
      a.map((l) =>
        l.key === key
          ? {
              ...l,
              funcao_id: funcaoId,
              descricao: f?.funcao ?? l.descricao,
              custoHora: String(f?.custo_hora ?? 0),
              encargosPct: String(Number(f?.encargos_pct ?? 0) * 100),
            }
          : l,
      ),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Calcular custo do item
          </DialogTitle>
          <DialogDescription>
            Materiais, processos e mão de obra viram custo; o markup vira preço. Base de
            consumo deste item:{" "}
            <strong>
              {baseConsumo.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {unidadeBase}
            </strong>
            {quantidade > 1 && ` · ${quantidade} peças`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ------------------------------- MATERIAIS ------------------------------ */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Materiais
                {ficha.length > 0 && (
                  <Badge variant="secondary" className="ml-2 font-normal">
                    ficha técnica do produto
                  </Badge>
                )}
              </h3>
              <Button type="button" size="sm" variant="outline" onClick={addMaterial}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Material
              </Button>
            </div>
            {materiais.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {produtoId
                  ? "Este produto não tem ficha técnica cadastrada — adicione os materiais à mão ou cadastre a ficha em Produtos."
                  : "Escolha um produto no item para carregar a ficha, ou adicione materiais à mão."}
              </p>
            ) : (
              materiais.map((l) => (
                <div key={l.key} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Select value={l.material_id ?? ""} onValueChange={(v) => escolherMaterial(l.key, v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={l.descricao || "Escolher material"} />
                      </SelectTrigger>
                      <SelectContent>
                        {catalogoMateriais.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.nome} · {brl(m.custo)}/{m.unidade ?? "un"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qtd ({l.unidade})</Label>
                    <Input
                      className="h-9 font-mono"
                      type="number"
                      step="0.0001"
                      value={l.quantidade}
                      onChange={(e) =>
                        setMateriais((a) =>
                          a.map((x) => (x.key === l.key ? { ...x, quantidade: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Custo un.</Label>
                    <Input
                      className="h-9 font-mono"
                      type="number"
                      step="0.01"
                      value={l.custoUnitario}
                      onChange={(e) =>
                        setMateriais((a) =>
                          a.map((x) => (x.key === l.key ? { ...x, custoUnitario: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Perda %</Label>
                    <Input
                      className="h-9 font-mono"
                      type="number"
                      step="1"
                      min="0"
                      max="99"
                      value={l.perdaPct}
                      onChange={(e) =>
                        setMateriais((a) =>
                          a.map((x) => (x.key === l.key ? { ...x, perdaPct: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remover ${l.descricao || "material"}`}
                      onClick={() => setMateriais((a) => a.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ------------------------------- PROCESSOS ------------------------------ */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Processos (máquina)</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addProcesso}
                disabled={semMaquina}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Processo
              </Button>
            </div>
            {(semMaquina || semCustoHora) && (
              <Aviso>
                {semMaquina
                  ? "Nenhuma máquina ativa cadastrada — o custo de processo fica de fora do cálculo."
                  : "Nenhuma máquina tem custo/hora preenchido: o processo entraria como R$ 0,00. Preencha em Máquinas para o cálculo valer."}
              </Aviso>
            )}
            {processos.map((l) => (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select value={l.maquina_id ?? ""} onValueChange={(v) => escolherMaquina(l.key, v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={l.descricao || "Escolher máquina"} />
                    </SelectTrigger>
                    <SelectContent>
                      {maquinas.map((m: any) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                          {Number(m.custo_hora) > 0 ? ` · ${brl(Number(m.custo_hora))}/h` : " · sem custo/h"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Horas{l.derivado ? " (calculadas)" : ""}</Label>
                  <Input
                    className={`h-9 font-mono ${l.derivado ? "bg-muted/40" : ""}`}
                    type="number"
                    step="0.001"
                    value={l.horas}
                    onChange={(e) =>
                      setProcessos((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, horas: e.target.value, derivado: false, memoria: "hora digitada à mão" } : x)),
                      )
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Custo/h</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="0.01"
                    value={l.custoHora}
                    onChange={(e) =>
                      setProcessos((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, custoHora: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Setup (min)</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="1"
                    value={l.setupMin}
                    onChange={(e) =>
                      setProcessos((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, setupMin: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover ${l.descricao || "processo"}`}
                    onClick={() => setProcessos((a) => a.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {/* Campos que a base de cobrança da máquina precisa. Aparecem só
                    os da máquina escolhida: laser não pergunta m², fiber não
                    pergunta espessura. */}
                {l.maquina_id && l.base === "tempo" && (
                  <>
                    <div className="col-span-3">
                      <Label className="text-xs">Material</Label>
                      <Select value={l.material} onValueChange={(v) => atualizarLinha(l.key, { material: v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Material" /></SelectTrigger>
                        <SelectContent>
                          {/* Vetado aparece na lista, marcado. Esconder faria a
                              vendedora procurar o material e concluir que
                              faltou cadastrar — e ligar a máquina para ver. */}
                          {[
                            ...new Map(
                              tabelaDe(l.maquina_id, "corte").map((v) => [v.material, v.vetado]),
                            ).entries(),
                          ].map(([m, vetado]) => (
                            <SelectItem key={m} value={m}>
                              {m}
                              {vetado ? " · não pode nesta máquina" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Espessura (mm)</Label>
                      <Input className="h-9 font-mono" type="number" step="0.5" value={l.espessuraMm}
                        onChange={(e) => atualizarLinha(l.key, { espessuraMm: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Traçado de corte (m)</Label>
                      <Input className="h-9 font-mono" type="number" step="0.1" value={l.comprimentoM}
                        placeholder="perímetro total"
                        onChange={(e) => atualizarLinha(l.key, { comprimentoM: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Área gravada (cm²)</Label>
                      <Input className="h-9 font-mono" type="number" step="1" value={l.areaGravacaoCm2}
                        placeholder="0 se só corte"
                        onChange={(e) => atualizarLinha(l.key, { areaGravacaoCm2: e.target.value })} />
                    </div>
                  </>
                )}
                {l.maquina_id && l.base === "area" && modosDe(l.maquina_id).length > 0 && (
                  <div className="col-span-5">
                    <Label className="text-xs">Modo de qualidade</Label>
                    <Select value={l.modoId ?? ""} onValueChange={(v) => atualizarLinha(l.key, { modoId: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Escolher modo" /></SelectTrigger>
                      <SelectContent>
                        {modosDe(l.maquina_id).map((mo) => (
                          <SelectItem key={mo.id} value={mo.id}>
                            {mo.nome} · {Number(mo.velocidade_m2_h).toLocaleString("pt-BR")} m²/h
                            {mo.passadas ? ` (${mo.passadas} passadas)` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {l.maquina_id && l.base === "metro_linear" && (
                  <>
                    <div className="col-span-4">
                      <Label className="text-xs">Traçado de corte (m)</Label>
                      <Input className="h-9 font-mono" type="number" step="0.1" value={l.comprimentoM}
                        onChange={(e) => atualizarLinha(l.key, { comprimentoM: e.target.value })} />
                    </div>
                    <div className="col-span-4">
                      <Label className="text-xs">Decapagem</Label>
                      <Select value={l.complexidade} onValueChange={(v) => atualizarLinha(l.key, { complexidade: v as ComplexidadeDecapagem })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simples">Simples — letras grandes (3 min/m²)</SelectItem>
                          <SelectItem value="media">Média — logos e textos (8 min/m²)</SelectItem>
                          <SelectItem value="detalhada">Detalhada — texto pequeno (20 min/m²)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                {l.maquina_id && l.base === "peca" && (
                  <>
                    <div className="col-span-2">
                      <Label className="text-xs">Peças</Label>
                      <Input className="h-9 font-mono" type="number" step="1" min="0" value={l.pecas}
                        onChange={(e) => atualizarLinha(l.key, { pecas: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Área marcada por peça (cm²)</Label>
                      <Input className="h-9 font-mono" type="number" step="0.5" value={l.areaPecaCm2}
                        onChange={(e) => atualizarLinha(l.key, { areaPecaCm2: e.target.value })} />
                    </div>
                    <div className="col-span-3 flex items-end pb-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={l.rotativo}
                          onChange={(e) => atualizarLinha(l.key, { rotativo: e.target.checked })} />
                        Eixo rotativo (copo, garrafa)
                      </label>
                    </div>
                  </>
                )}
                {l.maquina_id && l.memoria && (
                  // Veto em vermelho e com nome próprio: "não pode" e "falta
                  // cadastrar" saíam na mesma cor, e um deles estraga a máquina.
                  <p
                    className={`col-span-12 text-[11px] ${
                      l.vetado ? "text-destructive font-medium" : l.derivado ? "text-muted-foreground" : "text-amber-600"
                    }`}
                  >
                    {l.vetado ? "Não pode ser feito nesta máquina: " : l.derivado ? "Conta: " : "Atenção: "}
                    {l.memoria}
                  </p>
                )}
                {/* Custo/hora zero é o zero disfarçado clássico: a linha soma
                    R$ 0,00 e parece calculada. O aviso é por LINHA porque o
                    aviso do bloco só aparece quando NENHUMA máquina tem custo. */}
                {l.maquina_id && num(l.custoHora) <= 0 && !l.vetado && (
                  <p className="col-span-12 text-[11px] text-amber-600">
                    Esta máquina está sem custo/hora: o processo entra como R$ 0,00. Preencha em
                    Máquinas (o valor de compra ou a parcela calcula sozinho).
                  </p>
                )}
              </div>
            ))}
          </section>

          {/* ------------------------------ MÃO DE OBRA ----------------------------- */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Mão de obra</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addMaoDeObra}
                disabled={semMaoDeObra}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Função
              </Button>
            </div>
            {semMaoDeObra && (
              <Aviso>
                Nenhuma função cadastrada em Custos de mão de obra — esse bloco fica de fora
                do cálculo.
              </Aviso>
            )}
            {maoDeObra.map((l) => (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select value={l.funcao_id ?? ""} onValueChange={(v) => escolherFuncao(l.key, v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={l.descricao || "Escolher função"} />
                    </SelectTrigger>
                    <SelectContent>
                      {funcoes.map((f: any) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.funcao} · {brl(Number(f.custo_hora ?? 0))}/h
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Horas</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="0.01"
                    value={l.horas}
                    onChange={(e) =>
                      setMaoDeObra((a) =>
                        a.map((x) =>
                          x.key === l.key
                            // Hora mexida à mão numa linha que segue o recorte:
                            // a partir daqui a sincronização não encosta nela.
                            ? { ...x, horas: e.target.value, ajustada: x.segueProcesso ? true : x.ajustada }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Custo/h</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="0.01"
                    value={l.custoHora}
                    onChange={(e) =>
                      setMaoDeObra((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, custoHora: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Encargos %</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="1"
                    value={l.encargosPct}
                    onChange={(e) =>
                      setMaoDeObra((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, encargosPct: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover ${l.descricao || "função"}`}
                    onClick={() => setMaoDeObra((a) => a.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {l.segueProcesso && (
                  <p className={`col-span-12 text-[11px] ${l.funcao_id ? "text-muted-foreground" : "text-amber-600"}`}>
                    {l.ajustada
                      ? `Decapagem e fita do recorte, ajustada à mão: ${Math.round(num(l.horas) * 60)} min.`
                      : `Decapagem e fita do recorte: ${Math.round(num(l.horas) * 60)} min — segue o traçado e a complexidade da linha de máquina.`}
                    {!l.funcao_id && " Escolha quem decapa: sem função, entra a R$ 0."}
                  </p>
                )}
              </div>
            ))}
          </section>

          {/* -------------------------------- FECHAMENTO ---------------------------- */}
          <section className="grid grid-cols-12 gap-2 items-end border-t pt-4">
            <div className="col-span-3">
              <Label className="text-xs">Outros custos (frete, terceiros)</Label>
              <Input
                className="h-9 font-mono"
                type="number"
                step="0.01"
                value={outrosCustos}
                onChange={(e) => setOutrosCustos(e.target.value)}
              />
            </div>
            <div className="col-span-3">
              <Label className="text-xs">Markup padrão %</Label>
              <Input
                className="h-9 font-mono"
                type="number"
                step="1"
                value={markupPadrao}
                onChange={(e) => setMarkupPadrao(e.target.value)}
              />
            </div>
            <div className="col-span-3">
              <Label className="text-xs">Taxas sobre a venda % (imposto, cartão)</Label>
              <Input
                className="h-9 font-mono"
                type="number"
                step="0.1"
                value={taxasVenda}
                onChange={(e) => setTaxasVenda(e.target.value)}
              />
            </div>
          </section>

          {resultado && temAlgumaLinha && (
            <section className="rounded-md border bg-muted/30 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Cifra rotulo="Materiais" valor={resultado.custoMateriais} />
              <Cifra rotulo="Processos" valor={resultado.custoProcessos} />
              <Cifra rotulo="Mão de obra" valor={resultado.custoMaoDeObra} />
              <Cifra rotulo="Custo total" valor={resultado.custoTotal} destaque />
              <Cifra rotulo="Preço sugerido" valor={resultado.precoFinal} destaque />
              <Cifra
                rotulo={`Custo por peça (÷ ${quantidade || 1})`}
                valor={resultado.custoTotal / (quantidade || 1)}
              />
              <Cifra rotulo="Lucro" valor={resultado.lucro} />
              <div>
                <div className="text-xs text-muted-foreground">Margem líquida</div>
                <div
                  className={`font-mono font-semibold ${
                    resultado.margemPct < 0.2 ? "text-destructive" : "text-accent"
                  }`}
                >
                  {pct(resultado.margemPct)}
                </div>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center gap-2">
          {/* Sair daqui com uma linha vetada seria vender um trabalho que a
              oficina não pode fazer. Trave, e diga qual linha. */}
          {temVetada && (
            <p className="text-xs text-destructive mr-auto">
              Tire ou troque a linha em vermelho para aplicar: essa máquina não pode processar esse material.
            </p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!resultado || !temAlgumaLinha || resultado.custoTotal <= 0 || temVetada}
            onClick={() => {
              if (!resultado) return;
              onAplicar({
                resultado,
                parametros: { ...entrada, baseConsumo, unidadeBase },
              });
              onOpenChange(false);
            }}
          >
            Aplicar ao item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function Cifra({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className={`font-mono ${destaque ? "font-semibold text-base" : ""}`}>{brl(valor)}</div>
    </div>
  );
}

