/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções novas fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  lerRespostaZapi,
  montarEnvio,
  renderizarTemplate,
  valeTentarDeNovo,
  type EnderecoZapi,
  type PedidoDeEnvio,
} from "@/domain/whatsapp/zapi-envio";
import type {
  StatusAviso,
  StatusExecucao,
  StatusFila,
  StatusMensagem,
} from "@/domain/whatsapp/status-das-filas";
import {
  CABECALHO_DO_DESPACHANTE,
  DESPACHANTE_DESLIGADO,
  limiteDePresa,
  proximaTentativaEm,
} from "@/domain/whatsapp/despachante";
import { hashDoSegredo, hashesIguais } from "@/domain/whatsapp/segredo-webhook";
import {
  destinoDaAutomacao,
  textoDaAutomacao,
  type ExecucaoParaEnvio,
} from "@/domain/automacoes/destino";

/**
 * O consumidor das filas de envio do WhatsApp.
 *
 * TRÊS FILAS, UM CONSUMIDOR, UMA RODADA:
 *   whatsapp_fila_envio   a resposta que uma pessoa escreveu na conversa
 *   notificacoes_fila     o aviso automático ao cliente (orçamento aprovado,
 *                         arte para aprovar, em produção, pronto, saiu, concluído)
 *   automacao_execucoes   a regra de /automacoes (desde 06/10/2026 — antes só
 *                         a função process-automations lia esta fila, e nada a
 *                         chamava: a fila enchia e nada saía)
 *
 * O TOKEN NÃO MORA NO BANCO. `whatsapp_instancias` guarda o id da instância e
 * o hash do segredo do webhook, nunca o token — ele é lido aqui de
 * `process.env`, no servidor, e só entra na URL montada na hora da chamada.
 * Por isso este arquivo tem sufixo `.server` e é importado dentro do handler:
 * nada dele chega ao pacote do navegador.
 *
 * QUEM CHAMA. Duas portas para a mesma rodada:
 *   POST /api/whatsapp/enviar     com a sessão de quem tem `whatsapp.reply`
 *                                 (a caixa de entrada depois de cada resposta;
 *                                 o despachante do navegador a cada 2 min de
 *                                 cada aba visível)
 *   POST /api/whatsapp/despachar  com o token DESPACHANTE_TOKEN no cabeçalho
 *                                 x-despachante-token — é o que o job do
 *                                 pg_cron chama a cada 2 min, 24 h. Sem a
 *                                 variável no servidor, 503 e nada muda para
 *                                 a porta de cima.
 *
 * POR ISSO CADA LINHA É RESERVADA antes de sair: `pendente` → `enviando` só se
 * ainda estava `pendente`, e só manda quem conseguiu a reserva. Sem isso, duas
 * chamadas simultâneas liam a mesma linha pendente e o cliente recebia o
 * mesmo aviso duas vezes. Linha esquecida em `enviando` (a rodada morreu no
 * meio) volta a `pendente` depois de 10 minutos.
 *
 * TODA GRAVAÇÃO LÊ O ERRO. Até 02/10/2026 nenhum `update` deste arquivo lia o
 * retorno, e um deles gravava `status: "falha"` em `notificacoes_fila` — valor
 * que o CHECK da tabela recusa. O Postgres derrubava o UPDATE inteiro, a
 * linha continuava "pendente" sem `ultimo_erro`, e o aviso que deveria ficar
 * marcado como falho voltava para a fila calado, rodada após rodada. Agora
 * cada tabela tem UMA função de gravação, tipada com os status que o banco
 * aceita (`status-das-filas.ts`), e o erro vai para o log e para a resposta.
 *
 * O QUE SAIU FICA REGISTRADO (06/10/2026). Cada chamada ao Z-API deixa uma
 * linha em `whatsapp_logs`: telefone, texto final, de qual fila, a resposta e
 * o HTTP — nunca o token (ele só existe na URL montada, que não é gravada). E
 * o aviso ao cliente que saiu passa a existir também em `whatsapp_mensagens`
 * (`whatsapp_registrar_mensagem`, direção saída): até então os três avisos
 * enviados não apareciam em conversa nenhuma, e o recibo do Z-API não tinha
 * linha para marcar.
 */

const ZAPI_LIMITE_POR_RODADA = 20;

/**
 * Tentativas de uma linha de `whatsapp_fila_envio` antes de virar falha
 * definitiva. A leitura da fila já filtrava `tentativas < 5`, mas a falha
 * "vale tentar de novo" gravava "pendente" com qualquer contagem — na quinta,
 * a linha saía do filtro e ficava pendente para sempre, sem ninguém saber.
 */
const FILA_MAX_TENTATIVAS = 5;

/** Tentativas de uma execução de automação antes de virar erro definitivo. */
const EXECUCAO_MAX_TENTATIVAS = 5;

/** O `ultimo_erro`/`erro` de quem volta da reserva esquecida. */
const ERRO_PRESA =
  "a rodada de envio anterior parou no meio (ficou em 'enviando' por mais de 10 min); devolvida à fila";

type Resposta = Record<string, unknown>;

function json(status: number, corpo: Resposta): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function credenciais() {
  return {
    token: process.env.ZAPI_TOKEN ?? "",
    clientToken: process.env.ZAPI_CLIENT_TOKEN ?? "",
    telefonePadrao: process.env.AUTOMATION_DEFAULT_PHONE ?? "",
  };
}

export function saudeDoEnvio(): Response {
  // Diz se o servidor tem as credenciais, sem mostrar nenhuma delas. É o que
  // separa "não configurei ainda" de "configurei e não sai" — e essa distinção
  // é metade do trabalho de achar o problema.
  const { token, clientToken } = credenciais();
  return json(200, {
    ok: true,
    servico: "envio pelo Z-API",
    metodo: "POST",
    token_configurado: token.length > 0,
    client_token_configurado: clientToken.length > 0,
  });
}

/**
 * GET /api/whatsapp/despachar: o despachante do servidor está ligado? É o que
 * a tela de automações lê para avisar "só sai com alguém logado" enquanto a
 * variável não existir. Não diz o token, só se há um.
 */
export async function saudeDoDespachante(): Promise<Response> {
  const daVariavel = (process.env.DESPACHANTE_TOKEN ?? "").length > 0;
  const noBanco = daVariavel ? null : await situacaoDoTokenNoBanco(null);
  return json(200, {
    ok: true,
    servico: "despachante do servidor",
    metodo: "POST",
    ligado: daVariavel || noBanco === "configurado",
    token: daVariavel ? "variável do servidor" : noBanco === "configurado" ? "Vault do banco" : null,
  });
}

