import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { lerRespostaZapi, telefoneParaZapi } from "@/domain/whatsapp/zapi-envio";

export type ResultadoVerificacao = {
  inicio: string;
  credenciais: boolean;
  conectado: boolean | null;
  celularConectado: boolean | null;
  erroStatus: string | null;
  testeEnviado: boolean;
  erroTeste: string | null;
};

/**
 * Verificação de conexão: pergunta ao Z-API se a instância está conectada e
 * manda uma mensagem de teste para o próprio número da empresa. A mensagem
 * dispara o webhook de status (e o "Ao receber"); a tela acompanha o que
 * chega no histórico a partir de `inicio`.
 *
 * Quem pode: `whatsapp.manage`, conferido no banco com a chave de serviço.
 * Antes bastava estar logado: qualquer pessoa da equipe mandava uma mensagem
 * pelo número da gráfica e trocava o status da instância.
 *
 * O envio de teste deixa linha em `whatsapp_logs` como qualquer outro envio
 * (sem o token — ele só existe na URL, que não é gravada).
 */
export const verificarConexaoZapi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResultadoVerificacao> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pode, error: erroPermissao } = await supabaseAdmin.rpc("has_permission", {
      _user_id: context.userId,
      _permission: "whatsapp.manage",
    });
    if (erroPermissao) {
      throw new Error(`Não foi possível conferir a permissão: ${erroPermissao.message}`);
    }
    if (pode !== true) {
      throw new Error("A verificação de conexão exige a permissão whatsapp › manage.");
    }

    const inicio = new Date().toISOString();
    const { data: instancia, error } = await context.supabase
      .from("whatsapp_instancias")
      .select("id, zapi_instance_id, numero")
      .eq("ativa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!instancia)
      throw new Error("Nenhuma instância cadastrada. Cadastre a instância antes de verificar.");

    const token = process.env.ZAPI_TOKEN ?? "";
    const clientToken = process.env.ZAPI_CLIENT_TOKEN ?? "";
    const r: ResultadoVerificacao = {
      inicio,
      credenciais: !!token,
      conectado: null,
      celularConectado: null,
      erroStatus: null,
      testeEnviado: false,
      erroTeste: null,
    };
    if (!token) {
      r.erroStatus = "O token do Z-API não está configurado no servidor.";
      return r;
    }
    const base = `https://api.z-api.io/instances/${instancia.zapi_instance_id}/token/${token}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(clientToken ? { "Client-Token": clientToken } : {}),
    };

    try {
      const resp = await fetch(`${base}/status`, { headers });
      const corpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        r.erroStatus = `O Z-API respondeu ${resp.status}: ${String(corpo.error ?? corpo.message ?? "sem detalhe")}`;
      } else {
        r.conectado = corpo.connected === true;
        r.celularConectado =
          typeof corpo.smartphoneConnected === "boolean" ? corpo.smartphoneConnected : null;
        if (corpo.error) r.erroStatus = String(corpo.error);
        await supabaseAdmin
          .from("whatsapp_instancias")
          .update({ conectado: r.conectado, status: r.conectado ? "conectada" : "desconectada" })
          .eq("id", instancia.id);
      }
    } catch (e) {
      r.erroStatus = `Não foi possível falar com o Z-API: ${e instanceof Error ? e.message : String(e)}`;
    }

    const phone = telefoneParaZapi(instancia.numero);
    if (!phone) {
      r.erroTeste = "Cadastre o número da empresa na instância para enviar a mensagem de teste.";
    } else if (r.conectado === false) {
      r.erroTeste = "Instância desconectada — o teste não sai até ler o QR Code.";
    } else {
      const message = `Teste de conexão do BEX PRINT OS — ${new Date().toLocaleString("pt-BR", { timeZone: "America/Belem" })}`;
      let registro: { sucesso: boolean; erro: string | null; response: Json } = {
        sucesso: false,
        erro: null,
        response: null,
      };
      try {
        const resp = await fetch(`${base}/send-text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ phone, message }),
        });
        // `resp.ok` não basta: o Z-API devolve 200 com o erro no corpo, e um
        // teste que se declara enviado sem messageId mente justo para quem
        // está tentando descobrir por que a mensagem não chega.
        const corpo = await resp.json().catch(() => null);
        const lido = lerRespostaZapi(resp.status, corpo);
        if (lido.ok) r.testeEnviado = true;
        else r.erroTeste = `O Z-API recusou o envio: ${lido.erro}`;
        registro = {
          sucesso: lido.ok,
          erro: lido.ok ? null : lido.erro,
          response: { status: resp.status, corpo } as Json,
        };
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        r.erroTeste = `Falha ao enviar o teste: ${motivo}`;
        registro = { sucesso: false, erro: motivo, response: null };
      }
      const { error: erroLog } = await supabaseAdmin.from("whatsapp_logs").insert({
        tipo: registro.sucesso ? "envio_texto" : "erro",
        sucesso: registro.sucesso,
        erro: registro.erro,
        instancia_id: instancia.id,
        request: { phone, message, fila: "teste_de_conexao", fila_id: inicio } as Json,
        response: registro.response,
      });
      if (erroLog)
        console.error("[whatsapp-verificar] falha ao gravar o log do teste", erroLog.message);
    }
    return r;
  });
