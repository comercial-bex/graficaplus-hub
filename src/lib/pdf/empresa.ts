import { supabase } from "@/integrations/supabase/client";

/**
 * Dados do emissor que aparecem no cabeçalho de Orçamentos e OS.
 *
 * Vivem em public.empresa_config (linha única), não mais fixos em código: o CNPJ
 * e a inscrição estadual precisam ser corrigíveis por quem administra o sistema,
 * sem alterar código e republicar.
 */

export type Empresa = {
  nome: string;
  razao_social?: string | null;
  cnpj?: string | null;
  inscricao_estadual?: string | null;
  slogan?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  telefones?: string | null;
  email?: string | null;
  site?: string | null;
  /** URL já assinada, pronta para o <Image> do PDF */
  logo_url?: string | null;
  cor: string;
  condicoes_gerais?: string | null;
};

/** Usado só se a configuração ainda não foi preenchida. */
const PADRAO: Empresa = {
  nome: "BEX PRINT OS",
  cor: "#7B2E8B",
};

export async function carregarEmpresa(): Promise<Empresa> {
  const { data, error } = await (supabase as any)
    .from("empresa_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return PADRAO;

  let logo_url: string | null = null;
  if (data.logo_path) {
    // Bucket privado: a URL assinada precisa durar só o tempo de renderizar.
    const { data: assinada } = await supabase.storage
      .from("arquivos-clientes")
      .createSignedUrl(data.logo_path, 300);
    logo_url = assinada?.signedUrl ?? null;
  }

  return {
    nome: data.nome ?? PADRAO.nome,
    razao_social: data.razao_social,
    cnpj: data.cnpj,
    inscricao_estadual: data.inscricao_estadual,
    slogan: data.slogan,
    endereco: data.endereco,
    bairro: data.bairro,
    cidade: data.cidade,
    estado: data.estado,
    cep: data.cep,
    telefones: data.telefones,
    email: data.email,
    site: data.site,
    logo_url,
    cor: data.cor_primaria ?? PADRAO.cor,
    condicoes_gerais: data.condicoes_gerais,
  };
}

/** "Rua X, 123 — Centro, Macapá-AP / CEP 68900-000" */
export function enderecoCompleto(e: Empresa): string | null {
  const linha1 = [e.endereco, e.bairro].filter(Boolean).join(" — ");
  const cidadeUf = [e.cidade, e.estado].filter(Boolean).join("-");
  const linha2 = [cidadeUf, e.cep ? `CEP ${e.cep}` : null].filter(Boolean).join(" / ");
  const completo = [linha1, linha2].filter(Boolean).join(", ");
  return completo || null;
}
