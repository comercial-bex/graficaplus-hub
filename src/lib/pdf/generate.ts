import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { DocumentoPDF, type DocItem, type DocumentoPDFProps } from "./DocumentoPDF";
import { carregarEmpresa } from "./empresa";

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

function fmt(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

export async function renderPDFBlob(props: DocumentoPDFProps): Promise<Blob> {
  const { pdf } = await import("@react-pdf/renderer");
  return await pdf(DocumentoPDF(props)).toBlob();
}

/**
 * Monta os itens do documento com metragem, acabamento e o layout de cada um.
 *
 * O bucket arquivos-clientes é privado, então a arte precisa de URL assinada —
 * o caminho gravado NÃO é público. A assinatura vale 5 min, o suficiente para o
 * @react-pdf/renderer buscar a imagem enquanto monta o PDF.
 */
async function montarItens(
  linhas: Record<string, unknown>[],
  mostrarValores: boolean,
): Promise<DocItem[]> {
  const caminhoPorArquivo = new Map<string, string>();
  const idsLayout = linhas
    .map((i) => i.arquivo_id as string | null)
    .filter((id): id is string => !!id);

  if (idsLayout.length > 0) {
    const { data: arquivos } = await supabase
      .from("arquivos")
      .select("id, caminho")
      .in("id", idsLayout);
    for (const a of arquivos ?? []) {
      const registro = a as { id: string; caminho: string };
      caminhoPorArquivo.set(registro.id, registro.caminho);
    }
  }

  const urlPorArquivo = new Map<string, string>();
  await Promise.all(
    [...caminhoPorArquivo.entries()].map(async ([id, caminho]) => {
      const { data } = await supabase.storage
        .from("arquivos-clientes")
        .createSignedUrl(caminho, 300);
      if (data?.signedUrl) urlPorArquivo.set(id, data.signedUrl);
    }),
  );

  return linhas.map((i) => ({
    descricao: String(i.descricao ?? ""),
    unidade: (i.unidade as string) ?? undefined,
    quantidade: Number(i.quantidade ?? 0),
    largura: i.largura != null ? Number(i.largura) : null,
    altura: i.altura != null ? Number(i.altura) : null,
    area_total: i.area_total != null ? Number(i.area_total) : null,
    acabamento: (i.acabamento as string) ?? null,
    layout_url: i.arquivo_id ? (urlPorArquivo.get(i.arquivo_id as string) ?? null) : null,
    valor_unitario: mostrarValores ? Number(i.valor_unitario ?? 0) : 0,
    valor_total: mostrarValores ? Number(i.valor_total ?? 0) : 0,
  }));
}

const somaArea = (itens: DocItem[]) => {
  const soma = itens.reduce((total, i) => total + Number(i.area_total ?? 0), 0);
  return soma > 0 ? Math.round(soma * 1000) / 1000 : null;
};

/** "Cliente retira na empresa" ou o endereço montado do jsonb. */
function descreverEntrega(entrega: unknown): string | null {
  if (!entrega || typeof entrega !== "object") return null;
  const e = entrega as Record<string, unknown>;
  if (typeof e.descricao === "string" && e.descricao.trim()) return e.descricao;
  const partes = [e.logradouro, e.numero, e.bairro, e.cidade, e.estado, e.cep]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return partes.length > 0 ? partes.join(", ") : null;
}

function descreverPagamento(condicao: unknown, total: number) {
  if (!condicao || typeof condicao !== "object") return null;
  const c = condicao as Record<string, unknown>;
  const parcelas = Number(c.parcelas ?? 0) || null;
  return {
    forma: typeof c.forma === "string" ? c.forma : null,
    parcelas,
    valor_parcela: parcelas && parcelas > 0 ? Math.round((total / parcelas) * 100) / 100 : null,
  };
}

export async function carregarPropsOrcamento(
  orcamentoId: string,
  mostrarValores = true,
): Promise<DocumentoPDFProps> {
  const { data: orc, error } = await fromFinancialView("orcamentos", mostrarValores)
    .select("*")
    .eq("id", orcamentoId)
    .single();
  if (error || !orc) throw error ?? new Error("Orçamento não encontrado");

  const [{ data: cliente }, { data: vendedor }, { data: itens = [] }] = await Promise.all([
    supabase
      .from("clientes")
      .select("*")
      .eq("id", (orc as any).cliente_id)
      .single(),
    (orc as any).vendedor_id
      ? supabase
          .from("usuarios")
          .select("nome")
          .eq("id", (orc as any).vendedor_id)
          .single()
      : Promise.resolve({ data: null }),
    fromFinancialView("orcamento_itens", mostrarValores)
      .select("*")
      .eq("orcamento_id", orcamentoId)
      .order("ordem"),
  ]);

  const validade = orc.created_at
    ? new Date(
        new Date(orc.created_at).getTime() + (orc.validade_dias ?? 7) * 86400000,
      ).toLocaleDateString("pt-BR")
    : null;

  const [empresa, itensDoc] = await Promise.all([
    carregarEmpresa(),
    montarItens((itens ?? []) as Record<string, unknown>[], mostrarValores),
  ]);
  const total = mostrarValores ? Number((orc as any).valor_total ?? 0) : 0;
  const c = (cliente ?? {}) as any;

  return {
    tipo: "orcamento",
    numero: orc.numero,
    data_solicitacao: fmt(orc.created_at),
    data_validade: validade,
    data_entrega: fmt((orc as any).prazo),
    vendedor: (vendedor as any)?.nome ?? null,
    status: orc.status,
    empresa,
    cliente: {
      nome: c.nome ?? (orc as any).cliente_nome ?? (orc as any).contato_nome ?? "—",
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      documento: c.documento ?? c.cpf_cnpj,
      endereco: c.endereco,
      bairro: c.bairro,
      cidade: c.cidade,
      estado: c.estado,
      cep: c.cep,
      telefone: c.telefone ?? (orc as any).contato_telefone,
      celular: c.whatsapp_principal,
      email: c.email ?? (orc as any).contato_email,
      contato: (orc as any).contato_nome,
    },
    itens: itensDoc,
    soma_area: somaArea(itensDoc),
    subtotal: mostrarValores ? Number((orc as any).valor_subtotal ?? total) : null,
    // Desconto é ABATIMENTO, nunca acréscimo. `valor_subtotal` é NOT NULL
    // DEFAULT 0, então um orçamento gravado só com o total daria subtotal
    // menor que o total e IMPRIMIRIA um desconto negativo no documento do
    // cliente — o mesmo defeito já corrigido em converter_orcamento_em_os.
    desconto: mostrarValores
      ? Math.max(0, Number((orc as any).valor_subtotal ?? total) - total)
      : null,
    total,
    pagamento: mostrarValores
      ? descreverPagamento((orc as any).condicao_pagamento, total)
      : null,
    entrega: descreverEntrega((orc as any).endereco_entrega),
    observacoes: orc.observacoes,
    mostrarValores,
  };
}

/**
 * Via INTERNA do orçamento: o mesmo documento com a base de custo anexada.
 *
 * Mostra com que números o preço foi montado — a tarifa de energia, a hora de
 * mão de obra, o custo do material — e, quando já houve produção, o que a peça
 * custou de verdade, com o desperdício dentro. Conferir um orçamento antigo sem
 * isso é arqueologia.
 *
 * Nunca é o documento do cliente: quem chama decide, e o preview marca a via.
 */
export async function carregarPropsOrcamentoComCustos(
  orcamentoId: string,
): Promise<DocumentoPDFProps> {
  const base = await carregarPropsOrcamento(orcamentoId, true);

  const [{ data: config }, { data: maoDeObra = [] }, { data: orc }] = await Promise.all([
    (supabase as any).from("config_precificacao_3d").select("*").limit(1).maybeSingle(),
    (supabase as any).from("custos_mao_de_obra").select("funcao, custo_hora, encargos_pct").eq("ativo", true).order("funcao"),
    (supabase as any).from("orcamentos").select("os_id").eq("id", orcamentoId).maybeSingle(),
  ]);

  const num = (v: unknown) => Number(v ?? 0);
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const tarifas: { rotulo: string; valor: string }[] = [];
  if (config) {
    tarifas.push({ rotulo: "Energia", valor: `${brl(num(config.tarifa_kwh_padrao))}/kWh` });
    tarifas.push({ rotulo: "Mão de obra", valor: `${brl(num(config.mo_custo_hora_padrao))}/h` });
    if (num(config.mo_encargos_pct) > 0) {
      tarifas.push({ rotulo: "Encargos", valor: `${num(config.mo_encargos_pct)}%` });
    }
    tarifas.push({ rotulo: "Markup", valor: `${num(config.markup_padrao).toFixed(2)}x` });
    // Zerado não é "de graça", é "ninguém preencheu" — e some da conta igual.
    if (num(config.custo_admin_padrao) === 0) {
      tarifas.push({ rotulo: "Custo admin", valor: "não informado" });
    }
  }
  for (const m of (maoDeObra ?? []) as any[]) {
    const cheia = num(m.custo_hora) * (1 + num(m.encargos_pct) / 100);
    tarifas.push({ rotulo: m.funcao, valor: `${brl(cheia)}/h` });
  }

  // Custo realizado só existe depois que virou OS e produziu.
  let realizados: Record<string, any> = {};
  const osId = (orc as any)?.os_id;
  if (osId) {
    const { data: pecas } = await (supabase.rpc as any)("custo_real_por_peca", { p_os_id: osId });
    for (const p of (pecas ?? []) as any[]) realizados[String(p.descricao)] = p;
  }

  return {
    ...base,
    custos: {
      tarifas,
      itens: base.itens.map((i) => {
        const r = realizados[i.descricao];
        return {
          descricao: i.descricao,
          quantidade: i.quantidade,
          custo_previsto_unitario: r ? num(r.custo_previsto_unitario) : 0,
          custo_real_unitario: r ? num(r.custo_real_unitario) : null,
          custo_perda: r && num(r.custo_perda) > 0 ? num(r.custo_perda) : null,
          preco_unitario: i.valor_unitario,
          margem_real: r?.margem_real != null ? Number(r.margem_real) : null,
        };
      }),
    },
  };
}

export async function carregarPropsOS(
  osId: string,
  mostrarValores = true,
): Promise<DocumentoPDFProps> {
  const { data: os, error } = await fromFinancialView("ordens_servico", mostrarValores)
    .select("*")
    .eq("id", osId)
    .single();
  if (error || !os) throw error ?? new Error("OS não encontrada");

  const [{ data: cliente }, { data: vendedor }, { data: itens = [] }] = await Promise.all([
    supabase
      .from("clientes")
      .select("*")
      .eq("id", (os as any).cliente_id)
      .single(),
    (os as any).vendedor_id
      ? supabase
          .from("usuarios")
          .select("nome")
          .eq("id", (os as any).vendedor_id)
          .single()
      : Promise.resolve({ data: null }),
    fromFinancialView("itens_os", mostrarValores).select("*").eq("os_id", osId).order("ordem"),
  ]);

  const [empresa, itensDoc, identificacaoLegal] = await Promise.all([
    carregarEmpresa(),
    montarItens((itens ?? []) as Record<string, unknown>[], mostrarValores),
    // Lei nº 9.504/1997: material impresso de campanha precisa trazer o CNPJ da
    // gráfica, o CNPJ/CPF de quem contratou e a tiragem. A função devolve null
    // quando falta alguma das três partes — meia identificação não cumpre a lei
    // e daria a impressão de que cumpre.
    (supabase.rpc as any)("identificacao_legal_os", { p_os_id: osId }).then(
      (r: { data: string | null }) => r.data ?? null,
    ),
  ]);
  const total = mostrarValores ? Number((os as any).valor_total ?? 0) : 0;
  const c = (cliente ?? {}) as any;

  return {
    tipo: "os",
    numero: os.numero,
    data_solicitacao: fmt(os.created_at),
    data_entrega: fmt(os.prazo_entrega),
    vendedor: (vendedor as any)?.nome ?? null,
    status: os.status,
    empresa,
    cliente: {
      nome: c.nome ?? (os as any).cliente_nome ?? "—",
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      documento: c.documento ?? c.cpf_cnpj,
      endereco: c.endereco,
      bairro: c.bairro,
      cidade: c.cidade,
      estado: c.estado,
      cep: c.cep,
      telefone: c.telefone,
      celular: c.whatsapp_principal,
      email: c.email,
    },
    itens: itensDoc,
    soma_area: somaArea(itensDoc),
    // A via de produção não mostra valores, mas metragem e layout são o que
    // a oficina precisa — por isso seguem presentes nos itens acima.
    subtotal: null,
    desconto: mostrarValores ? Number((os as any).desconto ?? 0) : null,
    total,
    pagamento: mostrarValores
      ? descreverPagamento((os as any).condicao_pagamento, total)
      : null,
    entrega: descreverEntrega((os as any).endereco_entrega),
    // A identificação legal vai junto das observações da OS, que é o bloco que a
    // produção lê antes de imprimir.
    observacoes: [os.observacoes ?? os.briefing, identificacaoLegal]
      .filter(Boolean)
      .join("\n\n"),
    mostrarValores,
  };
}

export async function carregarPropsOrcamento3d(
  id: string,
  mostrarValores = true,
): Promise<DocumentoPDFProps> {
  const { data: orc, error } = await (supabase as any)
    .from("orcamentos_3d")
    .select("*, clientes(*)")
    .eq("id", id)
    .single();
  if (error || !orc) throw error ?? new Error("Orçamento 3D não encontrado");

  const { data: calc } = await (supabase as any)
    .from("orcamento_3d_calculos")
    .select("valor_unitario")
    .eq("orcamento_3d_id", id)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  const qtd = Number(orc.quantidade ?? 1) || 1;
  const preco = Number(orc.preco_comercial ?? 0);
  const unit = calc?.valor_unitario != null ? Number(calc.valor_unitario) : qtd > 0 ? preco / qtd : preco;
  const validade = orc.validade
    ? new Date(orc.validade).toLocaleDateString("pt-BR")
    : orc.created_at
      ? new Date(new Date(orc.created_at).getTime() + 7 * 86400000).toLocaleDateString("pt-BR")
      : null;
  const cli = (orc.clientes ?? {}) as any;
  const empresa = await carregarEmpresa();

  return {
    tipo: "orcamento_3d",
    numero: String(id).slice(0, 8).toUpperCase(),
    data_solicitacao: fmt(orc.created_at),
    data_validade: validade,
    vendedor: null,
    status: orc.status,
    empresa,
    cliente: {
      nome: cli.nome ?? "—",
      razao_social: cli.razao_social,
      nome_fantasia: cli.nome_fantasia,
      documento: cli.documento ?? cli.cpf_cnpj,
      endereco: cli.endereco,
      bairro: cli.bairro,
      cidade: cli.cidade,
      estado: cli.estado,
      cep: cli.cep,
      telefone: cli.telefone,
      celular: cli.whatsapp_principal,
      email: cli.email,
    },
    itens: [
      {
        descricao: orc.titulo,
        unidade: "un",
        quantidade: qtd,
        valor_unitario: mostrarValores ? unit : 0,
        valor_total: mostrarValores ? preco : 0,
      },
    ],
    total: mostrarValores ? preco : 0,
    observacoes: orc.descricao ?? null,
    mostrarValores,
  };
}

/**
 * Recibo de retirada de material — o papel que a baixa de estoque não tinha.
 *
 * A saída já grava material, quantidade, OS, quem retirou e quando; aqui isso
 * vira documento assinável. Sem valores: é controle de material, não de dinheiro,
 * e o custo do insumo não é assunto de quem assina no balcão.
 */
export async function carregarPropsReciboMaterial(osId: string): Promise<DocumentoPDFProps> {
  const { data: os, error } = await fromFinancialView("ordens_servico", false)
    .select("*")
    .eq("id", osId)
    .single();
  if (error || !os) throw error ?? new Error("OS não encontrada");

  const { data: movimentos = [] } = await supabase
    .from("movimentacoes_estoque")
    .select("id, created_at, quantidade, unidade, material_id, usuario_id, motivo")
    .eq("os_id", osId)
    .eq("tipo", "saida")
    .order("created_at");

  const linhas = (movimentos ?? []) as Record<string, unknown>[];
  if (linhas.length === 0) {
    throw new Error("Esta OS ainda não teve baixa de estoque — não há o que dar recibo.");
  }

  const idsMaterial = [...new Set(linhas.map((m) => m.material_id as string))];
  const idsUsuario = [
    ...new Set(linhas.map((m) => m.usuario_id as string | null).filter(Boolean)),
  ] as string[];

  const [{ data: cliente }, { data: materiais }, { data: usuarios }, empresa] = await Promise.all([
    (os as any).cliente_id
      ? supabase.from("clientes").select("*").eq("id", (os as any).cliente_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("materiais").select("id, nome, unidade").in("id", idsMaterial),
    idsUsuario.length
      ? supabase.from("usuarios").select("id, nome").in("id", idsUsuario)
      : Promise.resolve({ data: [] as any[] }),
    carregarEmpresa(),
  ]);

  const nomeMaterial = new Map((materiais ?? []).map((m: any) => [m.id, m]));
  const nomeUsuario = new Map((usuarios ?? []).map((u: any) => [u.id, u.nome]));
  const c = (cliente ?? {}) as any;

  // Quem retirou: normalmente é uma pessoa só na baixa inteira. Havendo mais de
  // uma, o recibo lista todas em vez de escolher uma e mentir na assinatura.
  //
  // A policy de `usuarios` só libera o próprio registro (fora admin e gestor).
  // Quem emite o recibo da própria baixa vê o próprio nome; emitindo o recibo de
  // uma baixa feita por outra pessoa, o nome não resolve. Nesse caso o documento
  // sai com a linha em branco para assinar à mão — melhor que imprimir um nome
  // errado ou um "—" onde deveria haver responsável.
  const retirantes = [
    ...new Set(linhas.map((m) => nomeUsuario.get(m.usuario_id as string)).filter(Boolean)),
  ] as string[];

  return {
    tipo: "recibo_material",
    numero: os.numero,
    data_solicitacao: fmt(String(linhas[0].created_at)),
    vendedor: null,
    status: os.status,
    empresa,
    cliente: {
      nome: c.nome ?? (os as any).cliente_nome ?? "—",
      razao_social: c.razao_social,
      documento: c.documento ?? c.cpf_cnpj,
      cidade: c.cidade,
      estado: c.estado,
      telefone: c.telefone,
    },
    itens: linhas.map((m) => {
      const mat: any = nomeMaterial.get(m.material_id as string);
      return {
        descricao: mat?.nome ?? "(material removido)",
        unidade: (m.unidade as string) ?? mat?.unidade ?? undefined,
        quantidade: Number(m.quantidade ?? 0),
        valor_unitario: 0,
        valor_total: 0,
        acabamento: (m.motivo as string) ?? null,
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
  const { data: os, error } = await fromFinancialView("ordens_servico", true)
    .select("*")
    .eq("id", osId)
    .single();
  if (error || !os) throw error ?? new Error("OS não encontrada");

  const [{ data: cliente }, { data: itens = [] }, { data: conta }, { data: pagos }, empresa] =
    await Promise.all([
      supabase.from("clientes").select("*").eq("id", (os as any).cliente_id).single(),
      fromFinancialView("itens_os", true).select("*").eq("os_id", osId).order("ordem"),
      (supabase as any)
        .from("contas_receber")
        .select("id, valor_total, status, parcelas_receber(parcela, valor, vencimento, status)")
        .eq("os_id", osId)
        .maybeSingle(),
      (supabase as any)
        .from("pagamentos")
        .select("valor, status")
        .eq("os_id", osId)
        .eq("status", "pago"),
      carregarEmpresa(),
    ]);

  const itensDoc = await montarItens((itens ?? []) as Record<string, unknown>[], true);
  const total = Number((os as any).valor_total ?? 0);
  const valorPago = ((pagos ?? []) as { valor: number }[]).reduce(
    (soma, p) => soma + Number(p.valor ?? 0),
    0,
  );

  const parcelas = (((conta as any)?.parcelas_receber ?? []) as any[])
    .map((p) => ({
      numero: Number(p.parcela ?? 0),
      valor: Number(p.valor ?? 0),
      vencimento: p.vencimento ?? null,
      pago: p.status === "pago" || p.status === "paga",
    }))
    .sort((a, b) => a.numero - b.numero);

  const { data: identificacao } = await (supabase.rpc as any)("identificacao_legal_os", {
    p_os_id: osId,
  });

  const c = (cliente ?? {}) as any;
  return {
    tipo: "fatura",
    numero: os.numero,
    data_solicitacao: fmt(os.created_at),
    data_entrega: fmt((os as any).data_entrega_real ?? os.prazo_entrega),
    status: (os as any).status_financeiro ?? os.status,
    vendedor: null,
    empresa,
    cliente: {
      nome: c.nome ?? (os as any).cliente_nome ?? "—",
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      documento: c.documento ?? c.cpf_cnpj,
      endereco: c.endereco,
      bairro: c.bairro,
      cidade: c.cidade,
      estado: c.estado,
      cep: c.cep,
      telefone: c.telefone,
      celular: c.whatsapp_principal,
      email: c.email,
    },
    itens: itensDoc,
    soma_area: somaArea(itensDoc),
    subtotal: Number((os as any).valor_subtotal ?? total),
    desconto: Number((os as any).desconto ?? 0),
    total,
    valor_pago: valorPago,
    parcelas,
    pagamento: descreverPagamento((os as any).condicao_pagamento, total),
    entrega: descreverEntrega((os as any).endereco_entrega),
    // A identificação legal vem antes da observação livre: numa fiscalização é a
    // primeira coisa que se procura no documento.
    observacoes: [identificacao, os.observacoes].filter(Boolean).join("\n\n") || null,
    mostrarValores: true,
  };
}

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
}) {
  // O recibo nunca mostra valores, independente de quem clicou.
  // Recibo de material nunca mostra valor; a fatura é o oposto — ela existe
  // justamente para mostrar.
  const mostrar = opts.tipo === "recibo_material" ? false : (opts.mostrarValores ?? true);
  const props =
    opts.tipo === "orcamento"
      ? await carregarPropsOrcamento(opts.referencia_id, mostrar)
      : opts.tipo === "orcamento_3d"
        ? await carregarPropsOrcamento3d(opts.referencia_id, mostrar)
        : opts.tipo === "recibo_material"
          ? await carregarPropsReciboMaterial(opts.referencia_id)
          : opts.tipo === "fatura"
            ? await carregarPropsFatura(opts.referencia_id)
            : await carregarPropsOS(opts.referencia_id, mostrar);
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
