import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { FAIXA_DA_MARCA, urlDaLogoFundoClaro, urlDaLogoFundoEscuro } from "@/lib/marca";

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
  /**
   * URL da logo; `renderPDFBlob` a converte em PNG/JPEG antes de desenhar. Nos
   * documentos da Bex Print é sempre a logo oficial para fundo branco
   * (`src/lib/marca.ts`); no do parceiro, a dele.
   */
  logo_url?: string | null;
  /**
   * Logo para a barra escura do rodapé (letras brancas). Só a Bex Print tem;
   * o documento do parceiro sai com o rodapé em texto, sem logo nenhuma.
   */
  logo_escura_url?: string | null;
  /**
   * Cor da marca: a caixa do número, os círculos dos itens, a barra do total.
   * No documento do parceiro é a cor que ele cadastrou.
   */
  cor: string;
  /**
   * Cores da faixa que separa cabeçalho e rodapé e dos cartões de layout (uma
   * por cartão, em rodízio). Sem faixa, tudo sai na `cor` — é o caso do
   * parceiro, que não leva as cores da Bex Print.
   */
  faixa?: readonly string[] | null;
  condicoes_gerais?: string | null;
};

/** Usado só se a configuração ainda não foi preenchida. */
const PADRAO: Omit<Empresa, "logo_url" | "logo_escura_url" | "faixa"> = {
  nome: "BEX PRINT OS",
  cor: "#7B2E8B",
};

// Sem `logo_path`: o documento da Bex Print usa a logo oficial para fundo
// branco, que mora em /public. A cadastrada em Configurações fica no bucket
// privado, e vendedor e financeiro não a leem — o PDF deles saía sem logo.
const COLUNAS =
  "nome, razao_social, cnpj, inscricao_estadual, slogan, endereco, bairro, cidade, estado, cep, telefones, email, site, cor_primaria, condicoes_gerais";

export async function carregarEmpresa(): Promise<Empresa> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- select com a lista em constante
  const { data, error } = await (supabase as any)
    .from("empresa_config")
    .select(COLUNAS)
    .eq("id", true)
    .maybeSingle();

  // Consulta que falhou não é "empresa sem cadastro": cair no cabeçalho padrão
  // mandaria o documento sem CNPJ e sem endereço sem ninguém saber por quê.
  if (error) throw new Error(`Não foi possível ler os dados da empresa: ${mensagemErro(error)}`);
  // Decisão do dono (06/10/2026): todo PDF da Bex Print tem fundo branco e
  // leva a logo oficial para fundo branco — para qualquer pessoa que gere.
  const logo_url = urlDaLogoFundoClaro();
  // A faixa e a logo do rodapé são da marca, não da configuração: todo
  // documento da Bex Print as leva, com ou sem cadastro preenchido.
  const marca = { logo_url, logo_escura_url: urlDaLogoFundoEscuro(), faixa: FAIXA_DA_MARCA };
  if (!data) return { ...PADRAO, ...marca };

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
    ...marca,
    cor: data.cor_primaria ?? PADRAO.cor,
    condicoes_gerais: data.condicoes_gerais,
  };
}
