import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calculator, Cpu, Package, RotateCw, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { SeletorFilamento, SeletorImpressora } from "@/components/impressao3d/seletores-3d";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { toast } from "sonner";
import {
  calcularPeca3D,
  inputsDoItem3d,
  LIMITES_DA_PECA_3D,
  PRECO_MUDOU_3D,
  resultadosDoItem3d,
  type AvisoDaCotacao3D,
  type EntradasDaPeca3D,
} from "@/domain/impressao3d/calcular-peca";
import { embalagemGravada } from "@/domain/impressao3d/custo-administrativo";
import { cotarPeca3d, salvarPeca3dNoOrcamento } from "@/lib/api/orcamento-3d.functions";
import { lerFilamentos3d, lerImpressoras3d } from "@/lib/supabase-financial-views";
import { Carregando } from "@/components/bex/Carregando";
import { Switch } from "@/components/ui/switch";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela, DICA_PRECO_3D_INCOMPLETO } from "@/lib/dicas";
import { precoPodeAparecer } from "@/domain/impressao3d/preco-pode-aparecer";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { FieldTooltip } from "@/components/bex/FieldTooltip";
import { Dropzone, type DropzoneStatus } from "@/components/bex/Dropzone";
import { runSlicerOcr, parseTempoLivre, formatMinutos } from "@/domain/impressao3d/ocr";
import { PRECO_MINIMO_POR_PECA } from "@/domain/impressao3d/preco";
import {
  BUCKET_DOS_ARQUIVOS_3D,
  caminhoDoArquivo3d,
  descreverFilamento,
} from "@/domain/impressao3d/arquivos";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import { lerArquivoDoFatiador } from "@/lib/api/fatiador.functions";
import { useAuth } from "@/lib/auth-context";
import { DicaIcone } from "@/components/bex/Dica";
import { enviarLayout } from "@/components/orcamento/layouts-do-item";

