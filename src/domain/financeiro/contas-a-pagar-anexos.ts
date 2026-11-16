/**
 * Contas a pagar, fase 1 (16/11/2026): as regras que a tela confere antes de falar com o banco.
 *
 * Nada aqui decide sozinho. O banco confere de novo tudo o que importa (migração
 * 20261116160000): o bucket recusa tipo e tamanho, `anexar_arquivo_conta_pagar` lê o tamanho
 * e o tipo do objeto gravado, `pagar_conta_pagar` recusa data futura. Estas funções existem
 * para a pessoa ouvir o "não" antes de esperar o envio, e para o teste segurar a regra.
 *
 * Datas são "aaaa-mm-dd" como texto e o "hoje" vem de fora (`hojeBr()` na tela).
 */

export const BUCKET_DE_ANEXOS = "contas-pagar-anexos";

/** 10 MB, o mesmo número do bucket e do CHECK da tabela. */
export const LIMITE_DO_ANEXO_EM_BYTES = 10 * 1024 * 1024;

export const EXTENSAO_DO_TIPO = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export type MimeAceito = keyof typeof EXTENSAO_DO_TIPO;

/** Para o `accept` do campo de arquivo: o tipo e a extensão, porque há navegador que só olha um. */
export const ACEITA_NO_CAMPO = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export type TipoDeAnexo = "fatura" | "comprovante";

export const ROTULO_DO_TIPO: Record<TipoDeAnexo, string> = {
  fatura: "Fatura/boleto",
  comprovante: "Comprovante de pagamento",
};

/** O mínimo que o banco aceita no motivo do estorno. */
export const MINIMO_DO_MOTIVO = 5;

export interface ArquivoEscolhido {
  name: string;
  type: string;
  size: number;
}

const POR_EXTENSAO: Record<string, MimeAceito> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/**
 * O tipo do arquivo. Confia no que o navegador diz quando é um dos três; quando ele não diz
 * nada (acontece com PDF em alguns Windows), olha a extensão. Tipo declarado diferente dos três
 * é recusado mesmo com extensão boa: é ele que o Storage grava e o banco confere.
 */
export function mimeDoArquivo(arquivo: Pick<ArquivoEscolhido, "name" | "type">): MimeAceito | null {
  const tipo = (arquivo.type ?? "").trim().toLowerCase();
  if (tipo in EXTENSAO_DO_TIPO) return tipo as MimeAceito;
  if (tipo !== "") return null;
  const extensao = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
  return POR_EXTENSAO[extensao] ?? null;
}

/** A mensagem que explica por que o arquivo não serve, ou null quando serve. */
export function problemaDoArquivo(arquivo: ArquivoEscolhido): string | null {
  if (!mimeDoArquivo(arquivo)) return `"${arquivo.name}" não é PDF, JPG nem PNG.`;
  if (arquivo.size <= 0) return `"${arquivo.name}" está vazio.`;
  if (arquivo.size > LIMITE_DO_ANEXO_EM_BYTES) {
    return `"${arquivo.name}" tem ${tamanhoLegivel(arquivo.size)}; o limite é 10 MB.`;
  }
  return null;
}

/**
 * Onde o arquivo mora no bucket: `<id da conta>/<id do arquivo>.<extensão>`. A policy de envio
 * só aceita esse formato, e o banco só registra arquivo que está na pasta da própria conta.
 * O nome que a pessoa deu ao arquivo fica na tabela, não no caminho.
 */
