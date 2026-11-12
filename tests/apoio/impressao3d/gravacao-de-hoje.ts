/**
 * ORÁCULO DA GRAVAÇÃO: o que a calculadora 3D manda para `salvar_item_3d_no_orcamento` na main de 11/11/2026
 * (commit dcd82c90), copiado de `src/components/impressao3d/calculadora-3d.tsx`, linhas 568 a 635 (o `inputs`,
 * o `resultados` e o objeto de 25 parâmetros da RPC) e `numOuNulo` (linha 68).
 *
 * Serve para provar que o servidor (`salvarPeca3dNoOrcamento`) e os construtores de
 * `src/domain/impressao3d/calcular-peca.ts` gravam a peça NO MESMO FORMATO de hoje: `ler_item_3d`, a tela
 * `orcamento-3d.$id`, `breakdown_3d` e a reabertura da peça leem estas chaves.
 *
 * Diferenças em relação ao texto da calculadora (as únicas):
 *   1. virou função, e o que na tela vem do estado do React entra por parâmetro (`a.*`);
 *   2. o orçamento (`orcId`), a peça (`orcamento3dId`), a foto (`fotoArquivoId`) e os caminhos dos arquivos
 *      entram prontos, porque na tela eles saem dos passos de antes (criar orçamento, subir arquivo);
 *   3. `descreverFilamento(filamento)` entra pronto em `materialDescricao`.
 * NÃO é código de produção e NÃO deve ser "melhorado".
 */
import { num, type CamposDaConta, type contaInlineDeHoje } from "./conta-inline-de-hoje";

/** `numOuNulo` de calculadora-3d.tsx:68, igual. */
export const numOuNulo = (v: string) => (String(v ?? "").trim() === "" ? null : num(v));

/** Os campos de `FormState` que a gravação lê, além dos da conta. Tudo texto, como na tela. */
export type CamposDaGravacao = CamposDaConta & {
  cliente_id: string;
  titulo: string;
  maquina_id: string;
  material_id: string;
  filamento_tipo_detectado: string;
  altura_camada: string;
  infill_pct: string;
};

export function gravacaoDeHoje(a: {
  f: CamposDaGravacao;
  calc: ReturnType<typeof contaInlineDeHoje>;
  tempoHoras: number;
  embalagemIncluida: boolean;
  clienteId: string | null;
  slicerPath: string | null;
  slicerAtualPath: string | null;
  impressora: { maquinas?: { nome?: string | null } | null } | undefined;
  filamento: { materiais?: { nome?: string | null } | null } | undefined;
  orcId: string;
  orcamento3dId: string | null;
  fotoArquivoId: string | null;
  materialDescricao: string | null;
}) {
  const {
    f,
    calc,
    embalagemIncluida,
    clienteId,
    slicerPath,
    slicerAtualPath,
    impressora,
    filamento,
  } = a;
  const { orcId, orcamento3dId, fotoArquivoId } = a;
  const tempoHoras = a.tempoHoras;

  // ---- calculadora-3d.tsx:568-635 ----
  const horasTotais = tempoHoras;
  const inputs = {
    cliente_id: clienteId ?? f.cliente_id ?? null,
    quantidade: calc.qtd,
    gramas: num(f.gramas),
    peso_suporte_g: num(f.peso_suporte),
    peso_purga_g: num(f.peso_purga),
    pecas_por_placa: num(f.pecas_placa, 1) || 1,
    filamento_tipo_detectado: f.filamento_tipo_detectado || null,
    altura_camada_mm: numOuNulo(f.altura_camada),
    infill_pct: numOuNulo(f.infill_pct),
    horas_totais: horasTotais,
    custo_hora_maquina: num(f.custo_hora),
    potencia_w: num(f.potencia_w),
    tarifa_kwh: num(f.tarifa_kwh),
    mao_obra: { custo_hora: num(f.mo_custo_hora), horas: calc.horasMaoDeObra },
    pct_acabamento: num(f.pct_acabamento),
    pct_falha: num(f.pct_falha),
    custo_admin: embalagemIncluida ? num(f.custo_admin) : 0,
    embalagem_incluida: embalagemIncluida,
    embalagem_valor: embalagemIncluida ? calc.indireto.toNumber() : 0,
    markup: num(f.markup, 2),
    slicer_screenshot: slicerPath ?? slicerAtualPath,
    impressora: impressora?.maquinas?.nome ?? null,
    filamento: filamento?.materiais?.nome ?? null,
  };
  const resultados = {
    material: calc.material.toNumber(),
    maquina: calc.maquina.toNumber(),
    energia: calc.energia.toNumber(),
    mao_de_obra: calc.maoDeObra.toNumber(),
    acabamento: calc.acabamento.toNumber(),
    risco: calc.risco.toNumber(),
    indireto: calc.indireto.toNumber(),
    embalagem_incluida: embalagemIncluida,
    embalagem: calc.indireto.toNumber(),
    operacional: calc.operacional.toNumber(),
    preco: calc.preco.toNumber(),
    margem: calc.margem.toNumber(),
  };

  const parametros = {
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
    p_material_descricao: a.materialDescricao,
  };
  return { inputs, resultados, parametros };
}