/* ------------------------------------------------------------------ */
/* O token do despachante                                              */
/* ------------------------------------------------------------------ */

type SituacaoDoTokenNoBanco = "sem_segredo" | "configurado" | "confere" | "nao_confere";

/**
 * O token mora no Vault do banco (`despachante_token`, migração
 * 20261008020000): foi gerado lá dentro e ninguém viu o valor. O banco
 * confere e só diz a situação — nunca devolve o token. `null` = o banco não
 * respondeu.
 */
async function situacaoDoTokenNoBanco(token: string | null): Promise<SituacaoDoTokenNoBanco | null> {
  // A função é nova e o types.ts gerado ainda não a conhece.
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("whatsapp_despachante_token_situacao", { p_token: token });
  if (error) return null;
  return data === "sem_segredo" || data === "configurado" || data === "confere" || data === "nao_confere"
    ? data
    : null;
}

/**
 * Confere o token que chegou no cabeçalho. A variável DESPACHANTE_TOKEN, se
 * existir, manda (comparação em tempo constante, pelo hash dos dois lados).
 * Sem ela, quem confere é o banco. Antes de 08/10/2026 só a variável valia, e
 * o despachante do servidor ficou desligado esperando alguém cadastrá-la.
 */
async function tokenDoDespachante(
  recebido: string,
): Promise<"confere" | "nao_confere" | "desligado" | "falhou"> {
  const esperado = process.env.DESPACHANTE_TOKEN ?? "";
  if (esperado) {
    if (!recebido) return "nao_confere";
    return hashesIguais(await hashDoSegredo(recebido), await hashDoSegredo(esperado))
      ? "confere"
      : "nao_confere";
  }
  const situacao = await situacaoDoTokenNoBanco(recebido || null);
  if (situacao === null) return "falhou";
  if (situacao === "sem_segredo") return "desligado";
  if (!recebido) return "nao_confere";
  return situacao === "confere" ? "confere" : "nao_confere";
}

/* ------------------------------------------------------------------ */
/* Gravações: uma por tabela, cada uma lendo o próprio erro            */
/* ------------------------------------------------------------------ */

export type ErroDeGravacao = { tabela: string; id: string; erro: string };

function anotarErro(erros: ErroDeGravacao[], tabela: string, id: string, mensagem: string) {
  const erro = { tabela, id, erro: mensagem };
  // O log do servidor é onde se procura quando "a mensagem não chegou": sem
  // esta linha, o UPDATE recusado não deixava rastro em lugar nenhum.
  console.error("[whatsapp-enviar] gravação recusada pelo banco", erro);
  erros.push(erro);
}

/**
 * Grava a linha de `whatsapp_fila_envio`. Com `quandoStatus`, só grava se a
 * linha ainda estiver nesse status — é a reserva. Devolve se a linha mudou.
 * Esta tabela não tem gatilho de `updated_at`: a data vai daqui, e é ela que
 * mede a reserva esquecida.
 */
