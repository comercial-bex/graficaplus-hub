import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { DocumentoPDF, type DocumentoPDFProps } from "./DocumentoPDF";

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

  return {
    tipo: "orcamento",
    numero: orc.numero,
    data_solicitacao: fmt(orc.created_at),
    data_validade: validade,
    vendedor: (vendedor as any)?.nome ?? null,
    status: orc.status,
    cliente: {
      nome: (cliente as any)?.nome ?? (orc as any).cliente_nome ?? "—",
      documento: (cliente as any)?.documento,
      endereco: (cliente as any)?.endereco,
      cidade: (cliente as any)?.cidade,
      estado: (cliente as any)?.estado,
      cep: (cliente as any)?.cep,
      telefone: (cliente as any)?.telefone,
      email: (cliente as any)?.email,
    },
    itens: (itens ?? []).map((i: any) => ({
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      valor_unitario: mostrarValores ? Number(i.valor_unitario) : 0,
      valor_total: mostrarValores ? Number(i.valor_total) : 0,
    })),
    total: mostrarValores ? Number((orc as any).valor_total) : 0,
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

  return {
    tipo: "os",
    numero: os.numero,
    data_solicitacao: fmt(os.created_at),
    data_entrega: fmt(os.prazo_entrega),
    vendedor: (vendedor as any)?.nome ?? null,
    status: os.status,
    cliente: {
      nome: (cliente as any)?.nome ?? (os as any).cliente_nome ?? "—",
      documento: (cliente as any)?.documento,
      endereco: (cliente as any)?.endereco,
      cidade: (cliente as any)?.cidade,
      estado: (cliente as any)?.estado,
      cep: (cliente as any)?.cep,
      telefone: (cliente as any)?.telefone,
      email: (cliente as any)?.email,
    },
    itens: (itens ?? []).map((i: any) => ({
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      valor_unitario: mostrarValores ? Number(i.valor_unitario) : 0,
      valor_total: mostrarValores ? Number(i.valor_total) : 0,
    })),
    total: mostrarValores ? Number((os as any).valor_total) : 0,
    observacoes: os.observacoes ?? os.briefing,
    mostrarValores,
  };
}

export async function salvarERegistrarPDF(opts: {
  blob: Blob;
  tipo: "orcamento" | "os";
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
  tipo: "orcamento" | "os";
  referencia_id: string;
  mostrarValores?: boolean;
}) {
  const mostrar = opts.mostrarValores ?? true;
  const props =
    opts.tipo === "orcamento"
      ? await carregarPropsOrcamento(opts.referencia_id, mostrar)
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
