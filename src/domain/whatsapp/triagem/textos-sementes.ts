import type { PassoDeTexto } from "./tipos";

/**
 * Sementes dos textos da triagem (seções 1.4 a 1.6 do projeto), a lista inicial
 * de `whatsapp_triagem_passos`. O dono edita pela tela (B6); aqui ficam para o
 * simulador, para os testes e para a migração B1 semear.
 *
 * Regras de escrita do dono: sem travessão, sem seta, sem parênteses. Cliente
 * final nunca lê parceiro, tabela, revenda nem preço diferenciado, e nenhum
 * texto fala valor, desconto, prazo ou forma de pagamento. O número do chat sai
 * só pelo final ("terminado em 2233"), por privacidade.
 */

function c(
  codigo: string,
  texto: string,
  extras: Partial<Pick<PassoDeTexto, "variantes" | "repeticao">> = {},
): PassoDeTexto {
  return { codigo, ramo: "cliente", texto, ativo: true, ...extras };
}
function p(
  codigo: string,
  texto: string,
  extras: Partial<Pick<PassoDeTexto, "variantes" | "repeticao">> = {},
): PassoDeTexto {
  return { codigo, ramo: "parceiro", texto, ativo: true, ...extras };
}

export const PASSOS_CLIENTE: readonly PassoDeTexto[] = [
  c(
    "nome",
    "Olá, seja bem-vindo à Bex Print! Para a gente seguir e atender você melhor, como posso te chamar? Pode me dizer seu nome e sobrenome.",
    {
      variantes: [
        "Oi, que bom ter você por aqui na Bex Print! Para eu te atender melhor, qual é o seu nome e sobrenome?",
        "Olá, tudo bem? Aqui é a Bex Print. Para continuar o atendimento, me diga seu nome e sobrenome, por favor.",
      ],
      repeticao:
        "Desculpe, não consegui entender. Pode escrever seu nome e sobrenome? Por exemplo, Maria Souza.",
    },
  ),
  c("nome_curto", "Para começar, pode me dizer seu nome e sobrenome?"),
  c("sobrenome", "Prazer, {{primeiro_nome}}! Qual é o seu sobrenome?", {
    repeticao:
      "Desculpe, não consegui entender. Pode escrever só o seu sobrenome? Por exemplo, Souza.",
  }),
  c(
    "primeira_vez",
    "Prazer, {{primeiro_nome}}! Você já é cliente da Bex Print ou está nos conhecendo agora?",
    {
      repeticao: "Só para eu registrar certinho, me diga assim: já sou cliente, ou primeira vez.",
    },
  ),
  c(
    "cep",
    "Que bom ter você por aqui! Se quiser, me passe só o seu CEP, ou o seu endereço, e a gente deixa guardado para atender melhor. Guardamos só para atender você e preparar seu atendimento. Se preferir não passar agora, sem problema, é só dizer pular.",
    {
      repeticao:
        "Não consegui ler o CEP. Ele tem 8 números, por exemplo 68900-000. Se preferir, é só dizer pular.",
    },
  ),
  c(
    "telefone",
    "{{ack}} Para registrar seu contato, vi que você está falando comigo pelo número {{telefone}}. Posso registrar esse mesmo? Responda sim, ou me diga outro número se preferir.",
    {
      repeticao:
        "Para registrar, me diga sim, se for esse número, ou escreva o outro número com DDD.",
    },
  ),
  c("telefone_direto", "{{ack}} Qual número, com DDD, posso registrar para o seu contato?", {
    repeticao: "Não consegui ler. Escreva só os números, com DDD, por exemplo 96 99999-9999.",
  }),
  c("telefone_novo", "Sem problema! Qual número, com DDD, você quer que eu registre?", {
    repeticao: "Não consegui ler. Escreva só os números, com DDD, por exemplo 96 99999-9999.",
  }),
  c(
    "fechamento_fora",
    "Tudo anotado, {{primeiro_nome}}! No momento estamos fora do atendimento presencial, que funciona das {{abre}} às {{fecha}}, {{dias}}. Mas a gente pode adiantar por aqui. Se quiser, me conte o que você precisa, e a equipe continua com você assim que abrir.",
  ),
  c(
    "fechamento_fora_sem_horario",
    "Tudo anotado, {{primeiro_nome}}! A equipe continua com você assim que possível. Se quiser ir adiantando, me conte o que você precisa.",
  ),
  c(
    "fechamento_dentro",
    "Tudo anotado, {{primeiro_nome}}! Já avisei a equipe, que continua com você em instantes. Se quiser ir adiantando, me conte o que você precisa.",
  ),
  // auxiliares
  c("ack_ja_cliente", "Que bom ter você de volta!"),
  c("ack_cep_ok", "Anotei o CEP {{cep}}, {{bairro}}, {{cidade}}."),
  c("ack_cep_sem_consulta", "Anotei o seu CEP."),
  c("ack_endereco", "Anotei o seu endereço."),
  c("ack_cep_pulado", "Tudo bem, sem problema."),
  c(
    "ack_preco",
    "O valor quem passa é a equipe, com tudo certinho para o seu pedido. Vou só terminar de anotar alguns dados para adiantar.",
  ),
  c(
    "aviso_audio",
    "Recebi seu áudio, mas por aqui eu consigo ler só texto. Pode me escrever a resposta? Se preferir, a equipe ouve seu áudio assim que puder.",
  ),
  c(
    "aviso_arquivo",
    "Recebi seu arquivo e já deixei guardado para a equipe. Antes, só preciso terminar de anotar alguns dados.",
  ),
  c("aviso_equipe", "Claro, já chamo a equipe para continuar com você."),
  c(
    "aviso_parar",
    "Tudo bem, não vou mais te enviar mensagens automáticas. A equipe continua à disposição por aqui.",
  ),
  c("reabertura", "Que bom ver você de volta! Para continuar, vou repetir a última pergunta."),
];

