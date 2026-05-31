import { supabase } from "@/integrations/supabase/client";
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

async function render(props: DocumentoPDFProps): Promise<Blob> {
  // Dinâmico para não pesar o bundle inicial nem rodar no SSR
  const { pdf } = await import("@react-pdf/renderer");
  return await pdf(DocumentoPDF(props)).toBlob();
}

function fmt(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("pt-BR"); } catch { return d; }
}

export async function gerarPDFOrcamento(orcamentoId: string, mostrarValores = true) {
  const { data: orc, error } = await supabase
    .from("orcamentos")
    .select("*, clientes(*), usuarios:vendedor_id(nome)")
    .eq("id", orcamentoId)
    .single();
  if (error || !orc) throw error ?? new Error("Orçamento não encontrado");

  const { data: itens = [] } = await supabase
    .from("orcamento_itens").select("*").eq("orcamento_id", orcamentoId).order("ordem");

  const validade = orc.created_at
    ? new Date(new Date(orc.created_at).getTime() + (orc.validade_dias ?? 7) * 86400000).toLocaleDateString("pt-BR")
    : null;

  const blob = await render({
    tipo: "orcamento",
    numero: orc.numero,
    data_solicitacao: fmt(orc.created_at),
    data_validade: validade,
    vendedor: (orc as any).usuarios?.nome ?? null,
    status: orc.status,
    cliente: {
      nome: orc.clientes?.nome ?? "—",
      documento: orc.clientes?.documento,
      endereco: orc.clientes?.endereco,
      cidade: orc.clientes?.cidade,
      estado: orc.clientes?.estado,
      cep: orc.clientes?.cep,
      telefone: orc.clientes?.telefone,
      email: orc.clientes?.email,
    },
    itens: (itens ?? []).map((i: any) => ({
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      valor_unitario: Number(i.valor_unitario),
      valor_total: Number(i.valor_total),
    })),
    total: Number(orc.valor_total),
    observacoes: orc.observacoes,
    mostrarValores,
  });

  download(blob, `orcamento-${orc.numero}.pdf`);
}

export async function gerarPDFOS(osId: string, mostrarValores = true) {
  const { data: os, error } = await supabase
    .from("ordens_servico")
    .select("*, clientes(*), usuarios:vendedor_id(nome)")
    .eq("id", osId)
    .single();
  if (error || !os) throw error ?? new Error("OS não encontrada");

  const { data: itens = [] } = await supabase
    .from("itens_os").select("*").eq("os_id", osId).order("ordem");

  const blob = await render({
    tipo: "os",
    numero: os.numero,
    data_solicitacao: fmt(os.created_at),
    data_entrega: fmt(os.prazo_entrega),
    vendedor: (os as any).usuarios?.nome ?? null,
    status: os.status,
    cliente: {
      nome: os.clientes?.nome ?? "—",
      documento: os.clientes?.documento,
      endereco: os.clientes?.endereco,
      cidade: os.clientes?.cidade,
      estado: os.clientes?.estado,
      cep: os.clientes?.cep,
      telefone: os.clientes?.telefone,
      email: os.clientes?.email,
    },
    itens: (itens ?? []).map((i: any) => ({
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      valor_unitario: Number(i.valor_unitario),
      valor_total: Number(i.valor_total),
    })),
    total: Number(os.valor_total),
    observacoes: os.observacoes ?? os.briefing,
    mostrarValores,
  });

  download(blob, `os-${os.numero}${mostrarValores ? "" : "-producao"}.pdf`);
}
