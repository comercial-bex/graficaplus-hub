import { explicarAviso } from "./fila";

/**
 * O que a tela da base de respostas mostra quando o banco recusa algo.
 *
 * As funções do banco levantam mensagens escritas para quem lê o SQL, com
 * parênteses, números de versão e códigos internos de regra. NENHUM texto do
 * banco chega à tela: aqui cada recusa conhecida vira uma frase própria, em
 * português simples, e o que não se reconhece vira uma frase padrão da ação.
 * Os únicos pedaços que atravessam são os CÓDIGOS das regras do validador, e
 * esses passam por `explicarAviso`, que os troca por uma explicação.
 *
 * Função pura: o servidor registra o erro cru no log dele e entrega só o que
 * sai daqui. Toda frase tem ao menos uma letra acentuada de propósito, porque o
 * tradutor central de erros da aplicação (`mensagemErro`) só deixa passar
 * texto que já pareça português.
 */

export type AcaoDaBase = "ler" | "verificar" | "salvar" | "aprovar" | "rascunho" | "arquivar";

export type ErroDoBanco = { message?: string | null; code?: string | null } | null | undefined;

const PADRAO_DA_ACAO: Record<AcaoDaBase, string> = {
  ler: "Não consegui carregar as respostas do agente agora. Tente de novo.",
  verificar: "Não consegui conferir o texto agora. Tente de novo.",
  salvar: "Não consegui salvar a resposta. Tente de novo.",
  aprovar: "Não consegui aprovar a resposta. Tente de novo.",
  rascunho: "Não consegui voltar a resposta a rascunho. Tente de novo.",
  arquivar: "Não consegui arquivar a resposta. Tente de novo.",
};

export const TEXTO_DE_VERSAO_TROCADA = "Esta resposta mudou enquanto você lia. Leia de novo antes de aprovar.";

/** Os códigos de regra que o banco entrega, no formato `(a, b)` ou depois dos dois pontos. */
function codigosDaRecusa(mensagem: string): string[] {
  const dentro = mensagem.match(/\(([^)]*)\)/)?.[1];
  const depois = mensagem.includes(":") ? mensagem.slice(mensagem.indexOf(":") + 1) : "";
  const lista = (dentro ?? depois).split(",").map((c) => c.trim());
  return [...new Set(lista.filter((c) => /^[a-z][a-z0-9_]{1,60}$/.test(c)))];
}

export function textoDoErroDaBase(erro: ErroDoBanco, acao: AcaoDaBase): string {
  const m = (erro?.message ?? "").toString();
  const code = (erro?.code ?? "").toString();

  if (/A resposta mudou depois que você/i.test(m)) {
    return acao === "salvar"
      ? "Esta resposta mudou enquanto você lia. Leia de novo antes de salvar."
      : TEXTO_DE_VERSAO_TROCADA;
  }
  if (/Não aprovei: o texto tem problemas|Texto recusado na aprovação/i.test(m)) {
    const codigos = codigosDaRecusa(m);
    const explicacoes = [...new Set(codigos.map(explicarAviso))];
    return explicacoes.length > 0
      ? `Não aprovei. ${explicacoes.join(" ")}`
      : "Não aprovei. O texto tem trechos que o agente não pode falar.";
  }
  if (/exige a permissão/i.test(m)) {
    return acao === "aprovar"
      ? "Só o dono aprova as respostas. Seu perfil não tem essa permissão."
      : "Seu perfil não tem a permissão para mexer nas respostas do agente.";
  }
  if (/Só se aprova rascunho/i.test(m)) {
    return "Só se aprova rascunho, e esta resposta já foi decidida. Recarregue a página e leia de novo.";
  }
  if (/Sem frase gatilho/i.test(m)) {
    return "Sem uma frase que chame a resposta, ela não seria usada nunca. Escreva ao menos uma antes de aprovar.";
  }
  if (/Já existe (uma|outra) resposta desse tema/i.test(m) || code === "23505") {
    return "Já existe uma resposta com este tema para os mesmos ramos e o mesmo produto. Edite essa ou arquive a outra.";
  }
  if (/Essa resposta não existe/i.test(m)) {
    return "Essa resposta não existe mais. Recarregue a página.";
  }
  if (/produto escolhido não existe/i.test(m)) {
    return "O produto escolhido não existe mais. Escolha outro.";
  }
  if (/arquivada não vai direto/i.test(m)) {
    return "Uma resposta arquivada não vai direto para aprovada. Volte a rascunho, leia de novo e aprove.";
  }
  if (/Aprovar só pela função|Aprovação em lote|Aprovar exige/i.test(m)) {
    return "A aprovação vale para uma resposta por vez, pelo botão Aprovar da resposta aberta.";
  }
  if (code === "23514" || /violates check constraint/i.test(m)) {
    return "O banco não aceitou algum dado desta resposta. Confira o texto e as frases e tente de novo.";
  }
  if (code === "23503" || /violates foreign key/i.test(m)) {
    return "Algo ligado a esta resposta, como o produto, não existe mais. Recarregue a página.";
  }
  return PADRAO_DA_ACAO[acao];
}
