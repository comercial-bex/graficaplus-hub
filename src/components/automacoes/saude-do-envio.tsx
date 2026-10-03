/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { PARADA_APOS_MS } from "@/domain/automacoes/execucoes";
import { envioFunciona, saudeDoEnvio, type ItemSaude } from "@/domain/automacoes/saude";
import type { InstanciaResumo } from "@/domain/whatsapp/situacao-conexao";

/**
 * As três peças que fazem a mensagem sair, medidas a cada minuto.
 *
 * Cada consulta falha sozinha: uma falha vira "não deu para conferir" com o
 * motivo, nunca "ok". Tela que diz que está tudo bem porque a pergunta caiu é
 * pior que tela nenhuma.
 */
export function useSaudeDoEnvio() {
  const { hasRole } = useAuth();
  // `logs_auditoria` só é legível por admin e gestor (policy "logs admin read").
  // Para os outros a consulta volta VAZIA, não com erro — e vazio aqui diria
  // "nenhuma falha". Melhor não perguntar.
  const leRastro = hasRole("admin") || hasRole("gestor");

  const consulta = useQuery({
    queryKey: ["automacoes-saude", leRastro],
    refetchInterval: 60_000,
    queryFn: async () => {
      const limite = new Date(Date.now() - PARADA_APOS_MS).toISOString();
      const db = supabase as any;
      const erros: string[] = [];

      const inst = await db
        .from("whatsapp_instancias")
        .select("conectado, status, ultimo_evento_at, ativa")
        .eq("ativa", true);
      if (inst.error) erros.push(`conexão do WhatsApp: ${mensagemErro(inst.error)}`);

      // As duas filas de saída: automação (só a função process-automations
      // consome) e avisos ao cliente (a função ou o envio do app).
      const auto = await db
        .from("automacao_execucoes")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .lte("scheduled_at", limite);
      // Em notificacoes_fila a data é a de criação: um aviso reagendado depois
      // de uma falha contaria como parado. Hoje (0 tentativas) não muda nada.
      const avisos = await db
        .from("notificacoes_fila")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .lte("created_at", limite);
      const maisAntigo = await db
        .from("notificacoes_fila")
        // pai-arbitrario-ok: lê a data do aviso parado mais antigo só para
        // MOSTRAR desde quando a fila não anda. Não grava vínculo nenhum.
        .select("created_at")
        .eq("status", "pendente")
        .lte("created_at", limite)
        .order("created_at", { ascending: true })
        .limit(1);
      const autoMaisAntiga = await db
        .from("automacao_execucoes")
        // pai-arbitrario-ok: idem — a mensagem parada mais antiga, para mostrar.
        .select("scheduled_at")
        .eq("status", "pendente")
        .lte("scheduled_at", limite)
        .order("scheduled_at", { ascending: true })
        .limit(1);
      const filaFalhou = auto.error || avisos.error || maisAntigo.error || autoMaisAntiga.error;
      if (filaFalhou) erros.push(`fila de envio: ${mensagemErro(filaFalhou)}`);

      let falhas: { total: number; ultimoErro: string | null; ultimoEm: string | null } | null =
        null;
      if (leRastro) {
        const desde = new Date(Date.now() - 7 * 86400_000).toISOString();
        const rastro = await db
          .from("logs_auditoria")
          // pai-arbitrario-ok: a falha mais recente do motor, para mostrar o
          // motivo. O total vem do count. Não grava nada.
          .select("created_at, detalhes", { count: "exact" })
          .eq("entidade", "automacoes")
          .eq("acao", "motor_falhou")
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .limit(1);
        if (rastro.error) {
          erros.push(`registro de falhas: ${mensagemErro(rastro.error)}`);
        } else {
          const ultimo = rastro.data?.[0];
          falhas = {
            total: rastro.count ?? 0,
            ultimoErro: (ultimo?.detalhes?.erro as string | undefined) ?? null,
            ultimoEm: ultimo?.created_at ?? null,
          };
        }
      }

      const itens = saudeDoEnvio({
        instancias: inst.error ? null : ((inst.data ?? []) as InstanciaResumo[]),
        paradas: filaFalhou
          ? null
          : {
              automacoes: auto.count ?? 0,
              automacoesDesde: autoMaisAntiga.data?.[0]?.scheduled_at ?? null,
              avisos: avisos.count ?? 0,
              avisosDesde: maisAntigo.data?.[0]?.created_at ?? null,
            },
        falhasDoMotor: falhas,
      });
      return { itens, erros };
    },
  });

  const itens: ItemSaude[] = consulta.data?.itens ?? [];
  return {
    itens,
    erros: consulta.data?.erros ?? [],
    carregando: consulta.isPending,
    erroGeral: consulta.isError ? mensagemErro(consulta.error) : null,
    // Enquanto não sabe, trata como "não funciona": é o lado seguro para
    // decidir se automação nova nasce ligada.
    funciona: consulta.isSuccess && envioFunciona(itens),
  };
}

const ICONE = {
  ok: (
    <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" aria-hidden="true" />
  ),
  problema: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
  desconhecido: (
    <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  ),
};

export function SaudeDoEnvio({ saude }: { saude: ReturnType<typeof useSaudeDoEnvio> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          O que precisa estar funcionando para a mensagem sair
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {saude.erroGeral ? (
          <p className="text-sm text-destructive">
            Não deu para conferir o envio: {saude.erroGeral}
          </p>
        ) : saude.carregando ? (
          <p className="text-sm text-muted-foreground">Conferindo WhatsApp, fila e motor…</p>
        ) : (
          <>
            {saude.itens.map((i) => (
              <div key={i.chave} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5">{ICONE[i.estado]}</span>
                <div>
                  <p className="font-medium">{i.titulo}</p>
                  <p className="text-muted-foreground">{i.detalhe}</p>
                </div>
              </div>
            ))}
            {saude.erros.length > 0 && (
              <p className="text-xs text-destructive">
                Consultas que falharam: {saude.erros.join(" · ")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