async function gravarFila(
  erros: ErroDeGravacao[],
  id: string,
  campos: { status: StatusFila; tentativas?: number; erro?: string | null },
  condicao?: { quandoStatus: StatusFila },
): Promise<boolean> {
  let consulta = supabaseAdmin
    .from("whatsapp_fila_envio")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (condicao) consulta = consulta.eq("status", condicao.quandoStatus);
  const { data, error } = await consulta.select("id");
  if (error) {
    anotarErro(erros, "whatsapp_fila_envio", id, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function gravarMensagem(
  erros: ErroDeGravacao[],
  id: string,
  campos: {
    status: StatusMensagem;
    erro: string | null;
    zapi_message_id?: string | null;
    enviado_em?: string;
  },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .update(campos)
    .eq("id", id)
    .select("id");
  if (error) {
    anotarErro(erros, "whatsapp_mensagens", id, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Grava a linha de `notificacoes_fila` (o gatilho da tabela cuida do
 * `updated_at`). Com `quandoStatus`, só grava se a linha ainda estiver nesse
 * status — é a reserva. Devolve se a linha mudou.
 */
async function gravarAviso(
  erros: ErroDeGravacao[],
  id: string,
  campos: {
    status: StatusAviso;
    tentativas?: number;
    ultimo_erro?: string | null;
    enviado_em?: string;
    provider_message_id?: string | null;
    proxima_tentativa_em?: string;
  },
  condicao?: { quandoStatus: StatusAviso },
): Promise<boolean> {
  let consulta = supabaseAdmin.from("notificacoes_fila").update(campos).eq("id", id);
  if (condicao) consulta = consulta.eq("status", condicao.quandoStatus);
  const { data, error } = await consulta.select("id");
  if (error) {
    anotarErro(erros, "notificacoes_fila", id, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Grava a linha de `automacao_execucoes`. A tabela não tem `updated_at`: a
 * hora da reserva vai em `resposta.reservado_em`, e é por ela que a reserva
 * esquecida é medida. Com `quandoStatus`, só grava se ainda estiver nele.
 */
async function gravarExecucao(
  erros: ErroDeGravacao[],
  id: string,
  campos: {
    status: StatusExecucao;
    tentativas?: number;
    processado_em?: string | null;
    scheduled_at?: string;
    resposta?: Json | null;
    erro?: string | null;
  },
  condicao?: { quandoStatus: StatusExecucao },
): Promise<boolean> {
  let consulta = supabaseAdmin.from("automacao_execucoes").update(campos).eq("id", id);
  if (condicao) consulta = consulta.eq("status", condicao.quandoStatus);
  const { data, error } = await consulta.select("id");
  if (error) {
    anotarErro(erros, "automacao_execucoes", id, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* O rastro de cada chamada ao Z-API                                   */
/* ------------------------------------------------------------------ */

type TipoDeLog = "envio_texto" | "envio_documento" | "envio_imagem" | "erro";

/**
 * Uma linha em `whatsapp_logs` por chamada ao Z-API: o que foi pedido (sem o
 * token — ele só existe na URL, que não é gravada), o que voltou e o HTTP.
 * Falha ao gravar o log não derruba o envio: vai para `erros_de_gravacao`,
 * como qualquer gravação recusada.
 */
async function registrarLog(
  erros: ErroDeGravacao[],
  log: {
    tipo: TipoDeLog;
    sucesso: boolean;
    erro: string | null;
    instancia_id: string;
    conversa_id?: string | null;
    mensagem_id?: string | null;
    request: { phone: string; message: string; fila: string; fila_id: string };
    response: { status: number; corpo: unknown } | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("whatsapp_logs").insert({
    tipo: log.tipo,
    sucesso: log.sucesso,
    erro: log.erro,
    instancia_id: log.instancia_id,
    conversa_id: log.conversa_id ?? null,
    mensagem_id: log.mensagem_id ?? null,
    request: log.request as Json,
    response: log.response as Json,
  });
  if (error) anotarErro(erros, "whatsapp_logs", log.request.fila_id, error.message);
}

/** A chamada ao Z-API. Rede fora é um caso separado: vale tentar de novo. */
async function chamarZapi(
  montado: EnderecoZapi,
  clientToken: string,
): Promise<{ status: number; corpo: unknown } | { falhaDeRede: string }> {
  try {
    const r = await fetch(montado.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clientToken ? { "Client-Token": clientToken } : {}),
      },
      body: JSON.stringify(montado.corpo),
    });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  } catch (e) {
    return { falhaDeRede: e instanceof Error ? e.message : "falha de rede ao chamar o Z-API" };
  }
}

/** O telefone e o texto que foram para o Z-API, para o log. */
function pedidoParaLog(montado: EnderecoZapi): { phone: string; message: string } {
  return {
    phone: String(montado.corpo.phone ?? ""),
    message: String(montado.corpo.message ?? montado.corpo.caption ?? ""),
  };
}

/* ------------------------------------------------------------------ */
/* Quem pode disparar o envio                                         */
/* ------------------------------------------------------------------ */

type Quem = { tipo: "usuario"; uid: string } | { tipo: "servidor" };

/**
 * Quem chamou tem direito? O JWT do usuário, com permissão de WhatsApp.
 *
 * `whatsapp.reply` é quem responde (vendedor, admin); `whatsapp.manage` é quem
 * administra a conexão. Os dois nomes existem — conferidos em
 * `role_permission_matrix`. Um nome inventado aqui (`whatsapp.send`) recusaria
 * todo mundo em silêncio: é o mesmo formato do filtro que procura palavra que
 * o banco nunca escreve.
 */
async function usuarioAutorizado(
  request: Request,
): Promise<{ ok: true; uid: string } | { ok: false; status: number; erro: string }> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!jwt) return { ok: false, status: 401, erro: "sessão ausente: entre no sistema de novo" };

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, status: 401, erro: "sessão inválida ou expirada" };

  for (const permissao of ["whatsapp.reply", "whatsapp.manage"]) {
    const { data: pode, error: erroPermissao } = await supabaseAdmin.rpc("has_permission", {
      _user_id: data.user.id,
      _permission: permissao,
    });
    // Falha ao consultar NÃO é "sem permissão": dizer 401 aqui mandaria a
    // pessoa pedir acesso que ela já tem, enquanto o problema é o banco.
    if (erroPermissao) {
      console.error("[whatsapp-enviar] falha ao conferir permissão", erroPermissao.message);
      return {
        ok: false,
        status: 500,
        erro: `falha ao conferir a permissão: ${erroPermissao.message}`,
      };
    }
    if (pode === true) return { ok: true, uid: data.user.id };
  }
  return { ok: false, status: 403, erro: "sem permissão para enviar WhatsApp (whatsapp › reply)" };
}

/** POST /api/whatsapp/enviar — a porta de quem está logado. */
export async function processarFilaZapi(request: Request): Promise<Response> {
  const quem = await usuarioAutorizado(request);
  if (!quem.ok) return json(quem.status, { ok: false, erro: quem.erro });
  return rodada({ tipo: "usuario", uid: quem.uid });
}

/**
 * POST /api/whatsapp/despachar — a porta do servidor (job do pg_cron).
 *
 * O token é comparado pelo SHA-256 dos dois lados, com `hashesIguais`: o
 * tempo da comparação não depende de quantos caracteres batem, nem do
 * tamanho do que foi mandado. Nada do token vai para log nem para a resposta.
 */
export async function despacharPeloServidor(request: Request): Promise<Response> {
  const recebido = request.headers.get(CABECALHO_DO_DESPACHANTE) ?? "";
  const situacao = await tokenDoDespachante(recebido);
  if (situacao === "desligado") {
    return json(503, {
      ok: false,
      erro: DESPACHANTE_DESLIGADO,
      comoResolver:
        "O token do despachante mora no Vault do banco (despachante_token): rode a migração 20261008020000_despachante_token_no_banco.sql. Enquanto isso, o despachante do navegador continua levando os avisos.",
    });
  }
  if (situacao === "falhou") {
    return json(503, { ok: false, erro: "não deu para conferir o token do despachante no banco" });
  }
  if (situacao !== "confere") return json(401, { ok: false, erro: "token do despachante inválido" });
  return rodada({ tipo: "servidor" });
}

/**
 * O mesmo token do despachante, para outras portas do servidor (a da
 * assistente de IA, POST /api/whatsapp/agente). Sem token configurado, recusa.
 */
export async function tokenDoServidorConfere(request: Request): Promise<boolean> {
  const recebido = request.headers.get(CABECALHO_DO_DESPACHANTE) ?? "";
  return (await tokenDoDespachante(recebido)) === "confere";
}

/**
 * A mesma rodada, chamada de DENTRO do servidor — sem porta HTTP e sem token.
 * Quem usa é a assistente de IA (`whatsapp-assistente.server.ts`): a resposta
 * dela sai na hora, em vez de esperar o job de 2 min ou uma aba aberta.
 */
export async function rodadaDoServidor(): Promise<Response> {
  return rodada({ tipo: "servidor" });
}

/* ------------------------------------------------------------------ */
/* Reserva esquecida                                                   */
/* ------------------------------------------------------------------ */

/**
 * Devolve à fila o que ficou em `enviando`/`processando` por mais de 10
 * minutos — a rodada que reservou morreu no meio (aba fechada, servidor
 * reiniciado). Vale para as três filas.
 *
 * PODE DUPLICAR: se o Z-API aceitou a mensagem e a resposta dele se perdeu, a
 * linha volta como pendente e o cliente recebe de novo. É o mal menor — a
 * alternativa é o aviso preso em `enviando` para sempre, que ninguém vê.
 * A tentativa já foi contada na reserva; quem esgotou vira falha.
 */
async function devolverReservasEsquecidas(erros: ErroDeGravacao[], agora: Date) {
  const limite = limiteDePresa(agora);

  const { data: filas, error: erroFilas } = await supabaseAdmin
    .from("whatsapp_fila_envio")
    .select("id, mensagem_id, tentativas")
    .eq("status", "enviando")
    .lt("updated_at", limite);
  if (erroFilas) {
    anotarErro(
      erros,
      "whatsapp_fila_envio",
      "*",
      `falha ao ler reservas esquecidas: ${erroFilas.message}`,
    );
  }
  for (const f of filas ?? []) {
    const acabou = (f.tentativas ?? 0) >= FILA_MAX_TENTATIVAS;
    const devolvida = await gravarFila(
      erros,
      f.id,
      { status: acabou ? "falha" : "pendente", erro: ERRO_PRESA },
      { quandoStatus: "enviando" },
    );
    if (devolvida && acabou && f.mensagem_id) {
      await gravarMensagem(erros, f.mensagem_id, { status: "falha", erro: ERRO_PRESA });
    }
  }

  const { data: avisos, error: erroAvisos } = await supabaseAdmin
    .from("notificacoes_fila")
    .select("id, tentativas, max_tentativas")
    .eq("status", "enviando")
    .lt("updated_at", limite);
  if (erroAvisos) {
    anotarErro(
      erros,
      "notificacoes_fila",
      "*",
      `falha ao ler reservas esquecidas: ${erroAvisos.message}`,
    );
  }
  for (const a of avisos ?? []) {
    const acabou = (a.tentativas ?? 0) >= (a.max_tentativas ?? 5);
    await gravarAviso(
      erros,
      a.id,
      { status: acabou ? "falhou" : "pendente", ultimo_erro: ERRO_PRESA },
      { quandoStatus: "enviando" },
    );
  }

  // A automação não tem updated_at: a hora da reserva está em resposta.reservado_em.
  const { data: execucoes, error: erroExecucoes } = await supabaseAdmin
    .from("automacao_execucoes")
    .select("id, tentativas")
    .eq("status", "processando")
    .lt("resposta->>reservado_em", limite);
  if (erroExecucoes) {
    anotarErro(
      erros,
      "automacao_execucoes",
      "*",
      `falha ao ler reservas esquecidas: ${erroExecucoes.message}`,
    );
  }
  for (const e of execucoes ?? []) {
    const acabou = (e.tentativas ?? 0) >= EXECUCAO_MAX_TENTATIVAS;
    await gravarExecucao(
      erros,
      e.id,
      acabou
        ? { status: "erro", erro: ERRO_PRESA, processado_em: agora.toISOString() }
        : { status: "pendente", erro: ERRO_PRESA, resposta: null },
      { quandoStatus: "processando" },
    );
  }
}

/* ------------------------------------------------------------------ */
/* A fila das conversas                                                */
/* ------------------------------------------------------------------ */

type LinhaDaFila = {
  id: string;
  conversa_id: string | null;
  mensagem_id: string | null;
  payload: Record<string, unknown> | null;
  tentativas: number | null;
  created_by: string | null;
  idempotency_key: string | null;
};

/** O que aconteceu com cada linha — a caixa de entrada procura a dela aqui. */
export type ResultadoDaLinha = {
  fila_id: string;
  mensagem_id: string | null;
  situacao: StatusFila;
  erro: string | null;
};

/**
 * O pedido, lido do payload da fila.
 *
 * A fila foi criada antes deste consumidor, então o payload é livre. Aceita o
 * que a tela de monitor grava (`{ tipo, texto }`) e o formato completo.
 *
 * O DESTINO É O DA CONVERSA. `payload.para` só valeria para linha sem
 * conversa — e linha sem conversa é recusada (abaixo). Antes, qualquer pessoa
 * da equipe podia inserir na fila uma linha com `para` apontando para outro
 * número e o consumidor mandava: a porta lateral que a migração de 06/10
 * fecha no banco e este arquivo fecha aqui.
 */
function pedidoDaLinha(linha: LinhaDaFila, telefoneDaConversa: string): PedidoDeEnvio {
  const p = linha.payload ?? {};
  const tipo = p.tipo === "pdf" ? "pdf" : p.tipo === "imagem" ? "imagem" : "texto";
  return {
    tipo,
    para: telefoneDaConversa,
    texto: (p.texto as string) ?? (p.message as string) ?? undefined,
    documento: (p.documento as string) ?? (p.document as string) ?? undefined,
    nomeArquivo: (p.nomeArquivo as string) ?? (p.fileName as string) ?? undefined,
  };
}

/**
 * A linha reservada não saiu. `tentativas` é a contagem já com esta (a reserva
 * conta). Esgotou ou não adianta repetir: falha definitiva, com o motivo — e
 * não uma "pendente" que a leitura da fila nunca mais pega.
 */
async function marcarFalha(
  erros: ErroDeGravacao[],
  linha: LinhaDaFila,
  tentativas: number,
  erro: string,
  definitiva: boolean,
): Promise<ResultadoDaLinha> {
  const acabou = definitiva || tentativas >= FILA_MAX_TENTATIVAS;
  const situacao: StatusFila = acabou ? "falha" : "pendente";

  await gravarFila(erros, linha.id, { status: situacao, erro });
  if (linha.mensagem_id) {
    await gravarMensagem(erros, linha.mensagem_id, { status: acabou ? "falha" : "pendente", erro });
  }
  return { fila_id: linha.id, mensagem_id: linha.mensagem_id, situacao, erro };
}

/* ------------------------------------------------------------------ */
/* A rodada                                                            */
/* ------------------------------------------------------------------ */

async function rodada(quem: Quem): Promise<Response> {
  const { token, clientToken, telefonePadrao } = credenciais();
  if (!token) {
    // Falar claro: sem isto, o sintoma seria "a fila não anda" e ninguém
    // adivinharia que falta uma variável de ambiente.
    return json(503, {
      ok: false,
      erro: "ZAPI_TOKEN não está configurado no servidor",
      comoResolver: "Cadastre ZAPI_TOKEN e ZAPI_CLIENT_TOKEN nas variáveis do projeto.",
    });
  }

  // pai-arbitrario-ok: o token do Z-API no servidor é UM (process.env), e ele
  // só vale para uma instância — a gráfica opera uma. Se um dia houver duas
  // ativas, o envio precisa passar a usar a instância de cada conversa.
  const { data: instancia, error: erroInstancia } = await supabaseAdmin
    .from("whatsapp_instancias")
    .select("id, zapi_instance_id, conectado")
    .eq("ativa", true)
    .limit(1)
    .maybeSingle();

  if (erroInstancia) {
    console.error("[whatsapp-enviar] falha ao ler a instância", erroInstancia.message);
    return json(500, { ok: false, erro: `falha ao ler a instância: ${erroInstancia.message}` });
  }
  if (!instancia?.zapi_instance_id) {
    return json(503, {
      ok: false,
      erro: "nenhuma instância do Z-API cadastrada",
      comoResolver: "Cadastre a instância em WhatsApp › Monitor.",
    });
  }

  const agora = new Date();
  const erros: ErroDeGravacao[] = [];
  await devolverReservasEsquecidas(erros, agora);

  if (instancia.conectado !== true) {
    // Celular fora do Z-API: tentar agora só gastaria as tentativas de cada
    // aviso — e o despachante chama de 2 em 2 minutos. Nada é tentado; as
    // linhas esperam pendentes e saem na primeira rodada depois de conectar.
    return json(503, {
      ok: false,
      erro: "WhatsApp desconectado: nada foi tentado, as mensagens esperam na fila",
      comoResolver:
        "Leia o QR Code no painel do Z-API e clique em Verificar no Monitor do WhatsApp.",
      erros_de_gravacao: erros,
    });
  }

  const { data: linhas, error: erroFila } = await supabaseAdmin
    .from("whatsapp_fila_envio")
    .select("id, conversa_id, mensagem_id, payload, tentativas, created_by, idempotency_key")
    .eq("status", "pendente")
    .lt("tentativas", FILA_MAX_TENTATIVAS)
    .order("created_at", { ascending: true })
    .limit(ZAPI_LIMITE_POR_RODADA);

  if (erroFila) {
    console.error("[whatsapp-enviar] falha ao ler a fila", erroFila.message);
    return json(500, { ok: false, erro: `falha ao ler a fila: ${erroFila.message}` });
  }

  const resultados: ResultadoDaLinha[] = [];

  for (const linha of (linhas ?? []) as LinhaDaFila[]) {
    // A RESERVA: só segue quem virou a linha de pendente para enviando. Se
    // outra chamada chegou antes, esta pula — e o cliente recebe uma vez só.
    const tentativas = (linha.tentativas ?? 0) + 1;
    const reservada = await gravarFila(
      erros,
      linha.id,
      { status: "enviando", tentativas },
      { quandoStatus: "pendente" },
    );
    if (!reservada) continue;

    // Linha sem conversa ou sem autor não tem como ter entrado pela caixa de
    // entrada (`whatsapp_responder` e `whatsapp_responder_arquivo` gravam os
    // dois). A exceção é a assistente de IA da caixa v3: `whatsapp_ia_enviar`
    // (SECURITY DEFINER, só service_role) enfileira sem autor, com a chave
    // 'ia:<mensagem>'. Fora disso é pedido de fora, e pedido de fora não sai —
    // falha definitiva, com o motivo na linha.
    const daIa = (linha.idempotency_key ?? "").startsWith("ia:");
    if (!linha.conversa_id || (!linha.created_by && !daIa)) {
      resultados.push(
        await marcarFalha(
          erros,
          linha,
          tentativas,
          "linha da fila sem conversa ou sem autor: só a caixa de entrada enfileira",
          true,
        ),
      );
      continue;
    }

    const { data: conversa, error: erroConversa } = await supabaseAdmin
      .from("whatsapp_conversas")
      .select("telefone")
      .eq("id", linha.conversa_id)
      .maybeSingle();
    if (erroConversa) {
      // Banco fora agora não quer dizer pedido ruim: tenta de novo depois.
      resultados.push(
        await marcarFalha(
          erros,
          linha,
          tentativas,
          `falha ao ler a conversa: ${erroConversa.message}`,
          false,
        ),
      );
      continue;
    }

    const pedido = pedidoDaLinha(linha, (conversa?.telefone as string) ?? "");
    // Arquivo enviado pela caixa: mora no bucket privado. O Z-API baixa por
    // um link temporário (1 h), gerado aqui no servidor.
    const caminho = (linha.payload?.storage_path as string | undefined) ?? null;
    if (pedido.tipo !== "texto" && !pedido.documento && caminho) {
      const bucket = (linha.payload?.storage_bucket as string | undefined) ?? "whatsapp-midias";
      const { data: assinado, error: erroLink } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(caminho, 3600);
      if (erroLink || !assinado) {
        resultados.push(
          await marcarFalha(
            erros,
            linha,
            tentativas,
            `falha ao gerar o link do arquivo: ${erroLink?.message ?? "sem link"}`,
            false,
          ),
        );
        continue;
      }
      pedido.documento = assinado.signedUrl;
    }

    const montado = montarEnvio(pedido, { instanceId: instancia.zapi_instance_id, token });

    if ("erro" in montado) {
      // Pedido que não dá para montar não melhora tentando de novo.
      resultados.push(await marcarFalha(erros, linha, tentativas, montado.erro, true));
      continue;
    }

    const resposta = await chamarZapi(montado, clientToken);
    const tipoDeLog: TipoDeLog =
      pedido.tipo === "pdf"
        ? "envio_documento"
        : pedido.tipo === "imagem"
          ? "envio_imagem"
          : "envio_texto";
    const logBase = {
      instancia_id: instancia.id,
      conversa_id: linha.conversa_id,
      mensagem_id: linha.mensagem_id,
      request: { ...pedidoParaLog(montado), fila: "whatsapp_fila_envio", fila_id: linha.id },
    };
    if ("falhaDeRede" in resposta) {
      await registrarLog(erros, {
        ...logBase,
        tipo: "erro",
        sucesso: false,
        erro: resposta.falhaDeRede,
        response: null,
      });
      resultados.push(await marcarFalha(erros, linha, tentativas, resposta.falhaDeRede, false));
      continue;
    }

    const lido = lerRespostaZapi(resposta.status, resposta.corpo);
    await registrarLog(erros, {
      ...logBase,
      tipo: lido.ok ? tipoDeLog : "erro",
      sucesso: lido.ok,
      erro: lido.ok ? null : lido.erro,
      response: resposta,
    });
    if (!lido.ok) {
      resultados.push(
        await marcarFalha(erros, linha, tentativas, lido.erro, !valeTentarDeNovo(lido.erro)),
      );
      continue;
    }

    // Saiu. A fila é gravada primeiro: se ela ficasse "pendente", a próxima
    // rodada mandaria a mesma mensagem de novo ao cliente.
    await gravarFila(erros, linha.id, { status: "enviada", erro: null });
    if (linha.mensagem_id) {
      // A chave única (instancia_id, zapi_message_id) não disputa com o
      // webhook: a mensagem mandada pela API chega lá com fromMe+fromApi e é
      // ignorada (evento-zapi.ts). Se mesmo assim o id já existir, o UPDATE
      // é recusado e o motivo vai para erros_de_gravacao — nunca uma segunda
      // linha.
      await gravarMensagem(erros, linha.mensagem_id, {
        status: "enviada",
        erro: null,
        zapi_message_id: lido.idExterno,
        enviado_em: new Date().toISOString(),
      });
    }
    resultados.push({
      fila_id: linha.id,
      mensagem_id: linha.mensagem_id,
      situacao: "enviada",
      erro: null,
    });
  }

  const avisos = await processarAvisosAoCliente(instancia, token, clientToken, agora);
  erros.push(...avisos.erros_de_gravacao);

  const automacoes = await processarAutomacoes(
    instancia,
    token,
    clientToken,
    telefonePadrao,
    agora,
  );
  erros.push(...automacoes.erros_de_gravacao);

  const falhas = resultados.filter((r) => r.situacao !== "enviada");
  const corpoResposta: Resposta = {
    ok: erros.length === 0 && !avisos.erro && !automacoes.erro,
    despachante: quem.tipo,
    enviadas: resultados.length - falhas.length,
    falhas: falhas.length,
    fila_vazia: resultados.length === 0,
    detalhes: falhas.map((f) => ({ id: f.fila_id, erro: f.erro })),
    resultados,
    erros_de_gravacao: erros,
    avisos_ao_cliente: {
      enviados: avisos.enviados,
      falhas: avisos.falhas,
      detalhes: avisos.detalhes,
      erro: avisos.erro,
    },
    automacoes: {
      enviadas: automacoes.enviadas,
      falhas: automacoes.falhas,
      detalhes: automacoes.detalhes,
      erro: automacoes.erro,
    },
  };

  if (erros.length > 0) {
    // Mensagem que saiu e não ficou registrada é o pior caso: o cliente
    // recebeu e o sistema diz "pendente". Resposta de erro, para ninguém ler
    // isto como sucesso.
    return json(500, {
      ...corpoResposta,
      erro: `o envio rodou, mas ${erros.length} gravação(ões) foram recusadas pelo banco — veja erros_de_gravacao`,
    });
  }
  return json(200, corpoResposta);
}

type Instancia = { id: string; zapi_instance_id: string };

/**
 * A OUTRA fila: os avisos automáticos ao cliente.
 *
 * `notificacoes_fila` é escrita por `tg_os_notificar_cliente` e pelo gatilho do
 * orçamento, com o modelo e as variáveis prontos. `marco_notificavel_os` define
 * cinco momentos que o cliente merece saber:
 *
 *   aguardando_aprovacao_arte  a arte está pronta para aprovar
 *   em_producao                seu produto está sendo confeccionado
 *   aguardando_retirada        está pronto para retirar
 *   em_entrega                 saiu para entrega
 *   concluido                  serviço concluído
 *
 * Tudo isso existe desde agosto e nunca saiu do lugar: ninguém lia a fila. Em
 * 28/09/2026 havia 12 avisos cancelados e 3 pendentes — estes últimos de três
 * orçamentos aprovados no mesmo dia, de clientes reais que nunca souberam.
 *
 * São duas filas porque são dois assuntos: aqui é o aviso que o sistema decide
 * mandar; `whatsapp_fila_envio` é a mensagem que uma pessoa escreveu na
 * conversa. O consumidor é o mesmo, e é isso que importa. Roda em TODA
 * chamada — antes só rodava quando havia mensagem de conversa na fila, e o
 * aviso dependia de alguém responder um cliente para sair.
 *
 * O status que não saiu aqui é "falhou" (o CHECK da tabela), nunca "falha":
 * é a palavra que `vw_avisos_pendentes` lista em /avisos com o `ultimo_erro`.
 * A falha que vale repetir espera (`proxima_tentativa_em`: 1, 5, 15, 60 min),
 * a mesma coluna que `reservar_notificacoes` respeita.
 *
 * O AVISO QUE SAIU VIRA MENSAGEM DA CONVERSA. Depois do `enviado`, a linha é
 * registrada em `whatsapp_mensagens` por `whatsapp_registrar_mensagem`
 * (direção saída, com o messageId do Z-API): a pessoa que abre a conversa vê o
 * que o sistema mandou, e o recibo (MessageStatusCallback) tem linha para
 * marcar entregue/lida. Falhar aqui NÃO desfaz o `enviado` — o cliente já
 * recebeu; o que falta é só o registro, e ele vai para erros_de_gravacao.
 */
async function processarAvisosAoCliente(
  instancia: Instancia,
  token: string,
  clientToken: string,
  agora: Date,
): Promise<{
  enviados: number;
  falhas: number;
  detalhes: { evento: string; erro: string }[];
  erros_de_gravacao: ErroDeGravacao[];
  erro: string | null;
}> {
  const erros: ErroDeGravacao[] = [];
  const detalhes: { evento: string; erro: string }[] = [];

  const { data: linhas, error: erroLinhas } = await supabaseAdmin
    .from("notificacoes_fila")
    .select("id, canal, destinatario, evento, template, variaveis, tentativas, max_tentativas")
    .eq("canal", "whatsapp")
    .eq("status", "pendente")
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${agora.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(ZAPI_LIMITE_POR_RODADA);

  if (erroLinhas) {
    const erro = `falha ao ler a fila de avisos: ${erroLinhas.message}`;
    console.error("[whatsapp-enviar]", erro);
    return { enviados: 0, falhas: 0, detalhes, erros_de_gravacao: erros, erro };
  }
  if (!linhas?.length) {
    return { enviados: 0, falhas: 0, detalhes, erros_de_gravacao: erros, erro: null };
  }

  // Os modelos numa consulta só: a fila costuma repetir poucos eventos, e uma
  // ida ao banco por linha seria desperdício puro.
  const { data: modelos, error: erroModelos } = await supabaseAdmin
    .from("notificacao_templates")
    .select("evento, corpo, ativo")
    .eq("canal", "whatsapp");
  if (erroModelos) {
    // Sem os modelos, todo aviso pareceria "sem modelo" e seria marcado como
    // falha definitiva por um tropeço do banco. Melhor não tocar em nada.
    const erro = `falha ao ler os modelos de mensagem: ${erroModelos.message}`;
    console.error("[whatsapp-enviar]", erro);
    return { enviados: 0, falhas: 0, detalhes, erros_de_gravacao: erros, erro };
  }
  const corpoPorEvento = new Map(
    (modelos ?? []).filter((m) => m.ativo !== false).map((m) => [m.evento, m.corpo]),
  );

  let enviados = 0;

  for (const linha of linhas) {
    const maximo = linha.max_tentativas ?? 5;
    // A RESERVA, igual à da fila das conversas — e a tentativa conta aqui,
    // como em `reservar_notificacoes`.
    const tentativas = (linha.tentativas ?? 0) + 1;
    const reservada = await gravarAviso(
      erros,
      linha.id,
      { status: "enviando", tentativas },
      { quandoStatus: "pendente" },
    );
    if (!reservada) continue;

    const corpo = corpoPorEvento.get(linha.template) ?? corpoPorEvento.get(linha.evento);
    if (!corpo) {
      // Modelo faltando não melhora tentando de novo. Falha definitiva, com o
      // nome do evento na mensagem — senão vira "não chegou" sem motivo.
      const erro = `sem modelo de mensagem para o evento "${linha.evento}"`;
      await gravarAviso(erros, linha.id, { status: "falhou", ultimo_erro: erro });
      detalhes.push({ evento: linha.evento, erro });
      continue;
    }

    // O texto fica numa variável: é ele que vai para a conversa e para o log.
    const textoDoAviso = renderizarTemplate(
      corpo,
      linha.variaveis as Record<string, unknown> | null,
    );
    const montado = montarEnvio(
      { tipo: "texto", para: linha.destinatario, texto: textoDoAviso },
      { instanceId: instancia.zapi_instance_id, token },
    );

    if ("erro" in montado) {
      await gravarAviso(erros, linha.id, { status: "falhou", ultimo_erro: montado.erro });
      detalhes.push({ evento: linha.evento, erro: montado.erro });
      continue;
    }

    const resposta = await chamarZapi(montado, clientToken);
    const request = { ...pedidoParaLog(montado), fila: "notificacoes_fila", fila_id: linha.id };
    if ("falhaDeRede" in resposta) {
      await registrarLog(erros, {
        tipo: "erro",
        sucesso: false,
        erro: resposta.falhaDeRede,
        instancia_id: instancia.id,
        request,
        response: null,
      });
      const acabou = tentativas >= maximo;
      await gravarAviso(erros, linha.id, {
        status: acabou ? "falhou" : "pendente",
        ultimo_erro: resposta.falhaDeRede,
        proxima_tentativa_em: proximaTentativaEm(agora, tentativas),
      });
      detalhes.push({ evento: linha.evento, erro: resposta.falhaDeRede });
      continue;
    }

    const lido = lerRespostaZapi(resposta.status, resposta.corpo);
    if (!lido.ok) {
      await registrarLog(erros, {
        tipo: "erro",
        sucesso: false,
        erro: lido.erro,
        instancia_id: instancia.id,
        request,
        response: resposta,
      });
      const definitiva = !valeTentarDeNovo(lido.erro) || tentativas >= maximo;
      await gravarAviso(erros, linha.id, {
        status: definitiva ? "falhou" : "pendente",
        ultimo_erro: lido.erro,
        proxima_tentativa_em: proximaTentativaEm(agora, tentativas),
      });
      detalhes.push({ evento: linha.evento, erro: lido.erro });
      continue;
    }

    await gravarAviso(erros, linha.id, {
      status: "enviado",
      enviado_em: new Date().toISOString(),
      provider_message_id: lido.idExterno,
      ultimo_erro: null,
    });
    enviados++;

    // O aviso vira mensagem da conversa. Fora da chamada para o objeto dela
    // não ter chave aninhada — senão tests/rpc-assinaturas desiste de conferir.
    const ponteiro = { fonte: "notificacoes_fila", id: linha.id };
    const { data: registrada, error: erroRegistro } = await (supabaseAdmin.rpc as any)(
      "whatsapp_registrar_mensagem",
      {
        p_instancia_id: instancia.id,
        p_zapi_message_id: lido.idExterno,
        p_telefone: request.phone,
        p_direcao: "saida",
        p_tipo: "texto",
        p_texto: textoDoAviso,
        p_payload: ponteiro,
        // 'automacao': o gatilho da caixa v3 (_wa_mensagem_antes_inserir) não
        // trata o aviso como resposta humana — não zera a espera do cliente
        // nem muda a conversa para 'humano'.
        p_origem: "automacao",
      },
    );
    if (erroRegistro) {
      anotarErro(
        erros,
        "whatsapp_mensagens",
        linha.id,
        `o aviso saiu, mas não ficou na conversa: ${erroRegistro.message}`,
      );
    }
    const gravada = (registrada ?? {}) as { mensagem_id?: string; conversa_id?: string };
    await registrarLog(erros, {
      tipo: "envio_texto",
      sucesso: true,
      erro: null,
      instancia_id: instancia.id,
      conversa_id: gravada.conversa_id ?? null,
      mensagem_id: gravada.mensagem_id ?? null,
      request,
      response: resposta,
    });
  }

  return { enviados, falhas: detalhes.length, detalhes, erros_de_gravacao: erros, erro: null };
}

/* ------------------------------------------------------------------ */
/* A terceira fila: as automações                                      */
/* ------------------------------------------------------------------ */

type LinhaDeExecucao = {
  id: string;
  automacao_id: string;
  gatilho: string;
  entidade: string;
  entidade_id: string | null;
  tentativas: number | null;
  contexto: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  automacoes: {
    id: string;
    nome: string;
    acao: string;
    payload: Record<string, unknown> | null;
    ativo: boolean;
  } | null;
};

/**
 * As regras de /automacoes (`automacao_execucoes`), drenadas na mesma rodada.
 *
 * Até 06/10/2026 só a função `process-automations` (Supabase Edge) lia esta
 * fila — e nada a chamava. O motor (`enqueue_automacoes`) enfileirava, a tela
 * dizia "na fila", e a mensagem nunca saía. Agora é o mesmo consumidor: a
 * varredura das situações (`criar_eventos_automacoes_recorrentes`: OS
 * atrasada, pagamento vencido, estoque no mínimo) roda no começo de cada
 * rodada, como a função antiga fazia, e cada execução pendente é reservada
 * (`pendente` → `processando`), montada por domain/automacoes/destino.ts e
 * mandada.
 *
 * O status é o CHECK da tabela: pendente | processando | sucesso | erro.
 * Falha de rede e limite de taxa voltam a `pendente` com `scheduled_at`
 * empurrado (1, 5, 15, 60 min); número inválido, destino recusado, regra sem
 * mensagem ou desligada viram `erro` de vez. Desligada no meio do caminho
 * recebe o mesmo texto 'Cancelada: …' que o gatilho do banco grava.
 */
async function processarAutomacoes(
  instancia: Instancia,
  token: string,
  clientToken: string,
  telefonePadrao: string,
  agora: Date,
): Promise<{
  enviadas: number;
  falhas: number;
  detalhes: { execucao: string; erro: string }[];
  erros_de_gravacao: ErroDeGravacao[];
  erro: string | null;
}> {
  const erros: ErroDeGravacao[] = [];
  const detalhes: { execucao: string; erro: string }[] = [];

  // As situações viram eventos aqui: sem esta chamada, "OS atrasada" e
  // "pagamento vencido" nunca entrariam na fila (ninguém mais chama a função).
  const { error: erroVarredura } = await (supabaseAdmin.rpc as any)(
    "criar_eventos_automacoes_recorrentes",
  );
  if (erroVarredura) {
    // Falha da varredura não impede o que já está na fila de sair.
    anotarErro(
      erros,
      "automacao_execucoes",
      "*",
      `falha na varredura das situações: ${erroVarredura.message}`,
    );
  }

  const { data: execucoes, error: erroExecucoes } = await supabaseAdmin
    .from("automacao_execucoes")
    .select(
      "id, automacao_id, gatilho, entidade, entidade_id, tentativas, contexto, payload, automacoes(id, nome, acao, payload, ativo)",
    )
    .eq("status", "pendente")
    .lte("scheduled_at", agora.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(ZAPI_LIMITE_POR_RODADA);

  if (erroExecucoes) {
    const erro = `falha ao ler a fila de automações: ${erroExecucoes.message}`;
    console.error("[whatsapp-enviar]", erro);
    return { enviadas: 0, falhas: 0, detalhes, erros_de_gravacao: erros, erro };
  }

  let enviadas = 0;

  for (const linha of (execucoes ?? []) as unknown as LinhaDeExecucao[]) {
    const tentativas = (linha.tentativas ?? 0) + 1;
    const reservada = await gravarExecucao(
      erros,
      linha.id,
      {
        status: "processando",
        tentativas,
        resposta: { reservado_em: agora.toISOString() },
      },
      { quandoStatus: "pendente" },
    );
    if (!reservada) continue;

    const falhar = async (erro: string, definitiva: boolean) => {
      const acabou = definitiva || tentativas >= EXECUCAO_MAX_TENTATIVAS;
      await gravarExecucao(
        erros,
        linha.id,
        acabou
          ? { status: "erro", erro, processado_em: new Date().toISOString(), resposta: null }
          : {
              status: "pendente",
              erro,
              resposta: null,
              scheduled_at: proximaTentativaEm(agora, tentativas),
            },
      );
      detalhes.push({ execucao: linha.id, erro });
    };

    const automacao = linha.automacoes;
    if (!automacao) {
      await falhar("a automação desta execução não existe mais", true);
      continue;
    }
    if (automacao.ativo === false) {
      await falhar("Cancelada: a automação foi desligada antes do envio.", true);
      continue;
    }
    if (automacao.acao !== "whatsapp") {
      await falhar(`Ação não suportada: ${automacao.acao || "sem ação"}`, true);
      continue;
    }

    const execucao: ExecucaoParaEnvio = {
      gatilho: linha.gatilho,
      contexto: linha.contexto ?? {},
      payload: linha.payload ?? {},
      automacao: { payload: automacao.payload ?? {} },
      telefonePadrao: telefonePadrao || null,
    };
    const texto = textoDaAutomacao(execucao);
    if (!texto) {
      await falhar("a automação não tem mensagem", true);
      continue;
    }
    const destino = destinoDaAutomacao(execucao);
    if (!destino.ok) {
      await falhar(destino.erro, true);
      continue;
    }

    const montado = montarEnvio(
      { tipo: "texto", para: destino.telefone, texto },
      { instanceId: instancia.zapi_instance_id, token },
    );
    if ("erro" in montado) {
      await falhar(montado.erro, true);
      continue;
    }

    const resposta = await chamarZapi(montado, clientToken);
    const request = { ...pedidoParaLog(montado), fila: "automacao_execucoes", fila_id: linha.id };
    if ("falhaDeRede" in resposta) {
      await registrarLog(erros, {
        tipo: "erro",
        sucesso: false,
        erro: resposta.falhaDeRede,
        instancia_id: instancia.id,
        request,
        response: null,
      });
      await falhar(resposta.falhaDeRede, false);
      continue;
    }

    const lido = lerRespostaZapi(resposta.status, resposta.corpo);
    await registrarLog(erros, {
      tipo: lido.ok ? "envio_texto" : "erro",
      sucesso: lido.ok,
      erro: lido.ok ? null : lido.erro,
      instancia_id: instancia.id,
      request,
      response: resposta,
    });
    if (!lido.ok) {
      await falhar(lido.erro, !valeTentarDeNovo(lido.erro));
      continue;
    }

    await gravarExecucao(erros, linha.id, {
      status: "sucesso",
      processado_em: new Date().toISOString(),
      resposta: (resposta.corpo ?? null) as Json,
      erro: null,
    });
    const { error: erroUltima } = await supabaseAdmin
      .from("automacoes")
      .update({ ultima_execucao: new Date().toISOString() })
      .eq("id", linha.automacao_id);
    if (erroUltima) anotarErro(erros, "automacoes", linha.automacao_id, erroUltima.message);
    enviadas++;
  }

  return { enviadas, falhas: detalhes.length, detalhes, erros_de_gravacao: erros, erro: null };
}
