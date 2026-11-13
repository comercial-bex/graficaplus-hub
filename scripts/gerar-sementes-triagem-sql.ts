/**
 * Gera os INSERTs das sementes da triagem (migração 20261113130000_triagem_dados.sql)
 * a partir das constantes TypeScript, que são a fonte da verdade:
 *
 *   npx tsx scripts/gerar-sementes-triagem-sql.ts passos     # whatsapp_triagem_passos
 *   npx tsx scripts/gerar-sementes-triagem-sql.ts respostas  # whatsapp_triagem_respostas
 *
 * O teste tests/triagem-dados-banco.test.ts lê o SQL da migração e compara linha por
 * linha com as mesmas constantes. Se alguém mudar a constante, o teste falha e este
 * script mostra o bloco novo para colar na migração (ainda não aplicada) ou numa migração
 * nova (se a B1 já estiver aplicada, nunca editar a migração aplicada).
 */
import { PASSOS_SEMENTE } from "../src/domain/whatsapp/triagem/textos-sementes";
import { SEMENTES_DO_QUADRO } from "../src/domain/whatsapp/triagem/quadro-sementes";

/** Explicação para o dono, em palavras simples, de quando cada mensagem é enviada. */
export const AJUDA_DO_PASSO: Record<string, string> = {
  nome: "Primeira mensagem para quem acabou de chamar a loja. Pede nome e sobrenome.",
  nome_curto:
    "Usada quando a pessoa já disse o que quer e o robô só precisa pedir o nome, sem repetir a saudação.",
  sobrenome: "Enviada quando a pessoa disse só o primeiro nome. Pede o sobrenome.",
  primeira_vez: "Pergunta se a pessoa já é cliente ou está conhecendo a Bex Print agora.",
  cep: "Pede o CEP ou o endereço, só de quem está na primeira vez. A pessoa pode pular.",
  telefone:
    "Pergunta se pode registrar o mesmo número com que a pessoa está falando. Mostra só o final do número.",
  telefone_direto:
    "Usada quando o número da conversa não é um celular comum. Pergunta direto qual número registrar.",
  telefone_novo: "Enviada quando a pessoa quer registrar outro número. Pede o número com DDD.",
  fechamento_fora:
    "Última mensagem quando a loja está fechada. Avisa o horário e diz que a equipe continua depois.",
  fechamento_fora_sem_horario:
    "Última mensagem fora do horário quando nenhum dia de atendimento está ligado na tabela de horários.",
  fechamento_dentro:
    "Última mensagem quando a loja está aberta. Diz que a equipe já foi avisada.",
  ack_ja_cliente: "Frase curta de boas-vindas para quem disse que já é cliente.",
  ack_cep_ok: "Confirma o CEP quando a consulta achou bairro e cidade.",
  ack_cep_sem_consulta: "Confirma o CEP quando a consulta não achou o endereço.",
  ack_endereco: "Confirma que o endereço escrito foi anotado.",
  ack_cep_pulado: "Resposta curta para quem pulou ou recusou o CEP.",
  ack_preco:
    "Resposta para quem pergunta valor no meio da conversa. O robô nunca fala preço, só avisa que a equipe passa.",
  aviso_audio:
    "Enviada uma vez, só no começo da conversa, quando a pessoa manda áudio. Pede a resposta por escrito.",
  aviso_arquivo: "Enviada uma vez quando a pessoa manda foto ou documento no começo da conversa.",
  aviso_equipe: "Resposta para quem pede para falar com uma pessoa da equipe.",
  aviso_parar: "Resposta para quem pede para parar de receber mensagens automáticas.",
  reabertura:
    "Enviada quando a pessoa volta depois de um tempo parado. Avisa que a última pergunta será repetida.",
  parceiro_nome:
    "Primeira mensagem do caminho de parceiro. Só sai quando o anúncio é de parceiro ou a pessoa escreveu que quer ser parceiro.",
  parceiro_link:
    "Manda o link de cadastro de parceiro, dentro do horário. Só sai depois de a pessoa dizer o nome.",
  parceiro_link_fora: "Mesmo link de cadastro, para fora do horário, com o aviso de que a equipe responde depois.",
  parceiro_valor:
    "Única resposta do caminho de parceiro para pergunta de valor. Nunca tem número.",
};

const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lista = (v: readonly string[] | undefined) =>
  !v || v.length === 0 ? "'{}'::text[]" : `ARRAY[${v.map(aspas).join(", ")}]::text[]`;

export function sqlDosPassos(): string {
  const ordem: Record<string, number> = { cliente: 0, parceiro: 0 };
  const linhas = PASSOS_SEMENTE.map((p) => {
    ordem[p.ramo] += 1;
    const ajuda = AJUDA_DO_PASSO[p.codigo];
    if (!ajuda) throw new Error(`sem ajuda para o passo ${p.codigo}`);
    return `  (${aspas(p.codigo)}, ${aspas(p.ramo)}, ${ordem[p.ramo]}, ${aspas(p.texto)}, ${lista(p.variantes)}, ${
      p.repeticao ? aspas(p.repeticao) : "NULL"
    }, ${aspas(ajuda)}, ${p.ativo === false ? "false" : "true"})`;
  });
  return linhas.join(",\n");
}

export function sqlDasRespostas(): string {
  const vistos = new Set<string>();
  const linhas = SEMENTES_DO_QUADRO.map((r) => {
    const chave = `${r.passo ?? ""}|${r.frase}|${r.casamento}`;
    if (vistos.has(chave)) throw new Error(`semente repetida: ${chave}`);
    vistos.add(chave);
    return `  (${r.passo ? aspas(r.passo) : "NULL"}, ${aspas(r.intencao)}, ${aspas(r.frase)}, ${aspas(r.casamento)}, ${
      r.ativo === false ? "false" : "true"
    })`;
  });
  return linhas.join(",\n");
}

if (process.argv[1]?.endsWith("gerar-sementes-triagem-sql.ts")) {
  const alvo = process.argv[2];
  if (alvo === "passos") console.log(sqlDosPassos());
  else if (alvo === "respostas") console.log(sqlDasRespostas());
  else {
    console.error("uso: npx tsx scripts/gerar-sementes-triagem-sql.ts passos|respostas");
    process.exit(1);
  }
}