export const PASSOS_PARCEIRO: readonly PassoDeTexto[] = [
  p(
    "parceiro_nome",
    "Olá, seja bem-vindo ao programa de parceiros da Bex Print! Para a gente seguir, como posso te chamar? Pode me dizer seu nome e sobrenome.",
    {
      repeticao:
        "Desculpe, não consegui entender. Pode escrever seu nome e sobrenome? Por exemplo, Maria Souza.",
    },
  ),
  p("nome_curto", "Para começar, pode me dizer seu nome e sobrenome?"),
  p(
    "parceiro_link",
    "Prazer, {{primeiro_nome}}! O cadastro de parceiro é rápido e é por aqui: {{link_parceiro}}. Depois do cadastro, a equipe libera o seu acesso e conversa com você.",
  ),
  p(
    "parceiro_link_fora",
    "Prazer, {{primeiro_nome}}! O cadastro de parceiro é rápido e é por aqui: {{link_parceiro}}. Depois do cadastro, a equipe libera o seu acesso e conversa com você. A equipe responde a partir das {{abre}}.",
  ),
  p("parceiro_valor", "As condições de parceiro ficam disponíveis depois do cadastro."),
  p("aviso_equipe", "Claro, já chamo a equipe para continuar com você."),
  p(
    "aviso_parar",
    "Tudo bem, não vou mais te enviar mensagens automáticas. A equipe continua à disposição por aqui.",
  ),
  p(
    "aviso_audio",
    "Recebi seu áudio, mas por aqui eu consigo ler só texto. Pode me escrever a resposta? Se preferir, a equipe ouve seu áudio assim que puder.",
  ),
  p(
    "aviso_arquivo",
    "Recebi seu arquivo e já deixei guardado para a equipe. Antes, só preciso terminar de anotar alguns dados.",
  ),
  p("reabertura", "Que bom ver você de volta! Para continuar, vou repetir a última pergunta."),
];

export const PASSOS_SEMENTE: readonly PassoDeTexto[] = [...PASSOS_CLIENTE, ...PASSOS_PARCEIRO];
