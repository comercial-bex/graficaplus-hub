import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
 */
export const verificarConexaoZapi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResultadoVerificacao> => {
    const inicio = new Date().toISOString();
    const { data: instancia, error } = await context.supabase
      .from("whatsapp_instancias")
      .select("id, zapi_instance_id, numero")
      .eq("ativa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!instancia) throw new Error("Nenhuma instância cadastrada. Cadastre a instância antes de verificar.");

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
        r.celularConectado = typeof corpo.smartphoneConnected === "boolean" ? corpo.smartphoneConnected : null;
        if (corpo.error) r.erroStatus = String(corpo.error);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
      try {
        const resp = await fetch(`${base}/send-text`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            phone,
            message: `Teste de conexão do BEX PRINT OS — ${new Date().toLocaleString("pt-BR", { timeZone: "America/Belem" })}`,
          }),
        });
        // `resp.ok` não basta: o Z-API devolve 200 com o erro no corpo, e um
        // teste que se declara enviado sem messageId mente justo para quem
        // está tentando descobrir por que a mensagem não chega.
        const lido = lerRespostaZapi(resp.status, await resp.json().catch(() => null));
        if (lido.ok) r.testeEnviado = true;
        else r.erroTeste = `O Z-API recusou o envio: ${lido.erro}`;
      } catch (e) {
        r.erroTeste = `Falha ao enviar o teste: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return r;
  });
