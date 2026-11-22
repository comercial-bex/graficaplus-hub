import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalculadoraDeTrofeu } from "@/components/trofeus/calculadora-de-trofeu";

/**
 * A porta nova do orçamento de troféu de acrílico (/orcamento-trofeu-novo). Como a do 3D: cria o orçamento comum,
 * grava o troféu (e a arte) como linhas dele e leva a pessoa para /orcamentos/<id>, o mesmo lugar de qualquer orçamento.
 */
export const Route = createFileRoute("/_authenticated/orcamento-trofeu-novo")({
  head: () => ({ meta: [{ title: "Novo orçamento de troféu — BEX PRINT OS" }] }),
  component: NovoOrcamentoDeTrofeu,
});

function NovoOrcamentoDeTrofeu() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <CalculadoraDeTrofeu
        modo="novo-orcamento"
        orcamentoId={null}
        clienteId={null}
        onSalvo={(r) => navigate({ to: "/orcamentos/$id", params: { id: r.orcamentoId } })}
        onCancelar={() => navigate({ to: "/orcamentos" })}
      />
    </div>
  );
}
