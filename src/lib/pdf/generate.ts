import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import { custoHoraComEncargos } from "@/domain/financeiro/encargos";
import { formatarDocumento, formatarTelefone, tipoPorTamanho } from "@/domain/documentos";
import { lerCondicao } from "@/domain/orcamentos/acordo";
import { STATUS as STATUS_DA_OS } from "@/domain/os/etapas";
import { mensagemErro } from "@/lib/erros";
import type { DocItem, DocumentoPDFProps } from "./DocumentoPDF";
import { carregarEmpresa } from "./empresa";
import { dataBR, descreverEntrega, parcelasDoAcordo, validadeAte } from "./formato";
import { prepararImagensDoDocumento } from "./imagens";

// As consultas abaixo usam listas de colunas montadas em constantes: o
// gerador de tipos do supabase-js só entende o select literal, e as views nem
// estão completas em types.ts. Daí o cliente sem tipo — as linhas ganham tipo
// próprio logo na leitura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baixa um PDF montado na hora, sem registrar no histórico — o do parceiro é dele. */
export const baixarArquivo = download;

/**
 * O motor do PDF (o @react-pdf e o próprio DocumentoPDF, que o importa) entra
 * só no navegador. Um `import()` simples não basta: ele continua no pacote do
 * servidor e o nitro empacota a biblioteca mesmo assim — pdfkit, fontkit,
 * brotli e o reconciler, ~2,6 MB que nunca rodam lá, num build que já estava no
 * limite de memória. Com a condição em `import.meta.env.SSR`, o build do
 * servidor troca tudo por `null` e o import some de lá.
 *
 * Por isso nenhum módulo que as rotas importam (este, o diálogo, o histórico)
 * pode importar o DocumentoPDF ou o @react-pdf diretamente — só `import type`.
 */
const importarMotorDoPdf = import.meta.env.SSR
  ? null
  : () => Promise.all([import("@react-pdf/renderer"), import("./DocumentoPDF")]);

/**
 * Renderiza o documento. Antes de desenhar, logo e artes são baixados e
 * convertidos para JPEG/PNG (imagens.ts): o @react-pdf só desenha esses dois, e
 * uma arte em WEBP ou PDF sumia do documento ou derrubava a geração inteira.
 */
export async function renderPDFBlob(props: DocumentoPDFProps): Promise<Blob> {
  if (!importarMotorDoPdf) throw new Error("O PDF só é gerado no navegador.");
  const [[{ pdf }, { DocumentoPDF }], pronto] = await Promise.all([
    importarMotorDoPdf(),
    prepararImagensDoDocumento(props),
  ]);
  return await pdf(DocumentoPDF(pronto)).toBlob();
}

/* ------------------------------------------------------------------------- */
/* Colunas                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Colunas do orçamento lidas da TABELA, em lista fechada.
 *
 * As views `orcamentos_*` não têm prazo, data prometida, condição de
 * pagamento, entrega nem as observações novas — por isso o PDF saía com "Data
 * de Entrega: —" e sem PAGAMENTO e ENTREGA. Na tabela o SELECT é por coluna (o
 * dinheiro mora nos espelhos): pedir `*`, ou uma coluna sem grant, derruba a
 * consulta INTEIRA. Nenhuma destas é dinheiro; o preço vem da view do nível de
 * quem pede.
 */
export const COLUNAS_DO_ORCAMENTO =
  "id, numero, cliente_id, vendedor_id, status, created_at, validade_dias, observacoes, observacao_cliente, observacao_interna, contato_nome, contato_telefone, contato_email, prazo, data_entrega_prometida, condicao_pagamento, precisa_entrega, precisa_instalacao, endereco_entrega, os_id";

/** Preço do orçamento: só nas views comercial e financeira. */
export const COLUNAS_DE_PRECO_DO_ORCAMENTO = "valor_subtotal, valor_total";

/** Itens do orçamento — as três views têm `tipo_produto` e `especificacao` desde 05/10/2026. */
export const COLUNAS_DOS_ITENS_DO_ORCAMENTO =
  "id, descricao, quantidade, unidade, ordem, created_at, largura, altura, area_total, acabamento, arquivo_id, tipo_produto, especificacao";

/**
 * Itens da OS. As views `itens_os_*` não têm tipo nem especificação; a
 * especificação vem da TABELA (`ESPECIFICACAO_DOS_ITENS_DA_OS`), à parte.
 */
export const COLUNAS_DOS_ITENS_DA_OS =
  "id, descricao, quantidade, unidade, ordem, created_at, largura, altura, area_total, acabamento, arquivo_id";

/**
 * A especificação de cada item da OS: `itens_os.especificacoes` é jsonb, e a
 * conversão grava `{"texto": …}` com a especificação do item do orçamento
 * (gatilho `tg_itens_os_herda_especificacao`). A coluna ganhou SELECT para a
 * equipe na migração 20261006230000 — antes, a via de produção da OS saía sem
 * a especificação que o vendedor escreveu.
 */
export const ESPECIFICACAO_DOS_ITENS_DA_OS = "id, especificacoes";

/** Preço do item: só nas views comercial e financeira. */
export const COLUNAS_DE_PRECO_DO_ITEM = "valor_unitario, valor_total";

/** OS pelas views `ordens_servico_*` (a operacional não tem `valor_total`). */
export const COLUNAS_DA_OS =
  "id, numero, cliente_id, cliente_nome, vendedor_id, orcamento_id, status, titulo, briefing, observacoes, prazo_entrega, data_entrega_real, created_at, precisa_entrega, precisa_instalacao";

export const COLUNAS_DO_CLIENTE =
  "nome, razao_social, nome_fantasia, documento, cpf_cnpj, endereco, bairro, cidade, estado, cep, telefone, whatsapp_principal, email";

/* ------------------------------------------------------------------------- */
/* Apoio                                                                      */
/* ------------------------------------------------------------------------- */

type Resposta<T> = { data: T; error: unknown };

