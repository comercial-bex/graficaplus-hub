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
type LinhaProc = { key: string; maquina_id: string | null; descricao: string; horas: string; custoHora: string; setupMin: string; potenciaKw: string };
type LinhaMO = { key: string; funcao_id: string | null; descricao: string; horas: string; custoHora: string; encargosPct: string };

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
        .select("id, nome, custo_hora, potencia_kw, setup_min, velocidade_m2_h")
        .eq("ativa", true)
        .order("nome");
      return data ?? [];
    },
  });

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
      processos: processos.map((p) => ({
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

  function addMaterial() {
    setMateriais((a) => [
      ...a,
      { key: novaKey(), material_id: null, descricao: "", unidade: "un", quantidade: "0", custoUnitario: "0", perdaPct: "0" },
    ]);
  }
  function addProcesso() {
    setProcessos((a) => [
      ...a,
      { key: novaKey(), maquina_id: null, descricao: "", horas: "0", custoHora: "0", setupMin: "0", potenciaKw: "0" },
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
    // Máquina com velocidade cadastrada sabe estimar as horas da própria tarefa:
    // metragem ÷ m²/h. Sem isso a vendedora chutaria o tempo de impressão.
    const horasEstimadas =
      maq && Number(maq.velocidade_m2_h) > 0 && baseConsumo > 0
        ? (baseConsumo / Number(maq.velocidade_m2_h)).toFixed(3)
        : undefined;
    setProcessos((a) =>
      a.map((l) =>
        l.key === key
          ? {
              ...l,
              maquina_id: maquinaId,
              descricao: maq?.nome ?? l.descricao,
              custoHora: String(maq?.custo_hora ?? 0),
              setupMin: String(maq?.setup_min ?? 0),
              potenciaKw: String(maq?.potencia_kw ?? 0),
              horas: horasEstimadas ?? l.horas,
            }
          : l,
      ),
    );
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
                  <Label className="text-xs">Horas</Label>
                  <Input
                    className="h-9 font-mono"
                    type="number"
                    step="0.01"
                    value={l.horas}
                    onChange={(e) =>
                      setProcessos((a) =>
                        a.map((x) => (x.key === l.key ? { ...x, horas: e.target.value } : x)),
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
                        a.map((x) => (x.key === l.key ? { ...x, horas: e.target.value } : x)),
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!resultado || !temAlgumaLinha || resultado.custoTotal <= 0}
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
