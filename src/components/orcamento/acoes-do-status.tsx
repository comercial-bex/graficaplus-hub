import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, RefreshCw, Timer, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import {
  MENSAGEM_PERFIL_NAO_ALTERA,
  MENSAGEM_PERFIL_NAO_APAGA,
  acoesDoOrcamento,
  mensagemDaExclusao,
  mensagemDaFuncao,
  rotuloDoStatus,
} from "@/domain/orcamentos/acoes-do-orcamento";
import { FUNCAO_DE_RENOVACAO, argumentosDaRenovacao } from "@/domain/orcamentos/renovacao";
import { ROTULO_DO_STATUS } from "@/components/orcamento/tela/comum";

/**
 * Os passos do status do orçamento, no lugar do Select que gravava qualquer valor (17/11/2026).
 *
 * Aprovar e Renovar passam por funções do banco. Recusar e Marcar como expirado são UPDATE só a partir de
 * "enviado" e conferem a contagem de linhas: a policy devolve 0 linhas sem erro para quem não pode alterar.
 * Apagar só existe em rascunho, para admin e gestor, e o gatilho do banco barra o que tem rastro.
 * Função que ainda não existe no banco vira mensagem simples, nunca um UPDATE direto no lugar.
 */

const OBS_APROVACAO = "Aprovado pela equipe: o cliente confirmou por WhatsApp ou no balcão.";

export function AcoesDoStatus({
  orc,
  podeAlterar,
}: {
  orc: { id: string; status: string; os_id?: string | null; valor_total?: number | string | null; enviado_em?: string | null; validade_dias?: number | null; created_at?: string | null };
  /** `orcamentos.update`: já calculado pela tela. */
  podeAlterar: boolean;
}) {
  const { hasPermission, hasRole } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [ocupado, setOcupado] = useState(false);

  const acoes = acoesDoOrcamento(
    orc,
    {
      aprovar: hasPermission("orcamentos.approve"),
      alterar: podeAlterar,
      renovar: hasPermission("orcamentos.create") && hasPermission("orcamentos.send"),
      apagar: hasRole("admin") || hasRole("gestor"),
    },
    new Date(),
  );

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["orcamento", orc.id] });
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
  };

  async function executar(fazer: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    try {
      await fazer();
    } finally {
      setOcupado(false);
    }
  }

  const aprovar = () =>
    executar(async () => {
      const { data, error } = await (supabase.rpc as any)("aprovar_orcamento", {
        p_orcamento_id: orc.id,
        p_observacao: OBS_APROVACAO,
      });
      if (error) return void toast.error(mensagemDaFuncao(error, "Não foi possível aprovar o orçamento."));
      toast.success(data?.ja_aprovado ? "Este orçamento já estava aprovado." : "Aprovação registrada.");
      atualizar();
    });

  const renovar = () =>
    executar(async () => {
      const { error } = await (supabase.rpc as any)(FUNCAO_DE_RENOVACAO, argumentosDaRenovacao(orc.id));
      if (error) return void toast.error(mensagemDaFuncao(error, "Não foi possível renovar o orçamento."));
      toast.success("Validade renovada. Agora mande ao cliente pelo botão Enviar.");
      atualizar();
    });

  const mudarDeEnviadoPara = (novo: "rejeitado" | "expirado", aviso: string) =>
    executar(async () => {
      const { data, error } = await supabase
        .from("orcamentos")
        .update({ status: novo })
        .eq("id", orc.id)
        .eq("status", "enviado")
        .select("id");
      if (error) return void toast.error(mensagemErro(error));
      if (!data || data.length === 0) return void toast.error(MENSAGEM_PERFIL_NAO_ALTERA);
      toast.success(aviso);
      atualizar();
    });

  const apagar = () =>
    executar(async () => {
      const { data, error } = await supabase
        .from("orcamentos")
        .delete()
        .eq("id", orc.id)
        .eq("status", "rascunho")
        .select("id");
      if (error) return void toast.error(mensagemDaExclusao(error));
      if (!data || data.length === 0) return void toast.error(MENSAGEM_PERFIL_NAO_APAGA);
      toast.success("Rascunho apagado.");
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      navigate({ to: "/orcamentos" });
    });

  const botao = "h-11 md:h-10 text-base";

  return (
    <div className="flex items-center gap-2 flex-wrap md:pl-12" data-testid="acoes-do-status">
      <span className="text-base text-muted-foreground" data-testid="situacao-do-orcamento">
        Situação: <strong className="text-foreground">{rotuloDoStatus(ROTULO_DO_STATUS, orc.status)}</strong>
      </span>

      {acoes.aprovar && (
        <ConfirmarAcao
          grande
          titulo="Registrar a aprovação do cliente?"
          descricao="Isto registra a aprovação do cliente, como se ele tivesse aprovado. O cliente pode receber um aviso no WhatsApp. Use só se ele já confirmou por WhatsApp ou no balcão."
          rotuloConfirmar="Registrar aprovação"
          aoConfirmar={aprovar}
        >
          <Button variant="outline" className={botao} disabled={ocupado} data-testid="acao-aprovar">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
          </Button>
        </ConfirmarAcao>
      )}

      {acoes.recusar && (
        <ConfirmarAcao
          grande
          titulo="Marcar como recusado?"
          descricao="O orçamento fica como recusado e o cliente não consegue mais responder pelo link. Para voltar atrás, será preciso falar com o gestor."
          rotuloConfirmar="Marcar como recusado"
          aoConfirmar={() => mudarDeEnviadoPara("rejeitado", "Orçamento marcado como recusado.")}
        >
          <Button variant="outline" className={botao} disabled={ocupado} data-testid="acao-recusar">
            <Ban className="h-4 w-4 mr-1" /> Marcar como recusado
          </Button>
        </ConfirmarAcao>
      )}

      {acoes.expirar && (
        <ConfirmarAcao
          grande
          titulo="Marcar como expirado?"
          descricao="O orçamento fica como expirado e o cliente não consegue mais responder pelo link. Você pode renovar depois."
          rotuloConfirmar="Marcar como expirado"
          aoConfirmar={() => mudarDeEnviadoPara("expirado", "Orçamento marcado como expirado.")}
        >
          <Button variant="outline" className={botao} disabled={ocupado} data-testid="acao-expirar">
            <Timer className="h-4 w-4 mr-1" /> Marcar como expirado
          </Button>
        </ConfirmarAcao>
      )}

      {acoes.renovar && (
        <ConfirmarAcao
          grande
          titulo="Renovar este orçamento?"
          descricao="A validade passa a contar de hoje e o orçamento volta a ficar enviado, e o link do cliente volta a aceitar resposta. Nenhuma mensagem é enviada ao cliente agora."
          rotuloConfirmar="Renovar"
          aoConfirmar={renovar}
        >
          <Button className={botao} disabled={ocupado} data-testid="acao-renovar">
            <RefreshCw className="h-4 w-4 mr-1" /> Renovar
          </Button>
        </ConfirmarAcao>
      )}

      {acoes.apagar && (
        <ConfirmarAcao
          grande
          destrutivo
          titulo="Apagar este rascunho?"
          descricao="O rascunho será apagado e não dá para desfazer. Só rascunho que nunca foi enviado pode ser apagado."
          rotuloConfirmar="Apagar rascunho"
          aoConfirmar={apagar}
        >
          <Button variant="destructive" className={botao} disabled={ocupado} data-testid="acao-apagar-rascunho">
            <Trash2 className="h-4 w-4 mr-1" /> Apagar rascunho
          </Button>
        </ConfirmarAcao>
      )}
    </div>
  );
}