/**
 * Consulta que falha vira erro, com o que se tentava ler. Antes cada uma
 * descartava o `error` e o documento saía com o dado faltando em silêncio —
 * a via de produção chegou a sair com uma caixa de custo vazia porque a
 * consulta pedia coluna que não existe (42703) e coluna sem grant (42501).
 */
function exigir<T>(r: Resposta<T>, oQue: string): T {
  if (r.error) {
    console.error(`[pdf] não foi possível ${oQue}:`, r.error);
    throw new Error(`Não foi possível ${oQue}: ${mensagemErro(r.error)}`);
  }
  return r.data;
}

const temTexto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const textoOuNulo = (v: unknown) => (temTexto(v) ? v.trim() : null);
const numero = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Qual view alimenta a via pedida.
 *
 * A via de produção nunca leva valor: view operacional, seja quem for. A via do
 * cliente é preço de venda — o nível comercial já traz valor_unitario,
 * valor_total e valor_subtotal e nunca custo nem margem, então é o que ela lê.
 * Quem chama pode informar o próprio nível (useAuth().nivelDeVisao): o
 * financeiro continua na view dele; qualquer outro cai no comercial, porque a
 * via do cliente sem coluna de preço sairia R$ 0,00 — exatamente o defeito que
 * o vendedor tinha até 22/09, quando `true` caía direto em "financeiro" e a
 * view devolvia nada para ele. Quem não pode ver preço a view comercial barra
 * no banco (can_see_prices) e o erro aparece, em vez de um PDF zerado.
 */
function nivelDaVia(mostrarValores: boolean, nivel?: NivelDeVisao): NivelDeVisao {
  if (!mostrarValores) return "operacional";
  return nivel === "financeiro" ? "financeiro" : "comercial";
}

type LinhaDoCliente = {
  nome: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  documento: string | null;
  cpf_cnpj: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  telefone: string | null;
  whatsapp_principal: string | null;
  email: string | null;
};

/**
 * Cadastro do cliente. Sem a permissão de ler clientes (o operador não tem) a
 * RLS devolve nada — o documento sai só com o nome que a OS ou o orçamento
 * trazem. Erro de verdade derruba.
 */
async function lerCliente(id: string | null | undefined): Promise<LinhaDoCliente | null> {
  if (!id) return null;
  return exigir(
    await db.from("clientes").select(COLUNAS_DO_CLIENTE).eq("id", id).maybeSingle(),
    "ler o cadastro do cliente",
  ) as LinhaDoCliente | null;
}

const documentoLegivel = (v: string | null) => (v && tipoPorTamanho(v) ? formatarDocumento(v) : v);
const telefoneLegivel = (v: string | null | undefined) => (v ? formatarTelefone(v) : null);

function clienteDoDocumento(
  c: LinhaDoCliente | null,
  reserva: {
    nome?: string | null;
    telefone?: string | null;
    email?: string | null;
    contato?: string | null;
  },
): DocumentoPDFProps["cliente"] {
  const nome = textoOuNulo(c?.nome) ?? textoOuNulo(reserva.nome);
  return {
    nome: nome ?? "—",
    razao_social: textoOuNulo(c?.razao_social) ?? nome,
    nome_fantasia: textoOuNulo(c?.nome_fantasia),
    documento: documentoLegivel(textoOuNulo(c?.documento) ?? textoOuNulo(c?.cpf_cnpj)),
    // `clientes` não tem inscrição estadual: o campo do modelo sai em branco.
    inscricao_estadual: null,
    endereco: textoOuNulo(c?.endereco),
    bairro: textoOuNulo(c?.bairro),
    cidade: textoOuNulo(c?.cidade),
    estado: textoOuNulo(c?.estado),
    cep: textoOuNulo(c?.cep),
    telefone: telefoneLegivel(textoOuNulo(c?.telefone) ?? textoOuNulo(reserva.telefone)),
    celular: telefoneLegivel(textoOuNulo(c?.whatsapp_principal)),
    email: textoOuNulo(c?.email) ?? textoOuNulo(reserva.email),
    contato: textoOuNulo(reserva.contato),
  };
}

/**
 * Nome de quem aparece no documento (responsável, quem retirou material).
 *
 * A policy de `usuarios` só libera o próprio registro (fora admin e gestor): o
 * vendedor que emite o orçamento de um colega não leria o nome dele, e o
 * documento sairia "Responsável: —". O que faltar vem de `equipe_para_venda`,
 * a lista da equipe que quem lê orçamento ou OS já enxerga.
 */
async function nomesDosUsuarios(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))];
  const nomes = new Map<string, string>();
  if (unicos.length === 0) return nomes;
  const linhas = exigir(
    await db.from("usuarios").select("id, nome").in("id", unicos),
    "ler o nome do responsável",
  ) as { id: string; nome: string | null }[] | null;
  for (const u of linhas ?? []) if (temTexto(u.nome)) nomes.set(u.id, u.nome.trim());
  if (nomes.size < unicos.length) {
    const { data, error } = await db.rpc("equipe_para_venda");
    // Reserva: sem ela o nome só fica em branco, o documento continua certo.
    if (error) console.warn("[pdf] equipe_para_venda:", error);
    for (const u of (data ?? []) as { id: string; nome: string | null }[]) {
      if (unicos.includes(u.id) && !nomes.has(u.id) && temTexto(u.nome))
        nomes.set(u.id, u.nome.trim());
    }
  }
  return nomes;
}

type LinhaDeItem = {
  id: string;
  descricao: string | null;
  quantidade: number | string | null;
  unidade: string | null;
  largura: number | string | null;
  altura: number | string | null;
  area_total: number | string | null;
  acabamento: string | null;
  arquivo_id: string | null;
  tipo_produto?: string | null;
  especificacao?: string | null;
  valor_unitario?: number | string | null;
  valor_total?: number | string | null;
  custo_unitario?: number | string | null;
};

/**
 * Monta os itens do documento com metragem, acabamento, especificação e a arte
 * de cada um.
 *
 * Cada item do orçamento pode ter várias artes (orcamento_item_arquivos); a
 * marcada como capa é a que aparece no bloco LAYOUT, as outras só contam
 * ("+N"). O bucket é privado: a capa ganha URL assinada, que `renderPDFBlob`
 * baixa e converte logo em seguida. Arte que não assina vira "arte sem prévia"
 * — uma arte ruim nunca derruba o documento.
 */
