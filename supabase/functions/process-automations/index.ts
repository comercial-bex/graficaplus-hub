import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";

type JsonRecord = Record<string, unknown>;

type AutomationExecution = {
  id: string;
  automacao_id: string;
  gatilho: string;
  entidade: string;
  entidade_id: string | null;
  tentativas: number;
  contexto: JsonRecord;
  payload: JsonRecord;
  automacoes: {
    id: string;
    nome: string;
    acao: string;
    payload: JsonRecord;
  } | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const zapiInstanceId = Deno.env.get("ZAPI_INSTANCE_ID") ?? "";
const zapiToken = Deno.env.get("ZAPI_TOKEN") ?? "";
const zapiClientToken = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";
const fallbackPhone = Deno.env.get("AUTOMATION_DEFAULT_PHONE") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getByPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as JsonRecord)[key];
    }
    return undefined;
  }, source);
}

function renderTemplate(template: string, data: JsonRecord): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, path: string) => {
    const value = getByPath(data, path);
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function resolvePhone(payload: JsonRecord, contexto: JsonRecord, merged: JsonRecord): string {
  const rawPhone =
    (typeof payload.telefone === "string" ? renderTemplate(payload.telefone, merged) : undefined) ||
    (typeof contexto.telefone === "string" ? contexto.telefone : undefined) ||
    (typeof getByPath(contexto, "cliente.telefone") === "string"
      ? String(getByPath(contexto, "cliente.telefone"))
      : undefined) ||
    fallbackPhone;

  return onlyDigits(rawPhone ?? "");
}

async function sendZapiText(phone: string, message: string): Promise<JsonRecord> {
  if (!zapiInstanceId || !zapiToken || !zapiClientToken) {
    throw new Error(
      "Z-API não configurada: defina ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN.",
    );
  }

  const requestPayload = { phone, message };
  const response = await fetch(
    `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-text`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": zapiClientToken,
      },
      body: JSON.stringify(requestPayload),
    },
  );

  const responseText = await response.text();
  let responsePayload: JsonRecord = { raw: responseText };
  try {
    responsePayload = JSON.parse(responseText);
  } catch (_error) {
    // Mantém o corpo bruto quando a Z-API responder texto simples.
  }

  if (!response.ok) {
    throw new Error(`Z-API retornou HTTP ${response.status}: ${responseText}`);
  }

  return responsePayload;
}

async function logWhatsapp(params: {
  execution: AutomationExecution;
  phone: string;
  message: string;
  status: string;
  requestPayload: JsonRecord;
  responsePayload?: JsonRecord;
  error?: string;
}) {
  // Colunas reais de whatsapp_logs: tipo, sucesso, request, response, erro.
  await supabase.from("whatsapp_logs").insert({
    tipo: "automacao",
    sucesso: params.status === "sucesso",
    request: {
      provider: "z-api",
      telefone: params.phone,
      mensagem: params.message,
      automacao_id: params.execution.automacao_id,
      automacao_execucao_id: params.execution.id,
      ...params.requestPayload,
    },
    response: params.responsePayload ?? null,
    erro: params.error ?? null,
  });
}

async function processExecution(execution: AutomationExecution) {
  const automationPayload = execution.automacoes?.payload ?? {};
  const payload = { ...automationPayload, ...execution.payload } as JsonRecord;
  const merged = {
    ...execution.contexto,
    payload,
    automacao: execution.automacoes,
    admin_telefone: fallbackPhone,
  } as JsonRecord;

  const messageTemplate = typeof payload.mensagem === "string" ? payload.mensagem : "";
  const message = renderTemplate(messageTemplate, merged).trim();
  const phone = resolvePhone(payload, execution.contexto, merged);
  const requestPayload = { phone, message };

  if (!message) throw new Error("Payload da automação não possui mensagem.");
  if (!phone) throw new Error("Não foi possível resolver telefone de destino para a automação.");

  if (execution.automacoes?.acao !== "whatsapp") {
    throw new Error(`Ação não suportada: ${execution.automacoes?.acao ?? "sem ação"}`);
  }

  const responsePayload = await sendZapiText(phone, message);
  await logWhatsapp({
    execution,
    phone,
    message,
    status: "sucesso",
    requestPayload,
    responsePayload,
  });
  return responsePayload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Supabase service role não configurado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit ?? 25) || 25, 100);

    const { error: scanError } = await supabase.rpc("criar_eventos_automacoes_recorrentes");
    if (scanError) throw scanError;

    const { data: executions, error: selectError } = await supabase
      .from("automacao_execucoes")
      .select("*, automacoes(id,nome,acao,payload)")
      .eq("status", "pendente")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (selectError) throw selectError;

    const results = [];

    for (const execution of (executions ?? []) as AutomationExecution[]) {
      const { data: locked, error: lockError } = await supabase
        .from("automacao_execucoes")
        .update({ status: "processando", tentativas: execution.tentativas + 1 })
        .eq("id", execution.id)
        .eq("status", "pendente")
        .select("id")
        .maybeSingle();

      if (lockError) throw lockError;
      if (!locked) continue;

      try {
        const responsePayload = await processExecution(execution);
        await supabase
          .from("automacao_execucoes")
          .update({
            status: "sucesso",
            processado_em: new Date().toISOString(),
            resposta: responsePayload,
            erro: null,
          })
          .eq("id", execution.id);
        await supabase
          .from("automacoes")
          .update({ ultima_execucao: new Date().toISOString() })
          .eq("id", execution.automacao_id);
        results.push({ id: execution.id, status: "sucesso" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const payload = {
          ...((execution.automacoes?.payload ?? {}) as JsonRecord),
          ...execution.payload,
        } as JsonRecord;
        const merged = {
          ...execution.contexto,
          payload,
          admin_telefone: fallbackPhone,
        } as JsonRecord;
        const renderedMessage =
          typeof payload.mensagem === "string"
            ? renderTemplate(payload.mensagem, merged).trim()
            : "";
        const phone = resolvePhone(payload, execution.contexto, merged);

        if (phone && renderedMessage) {
          await logWhatsapp({
            execution,
            phone,
            message: renderedMessage,
            status: "erro",
            requestPayload: { phone, message: renderedMessage },
            error: message,
          });
        }

        await supabase
          .from("automacao_execucoes")
          .update({ status: "erro", processado_em: new Date().toISOString(), erro: message })
          .eq("id", execution.id);
        results.push({ id: execution.id, status: "erro", error: message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
