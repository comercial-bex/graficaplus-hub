import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  lerRespostaZapi,
  montarEnvio,
  valeTentarDeNovo,
  type PedidoDeEnvio,
} from "@/domain/whatsapp/zapi-envio";

/**
 * O consumidor da fila de envio do WhatsApp.
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
 * Sem `pg_cron` e sem `pg_net` no projeto, o banco não consegue disparar
 * nada sozinho — por isso o consumo é por chamada HTTP, feita pelo próprio
 * app logo depois de enfileirar, e repetível pelo botão do monitor.
 */

const ZAPI_LIMITE_POR_RODADA = 20;

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

/** Quem chamou tem direito? O JWT do usuário, com a permissão de WhatsApp. */
async function usuarioAutorizado(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user) return null;

  // `whatsapp.reply` é a permissão que existe — conferido em
  // `perfil_permissoes`. Um nome inventado aqui (`whatsapp.send`) recusaria
  // todo mundo em silêncio: é o mesmo formato do filtro que procura palavra
  // que o banco nunca escreve.
  const { data: pode } = await supabaseAdmin.rpc("has_permission", {
    _user_id: data.user.id,
    _permission: "whatsapp.reply",
  });
  return pode === true ? data.user.id : null;
}

type LinhaDaFila = {
  id: string;
  conversa_id: string | null;
  mensagem_id: string | null;
  payload: Record<string, unknown> | null;
  tentativas: number | null;
};

/**
 * O pedido, lido do payload da fila.
 *
 * A fila foi criada antes deste consumidor, então o payload é livre. Aceita o
 * que a tela de monitor já grava (`{ texto }`) e o formato completo.
 */
function pedidoDaLinha(linha: LinhaDaFila, telefone: string): PedidoDeEnvio {
  const p = linha.payload ?? {};
  const tipo = p.tipo === "pdf" ? "pdf" : "texto";
  return {
    tipo,
    para: (p.para as string) ?? telefone,
    texto: (p.texto as string) ?? (p.message as string) ?? undefined,
    documento: (p.documento as string) ?? (p.document as string) ?? undefined,
    nomeArquivo: (p.nomeArquivo as string) ?? (p.fileName as string) ?? undefined,
  };
}

async function marcarFalha(linha: LinhaDaFila, erro: string, definitiva: boolean) {
  await supabaseAdmin
    .from("whatsapp_fila_envio")
    .update({
      status: definitiva ? "falha" : "pendente",
      tentativas: (linha.tentativas ?? 0) + 1,
      erro,
      updated_at: new Date().toISOString(),
    })
    .eq("id", linha.id);

  if (linha.mensagem_id) {
    await supabaseAdmin
      .from("whatsapp_mensagens")
      .update({ status: definitiva ? "falha" : "pendente", erro })
      .eq("id", linha.mensagem_id);
  }
}

export async function processarFilaZapi(request: Request): Promise<Response> {
  const uid = await usuarioAutorizado(request);
  if (!uid) return json(401, { ok: false, erro: "sem permissão para enviar WhatsApp" });

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

  const { data: instancia } = await supabaseAdmin
    .from("whatsapp_instancias")
    .select("zapi_instance_id")
    .eq("ativa", true)
    .limit(1)
    .maybeSingle();

  if (!instancia?.zapi_instance_id) {
    return json(503, {
      ok: false,
      erro: "nenhuma instância do Z-API cadastrada",
      comoResolver: "Cadastre a instância em WhatsApp › Conexão.",
    });
  }

  const { data: linhas, error: erroFila } = await supabaseAdmin
    .from("whatsapp_fila_envio")
    .select("id, conversa_id, mensagem_id, payload, tentativas")
    .eq("status", "pendente")
    .lt("tentativas", 5)
    .order("created_at", { ascending: true })
    .limit(ZAPI_LIMITE_POR_RODADA);

  if (erroFila) return json(500, { ok: false, erro: "falha ao ler a fila" });
  if (!linhas?.length) return json(200, { ok: true, enviadas: 0, falhas: 0, fila_vazia: true });

  let enviadas = 0;
  const falhas: { id: string; erro: string }[] = [];

  for (const linha of linhas as LinhaDaFila[]) {
    // O telefone sai da conversa quando o payload não traz — é o caminho do
    // reenvio pela tela, que só guarda o texto.
    let telefone = "";
    if (linha.conversa_id) {
      const { data: conversa } = await supabaseAdmin
        .from("whatsapp_conversas")
        .select("telefone")
        .eq("id", linha.conversa_id)
        .maybeSingle();
      telefone = (conversa?.telefone as string) ?? "";
    }

    const montado = montarEnvio(pedidoDaLinha(linha, telefone), {
      instanceId: instancia.zapi_instance_id,
      token,
    });

    if ("erro" in montado) {
      // Pedido que não dá para montar não melhora tentando de novo.
      await marcarFalha(linha, montado.erro, true);
      falhas.push({ id: linha.id, erro: montado.erro });
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
      await marcarFalha(linha, erro, false);
      falhas.push({ id: linha.id, erro });
      continue;
    }

    const lido = lerRespostaZapi(status, corpo);
    if (!lido.ok) {
      await marcarFalha(linha, lido.erro, !valeTentarDeNovo(lido.erro));
      falhas.push({ id: linha.id, erro: lido.erro });
      continue;
    }

    await supabaseAdmin
      .from("whatsapp_fila_envio")
      .update({
        status: "enviada",
        tentativas: (linha.tentativas ?? 0) + 1,
        erro: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", linha.id);

    if (linha.mensagem_id) {
      await supabaseAdmin
        .from("whatsapp_mensagens")
        .update({ status: "enviada", erro: null, zapi_message_id: lido.idExterno })
        .eq("id", linha.mensagem_id);
    }
    enviadas++;
  }

  return json(200, { ok: true, enviadas, falhas: falhas.length, detalhes: falhas });
}