async function montarItens(
  linhas: LinhaDeItem[],
  opcoes: { mostrarValores: boolean; artesDoOrcamento: boolean },
): Promise<DocItem[]> {
  const artesPorItem = new Map<string, string[]>();
  if (opcoes.artesDoOrcamento && linhas.length > 0) {
    const vinculos = exigir(
      await db
        .from("orcamento_item_arquivos")
        .select("item_id, arquivo_id, capa, ordem")
        .in(
          "item_id",
          linhas.map((l) => l.id),
        )
        .order("capa", { ascending: false })
        .order("ordem"),
      "ler os layouts dos itens",
    ) as { item_id: string; arquivo_id: string }[] | null;
    for (const v of vinculos ?? []) {
      const lista = artesPorItem.get(v.item_id) ?? [];
      lista.push(v.arquivo_id);
      artesPorItem.set(v.item_id, lista);
    }
  }
  // itens antigos (e os da OS) só têm arquivo_id
  for (const l of linhas) {
    if (l.arquivo_id && !artesPorItem.has(l.id)) artesPorItem.set(l.id, [l.arquivo_id]);
  }

  const capas = [...new Set([...artesPorItem.values()].map((artes) => artes[0]))];
  const arquivos = capas.length
    ? ((exigir(
        await db.from("arquivos").select("id, nome, caminho, bucket").in("id", capas),
        "ler os arquivos de layout",
      ) ?? []) as { id: string; nome: string | null; caminho: string; bucket: string | null }[])
    : [];

  // Uma chamada por bucket assina todas as capas de uma vez.
  const urlPorArquivo = new Map<string, string>();
  const porBucket = new Map<string, typeof arquivos>();
  for (const a of arquivos) {
    const bucket = a.bucket || "arquivos-clientes";
    porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), a]);
  }
  await Promise.all(
    [...porBucket].map(async ([bucket, lista]) => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(
        lista.map((a) => a.caminho),
        600,
      );
      if (error) console.warn(`[pdf] não assinou as artes em ${bucket}:`, error);
      for (const assinada of data ?? []) {
        const arquivo = lista.find((a) => a.caminho === assinada.path);
        if (arquivo && assinada.signedUrl) urlPorArquivo.set(arquivo.id, assinada.signedUrl);
      }
    }),
  );
  const arquivoPorId = new Map(arquivos.map((a) => [a.id, a]));

  return linhas.map((i) => {
    const artes = artesPorItem.get(i.id) ?? [];
    const capa = artes[0];
    const url = capa ? (urlPorArquivo.get(capa) ?? null) : null;
    const arquivo = capa ? arquivoPorId.get(capa) : undefined;
    return {
      descricao: String(i.descricao ?? ""),
      especificacao: textoOuNulo(i.especificacao),
      tipo_produto: textoOuNulo(i.tipo_produto),
      unidade: i.unidade ?? undefined,
      quantidade: numero(i.quantidade),
      largura: i.largura != null ? numero(i.largura) : null,
      altura: i.altura != null ? numero(i.altura) : null,
      area_total: i.area_total != null ? numero(i.area_total) : null,
      acabamento: textoOuNulo(i.acabamento),
      layout_url: url,
      // Sem linha em `arquivos` (sem acesso) ou sem URL assinada: a caixa diz
      // que há arte, em vez de o item parecer não ter nenhuma.
      layout_nome: arquivo?.nome ?? (capa ? "arquivo indisponível" : null),
      layout_sem_previa: !!capa && !url,
      layouts_extras: Math.max(0, artes.length - 1),
      valor_unitario: opcoes.mostrarValores ? numero(i.valor_unitario) : 0,
      valor_total: opcoes.mostrarValores ? numero(i.valor_total) : 0,
    };
  });
}

const somaArea = (itens: DocItem[]) => {
  const soma = itens.reduce((total, i) => total + Number(i.area_total ?? 0), 0);
  return soma > 0 ? Math.round(soma * 1000) / 1000 : null;
};

function rotuloDoStatusDaOS(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUS_DA_OS.find((s) => s.status === status)?.rotulo ?? status.replace(/_/g, " ");
}

/**
 * Lei nº 9.504/1997: material impresso de campanha precisa trazer o CNPJ da
 * gráfica, o CNPJ/CPF de quem contratou e a tiragem. A função devolve null
 * quando falta alguma das três partes — meia identificação não cumpre a lei e
 * daria a impressão de que cumpre.
 */
async function lerIdentificacaoLegal(osId: string): Promise<string | null> {
  return (exigir(
    await db.rpc("identificacao_legal_os", { p_os_id: osId }),
    "montar a identificação legal da OS",
  ) ?? null) as string | null;
}

/* ------------------------------------------------------------------------- */
/* Orçamento                                                                  */
/* ------------------------------------------------------------------------- */

type LinhaDoOrcamento = {
  id: string;
  numero: number;
  cliente_id: string | null;
  vendedor_id: string | null;
  status: string | null;
  created_at: string | null;
  validade_dias: number | null;
  observacoes: string | null;
  observacao_cliente: string | null;
  observacao_interna: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  prazo: string | null;
  data_entrega_prometida: string | null;
  condicao_pagamento: unknown;
  precisa_entrega: boolean | null;
  precisa_instalacao: boolean | null;
  endereco_entrega: unknown;
  os_id: string | null;
};

const SEM_LEITURA = Promise.resolve({ data: null, error: null });

