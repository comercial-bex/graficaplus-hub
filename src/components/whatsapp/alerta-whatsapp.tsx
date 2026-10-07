import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { alertasDaConexao } from "@/domain/whatsapp/diagnostico-webhooks";

/** Faixa de alerta no topo do sistema quando o WhatsApp cai ou fica mudo. */
export function AlertaWhatsapp({ compacto = false }: { compacto?: boolean }) {
  const { hasPermission, hasRole } = useAuth();
  // Quem ABRE o Monitor: a mesma régua da rota em src/lib/permissions.ts.
  const abreMonitor = hasPermission("whatsapp.manage") || hasPermission("whatsapp.read");
  // Quem VÊ o aviso: além de quem opera o WhatsApp, administrador e gestor.
  // Antes só quem tinha permissão de WhatsApp via a faixa — admin e vendedor —,
  // e o gestor, que é quem cobra o atendimento, não sabia que o WhatsApp
  // estava fora do ar. A leitura de `whatsapp_instancias` já era liberada a
  // toda a equipe (policy `is_staff`); o portão estava só aqui na tela.
  const pode = abreMonitor || hasRole("admin") || hasRole("gestor");

  const consulta = useQuery({
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
      //
      // As duas leituras LANÇAM no erro (06/10/2026): antes, `{ data: inst }`
      // sem o error virava "instância nula" e a faixa sumia — a tela ficava
      // muda justo quando o banco não respondia.
      const { data: inst, error: erroInstancia } = await supabase
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
      if (erroInstancia) throw erroInstancia;
      const desde = new Date(Date.now() - 864e5).toISOString();
      const { count, error: erroEventos } = await supabase
        .from("whatsapp_webhook_eventos")
        .select("id", { count: "exact", head: true })
        .not("erro", "is", null)
        .gte("created_at", desde);
      if (erroEventos) throw erroEventos;
      return alertasDaConexao(inst ?? null, count ?? 0);
    },
  });

  if (!pode) return null;

  if (consulta.isError) {
    // Faixa própria: "não deu para conferir" não é "está tudo bem".
    return (
      <div className={compacto ? "space-y-2" : "mb-4 space-y-2"}>
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-[color:var(--bex-amber)]/50 bg-[color:var(--bex-amber)]/10 p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
          <div className="flex-1">
            <span className="font-semibold text-foreground">Não deu para conferir o WhatsApp.</span>{" "}
            <span className="text-muted-foreground">
              A leitura da conexão falhou ({mensagemErro(consulta.error)}). Isto não quer dizer que
              está conectado.
            </span>
          </div>
          {!compacto && abreMonitor && (
            <Link to="/whatsapp-monitor" className="shrink-0 text-xs font-medium text-primary underline">
              Abrir Monitor
            </Link>
          )}
        </div>
      </div>
    );
  }

  const alertas = consulta.data ?? [];
  if (alertas.length === 0) return null;
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
          {/* O gestor vê o aviso mas não abre o Monitor (a rota exige
              whatsapp.read/manage). Link para uma tela que responde "sem
              acesso" é beco sem saída — então só aparece para quem entra. */}
          {!compacto && abreMonitor && (
            <Link to="/whatsapp-monitor" className="shrink-0 text-xs font-medium text-primary underline">
              Abrir Monitor
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