export function caminhoDoAnexo(contaId: string, idDoArquivo: string, mime: MimeAceito): string {
  return `${contaId}/${idDoArquivo}.${EXTENSAO_DO_TIPO[mime]}`;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data do pagamento: obrigatória, válida e não futura. Data passada é aceita. */
export function problemaDaDataDoPagamento(data: string, hoje: string): string | null {
  if (!data) return "Informe a data do pagamento.";
  if (!DATA.test(data) || Number.isNaN(new Date(`${data}T12:00:00`).getTime())) {
    return "Data do pagamento inválida.";
  }
  if (data > hoje)
    return "A data do pagamento não pode ser futura: pagamento agendado ainda não é pagamento.";
  return null;
}

export function problemaDoMotivo(motivo: string): string | null {
  const limpo = motivo.trim();
  if (limpo.length === 0) return "O motivo do estorno é obrigatório.";
  if (limpo.length < MINIMO_DO_MOTIVO)
    return `Escreva o motivo com pelo menos ${MINIMO_DO_MOTIVO} caracteres.`;
  return null;
}

export interface AnexoDaConta {
  id: string;
  conta_pagar_id: string;
  tipo: TipoDeAnexo;
  caminho: string;
  nome_arquivo: string;
  mime: string;
  tamanho_bytes: number;
  enviado_por_nome: string | null;
  enviado_em: string;
}

export function anexosPorConta(anexos: readonly AnexoDaConta[]): Map<string, AnexoDaConta[]> {
  const mapa = new Map<string, AnexoDaConta[]>();
  for (const a of anexos) {
    const lista = mapa.get(a.conta_pagar_id);
    if (lista) lista.push(a);
    else mapa.set(a.conta_pagar_id, [a]);
  }
  return mapa;
}

export interface ContaComComprovante {
  status: string;
  /** O comprovante da baixa de parcela de compromisso (bucket comprovantes), anterior aos anexos. */
  comprovante_url?: string | null;
}

/** Anexos novos mais o comprovante antigo da parcela, que também é prova e aparece no clipe. */
export function quantidadeDeArquivos(
  conta: ContaComComprovante,
  anexos: readonly AnexoDaConta[],
): number {
  return anexos.length + (temComprovanteAntigo(conta) ? 1 : 0);
}

export function temComprovanteAntigo(conta: ContaComComprovante): boolean {
  return (conta.comprovante_url ?? "").trim() !== "";
}

/**
 * Paga e sem prova: o mesmo aviso das parcelas de Despesas fixas e contratos. Vale o
 * comprovante antigo da parcela ou um anexo do tipo comprovante; fatura não é prova de
 * pagamento.
 */
export function pagaSemComprovante(
  conta: ContaComComprovante,
  anexos: readonly AnexoDaConta[],
): boolean {
  if (conta.status !== "paga") return false;
  if (temComprovanteAntigo(conta)) return false;
  return !anexos.some((a) => a.tipo === "comprovante");
}

export type EventoDoHistorico =
  | "criada"
  | "paga"
  | "estornada"
  | "reaberta"
  | "cancelada"
  | "excluida"
  | "anexo_enviado"
  | "anexo_removido";

export interface LinhaDoHistorico {
  id: string;
  evento: EventoDoHistorico | string;
  usuario_nome: string | null;
  ocorrido_em: string;
  valor: number | string | null;
  data_pagamento: string | null;
  motivo: string | null;
  detalhes: Record<string, unknown> | null;
}

const VERBO: Record<EventoDoHistorico, string> = {
  criada: "Lançou a conta",
  paga: "Pagou",
  estornada: "Estornou o pagamento",
  reaberta: "Reabriu a conta",
  cancelada: "Cancelou a conta",
  excluida: "Excluiu a conta",
  anexo_enviado: "Anexou",
  anexo_removido: "Removeu o anexo",
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => {
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
};

/** Uma frase por linha do histórico. Quem fez e quando ficam ao lado, na tela. */
export function frasesDoHistorico(h: LinhaDoHistorico): { titulo: string; detalhe: string | null } {
  const verbo = VERBO[h.evento as EventoDoHistorico] ?? h.evento;
  const d = h.detalhes ?? {};
  const partes: string[] = [];
  if (h.evento === "anexo_enviado" || h.evento === "anexo_removido") {
    const tipo = ROTULO_DO_TIPO[d.tipo as TipoDeAnexo] ?? "arquivo";
    const nome = typeof d.nome_arquivo === "string" ? ` "${d.nome_arquivo}"` : "";
    return {
      titulo: `${verbo}: ${tipo.toLowerCase()}${nome}`,
      detalhe: h.motivo ? `Motivo: ${h.motivo}` : null,
    };
  }
  if (h.valor !== null && h.valor !== undefined && h.evento !== "criada")
    partes.push(brl(Number(h.valor)));
  if (h.evento === "paga" && h.data_pagamento) partes.push(`pago em ${dataBr(h.data_pagamento)}`);
  if (h.evento === "paga" && typeof d.conta_bancaria === "string")
    partes.push(`saiu de ${d.conta_bancaria}`);
  if (h.evento === "estornada" && h.data_pagamento)
    partes.push(`pagamento de ${dataBr(h.data_pagamento)}`);
  if (h.evento === "criada" && h.valor !== null && h.valor !== undefined)
    partes.push(brl(Number(h.valor)));
  if (h.motivo) partes.push(`motivo: ${h.motivo}`);
  return { titulo: verbo, detalhe: partes.length > 0 ? partes.join(" · ") : null };
}

/**
 * A migração ainda não foi aplicada: tabela, função ou coluna nova não existe. A tela trata
 * como "recurso desligado" em vez de quebrar, como as telas de parceiro fazem.
 */
export function recursoAusente(
  erro: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!erro) return false;
  const codigo = erro.code ?? "";
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(codigo)) return true;
  return /does not exist|schema cache|could not find the (function|table)/i.test(
    erro.message ?? "",
  );
}