async function lerOrcamento(
  orcamentoId: string,
  mostrarValores: boolean,
  nivel: NivelDeVisao | undefined,
  comCusto = false,
) {
  const visao = nivelDaVia(mostrarValores, nivel);
  const colunasDosItens = [
    COLUNAS_DOS_ITENS_DO_ORCAMENTO,
    mostrarValores ? COLUNAS_DE_PRECO_DO_ITEM : null,
    comCusto ? "custo_unitario" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const [rOrcamento, rPreco, rItens] = await Promise.all([
    db.from("orcamentos").select(COLUNAS_DO_ORCAMENTO).eq("id", orcamentoId).maybeSingle(),
    mostrarValores
      ? fromFinancialView("orcamentos", visao)
          .select(COLUNAS_DE_PRECO_DO_ORCAMENTO)
          .eq("id", orcamentoId)
          .maybeSingle()
      : SEM_LEITURA,
    fromFinancialView("orcamento_itens", visao)
      .select(colunasDosItens)
      .eq("orcamento_id", orcamentoId)
      .order("ordem")
      .order("created_at"),
  ]);

  const orc = exigir(rOrcamento, "ler o orçamento") as LinhaDoOrcamento | null;
  if (!orc) throw new Error("Orçamento não encontrado — ou seu perfil não tem acesso a ele.");
  const preco = exigir(rPreco, "ler os valores do orçamento") as {
    valor_subtotal: number | string | null;
    valor_total: number | string | null;
  } | null;
  // A view comercial devolve zero linhas a quem não pode ver preço. Sem isto a
  // via do cliente sairia com tudo R$ 0,00.
  if (mostrarValores && !preco) {
    throw new Error(
      "Seu perfil não vê o preço deste orçamento. Use a via de produção, que sai sem valores.",
    );
  }
  const linhas = (exigir(rItens, "ler os itens do orçamento") ?? []) as LinhaDeItem[];

  const [cliente, nomes, empresa, itens] = await Promise.all([
    lerCliente(orc.cliente_id),
    nomesDosUsuarios([orc.vendedor_id]),
    carregarEmpresa(),
    montarItens(linhas, { mostrarValores, artesDoOrcamento: true }),
  ]);

  const total = mostrarValores ? numero(preco?.valor_total) : 0;
  const somaDosItens = centavos(itens.reduce((s, i) => s + i.valor_total, 0));
  // `valor_subtotal` é NOT NULL DEFAULT 0: orçamento gravado só com o total
  // teria "Total Produtos R$ 0,00" ao lado de itens que somam o preço inteiro.
  const subtotal =
    numero(preco?.valor_subtotal) > 0 ? numero(preco?.valor_subtotal) : somaDosItens || total;
  const condicao = lerCondicao(orc.condicao_pagamento);
  const parcelas = mostrarValores ? parcelasDoAcordo(total, condicao) : null;

  const props: DocumentoPDFProps = {
    tipo: "orcamento",
    numero: orc.numero,
    data_solicitacao: dataBR(orc.created_at),
    data_validade: dataBR(validadeAte(orc.created_at, orc.validade_dias ?? 7)),
    // A entrega é a data prometida ao cliente; a expedição é quando a produção
    // fecha (`prazo`, que a OS herda). Quase sempre são o mesmo dia; quando
    // uma falta, vale a outra.
    data_entrega: dataBR(orc.data_entrega_prometida ?? orc.prazo),
    data_expedicao: dataBR(orc.prazo ?? orc.data_entrega_prometida),
    vendedor: (orc.vendedor_id && nomes.get(orc.vendedor_id)) || null,
    status: orc.status,
    empresa,
    cliente: clienteDoDocumento(cliente, {
      nome: orc.contato_nome,
      telefone: orc.contato_telefone,
      email: orc.contato_email,
      contato: orc.contato_nome,
    }),
    itens,
    soma_area: somaArea(itens),
    subtotal: mostrarValores ? subtotal : null,
    // Desconto é ABATIMENTO, nunca acréscimo: subtotal menor que o total (dado
    // antigo) imprimiria um desconto negativo no documento do cliente — o mesmo
    // defeito já corrigido em converter_orcamento_em_os.
    desconto: mostrarValores ? Math.max(0, centavos(subtotal - total)) : null,
    total,
    pagamento: mostrarValores
      ? { forma: textoOuNulo(condicao.forma), parcelas: parcelas?.length ?? 1 }
      : null,
    parcelas,
    entrega: descreverEntrega(orc),
    // Ao cliente vai a observação dele; sem ela, a antiga `observacoes`; sem as
    // duas, o documento põe as condições gerais da empresa. A via de produção
    // leva só o recado interno — nunca preço, nunca condição comercial.
    observacoes: mostrarValores
      ? (textoOuNulo(orc.observacao_cliente) ?? textoOuNulo(orc.observacoes))
      : null,
    observacao_interna: mostrarValores ? null : textoOuNulo(orc.observacao_interna),
    mostrarValores,
    custos: null,
  };
  return { props, linhas, orcamento: orc };
}

export async function carregarPropsOrcamento(
  orcamentoId: string,
  mostrarValores = true,
  nivel?: NivelDeVisao,
): Promise<DocumentoPDFProps> {
  return (await lerOrcamento(orcamentoId, mostrarValores, nivel)).props;
}

type PecaRealizada = {
  descricao: string | null;
  custo_real_total: number | string | null;
  custo_real_unitario: number | string | null;
  custo_perda: number | string | null;
  margem_real: number | string | null;
};

/**
 * Casa cada item do orçamento com a peça da OS pela descrição, na ordem.
 * Só pela descrição, dois itens iguais (o 1059 tem dois "Adesivo starpac")
 * recebiam os dois o custo da última peça. Aqui o 1º item leva a 1ª peça com
 * aquela descrição, o 2º leva a 2ª — as duas listas vêm em `ordem`, que a
 * conversão copia.
 */
function casarPecas(itens: DocItem[], pecas: PecaRealizada[]): (PecaRealizada | null)[] {
  const fila = new Map<string, PecaRealizada[]>();
  const chave = (d: string | null) => (d ?? "").trim().toLowerCase();
  for (const p of pecas) fila.set(chave(p.descricao), [...(fila.get(chave(p.descricao)) ?? []), p]);
  return itens.map((i) => fila.get(chave(i.descricao))?.shift() ?? null);
}

/**
 * Via INTERNA do orçamento: o mesmo documento com a base de custo anexada.
 *
 * Mostra com que números o preço foi montado — a tarifa de energia, a hora de
 * mão de obra, o custo previsto de cada item — e, quando já houve produção, o
 * que a peça custou de verdade, com o desperdício dentro. Conferir um orçamento
 * antigo sem isso é arqueologia.
 *
 * Nunca é o documento do cliente: quem chama decide, e o documento sai marcado
 * "USO INTERNO". Tudo vem da view financeira e de tabelas com leitura para o
 * financeiro; quem não vê custo recebe o erro, não uma caixa vazia.
 */
export async function carregarPropsOrcamentoComCustos(
  orcamentoId: string,
): Promise<DocumentoPDFProps> {
  const {
    props: base,
    linhas,
    orcamento,
  } = await lerOrcamento(orcamentoId, true, "financeiro", true);

  const [rConfig, rMaoDeObra, rPecas] = await Promise.all([
    db
      .from("config_precificacao_3d")
      .select(
        "tarifa_kwh_padrao, mo_custo_hora_padrao, mo_encargos_pct, markup_padrao, custo_admin_padrao",
      )
      .limit(1)
      .maybeSingle(),
    db
      .from("custos_mao_de_obra")
      .select("funcao, custo_hora, encargos_pct")
      .eq("ativo", true)
      .order("funcao"),
    orcamento.os_id ? db.rpc("custo_real_por_peca", { p_os_id: orcamento.os_id }) : SEM_LEITURA,
  ]);
  const config = exigir(rConfig, "ler as tarifas da precificação") as Record<
    string,
    number | null
  > | null;
  const maoDeObra = (exigir(rMaoDeObra, "ler o custo da mão de obra") ?? []) as {
    funcao: string;
    custo_hora: number;
    encargos_pct: number;
  }[];
  // Custo realizado só existe depois que virou OS e produziu.
  const pecas = (exigir(rPecas, "ler o custo realizado das peças") ?? []) as PecaRealizada[];

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const tarifas: { rotulo: string; valor: string }[] = [];
  if (config) {
    tarifas.push({ rotulo: "Energia", valor: `${brl(numero(config.tarifa_kwh_padrao))}/kWh` });
    tarifas.push({ rotulo: "Mão de obra", valor: `${brl(numero(config.mo_custo_hora_padrao))}/h` });
    if (numero(config.mo_encargos_pct) > 0) {
      tarifas.push({ rotulo: "Encargos", valor: `${numero(config.mo_encargos_pct)}%` });
    }
    tarifas.push({ rotulo: "Markup", valor: `${numero(config.markup_padrao).toFixed(2)}x` });
    // Zerado não é "de graça", é "ninguém preencheu" — e some da conta igual.
    if (numero(config.custo_admin_padrao) === 0) {
      tarifas.push({ rotulo: "Custo admin", valor: "não informado" });
    }
  }
  for (const m of maoDeObra) {
    // A régua de `config_precificacao_3d.mo_encargos_pct` está em pontos
    // percentuais; `custos_mao_de_obra.encargos_pct` guarda fração. A conta vem
    // do domínio, um lugar só.
    tarifas.push({
      rotulo: m.funcao,
      valor: `${brl(custoHoraComEncargos(m.custo_hora, m.encargos_pct))}/h`,
    });
  }

  const realizadas = casarPecas(base.itens, pecas);
  return {
    ...base,
    custos: {
      tarifas,
      itens: base.itens.map((i, k) => {
        const r = realizadas[k];
        const produziu = !!r && numero(r.custo_real_total) > 0;
        return {
          descricao: i.descricao,
          quantidade: i.quantidade,
          // O previsto é o custo do item no orçamento (view financeira) — existe
          // antes da OS; a peça da OS só copia esse número na conversão.
          custo_previsto_unitario: numero(linhas[k]?.custo_unitario),
          custo_real_unitario: produziu ? numero(r.custo_real_unitario) : null,
          custo_perda: produziu && numero(r.custo_perda) > 0 ? numero(r.custo_perda) : null,
          preco_unitario: i.valor_unitario,
          margem_real: produziu && r.margem_real != null ? Number(r.margem_real) : null,
        };
      }),
    },
  };
}

/* ------------------------------------------------------------------------- */
/* OS e fatura                                                                */
/* ------------------------------------------------------------------------- */

type LinhaDaOS = {
  id: string;
  numero: number;
  cliente_id: string | null;
  cliente_nome: string | null;
  vendedor_id: string | null;
  orcamento_id: string | null;
  status: string | null;
  titulo: string | null;
  briefing: string | null;
  observacoes: string | null;
  prazo_entrega: string | null;
  data_entrega_real: string | null;
  created_at: string | null;
  precisa_entrega: boolean | null;
  precisa_instalacao: boolean | null;
  valor_total?: number | string | null;
};

async function lerOS(osId: string, visao: NivelDeVisao, comPreco: boolean) {
  const [rOs, rEntrega, rItens] = await Promise.all([
    fromFinancialView("ordens_servico", visao)
      .select(comPreco ? `${COLUNAS_DA_OS}, valor_total` : COLUNAS_DA_OS)
      .eq("id", osId)
      .maybeSingle(),
    // O endereço só existe na tabela (as views não têm); a coluna tem grant.
    db.from("ordens_servico").select("endereco_entrega").eq("id", osId).maybeSingle(),
    fromFinancialView("itens_os", visao)
      .select(
        comPreco
          ? `${COLUNAS_DOS_ITENS_DA_OS}, ${COLUNAS_DE_PRECO_DO_ITEM}`
          : COLUNAS_DOS_ITENS_DA_OS,
      )
      .eq("os_id", osId)
      .order("ordem")
      .order("created_at"),
  ]);
  const os = exigir(rOs, "ler a OS") as LinhaDaOS | null;
  if (!os) {
    throw new Error(
      comPreco
        ? "OS não encontrada — ou seu perfil não vê os valores dela."
        : "OS não encontrada — ou seu perfil não tem acesso a ela.",
    );
  }
  const endereco = exigir(rEntrega, "ler o endereço de entrega da OS") as {
    endereco_entrega: unknown;
  } | null;
  const linhas = (exigir(rItens, "ler os itens da OS") ?? []) as LinhaDeItem[];
  return {
    os,
    endereco_entrega: endereco?.endereco_entrega ?? null,
    linhas: await comEspecificacaoDaOS(osId, linhas),
  };
}

/**
 * Junta a especificação de cada item (lida da tabela) às linhas da view.
 *
 * Reserva, como o nome do responsável: a especificação enfeita o documento,
 * não muda nada que se cobra nem o que se produz em medida e quantidade. Se a
 * leitura falhar — o banco sem a migração 20261006230000, por exemplo —, a OS
 * sai sem ela e o motivo vai para o console, em vez de o PDF inteiro cair.
 */
async function comEspecificacaoDaOS(osId: string, linhas: LinhaDeItem[]): Promise<LinhaDeItem[]> {
  if (linhas.length === 0) return linhas;
  const { data, error } = await db
    .from("itens_os")
    .select(ESPECIFICACAO_DOS_ITENS_DA_OS)
    .eq("os_id", osId);
  if (error) {
    console.warn("[pdf] a OS sai sem a especificação dos itens:", error);
    return linhas;
  }
  const porItem = new Map<string, string>();
  for (const l of (data ?? []) as { id: string; especificacoes: unknown }[]) {
    const e = l.especificacoes;
    const texto = e && typeof e === "object" ? (e as Record<string, unknown>).texto : null;
    if (temTexto(texto)) porItem.set(l.id, texto.trim());
  }
  return linhas.map((l) => (porItem.has(l.id) ? { ...l, especificacao: porItem.get(l.id) } : l));
}

export async function carregarPropsOS(
  osId: string,
  mostrarValores = true,
  nivel?: NivelDeVisao,
): Promise<DocumentoPDFProps> {
  // Mesma regra do orçamento: via do cliente lê pelo nível, sem custo.
  const visao = nivelDaVia(mostrarValores, nivel);
  const { os, endereco_entrega, linhas } = await lerOS(osId, visao, mostrarValores);

  const [cliente, nomes, empresa, itens, identificacaoLegal] = await Promise.all([
    lerCliente(os.cliente_id),
    nomesDosUsuarios([os.vendedor_id]),
    carregarEmpresa(),
    // A via de produção não mostra valores, mas metragem e layout são o que a
    // oficina precisa — por isso seguem nos itens.
    montarItens(linhas, { mostrarValores, artesDoOrcamento: false }),
    lerIdentificacaoLegal(osId),
  ]);
  const total = mostrarValores ? numero(os.valor_total) : 0;
  const somaDosItens = centavos(itens.reduce((s, i) => s + i.valor_total, 0));

  return {
    tipo: "os",
    numero: os.numero,
    data_solicitacao: dataBR(os.created_at),
    data_entrega: dataBR(os.prazo_entrega),
    vendedor: (os.vendedor_id && nomes.get(os.vendedor_id)) || null,
    status: rotuloDoStatusDaOS(os.status),
    empresa,
    cliente: clienteDoDocumento(cliente, { nome: os.cliente_nome }),
    itens,
    soma_area: somaArea(itens),
    // O desconto da OS não está em view nenhuma; é o que a conversão grava
    // (itens − total), e o total segue os itens desde então.
    subtotal: mostrarValores ? somaDosItens || total : null,
    desconto: mostrarValores ? Math.max(0, centavos(somaDosItens - total)) : null,
    total,
    pagamento: null,
    parcelas: null,
    entrega: descreverEntrega({ ...os, endereco_entrega }),
    // A identificação legal vai junto das observações da OS, que é o bloco que a
    // produção lê antes de imprimir.
    observacoes:
      [textoOuNulo(os.observacoes) ?? textoOuNulo(os.briefing), identificacaoLegal]
        .filter(temTexto)
        .join("\n\n") || null,
    mostrarValores,
    custos: null,
  };
}

/**
 * Fatura da OS — o último elo do encanamento: orçamento → OS → custo → cobrança.
 *
 * Não cria conta a receber: ela já nasce na conversão do orçamento, com as
 * parcelas. Esta função só produz o DOCUMENTO que falta — o papel que o cliente
 * recebe dizendo o que deve, quando vence e quanto já pagou.
 *
 * Material de campanha sai com a identificação exigida pela Lei 9.504/1997, a
 * mesma da OS: a fatura costuma ser o documento que vai para a prestação de
 * contas eleitoral.
 */
export async function carregarPropsFatura(osId: string): Promise<DocumentoPDFProps> {
  const { os, endereco_entrega, linhas } = await lerOS(osId, "financeiro", true);

  const [rContas, rPagos, rResultado, rCondicao] = await Promise.all([
    db
      .from("contas_receber")
      .select("id, parcelas_receber(parcela, valor, vencimento, status)")
      .eq("os_id", osId),
    db.from("pagamentos").select("valor").eq("os_id", osId).eq("status", "pago"),
    db
      .from("os_resultados_financeiros")
      .select("status_financeiro")
      .eq("os_id", osId)
      .maybeSingle(),
    // A OS copia a condição do orçamento na conversão, mas a coluna dela não tem
    // SELECT para a equipe; a do orçamento tem, e nada a muda depois.
    os.orcamento_id
      ? db.from("orcamentos").select("condicao_pagamento").eq("id", os.orcamento_id).maybeSingle()
      : SEM_LEITURA,
  ]);
  const contas = (exigir(rContas, "ler a conta a receber") ?? []) as {
    parcelas_receber: {
      parcela: number;
      valor: number | string;
      vencimento: string | null;
      status: string | null;
    }[];
  }[];
  const pagos = (exigir(rPagos, "ler os pagamentos") ?? []) as { valor: number | string }[];
  const resultado = exigir(rResultado, "ler a situação financeira") as {
    status_financeiro: string | null;
  } | null;
  const condicao = lerCondicao(
    (exigir(rCondicao, "ler a condição de pagamento") as { condicao_pagamento: unknown } | null)
      ?.condicao_pagamento,
  );

  const [cliente, empresa, itens, identificacao] = await Promise.all([
    lerCliente(os.cliente_id),
    carregarEmpresa(),
    montarItens(linhas, { mostrarValores: true, artesDoOrcamento: false }),
    lerIdentificacaoLegal(osId),
  ]);

  const total = numero(os.valor_total);
  const somaDosItens = centavos(itens.reduce((s, i) => s + i.valor_total, 0));
  const valorPago = centavos(pagos.reduce((soma, p) => soma + numero(p.valor), 0));
  const parcelas = contas
    .flatMap((c) => c.parcelas_receber ?? [])
    .map((p) => ({
      numero: numero(p.parcela),
      valor: numero(p.valor),
      vencimento: p.vencimento ?? null,
      pago: p.status === "pago" || p.status === "paga",
    }))
    .sort((a, b) => a.numero - b.numero);
  const situacao = resultado?.status_financeiro;

  return {
    tipo: "fatura",
    numero: os.numero,
    data_solicitacao: dataBR(os.created_at),
    data_entrega: dataBR(os.data_entrega_real ?? os.prazo_entrega),
    status: situacao ? situacao.charAt(0).toUpperCase() + situacao.slice(1) : null,
    vendedor: null,
    empresa,
    cliente: clienteDoDocumento(cliente, { nome: os.cliente_nome }),
    itens,
    soma_area: somaArea(itens),
    subtotal: somaDosItens || total,
    desconto: Math.max(0, centavos(somaDosItens - total)),
    total,
    valor_pago: valorPago,
    parcelas,
    pagamento:
      parcelas.length > 0 || temTexto(condicao.forma)
        ? { forma: textoOuNulo(condicao.forma), parcelas: parcelas.length || null }
        : null,
    entrega: descreverEntrega({ ...os, endereco_entrega }),
    // A identificação legal vem antes da observação livre: numa fiscalização é a
    // primeira coisa que se procura no documento.
    observacoes: [identificacao, textoOuNulo(os.observacoes)].filter(temTexto).join("\n\n") || null,
    mostrarValores: true,
  };
}

/* ------------------------------------------------------------------------- */
/* Orçamento 3D                                                               */
/* ------------------------------------------------------------------------- */

export async function carregarPropsOrcamento3d(
  id: string,
  mostrarValores = true,
): Promise<DocumentoPDFProps> {
  const [rOrc, rCalc] = await Promise.all([
    db
      .from("orcamentos_3d")
      .select(
        "id, titulo, descricao, quantidade, preco_comercial, validade, prazo, status, created_at, created_by, cliente_id, contato_nome, contato_telefone, contato_email",
      )
      .eq("id", id)
      .maybeSingle(),
    // Sem permissão de custo a policy devolve zero linhas (desde 05/10); o
    // unitário cai para preço ÷ quantidade.
    db
      .from("orcamento_3d_calculos")
      .select("valor_unitario")
      .eq("orcamento_3d_id", id)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const orc = exigir(rOrc, "ler o orçamento 3D") as {
    id: string;
    titulo: string | null;
    descricao: string | null;
    quantidade: number | string | null;
    preco_comercial: number | string | null;
    validade: string | null;
    prazo: string | null;
    status: string | null;
    created_at: string | null;
    created_by: string | null;
    cliente_id: string | null;
    contato_nome: string | null;
    contato_telefone: string | null;
    contato_email: string | null;
  } | null;
  if (!orc) throw new Error("Orçamento 3D não encontrado — ou seu perfil não tem acesso a ele.");
  const calc = exigir(rCalc, "ler o cálculo do orçamento 3D") as {
    valor_unitario: number | string | null;
  } | null;

  const [cliente, nomes, empresa] = await Promise.all([
    lerCliente(orc.cliente_id),
    nomesDosUsuarios([orc.created_by]),
    carregarEmpresa(),
  ]);

  const qtd = numero(orc.quantidade) || 1;
  const preco = numero(orc.preco_comercial);
  const unit = calc?.valor_unitario != null ? numero(calc.valor_unitario) : preco / qtd;

  return {
    tipo: "orcamento_3d",
    numero: String(orc.id).slice(0, 8).toUpperCase(),
    data_solicitacao: dataBR(orc.created_at),
    // `validade` é coluna date: dataBR não a faz voltar um dia.
    data_validade: dataBR(orc.validade) ?? dataBR(validadeAte(orc.created_at, 7)),
    data_entrega: dataBR(orc.prazo),
    vendedor: (orc.created_by && nomes.get(orc.created_by)) || null,
    status: orc.status,
    empresa,
    cliente: clienteDoDocumento(cliente, {
      nome: orc.contato_nome,
      telefone: orc.contato_telefone,
      email: orc.contato_email,
      contato: orc.contato_nome,
    }),
    itens: [
      {
        descricao: String(orc.titulo ?? "Peça 3D"),
        unidade: "un",
        quantidade: qtd,
        valor_unitario: mostrarValores ? unit : 0,
        valor_total: mostrarValores ? preco : 0,
      },
    ],
    subtotal: mostrarValores ? preco : null,
    desconto: mostrarValores ? 0 : null,
    total: mostrarValores ? preco : 0,
    observacoes: textoOuNulo(orc.descricao),
    mostrarValores,
  };
}

/* ------------------------------------------------------------------------- */
/* Recibo de material                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Recibo de retirada de material — o papel que a baixa de estoque não tinha.
 *
 * A saída já grava material, quantidade, OS, quem retirou e quando; aqui isso
 * vira documento assinável. Sem valores: é controle de material, não de dinheiro,
 * e o custo do insumo não é assunto de quem assina no balcão.
 */
export async function carregarPropsReciboMaterial(osId: string): Promise<DocumentoPDFProps> {
  const [rOs, rMovimentos] = await Promise.all([
    fromFinancialView("ordens_servico", "operacional")
      .select(COLUNAS_DA_OS)
      .eq("id", osId)
      .maybeSingle(),
    db
      .from("movimentacoes_estoque")
      .select("id, created_at, quantidade, unidade, material_id, usuario_id, motivo")
      .eq("os_id", osId)
      .eq("tipo", "saida")
      .order("created_at"),
  ]);
  const os = exigir(rOs, "ler a OS") as LinhaDaOS | null;
  if (!os) throw new Error("OS não encontrada — ou seu perfil não tem acesso a ela.");
  const linhas = (exigir(rMovimentos, "ler as baixas de estoque da OS") ?? []) as {
    created_at: string;
    quantidade: number | string | null;
    unidade: string | null;
    material_id: string;
    usuario_id: string | null;
    motivo: string | null;
  }[];
  if (linhas.length === 0) {
    throw new Error("Esta OS ainda não teve baixa de estoque — não há o que dar recibo.");
  }

  const idsMaterial = [...new Set(linhas.map((m) => m.material_id))];
  const [cliente, rMateriais, nomes, empresa] = await Promise.all([
    lerCliente(os.cliente_id),
    db.from("materiais").select("id, nome, unidade").in("id", idsMaterial),
    nomesDosUsuarios(linhas.map((m) => m.usuario_id)),
    carregarEmpresa(),
  ]);
  const materiais = (exigir(rMateriais, "ler os materiais") ?? []) as {
    id: string;
    nome: string;
    unidade: string | null;
  }[];
  const materialPorId = new Map(materiais.map((m) => [m.id, m]));

  // Quem retirou: normalmente é uma pessoa só na baixa inteira. Havendo mais de
  // uma, o recibo lista todas em vez de escolher uma e mentir na assinatura.
  // Nome que não resolve deixa a linha em branco para assinar à mão — melhor
  // que imprimir um nome errado ou um "—" onde deveria haver responsável.
  const retirantes = [
    ...new Set(
      linhas.map((m) => (m.usuario_id ? nomes.get(m.usuario_id) : undefined)).filter(temTexto),
    ),
  ];

  return {
    tipo: "recibo_material",
    numero: os.numero,
    data_solicitacao: dataBR(linhas[0].created_at),
    vendedor: null,
    status: rotuloDoStatusDaOS(os.status),
    empresa,
    cliente: clienteDoDocumento(cliente, { nome: os.cliente_nome }),
    itens: linhas.map((m) => {
      const material = materialPorId.get(m.material_id);
      return {
        descricao: material?.nome ?? "(material removido)",
        unidade: m.unidade ?? material?.unidade ?? undefined,
        quantidade: numero(m.quantidade),
        valor_unitario: 0,
        valor_total: 0,
        acabamento: textoOuNulo(m.motivo),
      };
    }),
    total: 0,
    observacoes: `Material retirado do estoque para a OS ${os.numero}${
      retirantes.length > 0 ? ` por ${retirantes.join(", ")}` : ""
    }. A assinatura confirma o recebimento das quantidades acima.`,
    assinaturas: {
      esquerda: `Entregue por (${empresa.razao_social ?? empresa.nome})`,
      direita: retirantes.length === 1 ? `Retirado por ${retirantes[0]}` : "Retirado por",
    },
    mostrarValores: false,
  };
}

/* ------------------------------------------------------------------------- */
/* Histórico                                                                  */
/* ------------------------------------------------------------------------- */

export async function salvarERegistrarPDF(opts: {
  blob: Blob;
  tipo: "orcamento" | "os" | "orcamento_3d" | "recibo_material" | "fatura";
  referencia_id: string;
  numero: number | string;
  /** `custos` é a via interna: mesma folha, com a base de custo anexada. */
  variante: "cliente" | "producao" | "custos";
}) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const sufixo =
    opts.variante === "producao" ? "-producao" : opts.variante === "custos" ? "-custos" : "";
  const filename = `${opts.tipo}-${opts.numero}${sufixo}.pdf`;
  const path = `${opts.tipo}/${opts.referencia_id}/${Date.now()}-${filename}`;

  const { error: upErr } = await supabase.storage
    .from("documentos-pdf")
    .upload(path, opts.blob, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  const { error: regErr } = await supabase.from("documentos_gerados").insert({
    tipo: opts.tipo,
    referencia_id: opts.referencia_id,
    variante: opts.variante,
    numero: Number(opts.numero) || null,
    caminho: path,
    tamanho_bytes: opts.blob.size,
    gerado_por: userId,
  });
  if (regErr) throw regErr;

  return { path, filename };
}

/** Renderiza + sobe no Storage + baixa para o usuário. */
export async function gerarESalvarPDF(opts: {
  tipo: "orcamento" | "os" | "orcamento_3d" | "recibo_material" | "fatura";
  referencia_id: string;
  mostrarValores?: boolean;
  /** Nível de quem pede (useAuth().nivelDeVisao); sem ele a via do cliente lê o comercial. */
  nivelDeVisao?: NivelDeVisao;
}) {
  // Recibo de material nunca mostra valor; a fatura é o oposto — ela existe
  // justamente para mostrar.
  const mostrar = opts.tipo === "recibo_material" ? false : (opts.mostrarValores ?? true);
  const props =
    opts.tipo === "orcamento"
      ? await carregarPropsOrcamento(opts.referencia_id, mostrar, opts.nivelDeVisao)
      : opts.tipo === "orcamento_3d"
        ? await carregarPropsOrcamento3d(opts.referencia_id, mostrar)
        : opts.tipo === "recibo_material"
          ? await carregarPropsReciboMaterial(opts.referencia_id)
          : opts.tipo === "fatura"
            ? await carregarPropsFatura(opts.referencia_id)
            : await carregarPropsOS(opts.referencia_id, mostrar, opts.nivelDeVisao);
  const blob = await renderPDFBlob(props);
  const { filename } = await salvarERegistrarPDF({
    blob,
    tipo: opts.tipo,
    referencia_id: opts.referencia_id,
    numero: props.numero,
    variante: mostrar ? "cliente" : "producao",
  });
  download(blob, filename);
  return { props, filename };
}

// Backwards-compat wrappers (caso algum lugar ainda chame os antigos)
export const gerarPDFOrcamento = (id: string, mostrarValores = true) =>
  gerarESalvarPDF({ tipo: "orcamento", referencia_id: id, mostrarValores });
export const gerarPDFOS = (id: string, mostrarValores = true) =>
  gerarESalvarPDF({ tipo: "os", referencia_id: id, mostrarValores });
