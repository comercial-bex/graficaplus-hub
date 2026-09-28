import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { alertasDaConexao } from "@/domain/whatsapp/diagnostico-webhooks";

/** Faixa de alerta no topo do sistema quando o WhatsApp cai ou fica mudo. */
export function AlertaWhatsapp({ compacto = false }: { compacto?: boolean }) {
  const { hasPermission } = useAuth();
  const pode = hasPermission("whatsapp.manage") || hasPermission("whatsapp.read");

  const { data: alertas = [] } = useQuery({
    queryKey: ["whatsapp-alertas"],
    enabled: pode,
    refetchInterval: 120_000,
    queryFn: async () => {
      // pai-arbitrario-ok: este alerta LÊ para avisar, não grava vínculo
      // nenhum — o risco que a guarda protege (pendurar um registro no pai
      // errado, calado) não existe aqui. O `.eq("ativa", true)` foi
      // acrescentado porque sem ele o alerta leria uma instância DESATIVADA e
      // diria que o WhatsApp está fora do ar com a instância nova rodando.
      // A gráfica opera uma instância; se um dia operar duas, este alerta
      // precisa passar a olhar todas e avisar da que caiu.
      const { data: inst } = await supabase
        .from("whatsapp_instancias")
        // pai-arbitrario-ok: LÊ para avisar, não grava vínculo — o risco que a
        // guarda protege (pendurar registro no pai errado, calado) não existe
        // aqui. O `.eq("ativa", true)` entrou porque sem ele o alerta leria
        // uma instância DESATIVADA e diria que o WhatsApp caiu com a nova
        // rodando. Se um dia houver duas ativas, este alerta precisa olhar
        // todas e avisar da que caiu.
        .select("conectado, status, ultimo_evento_at, ativa")
        .eq("ativa", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      const desde = new Date(Date.now() - 864e5).toISOString();
      const { count } = await supabase
        .from("whatsapp_webhook_eventos")
        .select("id", { count: "exact", head: true })
        .not("erro", "is", null)
        .gte("created_at", desde);
      return alertasDaConexao(inst ?? null, count ?? 0);
    },
  });

  if (!pode || alertas.length === 0) return null;
  return (
    <div className={compacto ? "space-y-2" : "mb-4 space-y-2"}>
      {alertas.map((a) => (
        <div
          key={a.titulo}
          role="alert"
          className={`flex items-start gap-2 rounded border p-3 text-sm ${
            a.nivel === "critico"
              ? "border-destructive/50 bg-destructive/10"
              : "border-[color:var(--bex-amber)]/50 bg-[color:var(--bex-amber)]/10"
          }`}
        >
          <TriangleAlert
            className={`mt-0.5 h-4 w-4 shrink-0 ${a.nivel === "critico" ? "text-destructive" : "text-[color:var(--bex-amber)]"}`}
          />
          <div className="flex-1">
            <span className="font-semibold text-foreground">{a.titulo}.</span>{" "}
            <span className="text-muted-foreground">{a.detalhe}</span>
          </div>
          {!compacto && (
            <Link to="/whatsapp-monitor" className="shrink-0 text-xs font-medium text-primary underline">
              Abrir Monitor
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
