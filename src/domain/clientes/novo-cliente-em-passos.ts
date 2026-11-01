import type { DadosCNPJ } from "@/lib/api/cnpj.server";
import { apenasDigitos, formatarCEP, formatarTelefone, recebeWhatsApp, validarDocumento } from "@/domain/documentos";
import { ehBrasil } from "@/domain/clientes/paises";

/**
 * Novo cliente em passos (25/10/2026). Mesma regra do cadastro de antes, uma pergunta por vez:
 *
 *  - o WhatsApp é obrigatório e tem de receber mensagem (celular com DDD e o 9): é por ele que sai
 *    o orçamento em PDF e o acompanhamento da OS, e o banco recusa sem ele desde 28/09;
 *  - o mesmo WhatsApp não entra duas vezes: cliente duplicado quebra a ligação automática da
 *    conversa (o webhook só liga quando o telefone bate com UM cliente);
 *  - CNPJ preenche razão social, nome, endereço e contato pela Receita, sem apagar o que a pessoa
 *    já digitou. CPF não tem consulta.
 */

export type NumeroDoPasso = 1 | 2 | 3 | 4 | 5 | 6;

export const PASSOS_DO_CLIENTE: readonly { n: NumeroDoPasso; titulo: string; pergunta: string }[] =
  [
    { n: 1, titulo: "Tipo", pergunta: "Quem é o cliente?" },
    { n: 2, titulo: "Documento", pergunta: "Qual o CNPJ ou CPF?" },
    { n: 3, titulo: "Contato", pergunta: "Como falar com ele?" },
    { n: 4, titulo: "Endereço", pergunta: "Onde fica?" },
    { n: 5, titulo: "Responsável", pergunta: "Quem atende este cliente?" },
    { n: 6, titulo: "Revisão", pergunta: "Está tudo certo?" },
  ];

export type RespostasDoCliente = {
  tipo: "pf" | "pj" | null;
  documento: string;
  nome: string;
  razao_social: string;
  telefone: string;
  email: string;
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  vendedor_id: string;
  observacoes: string;
  /** De onde veio o cliente (Instagram, indicação, balcão...); vazio quando ninguém disse. */
  origem: string;
  /** País do cliente (ISO de duas letras). Fora do Brasil não há CPF nem CNPJ, e o WhatsApp leva o código do país. */
  pais: string;
};

export const RESPOSTAS_VAZIAS_DO_CLIENTE: RespostasDoCliente = {
  tipo: null,
  documento: "",
  nome: "",
  razao_social: "",
  telefone: "",
  email: "",
  cep: "",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "",
  vendedor_id: "",
  observacoes: "",
  origem: "",
  pais: "BR",
};

/** Preenche com os dados da Receita sem sobrescrever o que já foi digitado à mão. */
export function aplicarDadosDaReceita(r: RespostasDoCliente, d: DadosCNPJ): RespostasDoCliente {
  return {
    ...r,
    razao_social: d.razao_social ?? r.razao_social,
    nome: r.nome || d.nome_fantasia || d.razao_social || "",
    endereco: d.endereco ?? r.endereco,
    bairro: d.bairro ?? r.bairro,
    cidade: d.cidade ?? r.cidade,
    estado: d.estado ?? r.estado,
    cep: d.cep ? formatarCEP(d.cep) : r.cep,
    telefone: r.telefone || (d.telefones ? formatarTelefone(d.telefones) : ""),
    email: r.email || (d.email ?? ""),
  };
}

/** Os passos que este cliente percorre: CPF não tem consulta, mas o documento ainda é perguntado. */
export function passosDoCliente(r?: Pick<RespostasDoCliente, "pais">): NumeroDoPasso[] {
  // Cliente de fora não tem CPF nem CNPJ: o passo do documento não existe para ele.
  return r && !ehBrasil(r.pais) ? [1, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];
}

/** Por que o passo ainda não pode avançar, ou nada. `duplicadoDe` é o nome do cliente com o mesmo WhatsApp. */
export function pendenciaDoPassoDoCliente(
  passo: NumeroDoPasso,
  r: RespostasDoCliente,
  duplicadoDe: string | null = null,
): string | null {
  switch (passo) {
    case 1:
      return r.tipo ? null : "Escolha o tipo do cliente.";
    case 2: {
      // Cliente do Brasil precisa do documento (nota fiscal, contrato, boleto). A consulta do
      // CNPJ preenche o resto, mas o número é obrigatório. Cliente de fora pula este passo.
      if (!ehBrasil(r.pais)) return null;
      const d = apenasDigitos(r.documento);
      if (!d) return "Informe o CPF ou o CNPJ do cliente. Para cliente de fora, volte e escolha o país.";
      return validarDocumento(d, r.tipo === "pf" ? "cpf" : "cnpj")
        ? null
        : "Confira o documento: os dígitos não conferem.";
    }
    case 3:
      if (!r.telefone.trim())
        return "Informe o WhatsApp do cliente: é por ele que sai o orçamento e o acompanhamento da OS.";
      if (!recebeWhatsApp(r.telefone)) {
        return ehBrasil(r.pais)
          ? "Esse número não recebe WhatsApp: precisa ser um celular com DDD e o 9 na frente."
          : "Esse número não recebe WhatsApp: escolha o código do país e escreva o número inteiro.";
      }
      if (duplicadoDe)
        return `Este WhatsApp já é de ${duplicadoDe.trim()}. Abra o cadastro que já existe.`;
      return null;
    case 4:
    case 5:
      return null;
    case 6:
      return r.nome.trim() ? null : "Dê o nome (fantasia) do cliente.";
  }
}

/** A linha de `clientes`, como o cadastro de antes grava (sem vendedor quando não há). */
export function clienteDasRespostas(r: RespostasDoCliente) {
  const base = {
    tipo: r.tipo ?? "pj",
    nome: r.nome.trim(),
    razao_social: r.tipo === "pj" ? r.razao_social.trim() : "",
    // Cliente de fora não tem documento brasileiro; o que sobrou de uma troca de país não vai.
    documento: ehBrasil(r.pais) ? r.documento.trim() : "",
    pais: r.pais || "BR",
    email: r.email.trim(),
    telefone: r.telefone.trim(),
    endereco: r.endereco.trim(),
    bairro: r.bairro.trim(),
    cidade: r.cidade.trim(),
    estado: r.estado.trim(),
    cep: r.cep.trim(),
    observacoes: r.observacoes.trim(),
  };
  // Origem só vai quando foi dita: vazia ficaria gravada como texto vazio em vez de "não informada".
  const comOrigem = r.origem.trim() ? { ...base, origem: r.origem.trim() } : base;
  return r.vendedor_id ? { ...comOrigem, vendedor_id: r.vendedor_id } : comOrigem;
}
