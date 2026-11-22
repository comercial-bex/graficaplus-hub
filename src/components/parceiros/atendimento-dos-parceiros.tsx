import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Headset, MessageCircle, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { parceirosSemContato, reabrirChamadoDoParceiro } from "@/lib/parceiro-atendimento-api";
import {
  agruparPorResponsavel,
  diaMes,
  FRASE_CHAMADO_JA_ABERTO,
  fraseDoChamadoReaberto,
  podeReabrirChamado,
  reais,
} from "@/domain/parceiros/sem-contato";

/**
 * Parceiros com chamado aberto (ou fechado sem nenhuma mensagem) que a equipe ainda não atendeu, por responsável.
 * O chamado fechado sem atendimento ganha o botão "Reabrir chamado" (só a gerência de parceiros e o responsável do parceiro;
 * o banco confere de novo). Reabrir não mexe nas regras de fechamento da caixa do WhatsApp: só abre um chamado novo.
 */
export function AtendimentoDosParceiros() {
  const { hasPermission, user } = useAuth();
  const podeGerir = hasPermission("parceiros.manage");
  const cliente = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["parceiros-sem-contato"],
    queryFn: parceirosSemContato,
    refetchInterval: 5 * 60_000,
  });
  const reabrir = useMutation({
    mutationFn: (parceiroId: string) => reabrirChamadoDoParceiro(parceiroId),
    onSuccess: (r) => {
      toast.success(r.jaAberto ? FRASE_CHAMADO_JA_ABERTO : fraseDoChamadoReaberto(r.numero, data?.horas ?? 48));
      void cliente.invalidateQueries({ queryKey: ["parceiros-sem-contato"] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
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
                          Fechado sem mensagem{l.fechado_em ? ` · ${diaMes(new Date(l.fechado_em))}` : ""}
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
                    <span className="flex shrink-0 flex-wrap justify-end gap-2">
                      {podeReabrirChamado({
                        fechadoSemContato: l.fechado_sem_contato,
                        podeGerir,
                        usuarioId: user?.id ?? null,
                        responsavelId: l.responsavel_id,
                      }) && (
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-11"
                          disabled={reabrir.isPending}
                          onClick={() => reabrir.mutate(l.parceiro_id)}
                          data-testid={`reabrir-chamado-${l.parceiro_id}`}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                          {reabrir.isPending && reabrir.variables === l.parceiro_id ? "Reabrindo…" : "Reabrir chamado"}
                        </Button>
                      )}
                      {l.conversa_id && (
                        <Button asChild size="sm" variant="outline" className="min-h-11">
                          <Link to="/whatsapp" search={{ conversa: l.conversa_id }}>
                            <MessageCircle className="mr-1 h-4 w-4" /> Conversa
                          </Link>
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground" data-testid="dica-reabrir-chamado">
        Chamado fechado sem ninguém falar com o parceiro aparece aqui com o botão <span className="font-medium">Reabrir chamado</span>.
        Reabrir só abre um chamado novo, sem mensagem para o parceiro, e o prazo de {data?.horas ?? 48} horas recomeça.
      </p>
    </section>
  );
}