const num = (v: string, fallback = 0) => {
  // tolera vírgula decimal (pt-BR): "6,52" -> 6.52, sem quebrar "1.375".
  let s = String(v ?? "").trim();
  if (s.includes(",")) {
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const money = (v: any) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Campo do OCR deixado em branco é "não sei", não zero: 0% de preenchimento existe. */
const numOuNulo = (v: string) => (String(v ?? "").trim() === "" ? null : num(v));

const vezes = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;

/**
 * A frase de quando o servidor não devolve o preço (onda C, 11/11/2026). Falha de cotação nunca vira o preço
 * anterior nem número de fábrica: a tela diz que falhou e não deixa salvar.
 */
const FALHA_DA_COTACAO_3D =
  "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.";

/** Os avisos do servidor dizem só que um cadastro está zerado, nunca o valor. */
const TEXTO_DO_AVISO: Record<AvisoDaCotacao3D, string> = {
  impressora_sem_custo_hora:
    "A impressora escolhida está sem custo por hora no cadastro. Peça à gerência para corrigir antes de enviar este preço.",
  impressora_sem_potencia:
    "A impressora escolhida está sem potência no cadastro: a energia ficou fora do preço. Avise a gerência.",
  filamento_sem_custo:
    "O filamento escolhido está sem custo no cadastro: o material ficou fora do preço. Avise a gerência.",
};

/** O valor só muda depois de `ms` sem mudar (a cotação espera a pessoa parar de digitar). */
function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

/** O que quem não vê custo manda ao servidor: só a peça, nunca taxa, preço ou markup (contrato de `cotarPeca3d`). */
type EntradasDaCotacao3D = {
  maquinaId: string;
  materialId: string;
  gramasModelo: number;
  pesoSuporteG: number;
  pesoPurgaG: number;
  tempoMinutos: number;
  quantidade: number;
  pecasPorPlaca: number;
};

/**
 * Confere a peça com os mesmos limites do servidor, para a mensagem sair aqui e não depois da espera.
 * Devolve a frase do primeiro problema, ou nulo.
 */
function problemaDaPeca(e: EntradasDaCotacao3D): string | null {
  const L = LIMITES_DA_PECA_3D;
  const fora = (v: number, lim: { min: number; max: number }) => !(v >= lim.min && v <= lim.max);
  const br = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  if (!Number.isInteger(e.quantidade) || fora(e.quantidade, L.quantidade))
    return `A quantidade deve ser um número inteiro, de ${br(L.quantidade.min)} a ${br(L.quantidade.max)}.`;
  if (!Number.isInteger(e.pecasPorPlaca) || fora(e.pecasPorPlaca, L.pecasPorPlaca))
    return `Peças na placa deve ser um número inteiro, de ${br(L.pecasPorPlaca.min)} a ${br(L.pecasPorPlaca.max)}.`;
  if (fora(e.gramasModelo, L.gramasModelo))
    return `O peso do modelo deve ficar entre ${br(L.gramasModelo.min)} g e ${br(L.gramasModelo.max)} g.`;
  if (fora(e.pesoSuporteG, L.pesoSuporteG))
    return `O peso do suporte deve ficar entre ${br(L.pesoSuporteG.min)} g e ${br(L.pesoSuporteG.max)} g.`;
  if (fora(e.pesoPurgaG, L.pesoPurgaG))
    return `O peso da purga deve ficar entre ${br(L.pesoPurgaG.min)} g e ${br(L.pesoPurgaG.max)} g.`;
  if (!Number.isInteger(e.tempoMinutos) || fora(e.tempoMinutos, L.tempoMinutos))
    return "O tempo de impressão deve ficar entre 1 minuto e 1 ano.";
  return null;
}

/** Os campos do formulário que entram na conta (tudo texto, como a tela guarda). */
type CamposDaConta3D = Pick<
  FormState,
  | "quantidade"
  | "gramas"
  | "peso_suporte"
  | "peso_purga"
  | "pecas_placa"
  | "custo_hora"
  | "potencia_w"
  | "tarifa_kwh"
  | "mo_custo_hora"
  | "mo_horas"
  | "pct_acabamento"
  | "pct_falha"
  | "custo_admin"
  | "markup"
>;

/**
 * Do formulário de quem vê custo para as entradas de `calcularPeca3D`, do mesmo jeito que a conta inline lia até
 * 11/11/2026 (`num(f.quantidade, 1)`, `num(f.markup, 2)`, custo por grama da lista, markup de atacado da base).
 * A normalização `|| 1`, `|| 2` e `|| 1,5` é do módulo. `tests/custo-3d-pela-visao.test.ts` compara, campo a campo,
 * esta tradução mais o módulo com a conta antiga.
 */
export function entradasDaContaNaTela(a: {
  f: CamposDaConta3D;
  tempoMinutos: number;
  custoPorGramaCalculado: unknown;
  embalagemIncluida: boolean;
  markupAtacadoPadrao: unknown;
}): EntradasDaPeca3D {
  const { f } = a;
  return {
    gramasModelo: num(f.gramas),
    pesoSuporteG: num(f.peso_suporte),
    pesoPurgaG: num(f.peso_purga),
    tempoMinutos: a.tempoMinutos,
    quantidade: num(f.quantidade, 1),
    pecasPorPlaca: num(f.pecas_placa, 1),
    moHoras: num(f.mo_horas),
    embalagemIncluida: a.embalagemIncluida,
    custoPorGrama: Number(a.custoPorGramaCalculado ?? 0),
    custoHoraMaquina: num(f.custo_hora),
    potenciaW: num(f.potencia_w),
    tarifaKwh: num(f.tarifa_kwh),
    moCustoHora: num(f.mo_custo_hora),
    embalagemValor: num(f.custo_admin),
    pctAcabamento: num(f.pct_acabamento),
    pctFalha: num(f.pct_falha),
    markup: num(f.markup, 2),
    markupAtacado: Number(a.markupAtacadoPadrao ?? 1.5),
  };
}

type FormState = {
  cliente_id: string;
  contato_nome: string;
  contato_telefone: string;
  contato_email: string;
  titulo: string;
  quantidade: string;
  maquina_id: string;
  material_id: string;
  gramas: string;
  tempo: string; // livre: "2h 15m", "2:15", "135"
  custo_hora: string;
  potencia_w: string;
  peso_suporte: string;
  peso_purga: string;
  pecas_placa: string;
  filamento_tipo_detectado: string;
  altura_camada: string;
  infill_pct: string;
  tarifa_kwh: string;
  mo_custo_hora: string;
  mo_horas: string;
  pct_acabamento: string;
  pct_falha: string;
  custo_admin: string;
  markup: string;
};

const PRESETS: {
  id: string;
  label: string;
  tone: "cyan" | "magenta" | "lime" | "amber";
  patch: Partial<FormState>;
}[] = [
  {
    id: "varejo",
    label: "Varejo padrão",
    tone: "cyan",
    patch: { markup: "2", pct_falha: "5", pct_acabamento: "5", mo_custo_hora: "40" },
  },
  {
    id: "atacado",
    label: "Atacado",
    tone: "lime",
    patch: { markup: "1.4", pct_falha: "3", pct_acabamento: "2", mo_custo_hora: "30" },
  },
  {
    id: "pintada",
    label: "Peça pintada",
    tone: "magenta",
    patch: { markup: "2.3", pct_acabamento: "12", mo_custo_hora: "50", pct_falha: "5" },
  },
  {
    id: "prototipo",
    label: "Protótipo rápido",
    tone: "amber",
    patch: { markup: "1.8", pct_falha: "10", pct_acabamento: "0", mo_custo_hora: "35" },
  },
];

export type ResultadoDaCalculadora3d = { orcamentoId: string; orcamento3dId: string; itemId: string };

/**
 * A calculadora de peça 3D (27/10/2026), a mesma em dois lugares:
 *   * `modo="embutido"`: dentro do orçamento comum, como um item — recebe o orçamento e o
 *     cliente de fora, não pergunta de novo, e ao salvar grava a peça E o item num ato só
 *     (`salvar_item_3d_no_orcamento`). Com `orcamento3dId`, reabre preenchida para editar.
 *   * `modo="novo-orcamento"`: a porta antiga (/orcamento-3d-novo): cria o orçamento comum
 *     antes e cai no mesmo caminho, para a pessoa terminar em /orcamentos como sempre.
 */
export function Calculadora3D({
  modo,
  orcamentoId,
  clienteId,
  orcamento3dId = null,
  onSalvo,
  onCancelar,
}: {
  modo: "embutido" | "novo-orcamento";
  orcamentoId: string | null;
  clienteId: string | null;
  orcamento3dId?: string | null;
  onSalvo: (r: ResultadoDaCalculadora3d) => void;
  onCancelar?: () => void;
}) {
  const embutido = modo === "embutido";
  // A mesma régua da tela do orçamento salvo: custo, lucro, margem e os
  // parâmetros de custo são de quem tem impressao3d.cost.read. O vendedor
  // cota e vê o preço — o que vai para o cliente.
  const { hasPermission } = useAuth();
  const podeVerCusto = hasPermission("impressao3d.cost.read");

  const [f, setF] = useState<FormState>({
    cliente_id: "",
    contato_nome: "",
    contato_telefone: "",
    contato_email: "",
    titulo: "",
    quantidade: "1",
    maquina_id: "",
    material_id: "",
    gramas: "",
    tempo: "",
    custo_hora: "",
    potencia_w: "",
    peso_suporte: "",
    peso_purga: "",
    pecas_placa: "",
    filamento_tipo_detectado: "",
    altura_camada: "",
    infill_pct: "",
    tarifa_kwh: "0.95",
    mo_custo_hora: "40",
    mo_horas: "0",
    pct_acabamento: "5",
    pct_falha: "5",
    custo_admin: "0",
    markup: "2",
  });
  // Campos que o usuário (ou um preset) já tocou — a configuração salva só
  // preenche o que ainda está intocado, em vez de comparar com literais.
  const tocados = useRef<Set<keyof FormState>>(new Set());
  const set = (k: keyof FormState, v: string) => {
    tocados.current.add(k);
    setF((s) => ({ ...s, [k]: v }));
  };
  // Embalagem é opcional e separada: desligada por padrão; a configuração só sugere o valor.
  const [embalagemIncluida, setEmbalagemIncluida] = useState(false);
  const patch = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));
  const aplicarPreset = (p: Partial<FormState>) => {
    (Object.keys(p) as (keyof FormState)[]).forEach((k) => tocados.current.add(k));
    patch(p);
  };

  // aplica último preset salvo. Preset é escolha de quem vê custo: no ramo sem custo ele nem entra (o servidor
  // cota com a base da gráfica). Antes, o preset que o gestor escolheu num computador valia para o vendedor no
  // mesmo computador.
  const [presetAtivo, setPresetAtivo] = useState<string | null>(null);
  useEffect(() => {
    if (!podeVerCusto || typeof window === "undefined") return;
    let id: string | null = null;
    try {
      id = localStorage.getItem("bex.orc3d.preset");
    } catch {
      return;
    }
    if (!id) return;
    const p = PRESETS.find((x) => x.id === id);
    if (p) {
      aplicarPreset(p.patch);
      setPresetAtivo(p.id);
    }
  }, [podeVerCusto]);

  const [fotoModelo, setFotoModelo] = useState<File | null>(null);
  const [slicerFile, setSlicerFile] = useState<File | null>(null);
  // O .3mf/.gcode sobe na hora da leitura; ao salvar, o mesmo caminho é reaproveitado.
  const [slicerSubidoPath, setSlicerSubidoPath] = useState<string | null>(null);
  const [ocr, setOcr] = useState<DropzoneStatus>({ kind: "idle" });

  async function processSlicer(file: File | null) {
    setSlicerFile(file);
    setSlicerSubidoPath(null);
    setOcr({ kind: "idle" });
    if (!file) return;
    // Arquivo do fatiador (.3mf / .gcode): o servidor lê peso e tempo de DENTRO do arquivo —
    // o número exato, sem o OCR errar vírgula (27/10/2026).
    if (/\.(3mf|gcode)$/i.test(file.name)) {
      setOcr({ kind: "loading", label: "Lendo o arquivo…" });
      try {
        const path = caminhoDoArquivo3d("slicer", file.name);
        const { error } = await supabase.storage.from(BUCKET_DOS_ARQUIVOS_3D).upload(path, file);
        if (error) throw error;
        setSlicerSubidoPath(path);
        const r = await lerArquivoDoFatiador({ data: { caminho: path } });
        const achou: string[] = [];
        if (r.totalWeightG) {
          set("gramas", String(r.totalWeightG));
          achou.push(`${r.totalWeightG.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g`);
        }
        if (r.totalTimeSeconds) {
          const min = Math.round(r.totalTimeSeconds / 60);
          set("tempo", formatMinutos(min));
          achou.push(formatMinutos(min));
        }
        if (r.plates.length > 1) achou.push(`${r.plates.length} placas somadas`);
        setOcr(
          achou.length
            ? { kind: "ok", label: `${achou.join(" · ")} · lido do arquivo` }
            : { kind: "error", label: "Arquivo sem peso e tempo — preencha manualmente" },
        );
      } catch (e) {
        setOcr({ kind: "error", label: mensagemErro(e, "Não li o arquivo — preencha manualmente") });
      }
      return;
    }
    setOcr({ kind: "loading", label: "Lendo…" });
    try {
      const r = await runSlicerOcr(file);
      const achou: string[] = [];
      if (r.gramas) {
        set("gramas", String(r.gramas));
        achou.push(`${r.gramas} g`);
      }
      if (r.minutos !== undefined) {
        set("tempo", formatMinutos(r.minutos));
        achou.push(formatMinutos(r.minutos));
      }
      if (r.pesoSuporteG !== undefined) set("peso_suporte", String(r.pesoSuporteG));
      if (r.pesoPurgaG !== undefined) set("peso_purga", String(r.pesoPurgaG));
      if (r.pecasPorPlaca !== undefined) set("pecas_placa", String(r.pecasPorPlaca));
      if (r.filamentoTipo) set("filamento_tipo_detectado", r.filamentoTipo);
      if (r.alturaCamadaMm !== undefined) set("altura_camada", String(r.alturaCamadaMm));
      if (r.infillPct !== undefined) set("infill_pct", String(r.infillPct));
      if (achou.length) {
        setOcr({ kind: "ok", label: achou.join(" · ") });
      } else {
        setOcr({ kind: "error", label: "Preencha manualmente" });
      }
    } catch {
      setOcr({ kind: "error", label: "OCR falhou — preencha manualmente" });
    }
  }

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-sel"],
    queryFn: async () =>
      (await supabase.from("clientes").select("id, nome").order("nome")).data ?? [],
  });
  // Impressoras e filamentos pelo nível de quem olha (onda C, 11/11/2026). Quem vê custo lê as visões
  // *_financeiro (custo por hora, potência e custo por grama) e calcula aqui; os demais leem só as colunas abertas
  // e o preço vem do servidor. Falha de leitura aparece como falha, nunca como "nenhuma impressora".
  const listaDeImpressoras = useQuery({
    queryKey: ["impressoras-sel", podeVerCusto],
    queryFn: async () => {
      const { data, error } = await lerImpressoras3d(podeVerCusto).eq("ativa", true);
      if (error) throw error;
      const linhas = (data ?? []) as any[];
      // A visão traz o nome solto; o seletor lê `maquinas?.nome`.
      return podeVerCusto ? linhas.map((l) => ({ ...l, maquinas: { nome: l.nome } })) : linhas;
    },
  });
  const listaDeFilamentos = useQuery({
    queryKey: ["filamentos-sel", podeVerCusto],
    queryFn: async () => {
      const { data, error } = await lerFilamentos3d(podeVerCusto);
      if (error) throw error;
      const linhas = (data ?? []) as any[];
      return podeVerCusto ? linhas.map((l) => ({ ...l, materiais: { nome: l.nome } })) : linhas;
    },
  });
  const impressoras: any[] = listaDeImpressoras.data ?? [];
  const filamentos: any[] = listaDeFilamentos.data ?? [];

  // Base de precificação 3D: preenche todo campo que o usuário ainda não tocou.
  // A tarifa de energia sempre vem da conta de luz cadastrada em /configuracoes-3d.
  // Só quem vê custo a lê: para os demais o servidor lê e só o preço volta.
  const {
    data: configPrec,
    isError: configErro,
    isPending: configPendente,
    isFetching: configBuscando,
    refetch: lerConfigDeNovo,
  } = useQuery({
    queryKey: ["config-precificacao-3d"],
    enabled: podeVerCusto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("config_precificacao_3d")
        .select(
          "tarifa_kwh_padrao, mo_custo_hora_padrao, markup_padrao, markup_atacado_padrao, pct_acabamento_padrao, pct_falha_padrao, custo_admin_padrao",
        )
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // A linha que não chega (erro, ou filtrada pela policy, ou nunca cadastrada) não é "use os números de fábrica":
  // a tela avisa em voz alta e não deixa salvar.
  const baseDePreco: "carregando" | "ok" | "falhou" | "vazia" = !podeVerCusto
    ? "ok"
    : configErro
      ? "falhou"
      : configPendente
        ? "carregando"
        : configPrec
          ? "ok"
          : "vazia";
  const [vindoDaConfig, setVindoDaConfig] = useState<Set<string>>(new Set());
  useEffect(() => {
    const c = configPrec;
    if (!c) return;
    const mapa: [keyof FormState, unknown][] = [
      ["tarifa_kwh", c.tarifa_kwh_padrao],
      ["mo_custo_hora", c.mo_custo_hora_padrao],
      ["markup", c.markup_padrao],
      ["pct_acabamento", c.pct_acabamento_padrao],
      ["pct_falha", c.pct_falha_padrao],
    ];
    const aplicados = new Set<string>();
    setF((s) => {
      const n2 = { ...s };
      for (const [k, v] of mapa) {
        if (v == null || tocados.current.has(k)) continue;
        n2[k] = String(v);
        aplicados.add(k);
      }
      return n2;
    });
    setVindoDaConfig(aplicados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configPrec]);

  // Reabrir uma peça gravada (edição): o banco devolve o que a calculadora precisa; os
  // parâmetros de custo só vêm para quem pode ver custo (os demais cotam com a base da gráfica).
  const [fotoAtualUrl, setFotoAtualUrl] = useState<string | null>(null);
  const [slicerAtualPath, setSlicerAtualPath] = useState<string | null>(null);
  const pecaGravada = useQuery({
    queryKey: ["ler-item-3d", orcamento3dId],
    enabled: !!orcamento3dId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("ler_item_3d", { p_orcamento_3d_id: orcamento3dId });
      if (error) throw error;
      return data as Record<string, any>;
    },
  });
  useEffect(() => {
    const p = pecaGravada.data;
    if (!p) return;
    const seg = Number(p.tempo_segundos ?? 0);
    const ci = (p.custo_inputs ?? {}) as Record<string, any>;
    const texto = (v: unknown) => (v == null || v === "" ? "" : String(v));
    const patchGravado: Partial<FormState> = {
      titulo: texto(p.titulo),
      quantidade: texto(p.quantidade) || "1",
      maquina_id: texto(p.maquina_id),
      material_id: texto(p.material_id),
      gramas: texto(p.gramas),
      tempo: seg > 0 ? formatMinutos(Math.round(seg / 60)) : "",
      peso_suporte: Number(p.peso_suporte_g ?? 0) > 0 ? texto(p.peso_suporte_g) : "",
      peso_purga: Number(p.peso_purga_g ?? 0) > 0 ? texto(p.peso_purga_g) : "",
      pecas_placa: Number(p.pecas_por_placa ?? 1) > 1 ? texto(p.pecas_por_placa) : "",
      filamento_tipo_detectado: texto(p.filamento_tipo_detectado),
      altura_camada: texto(p.altura_camada_mm),
      infill_pct: texto(p.infill_pct),
    };
    if (ci.custo_hora_maquina != null) patchGravado.custo_hora = texto(ci.custo_hora_maquina);
    if (ci.potencia_w != null) patchGravado.potencia_w = texto(ci.potencia_w);
    if (ci.tarifa_kwh != null) patchGravado.tarifa_kwh = texto(ci.tarifa_kwh);
    if (ci.mao_obra?.custo_hora != null) patchGravado.mo_custo_hora = texto(ci.mao_obra.custo_hora);
    if (ci.mao_obra?.horas != null) patchGravado.mo_horas = texto(ci.mao_obra.horas);
    if (ci.pct_acabamento != null) patchGravado.pct_acabamento = texto(ci.pct_acabamento);
    if (ci.pct_falha != null) patchGravado.pct_falha = texto(ci.pct_falha);
    const emb = embalagemGravada(ci);
    setEmbalagemIncluida(emb.incluida);
    patchGravado.custo_admin = emb.incluida ? texto(emb.valor) : "0";
    if (ci.markup != null) patchGravado.markup = texto(ci.markup);
    aplicarPreset(patchGravado);
    setSlicerAtualPath(typeof p.slicer_screenshot === "string" ? p.slicer_screenshot : null);
    if (typeof p.foto_modelo_path === "string" && p.foto_modelo_path) {
      supabase.storage
        .from(BUCKET_DOS_ARQUIVOS_3D)
        .createSignedUrl(p.foto_modelo_path, 600)
        .then(({ data }) => setFotoAtualUrl(data?.signedUrl ?? null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pecaGravada.data]);

  const impressora = impressoras.find((m: any) => m.maquina_id === f.maquina_id);
  const filamento = filamentos.find((m: any) => m.material_id === f.material_id);

  // Ao trocar de impressora, puxa custo-hora e potência para campos editáveis.
  // Evita sub-precificar em silêncio quando a impressora não tem custo-hora.
  // Só para quem vê custo: no ramo sem custo essas colunas nem chegam ao navegador (o servidor as lê).
  useEffect(() => {
    if (!podeVerCusto || !impressora) return;
    setF((s) => ({
      ...s,
      custo_hora: String(Number(impressora.custo_hora_calculado ?? 0)),
      potencia_w: String(Number(impressora.potencia_media_w ?? 0)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.maquina_id, podeVerCusto]);

  const tempoMinutos = parseTempoLivre(f.tempo) ?? 0;
  const tempoHoras = tempoMinutos / 60;

  // A conta é uma só (src/domain/impressao3d/calcular-peca.ts), a mesma que o servidor roda para quem não vê
  // custo. Aqui ela só roda para quem vê custo, com as taxas das visões e o que estiver no cartão de custo.
  const entradasDaConta = useMemo(
    () =>
      entradasDaContaNaTela({
        f,
        tempoMinutos,
        custoPorGramaCalculado: filamento?.custo_por_grama_calculado,
        embalagemIncluida,
        markupAtacadoPadrao: configPrec?.markup_atacado_padrao,
      }),
    [f, tempoMinutos, filamento, configPrec, embalagemIncluida],
  );
  const calc = useMemo(
    () => (podeVerCusto ? calcularPeca3D(entradasDaConta) : null),
    [podeVerCusto, entradasDaConta],
  );

  // Sem os quatro dados do custo, nenhum valor aparece: o cálculo segue igual por baixo.
  const mostraPreco = precoPodeAparecer({
    maquinaId: f.maquina_id,
    materialId: f.material_id,
    gramas: num(f.gramas),
    tempoMinutos,
  });

  // ---- Ramo sem custo: o preço vem do servidor (cotarPeca3d) ----
  // O navegador manda só a peça; o servidor lê as taxas com a chave de serviço, roda a mesma conta e devolve o
  // preço. Espera 400 ms depois de a pessoa parar de digitar, e nunca mostra o preço anterior como se fosse o atual.
  const entradasDaCotacao: EntradasDaCotacao3D = {
    maquinaId: f.maquina_id,
    materialId: f.material_id,
    gramasModelo: num(f.gramas),
    pesoSuporteG: num(f.peso_suporte),
    pesoPurgaG: num(f.peso_purga),
    tempoMinutos,
    quantidade: num(f.quantidade, 1) || 1,
    pecasPorPlaca: num(f.pecas_placa, 1) || 1,
  };
  const chaveDaCotacao = JSON.stringify(entradasDaCotacao);
  const chaveAtrasada = useAtrasado(chaveDaCotacao, 400);
  const problemaDaCotacao = !podeVerCusto && mostraPreco ? problemaDaPeca(entradasDaCotacao) : null;
  const cotavel = !podeVerCusto && mostraPreco && !problemaDaCotacao;
  const esperandoDigitar = chaveAtrasada !== chaveDaCotacao;
  const cotacao = useQuery({
    queryKey: ["cotar-peca-3d", chaveAtrasada],
    enabled: cotavel && !esperandoDigitar,
    queryFn: () => cotarPeca3d({ data: JSON.parse(chaveAtrasada) as EntradasDaCotacao3D }),
    retry: 1,
    staleTime: 30_000,
  });
  // Só vale a cotação das entradas de AGORA: digitou de novo, some até a nova chegar.
  const cotacaoAtual = cotavel && !esperandoDigitar && cotacao.isSuccess ? cotacao.data : null;
  const cotacaoFalhou = cotavel && !esperandoDigitar && cotacao.isError;
  const cotando = cotavel && !cotacaoAtual && !cotacaoFalhou;

  // O que o cartão de resultado mostra, venha de onde vier.
  const resumo = calc
    ? {
        preco: calc.preco.toNumber(),
        unitario: calc.unitario.toNumber(),
        qtd: calc.qtd,
        placas: calc.placas,
        peloMinimo: calc.peloMinimo,
      }
    : cotacaoAtual
      ? {
          preco: cotacaoAtual.preco,
          unitario: cotacaoAtual.unitario,
          qtd: cotacaoAtual.quantidade,
          placas: cotacaoAtual.placas,
          peloMinimo: cotacaoAtual.peloMinimo,
        }
      : null;
  const qtdNoTitulo = resumo?.qtd ?? (num(f.quantidade, 1) || 1);
  // Salvar só com preço de verdade: quem vê custo, com a base de preço lida; os demais, com a cotação de agora.
  const precoPronto = podeVerCusto ? baseDePreco === "ok" : !!cotacaoAtual;

  const faltando: string[] = [];
  if (!f.titulo) faltando.push("título");
  if (!f.maquina_id) faltando.push("impressora");
  if (!f.material_id) faltando.push("filamento");
  if (num(f.gramas) <= 0) faltando.push("peso");
  // Sem tempo, `machineCost` e `energyCost` devolvem zero e o orçamento sai sem
  // custo de máquina nem de energia — a hora de impressora vira brinde, e nada
  // na tela avisa. Foi o que aconteceu no primeiro orçamento real do sistema.
  if (tempoMinutos <= 0) faltando.push("tempo de impressão");

  const salvar = useMutation({
    mutationFn: async (): Promise<ResultadoDaCalculadora3d> => {
      if (faltando.length) throw new Error(`Faltando: ${faltando.join(", ")}`);

      // Porta antiga: o orçamento comum nasce aqui, com o cliente ou o contato digitado.
      let orcId = orcamentoId;
      if (!orcId) {
        if (!f.cliente_id && !f.contato_nome.trim()) {
          throw new Error("Escolha o cliente ou escreva o nome do contato.");
        }
        const { data: criado, error: erroOrc } = await (supabase as any)
          .from("orcamentos")
          .insert({
            cliente_id: f.cliente_id || null,
            contato_nome: f.cliente_id ? null : f.contato_nome.trim(),
            contato_telefone: f.cliente_id ? null : f.contato_telefone.trim() || null,
            contato_email: f.cliente_id ? null : f.contato_email.trim() || null,
            titulo: f.titulo.trim(),
            valor_total: 0,
            valor_subtotal: 0,
          })
          .select("id")
          .single();
        if (erroOrc) throw erroOrc;
        orcId = (criado as { id: string }).id;
      }

      // Print do fatiador: fica com o cálculo (só quem vê custo abre).
      let slicerPath: string | null = null;
      const ts = Date.now();
      if (slicerFile) {
        if (slicerSubidoPath) {
          slicerPath = slicerSubidoPath; // o .3mf/.gcode já subiu quando foi lido
        } else {
          const path = caminhoDoArquivo3d("slicer", slicerFile.name, ts);
          const { error } = await supabase.storage.from(BUCKET_DOS_ARQUIVOS_3D).upload(path, slicerFile);
          if (error) throw error;
          slicerPath = path;
        }
      }
      // Foto do modelo: entra como arte do item (capa): sai no PDF, no link do cliente e na OS.
      let fotoArquivoId: string | null = null;
      if (fotoModelo) {
        const r = await enviarLayout(fotoModelo, orcId, clienteId ?? (f.cliente_id || null));
        fotoArquivoId = r.id;
      }

      // Quem NÃO vê custo: o servidor refaz a conta com as taxas do banco e grava pela mesma função do banco, com a
      // sessão de quem salva. O navegador não manda preço nem custo; o preço que a tela mostrou só é conferido.
      if (!podeVerCusto) {
        if (!cotacaoAtual) throw new Error(FALHA_DA_COTACAO_3D);
        const r = await salvarPeca3dNoOrcamento({
          data: {
            ...(JSON.parse(chaveDaCotacao) as EntradasDaCotacao3D),
            orcamentoId: orcId,
            orcamento3dId,
            titulo: f.titulo.trim(),
            filamentoTipoDetectado: f.filamento_tipo_detectado || null,
            alturaCamadaMm: numOuNulo(f.altura_camada),
            infillPct: numOuNulo(f.infill_pct),
            slicerScreenshot: slicerPath ?? slicerAtualPath,
            fotoArquivoId,
            clienteId: clienteId ?? (f.cliente_id || null),
            precoVisto: cotacaoAtual.preco,
          },
        });
        return { orcamentoId: r.orcamentoId, orcamento3dId: r.orcamento3dId, itemId: r.itemId };
      }

      // Quem vê custo: a conta é a do navegador (as taxas vieram das visões) e grava pela função do banco, como
      // sempre. O formato gravado é o mesmo do servidor (os construtores moram no módulo da conta).
      if (!calc || baseDePreco !== "ok") throw new Error("A base de preço 3D não chegou. Avise a gerência.");
      const horasTotais = tempoHoras;
      const inputs = inputsDoItem3d(entradasDaConta, calc, {
        clienteId: clienteId ?? f.cliente_id ?? null,
        filamentoTipoDetectado: f.filamento_tipo_detectado || null,
        alturaCamadaMm: numOuNulo(f.altura_camada),
        infillPct: numOuNulo(f.infill_pct),
        slicerScreenshot: slicerPath ?? slicerAtualPath,
        impressora: impressora?.maquinas?.nome ?? null,
        filamento: filamento?.materiais?.nome ?? null,
      });
      const resultados = resultadosDoItem3d(entradasDaConta, calc);

      const { data, error } = await (supabase.rpc as any)("salvar_item_3d_no_orcamento", {
        p_orcamento_id: orcId,
        p_orcamento_3d_id: orcamento3dId,
        p_titulo: f.titulo.trim(),
        p_quantidade: calc.qtd,
        p_maquina_id: f.maquina_id,
        p_material_id: f.material_id,
        p_gramas: num(f.gramas),
        p_tempo_segundos: Math.round(horasTotais * 3600),
        p_custo_por_grama: calc.cpg,
        p_inputs: inputs,
        p_resultados: resultados,
        p_custo_material: calc.material.toNumber(),
        p_custo_maquina: calc.maquina.toNumber(),
        p_custo_energia: calc.energia.toNumber(),
        p_custo_mao_obra: calc.maoDeObra.toNumber(),
        p_custo_acabamento: calc.acabamento.toNumber(),
        p_custo_risco: calc.risco.toNumber(),
        p_custo_indireto: calc.indireto.toNumber(),
        p_custo_operacional: calc.operacional.toNumber(),
        p_preco: calc.preco.toNumber(),
        p_markup: num(f.markup, 2),
        p_margem: calc.margem.toNumber(),
        p_lucro: calc.lucro.toNumber(),
        p_foto_arquivo_id: fotoArquivoId,
        p_material_descricao: descreverFilamento(filamento),
      });
      if (error) throw error;
      const r = data as { orcamento_3d_id: string; item_id: string };
      return { orcamentoId: orcId, orcamento3dId: r.orcamento_3d_id, itemId: r.item_id };
    },
    onSuccess: (r) => {
      toast.success(orcamento3dId ? "Peça 3D atualizada" : "Peça 3D adicionada ao orçamento");
      onSalvo(r);
    },
    onError: (e: any) => {
      toast.error(mensagemErro(e));
      // "O preço mudou": a base ou o custo mudou depois da cotação. A tela ainda guarda a cotação velha (30 s de
      // cache), então pede a nova na hora. Sem isso o vendedor não vê valor novo e o salvar falha em laço.
      if (mensagemErro(e) === PRECO_MUDOU_3D) void cotacao.refetch();
    },
  });


  // Ramo de custo: sem os quatro dados do custo, nenhum valor aparece (só "—"); o cálculo segue igual por baixo.
  const valor = (v: Parameters<typeof money>[0]) => (mostraPreco ? money(v) : "—");
  const margemPct = calc ? calc.margem.toNumber() * 100 : 0;
  const margemTone: "lime" | "amber" | "magenta" =
    margemPct >= 40 ? "lime" : margemPct >= 15 ? "amber" : "magenta";

  const total = calc ? calc.operacional.toNumber() || 1 : 1;
  const breakdown = calc
    ? [
        { label: "Material", value: calc.material.toNumber(), tone: "cyan" as const },
        { label: "Máquina", value: calc.maquina.toNumber(), tone: "magenta" as const },
        { label: "Energia", value: calc.energia.toNumber(), tone: "amber" as const },
        { label: "Mão de obra", value: calc.maoDeObra.toNumber(), tone: "lime" as const },
        { label: "Acabamento", value: calc.acabamento.toNumber(), tone: "cyan" as const },
        { label: "Falha", value: calc.risco.toNumber(), tone: "magenta" as const },
        { label: "Embalagem", value: calc.indireto.toNumber(), tone: "muted" as const },
      ]
    : [];

  return (
    <div className="space-y-6 pb-24">
      {embutido ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{orcamento3dId ? "Editar a peça 3D" : "Peça de impressão 3D"}</h2>
            <p className="text-sm text-muted-foreground">
              {podeVerCusto
                ? "Solte o print do fatiador: o motor calcula custo, preço e margem. Ao salvar, a peça entra como item do orçamento."
                : "Solte o print do fatiador: o motor calcula o preço. Ao salvar, a peça entra como item do orçamento."}
            </p>
          </div>
          {onCancelar && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={salvar.isPending}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
          )}
        </div>
      ) : (
      <SectionHeader
        ajuda={dicaTela("/orcamento-3d-novo")}
        breadcrumb="Impressão 3D · Novo orçamento"
        title="Novo orçamento 3D"
        description={
          podeVerCusto
            ? "Solte o print do fatiador e o motor calcula custo, preço e margem em tempo real. A peça nasce como item de um orçamento comum."
            : "Solte o print do fatiador e o motor calcula o preço em tempo real. A peça nasce como item de um orçamento comum."
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/orcamentos">
              <ArrowLeft className="h-4 w-4 mr-1" /> Orçamentos
            </Link>
          </Button>
        }
      />
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* ---- Formulário ---- */}
        <div className="space-y-6">
          {/* 1. Identificação */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo n="1" icone={<Package className="h-4 w-4" />} titulo="Identificação" sub="Quem, o quê, quantos" />
              <div className={embutido ? "grid gap-3 md:grid-cols-[3fr_1fr]" : "grid gap-3 md:grid-cols-[2fr_1fr_1fr]"}>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Título"
                    required
                    hint="Nome curto que aparece no PDF e na listagem. Ex.: 'Porta-joias verde matcha'."
                  />
                  <Input
                    aria-label="Título"
                    value={f.titulo}
                    onChange={(e) => set("titulo", e.target.value)}
                    placeholder="ex.: Porta-joias verde matcha"
                  />
                </div>
                {!embutido && (
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Cliente"
                    hint="Opcional. Sem cliente cadastrado, escreva o nome do contato abaixo — o vínculo só é exigido na hora de virar OS."
                  />
                  <Select
                    value={f.cliente_id || "__avulso"}
                    onValueChange={(v) => set("cliente_id", v === "__avulso" ? "" : v)}
                  >
                    <SelectTrigger aria-label="Cliente">
                      <SelectValue placeholder="Selecionar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__avulso">Sem cadastro (contato avulso)</SelectItem>
                      {clientes.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}

                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Quantidade"
                    hint="Total de peças a cotar. O motor escala automaticamente: material/máquina/energia por impressão e mão de obra por peça; a embalagem é opcional e, se marcada, cobrada uma vez por item (use 'Peças na placa' se o print traz mais de uma)."
                  />
                  <Input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    aria-label="Quantidade"
                    value={f.quantidade}
                    onChange={(e) => set("quantidade", e.target.value)}
                  />
                </div>
              </div>

              {!embutido && !f.cliente_id && (
                <div className="grid gap-3 md:grid-cols-3 rounded-lg border border-border/60 bg-card/40 p-3">
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Nome do contato"
                      hint="Aparece no PDF no lugar do cliente. Você cadastra o cliente depois, na conversão em OS."
                    />
                    <Input
                      aria-label="Nome do contato"
                      value={f.contato_nome}
                      onChange={(e) => set("contato_nome", e.target.value)}
                      placeholder="Ex.: Marina (Instagram)"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Telefone / WhatsApp" hint="Opcional. Facilita o follow-up do orçamento." />
                    <Input
                      aria-label="Telefone do contato"
                      value={f.contato_telefone}
                      onChange={(e) => set("contato_telefone", e.target.value)}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="E-mail" hint="Opcional. Usado no envio do PDF do orçamento." />
                    <Input
                      aria-label="E-mail do contato"
                      value={f.contato_email}
                      onChange={(e) => set("contato_email", e.target.value)}
                      placeholder="contato@email.com"
                    />
                  </div>
                </div>
              )}



              <Dropzone
                label={fotoAtualUrl && !fotoModelo ? "Trocar a foto do modelo (opcional)" : "Foto do modelo (opcional)"}
                hint="A peça como o cliente vai recebê-la — sai no PDF, no link do cliente e na OS"
                file={fotoModelo}
                onFile={setFotoModelo}
                accent="magenta"
                captureFromClipboard={false}
                compact
                previewClassName="h-44 sm:h-56"
              />
              {fotoAtualUrl && !fotoModelo && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground" data-testid="foto-atual-da-peca">
                  <img src={fotoAtualUrl} alt="Foto atual do modelo" className="h-28 w-40 rounded-md border object-cover" />
                  <span>A foto atual fica; solte outra acima para trocar.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Fatiador */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo n="2" icone={<Cpu className="h-4 w-4" />} titulo="Dados do fatiador" sub="O herói — o motor lê tudo daqui" />

              <Dropzone
                label="Print ou arquivo do fatiador"
                hint="Solte o print (imagem) ou o próprio arquivo .3mf/.gcode do Bambu Studio, Orca, Cura ou PrusaSlicer — lemos peso e tempo; o arquivo é exato, o print passa por OCR"
                file={slicerFile}
                onFile={processSlicer}
                status={ocr}
                accent="cyan"
                accept="image/*,.3mf,.gcode"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Impressora"
                    required
                    hint={
                      podeVerCusto
                        ? "Custo/hora vem do cadastro da impressora (depreciação + manutenção + rateio de estrutura)."
                        : "Escolha a impressora que vai imprimir a peça."
                    }
                  />
                  {listaDeImpressoras.isPending ? (
                    <Carregando linhas={1} />
                  ) : listaDeImpressoras.isError ? (
                    <FalhaDaLista
                      texto="Não consegui carregar as impressoras."
                      tentando={listaDeImpressoras.isFetching}
                      onTentar={() => void listaDeImpressoras.refetch()}
                    />
                  ) : impressoras.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-base text-muted-foreground">
                      Nenhuma impressora ativa. Cadastre em Impressoras 3D.
                    </p>
                  ) : (
                    <SeletorImpressora
                      impressoras={impressoras}
                      valor={f.maquina_id}
                      onChange={(id) => set("maquina_id", id)}
                      detalhe={(m: any) =>
                        podeVerCusto
                          ? `${money(m.custo_hora_calculado ?? 0)}/h · ${Number(m.potencia_media_w ?? 0).toFixed(0)} W`
                          : undefined
                      }
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Filamento"
                    required
                    hint={
                      podeVerCusto
                        ? "O custo por grama vem do cadastro do filamento. Toque numa cor para filtrar a lista."
                        : "Escolha o filamento. Toque numa cor para filtrar a lista."
                    }
                  />
                  {listaDeFilamentos.isPending ? (
                    <Carregando linhas={1} />
                  ) : listaDeFilamentos.isError ? (
                    <FalhaDaLista
                      texto="Não consegui carregar os filamentos."
                      tentando={listaDeFilamentos.isFetching}
                      onTentar={() => void listaDeFilamentos.refetch()}
                    />
                  ) : filamentos.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-base text-muted-foreground">
                      Nenhum filamento cadastrado. Cadastre em Filamentos 3D.
                    </p>
                  ) : (
                    <SeletorFilamento
                      filamentos={filamentos}
                      valor={f.material_id}
                      onChange={(id) => set("material_id", id)}
                      detalhe={(m: any) =>
                        [m.tipo, m.cor, podeVerCusto ? `${money(Number(m.custo_por_grama_calculado ?? 0) * 1000)}/kg` : null]
                          .filter(Boolean)
                          .join(" · ")
                      }
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Peso do modelo (g)"
                    required
                    hint="Só o peso do modelo. Suporte e purga ficam nos campos 'Detectado no print' abaixo. Aceita decimais (ex.: 6,52)."
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label="Peso do modelo (g)"
                    value={f.gramas}
                    onChange={(e) => set("gramas", e.target.value.replace(",", "."))}
                    placeholder="ex.: 6,52"
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Tempo total"
                    hint="Aceita: 2h 15m · 2:15 · 135min · 1,5h · 90m. Cada hora custa a linha 'Máquina' + 'Energia'."
                  />
                  <Input
                    type="text"
                    inputMode="text"
                    aria-label="Tempo total"
                    value={f.tempo}
                    onChange={(e) => set("tempo", e.target.value)}
                    placeholder="ex.: 2h 15m ou 2:15"
                  />
                  {tempoMinutos > 0 && (
                    <div className="text-xs text-muted-foreground font-mono">
                      ≈ {formatMinutos(tempoMinutos)} · {tempoMinutos} min
                    </div>
                  )}
                </div>
              </div>

              {/* Detectado no print — bloco enxuto com campos extras */}
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Detectado no print
                  </div>
                  <span className="text-xs text-muted-foreground">Preenchido pelo OCR; ajuste se preciso</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peso suporte (g)"
                      hint="Filamento gasto em estruturas de suporte. Soma no total de material antes do custo."
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label="Peso suporte (g)"
                      value={f.peso_suporte}
                      onChange={(e) => set("peso_suporte", e.target.value.replace(",", "."))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peso purga/torre (g)"
                      hint="Purga e torre de troca (prime tower). Em multicolor passa fácil de 20% do total."
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label="Peso purga/torre (g)"
                      value={f.peso_purga}
                      onChange={(e) => set("peso_purga", e.target.value.replace(",", "."))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peças na placa"
                      hint="Quantas peças o print inclui. Confira contra 'Quantidade' para evitar subestimar 5×."
                    />
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      aria-label="Peças na placa"
                      value={f.pecas_placa}
                      onChange={(e) => set("pecas_placa", e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Tipo detectado" hint="Se diferente do filamento selecionado, revise — pode mudar R$/kg." />
                    <Input
                      aria-label="Tipo detectado"
                      value={f.filamento_tipo_detectado}
                      onChange={(e) => set("filamento_tipo_detectado", e.target.value.toUpperCase())}
                      placeholder="PLA / PETG / ABS…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Altura camada (mm)" hint="Só metadado de reprodutibilidade. Não afeta o custo." />
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label="Altura camada (mm)"
                      value={f.altura_camada}
                      onChange={(e) => set("altura_camada", e.target.value.replace(",", "."))}
                      placeholder="ex.: 0,2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Infill (%)" hint="Só metadado. Peça re-cotada com infill maior vai gastar mais material." />
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label="Infill (%)"
                      value={f.infill_pct}
                      onChange={(e) => set("infill_pct", e.target.value.replace(",", "."))}
                      placeholder="ex.: 15"
                    />
                  </div>
                </div>
                {f.filamento_tipo_detectado && filamento?.tipo &&
                  f.filamento_tipo_detectado.toUpperCase() !== String(filamento.tipo).toUpperCase() && (
                    <div className="text-xs rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-amber-300">
                      Atenção: fatiador diz <b>{f.filamento_tipo_detectado}</b>, você selecionou <b>{filamento.tipo}</b>.
                    </div>
                  )}
                {num(f.pecas_placa) > 1 && num(f.quantidade) !== num(f.pecas_placa) && (
                  <div className="text-xs rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-amber-300">
                    O print é de <b>{num(f.pecas_placa)}</b> peças e a quantidade cotada é <b>{num(f.quantidade)}</b>. Confira se o peso e o tempo cobrem o total.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>



          {/* 3. Parâmetros de custo — só para quem vê custo; os demais cotam com a
              base das Configurações 3D, sem ver os números de custo. */}
          {!podeVerCusto ? (
            <Card>
              <CardContent className="pt-6 space-y-2">
                <BlocoTitulo
                  n="3"
                  icone={<Wand2 className="h-4 w-4" />}
                  titulo="Parâmetros de custo"
                  sub="Seguem as Configurações 3D da gráfica"
                />
                <p className="text-base text-muted-foreground">
                  Custo por hora, energia, mão de obra, perdas e markup vêm da base da gráfica, e a
                  conta é feita no servidor. Você informa a peça e recebe o preço.
                </p>
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo
                n="3"
                icone={<Wand2 className="h-4 w-4" />}
                titulo="Parâmetros de custo"
                sub="Presets aceleram — os tooltips têm médias de mercado"
              />

                <GradeDeCartoes rotulo="Presets de custo" className="lg:grid-cols-4">
                  {PRESETS.map((p) => (
                    <CartaoDeEscolha
                      key={p.id}
                      ativo={presetAtivo === p.id}
                      titulo={p.label}
                      detalhe={`markup ${vezes(Number(p.patch.markup))} · falha ${p.patch.pct_falha}%`}
                      className="min-h-16"
                      onEscolher={() => {
                        aplicarPreset(p.patch);
                        setPresetAtivo(p.id);
                        if (typeof window !== "undefined")
                          localStorage.setItem("bex.orc3d.preset", p.id);
                      }}
                    />
                  ))}
                </GradeDeCartoes>

              {configErro && (
                <p className="text-xs text-[color:var(--bex-magenta)]">
                  Não foi possível ler a base de precificação 3D — os valores abaixo são padrões
                  genéricos. Revise em Configurações 3D.
                </p>
              )}
              {!configErro && vindoDaConfig.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tarifa de energia, mão de obra e demais parâmetros vindos das{" "}
                  <Link to="/configuracoes-3d" className="text-[color:var(--bex-cyan)] hover:underline">
                    Configurações 3D
                  </Link>
                  . Edite abaixo para sobrepor só neste orçamento.
                </p>
              )}



              <div className="grid gap-3 md:grid-cols-3">
                <Campo
                  label="Custo-hora máquina (R$/h)"
                  hint="Puxado da impressora ao selecioná-la; edite se o cadastro estiver incompleto."
                  value={f.custo_hora}
                  onChange={(v) => set("custo_hora", v)}
                  step="0.01"
                />
                <Campo
                  label="Potência (W)"
                  hint="Potência média da impressora, puxada do cadastro. Base do custo de energia."
                  value={f.potencia_w}
                  onChange={(v) => set("potencia_w", v)}
                  step="1"
                />
                <Campo
                  label="Tarifa energia (R$/kWh)"
                  hint="R$/kWh da conta de luz. Média BR residencial 0,85–1,10; comercial 0,60–0,90."
                  value={f.tarifa_kwh}
                  onChange={(v) => set("tarifa_kwh", v)}
                  step="0.01"
                />
                <Campo
                  label="Mão de obra (R$/h)"
                  hint="Custo do operador incluindo encargos. Sugerido 25–60 R$/h para operação 3D."
                  value={f.mo_custo_hora}
                  onChange={(v) => set("mo_custo_hora", v)}
                  step="0.01"
                />
                <Campo
                  label="Mão de obra (horas)"
                  hint={
                    "Só o pós-processamento manual por peça (remoção de suporte, lixa, montagem). " +
                    "Em branco ou 0: sem mão de obra."
                  }
                  value={f.mo_horas}
                  onChange={(v) => set("mo_horas", v)}
                  step="0.1"
                />
                <Campo
                  label="% Acabamento"
                  hint="Reserva para tinta, cola, verniz. Peça crua 0–3%; pintada 8–15%."
                  value={f.pct_acabamento}
                  onChange={(v) => set("pct_acabamento", v)}
                  step="0.1"
                />
                <Campo
                  label="% Falha"
                  hint="Provisão de reimpressão. FDM confiável 3–7%; resina/peça complexa 10–15%."
                  value={f.pct_falha}
                  onChange={(v) => set("pct_falha", v)}
                  step="0.1"
                />
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Switch
                      checked={embalagemIncluida}
                      onCheckedChange={(on) => {
                        setEmbalagemIncluida(on);
                        if (on && num(f.custo_admin) <= 0 && configPrec?.custo_admin_padrao != null) {
                          patch({ custo_admin: String(configPrec.custo_admin_padrao) });
                        }
                      }}
                      aria-label="Cobrar embalagem neste item"
                    />
                    Cobrar embalagem neste item
                  </label>
                  {embalagemIncluida ? (
                    <Campo
                      label="Embalagem (R$)"
                      hint="Cobrado uma vez por item 3D, qualquer que seja a quantidade"
                      value={f.custo_admin}
                      onChange={(v) => set("custo_admin", v)}
                      step="0.01"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem embalagem: nada entra no custo nem no preço.</p>
                  )}
                </div>
                <Campo
                  label="Markup (×)"
                  hint="Multiplica o custo operacional. Varejo 2,0–2,5×; atacado 1,3–1,5×; peça premium 2,5–3,5×."
                  value={f.markup}
                  onChange={(v) => set("markup", v)}
                  step="0.1"
                />
              </div>
              {f.maquina_id && num(f.custo_hora) <= 0 && (
                <p className="mt-2 text-xs text-destructive">
                  A impressora selecionada está sem custo-hora — informe manualmente acima ou
                  corrija o cadastro, senão o orçamento sub-precifica.
                </p>
              )}
            </CardContent>
          </Card>
          )}
        </div>

        {/* ---- Resumo herói (sticky) ---- */}
        <div className="space-y-4">
          <div className={embutido ? "space-y-4" : "lg:sticky lg:top-4 space-y-4"}>
            <Card className="overflow-hidden border-[color:var(--bex-cyan)]/30">
              <div
                className="px-5 py-4 border-b border-border"
                style={{ background: "var(--gradient-cmyk)" }}
              >
                <div className="flex items-center justify-between text-background/90">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest font-bold">
                    <Calculator className="h-3.5 w-3.5" /> Resultado
                  </div>
                  {podeVerCusto && mostraPreco && (
                    <StatusChip
                      label={`${margemPct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de margem`}
                      tone={margemTone}
                    />
                  )}
                </div>
              </div>
              <CardContent className="pt-5 space-y-4">
                <div>
                  {/* "Preço (2×)" lia como "duas peças": a quantidade e o markup
                      agora têm nome. */}
                  <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
                    {qtdNoTitulo > 1 ? `Preço total · ${qtdNoTitulo} peças` : "Preço"}
                    {calc && ` · markup ${vezes(calc.markup)}`}
                  </div>
                  {calc ? (
                    // Ramo de custo: a conta é daqui; enquanto a base de preço não chega, nada de número.
                    baseDePreco === "carregando" ? (
                      <Carregando linhas={1} />
                    ) : (
                      <div className="font-mono text-4xl font-black tracking-tight">
                        {valor(calc.preco)}
                      </div>
                    )
                  ) : (
                    <PrecoDoServidor
                      mostraPreco={mostraPreco}
                      problema={problemaDaCotacao}
                      cotando={cotando}
                      falhou={cotacaoFalhou}
                      erro={cotacao.error}
                      tentando={cotacao.isFetching}
                      onTentar={() => void cotacao.refetch()}
                      preco={cotacaoAtual ? money(cotacaoAtual.preco) : null}
                    />
                  )}
                  {!mostraPreco && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="preco-3d-incompleto">
                      {DICA_PRECO_3D_INCOMPLETO}
                    </p>
                  )}
                  {calc && (
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      <span>Custo {valor(calc.operacional)}</span>
                      <span>·</span>
                      <span>Lucro {valor(calc.lucro)}</span>
                    </div>
                  )}
                </div>

                {podeVerCusto && (baseDePreco === "falhou" || baseDePreco === "vazia") && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-lg border border-destructive p-3 text-foreground"
                    data-testid="base-de-preco-3d-faltou"
                  >
                    <p className="flex items-start gap-2 text-base font-medium">
                      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
                      {baseDePreco === "falhou"
                        ? "Não consegui ler a base de preço 3D."
                        : "A base de preço 3D não chegou para o seu perfil."}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Tarifa, mão de obra, percentuais e markup estão com valores genéricos. Salvar fica
                      bloqueado até a base chegar. Se continuar, avise a gerência.
                    </p>
                    {baseDePreco === "falhou" && (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={configBuscando}
                        onClick={() => void lerConfigDeNovo()}
                      >
                        <RotateCw className="mr-2 h-4 w-4" aria-hidden /> Tentar de novo
                      </Button>
                    )}
                  </div>
                )}

                {resumo && resumo.qtd > 1 && baseDePreco !== "carregando" && (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Preço unitário
                      {resumo.placas !== resumo.qtd ? ` · ${resumo.placas} impressões` : ""}
                    </span>
                    <span className="font-mono font-semibold">{valor(resumo.unitario)}</span>
                  </div>
                )}

                {cotacaoAtual?.avisos.map((a) => (
                  <p
                    key={a}
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)] px-3 py-2 text-base text-foreground"
                    data-testid={`aviso-da-cotacao-${a}`}
                  >
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    {TEXTO_DO_AVISO[a]}
                  </p>
                ))}

                {mostraPreco && resumo?.peloMinimo && (
                  <p className="text-xs text-muted-foreground" data-testid="preco-minimo-3d">
                    Preço mínimo de {money(PRECO_MINIMO_POR_PECA)} por peça aplicado: o cálculo deu
                    menos que isso.
                  </p>
                )}

                {calc && (
                <>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                    De onde vem o custo
                  </div>
                  {breakdown.map((b) => {
                    const pct = total > 0 ? (b.value / total) * 100 : 0;
                    return (
                      <div key={b.label} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{b.label}</span>
                          <span className="font-mono">{valor(b.value)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              b.tone === "cyan" && "bg-[color:var(--bex-cyan)]",
                              b.tone === "magenta" && "bg-[color:var(--bex-magenta)]",
                              b.tone === "amber" && "bg-amber-400",
                              b.tone === "lime" && "bg-[color:var(--bex-lime)]",
                              b.tone === "muted" && "bg-muted-foreground",
                            )}
                            style={{ width: `${mostraPreco ? Math.min(100, pct) : 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div
                    className="rounded-lg border border-border px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground font-mono">
                      Atacado {vezes(calc.markupAtacado)}
                      <DicaIcone
                        texto={`Preço de atacado: custo × ${vezes(calc.markupAtacado)} (markup de atacado das Configurações 3D)`}
                        rotulo="Atacado"
                      />
                    </div>
                    <div className="font-mono font-semibold">{valor(calc.atacado)}</div>
                    <div className="text-xs text-muted-foreground">preço para revenda</div>
                  </div>
                  <div
                    className="rounded-lg border border-border px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground font-mono">
                      Piso · 10% de margem
                      <DicaIcone texto="O menor preço que ainda deixa 10% de margem. Abaixo dele, a peça dá prejuízo." rotulo="Piso" />
                    </div>
                    <div className="font-mono font-semibold">{valor(calc.equilibrio)}</div>
                    <div className="text-xs text-muted-foreground">não vender abaixo</div>
                  </div>
                </div>
                </>
                )}

                {faltando.length > 0 && (
                  <div className="text-xs rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-300 flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Faltando: {faltando.join(", ")}</span>
                  </div>
                )}

                <NeonButton
                  className="w-full"
                  onClick={() => salvar.mutate()}
                  disabled={salvar.isPending || faltando.length > 0 || !precoPronto}
                >
                  {salvar.isPending ? "Salvando..." : embutido ? (orcamento3dId ? "Salvar a peça" : "Adicionar a peça ao orçamento") : "Salvar orçamento"}
                </NeonButton>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlocoTitulo({
  n,
  icone,
  titulo,
  sub,
}: {
  n: string;
  icone: React.ReactNode;
  titulo: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3 pb-2 border-b border-border">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm font-black text-background"
        style={{ background: "var(--gradient-cmyk)" }}
      >
        {n}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          {icone}
          {titulo}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

/** Lista que não carregou: diz que falhou e oferece tentar de novo (nunca "nenhuma impressora"). */
function FalhaDaLista({
  texto,
  tentando,
  onTentar,
}: {
  texto: string;
  tentando: boolean;
  onTentar: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-foreground">
      <p className="flex items-start gap-2 text-base font-medium">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        {texto}
      </p>
      <p className="text-sm text-muted-foreground">
        É uma falha de leitura, não uma lista vazia. Se continuar, avise a gerência.
      </p>
      <Button type="button" variant="outline" className="min-h-11" disabled={tentando} onClick={onTentar}>
        <RotateCw className="mr-2 h-4 w-4" aria-hidden /> Tentar de novo
      </Button>
    </div>
  );
}

/**
 * O preço de quem não vê custo, como o servidor o devolveu (onda C, 11/11/2026). Cinco estados, e nenhum mostra
 * número que não seja o das entradas de agora: falta dado, dado fora do limite, calculando, falhou, pronto.
 */
function PrecoDoServidor({
  mostraPreco,
  problema,
  cotando,
  falhou,
  erro,
  tentando,
  onTentar,
  preco,
}: {
  mostraPreco: boolean;
  problema: string | null;
  cotando: boolean;
  falhou: boolean;
  erro: unknown;
  tentando: boolean;
  onTentar: () => void;
  preco: string | null;
}) {
  if (!mostraPreco) {
    return (
      <div className="text-2xl font-semibold text-muted-foreground" data-testid="preco-3d-sem-valor">
        Sem preço ainda
      </div>
    );
  }
  if (problema) {
    return (
      <p role="alert" className="flex items-start gap-2 text-base font-medium text-foreground" data-testid="preco-3d-entrada-invalida">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        {problema}
      </p>
    );
  }
  if (falhou) {
    // O servidor responde em português quando sabe o motivo (impressora desativada, base não cadastrada);
    // o resto vira a frase geral, sem detalhe técnico.
    const motivo = mensagemErro(erro, FALHA_DA_COTACAO_3D);
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-foreground" data-testid="preco-3d-falhou">
        <p className="flex items-start gap-2 text-base font-medium">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          {FALHA_DA_COTACAO_3D}
        </p>
        {motivo !== FALHA_DA_COTACAO_3D && <p className="text-sm text-muted-foreground">{motivo}</p>}
        <Button type="button" variant="outline" className="min-h-11" disabled={tentando} onClick={onTentar}>
          <RotateCw className="mr-2 h-4 w-4" aria-hidden /> Tentar de novo
        </Button>
      </div>
    );
  }
  if (cotando || !preco) {
    return (
      <div data-testid="preco-3d-calculando">
        <Carregando linhas={1} className="max-w-64" />
        <p className="text-sm text-muted-foreground">Calculando o preço</p>
      </div>
    );
  }
  return (
    <div className="font-mono text-4xl font-black tracking-tight" data-testid="preco-3d-do-servidor">
      {preco}
    </div>
  );
}

function Campo({
  label,
  hint,
  value,
  onChange,
  step,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldTooltip label={label} hint={hint} />
      <Input
        type="number"
        step={step}
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
