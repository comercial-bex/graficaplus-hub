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
    desconto: mostrarValores
      ? Number((orc as any).valor_subtotal ?? total) - total
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

  const [empresa, itensDoc] = await Promise.all([
    carregarEmpresa(),
    montarItens((itens ?? []) as Record<string, unknown>[], mostrarValores),
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
    observacoes: os.observacoes ?? os.briefing,
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

export async function salvarERegistrarPDF(opts: {
  blob: Blob;
  tipo: "orcamento" | "os" | "orcamento_3d";
  referencia_id: string;
  numero: number | string;
  variante: "cliente" | "producao";
}) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const filename = `${opts.tipo}-${opts.numero}${opts.variante === "producao" ? "-producao" : ""}.pdf`;
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
  tipo: "orcamento" | "os" | "orcamento_3d";
  referencia_id: string;
  mostrarValores?: boolean;
}) {
  const mostrar = opts.mostrarValores ?? true;
  const props =
    opts.tipo === "orcamento"
      ? await carregarPropsOrcamento(opts.referencia_id, mostrar)
      : opts.tipo === "orcamento_3d"
        ? await carregarPropsOrcamento3d(opts.referencia_id, mostrar)
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
