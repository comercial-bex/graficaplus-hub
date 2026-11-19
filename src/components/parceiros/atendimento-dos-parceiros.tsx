import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Headset, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { parceirosSemContato } from "@/lib/parceiro-atendimento-api";
import { agruparPorResponsavel, diaMes, reais } from "@/domain/parceiros/sem-contato";

/** Parceiros com chamado aberto (ou fechado sem nenhuma mensagem) que a equipe ainda não atendeu, por responsável. */
export function AtendimentoDosParceiros() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["parceiros-sem-contato"],
    queryFn: parceirosSemContato,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || data === null) return null; // ainda sem a função no banco
  const sem = (data?.lista ?? []).filter((l) => l.sem_contato);
  // Conta só chamados abertos ou fechados sem mensagem (fechados com atendimento não entram).
  const total = (data?.lista ?? []).filter((l) => !l.fechado_em || l.sem_contato).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Headset className="h-4 w-4 text-muted-foreground" />
          Atendimento dos parceiros
        </h3>
        {data && (
          <span className="text-xs text-muted-foreground">
            {sem.length === 0
              ? `Todos os ${total} parceiros com chamado estão em dia.`
              : `${sem.length} de ${total} sem contato há mais de ${data.horas} horas`}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{mensagemErro(error)}</p>}
      {sem.length > 0 && (
        <div className="mt-3 space-y-3">
          {agruparPorResponsavel(sem).map((g) => (
            <div key={g.responsavel_id ?? "sem"}>
              <p className="text-sm font-medium">
                {g.responsavel_nome}{" "}
                <span className="text-muted-foreground">· {g.linhas.length}</span>
              </p>
              <ul className="mt-1 divide-y divide-border text-sm">
                {g.linhas.map((l) => (
                  <li key={l.parceiro_id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{l.nome}</span>
                      {l.fechado_sem_contato && (
                        <Badge variant="destructive" className="ml-2 align-middle">
                          Fechado sem mensagem · {l.fechado_por_nome ?? "automação"}
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        · {l.horas_sem_contato ?? 0}h sem contato
                        {l.fechado_sem_contato
                          ? " · chamado fechado sem ninguém falar com ele"
                          : l.ultima_entrada &&
                        l.ultima_saida_equipe &&
                        l.ultima_entrada > l.ultima_saida_equipe
                            ? " · escreveu e espera resposta"
                            : " · ninguém falou com ele ainda"}
                        {l.credito > 0 && l.credito_vence_em
                          ? ` · crédito ${reais(l.credito)} até ${diaMes(new Date(l.credito_vence_em))}`
                          : ""}
                        {l.comprou ? " · já compra" : ""}
                      </span>
                    </span>
                    {l.conversa_id && (
                      <Button asChild size="sm" variant="outline" className="shrink-0">
                        <Link to="/whatsapp" search={{ conversa: l.conversa_id }}>
                          <MessageCircle className="mr-1 h-4 w-4" /> Conversa
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
