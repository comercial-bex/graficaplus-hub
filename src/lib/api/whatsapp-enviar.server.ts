import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  lerRespostaZapi,
  montarEnvio,
  renderizarTemplate,
  valeTentarDeNovo,
  type PedidoDeEnvio,
} from "@/domain/whatsapp/zapi-envio";
import type { StatusAviso, StatusFila, StatusMensagem } from "@/domain/whatsapp/status-das-filas";
import { limiteDePresa, proximaTentativaEm } from "@/domain/whatsapp/despachante";

/**
 * O consumidor das filas de envio do WhatsApp.
 *
 * `whatsapp_fila_envio` existe desde junho e a tela de monitor enfileira nela.
 * Nada nunca leu essa fila: mensagem enfileirada ficava parada para sempre, e
 * a tela mostrava "reenfileirada para envio" como se algo fosse acontecer.
 *
 * O TOKEN NÃO MORA NO BANCO. `whatsapp_instancias` guarda o id da instância e
 * o hash do segredo do webhook, nunca o token — ele é lido aqui de
 * `process.env`, no servidor, e só entra na URL montada na hora da chamada.
 * Por isso este arquivo tem sufixo `.server` e é importado dentro do handler:
 * nada dele chega ao pacote do navegador.
 *
 * QUEM CHAMA. Sem `pg_cron` e sem `pg_net` no projeto, o banco não consegue
 * disparar nada sozinho — o consumo é por chamada HTTP: a caixa de entrada
 * (/whatsapp) chama logo depois de cada resposta, e o despachante
 * (`despachante-de-avisos.tsx`) chama a cada 2 minutos de cada aba visível de
 * quem tem `whatsapp.reply`. Várias abas, várias pessoas, ao mesmo tempo.
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
 */

const ZAPI_LIMITE_POR_RODADA = 20;

/**
 * Tentativas de uma linha de `whatsapp_fila_envio` antes de virar falha
 * definitiva. A leitura da fila já filtrava `tentativas < 5`, mas a falha
 * "vale tentar de novo" gravava "pendente" com qualquer contagem — na quinta,
 * a linha saía do filtro e ficava pendente para sempre, sem ninguém saber.
 */
const FILA_MAX_TENTATIVAS = 5;

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

/* ------------------------------------------------------------------ */
/* Quem pode disparar o envio                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Reserva esquecida                                                   */
/* ------------------------------------------------------------------ */

/**
 * Devolve à fila o que ficou em `enviando` por mais de 10 minutos — a rodada
 * que reservou morreu no meio (aba fechada, servidor reiniciado). Vale para as
 * duas filas, inclusive para o que a função `process-automations` reservou.
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
 * que a tela de monitor já grava (`{ texto }`) e o formato completo.
 */
function pedidoDaLinha(linha: LinhaDaFila, telefone: string): PedidoDeEnvio {
  const p = linha.payload ?? {};
  const tipo = p.tipo === "pdf" ? "pdf" : p.tipo === "imagem" ? "imagem" : "texto";
  return {
    tipo,
    para: (p.para as string) ?? telefone,
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

export async function processarFilaZapi(request: Request): Promise<Response> {
  const quem = await usuarioAutorizado(request);
  if (!quem.ok) return json(quem.status, { ok: false, erro: quem.erro });

  const { token, clientToken } = credenciais();
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
    .select("zapi_instance_id, conectado")
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
    .select("id, conversa_id, mensagem_id, payload, tentativas")
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

    // O telefone sai da conversa quando o payload não traz — é o caminho do
    // reenvio pela tela, que só guarda o texto.
    let telefone = "";
    if (linha.conversa_id) {
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
      telefone = (conversa?.telefone as string) ?? "";
    }

    const pedido = pedidoDaLinha(linha, telefone);
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
          await marcarFalha(erros, linha, tentativas, `falha ao gerar o link do arquivo: ${erroLink?.message ?? "sem link"}`, false),
        );
        continue;
      }
      pedido.documento = assinado.signedUrl;
    }

    const montado = montarEnvio(pedido, {
      instanceId: instancia.zapi_instance_id,
      token,
    });

    if ("erro" in montado) {
      // Pedido que não dá para montar não melhora tentando de novo.
      resultados.push(await marcarFalha(erros, linha, tentativas, montado.erro, true));
      continue;
    }

    let status = 0;
    let corpo: unknown = null;
    try {
      const resposta = await fetch(montado.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(clientToken ? { "Client-Token": clientToken } : {}),
        },
        body: JSON.stringify(montado.corpo),
      });
      status = resposta.status;
      corpo = await resposta.json().catch(() => null);
    } catch (e) {
      const erro = e instanceof Error ? e.message : "falha de rede ao chamar o Z-API";
      resultados.push(await marcarFalha(erros, linha, tentativas, erro, false));
      continue;
    }

    const lido = lerRespostaZapi(status, corpo);
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

  const avisos = await processarAvisosAoCliente(
    instancia.zapi_instance_id,
    token,
    clientToken,
    agora,
  );
  erros.push(...avisos.erros_de_gravacao);

  const falhas = resultados.filter((r) => r.situacao !== "enviada");
  const corpoResposta: Resposta = {
    ok: erros.length === 0 && !avisos.erro,
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
 */
async function processarAvisosAoCliente(
  instanceId: string,
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

    const montado = montarEnvio(
      {
        tipo: "texto",
        para: linha.destinatario,
        texto: renderizarTemplate(corpo, linha.variaveis as Record<string, unknown> | null),
      },
      { instanceId, token },
    );

    if ("erro" in montado) {
      await gravarAviso(erros, linha.id, { status: "falhou", ultimo_erro: montado.erro });
      detalhes.push({ evento: linha.evento, erro: montado.erro });
      continue;
    }

    let status = 0;
    let resposta: unknown = null;
    try {
      const r = await fetch(montado.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(clientToken ? { "Client-Token": clientToken } : {}),
        },
        body: JSON.stringify(montado.corpo),
      });
      status = r.status;
      resposta = await r.json().catch(() => null);
    } catch (e) {
      const erro = e instanceof Error ? e.message : "falha de rede ao chamar o Z-API";
      const acabou = tentativas >= maximo;
      await gravarAviso(erros, linha.id, {
        status: acabou ? "falhou" : "pendente",
        ultimo_erro: erro,
        proxima_tentativa_em: proximaTentativaEm(agora, tentativas),
      });
      detalhes.push({ evento: linha.evento, erro });
      continue;
    }

    const lido = lerRespostaZapi(status, resposta);
    if (!lido.ok) {
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
  }

  return { enviados, falhas: detalhes.length, detalhes, erros_de_gravacao: erros, erro: null };
}
